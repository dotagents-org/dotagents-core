// Live usage (ADR 0008): each profile's usage asked of Anthropic's OAuth usage endpoint, with the
// login Claude Code keeps, about once a minute. The access token is renewed here only when it is
// about to expire, and the rotated token written back at once to the copy it came from: a renewal
// spends the old refresh token, so a copy left behind signs that profile out. A copy Claude Code
// also uses (the slot, a profile's own folder) is renewed only once it has expired, since Claude
// Code renews before that while a session runs; the vault's copy is renewed a few minutes early.
//
// What comes back is kept in <state>/usage/<profile>.json, in the shape of Claude Code's own cache,
// so every surface reads it next to that cache (core/snapshot.ts) and none asks again. Errors and
// 429s back off. Tokens are never printed, logged or written anywhere but the copy they came from.
//
// The network goes through a Fetcher; the tests pass a fake one.

import fs from "node:fs";
import path from "node:path";
import { type Profile, loadProfiles, stateDir } from "./machine-state.ts";
import { report, section } from "./output.ts";
import { PALETTE } from "./profiles.ts";
import { defaultConfigDir } from "./claude-code.ts";
import { state } from "./state.ts";
import { liveLogin, withLoginLock, writePrivate } from "./switch.ts";
import { normalize } from "./usage.ts";

export type Fetcher = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }) => Promise<{ status: number; headers: { get(name: string): string | null }; text: string }>;

export const httpFetcher: Fetcher = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, headers: res.headers, text: (await res.text()).slice(0, 64_000) };
};

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
// Claude Code's public OAuth client, not a secret.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const BETA = "oauth-2025-04-20";
// The endpoint answers other clients with 429: this names a real Claude Code release, in the form
// the endpoint reads.
const USER_AGENT = "claude-cli/2.1.314 (external, cli)";

// At most one request per profile in this time, from any number of dotagents processes.
export const LIVE_EVERY_MS = 55_000;
// Early renewal of the vault's copy, which nobody else renews.
const RENEW_EARLY_MS = 5 * 60_000;
const BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

// What dotagents keeps per profile: the last usage, as Claude Code's cache keeps it (fetchedAtMs,
// accountUuid, utilization), and the last attempt, with its error and when to try again.
type LiveRecord = { fetchedAtMs?: number; accountUuid?: string; utilization?: unknown; askedAtMs?: number; failures?: number; retryAtMs?: number; error?: string };

const recordFile = (name: string, dir = stateDir()) => path.join(dir, "usage", `${name}.json`);

export function readRecord(name: string, dir?: string): LiveRecord {
  try {
    const data = JSON.parse(fs.readFileSync(recordFile(name, dir), "utf8"));
    return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// In one step, so a surface reading it never sees half a file.
const writeRecord = (name: string, record: LiveRecord) => writePrivate(recordFile(name), `${JSON.stringify({ version: 1, ...record }, null, 2)}\n`);

// The live usage of a profile, as the snapshot reads it: the cache-shaped part and the last error.
export function liveUsage(name: string, dir?: string) {
  const r = readRecord(name, dir);
  return { cache: r.fetchedAtMs ? { fetchedAtMs: r.fetchedAtMs, accountUuid: r.accountUuid, utilization: r.utilization } : null, error: r.error ?? null };
}

// The message of an error body, in its three known shapes; never the body itself, which a broken
// server could fill with anything.
function errorText(status: number, text: string) {
  let message: unknown;
  try {
    const body = JSON.parse(text);
    message = body?.error_description ?? body?.error?.message ?? body?.error;
  } catch {
    message = undefined;
  }
  return `HTTP ${status}${typeof message === "string" ? `: ${message.slice(0, 160)}` : ""}`;
}

type Oauth = { accessToken?: unknown; refreshToken?: unknown; expiresAt?: unknown };

const readCredentials = (file: string): { all: Record<string, unknown>; oauth: Oauth } | null => {
  try {
    const all = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof all?.claudeAiOauth === "object" && all.claudeAiOauth !== null ? { all, oauth: all.claudeAiOauth } : null;
  } catch {
    return null;
  }
};

// A valid access token for the login, renewed first when it is due. Under the lock, and read again
// there: a switch, another dotagents or Claude Code may have renewed it a moment ago.
async function accessToken(file: string, shared: boolean, fetcher: Fetcher, now: () => number): Promise<{ token: string } | { error: string }> {
  return withLoginLock(async () => {
    const creds = readCredentials(file);
    if (!creds || typeof creds.oauth.accessToken !== "string" || !creds.oauth.accessToken) return { error: "no login in its credentials; sign in again" };
    const expiresAt = typeof creds.oauth.expiresAt === "number" ? creds.oauth.expiresAt : 0;
    if (expiresAt - now() > (shared ? 0 : RENEW_EARLY_MS)) return { token: creds.oauth.accessToken };
    if (typeof creds.oauth.refreshToken !== "string" || !creds.oauth.refreshToken) return { error: "the login expired and has no refresh token; sign in again" };
    const res = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-beta": BETA, "user-agent": USER_AGENT },
      body: JSON.stringify({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: creds.oauth.refreshToken }),
    });
    if (res.status !== 200) return { error: `couldn't renew the login (${errorText(res.status, res.text)})` };
    let body: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    try {
      body = JSON.parse(res.text);
    } catch {
      body = {};
    }
    if (typeof body.access_token !== "string" || !body.access_token || typeof body.expires_in !== "number" || !(body.expires_in > 0))
      return { error: "couldn't renew the login: the answer has no token" };
    const rotated = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : creds.oauth.refreshToken;
    const oauth = { ...creds.oauth, accessToken: body.access_token, refreshToken: rotated, expiresAt: now() + body.expires_in * 1000 };
    try {
      writePrivate(file, JSON.stringify({ ...creds.all, claudeAiOauth: oauth }));
    } catch (err) {
      // The old refresh token is spent: losing the new one signs the profile out.
      return { error: `renewed the login but couldn't save it to ${file} (${(err as Error).message}); sign in again` };
    }
    return { token: body.access_token };
  });
}

export type LiveResult = { status: "updated" | "ok" | "failed"; detail: string };

// Asks for one profile's usage, unless it was asked a moment ago or is backing off.
export async function fetchLive(p: Profile, { fetcher = httpFetcher, now = Date.now }: { fetcher?: Fetcher; now?: () => number } = {}): Promise<LiveResult> {
  const record = readRecord(p.name);
  const wait = Math.max((record.askedAtMs ?? 0) + LIVE_EVERY_MS, record.retryAtMs ?? 0) - now();
  if (wait > 0) return { status: "ok", detail: record.error ? `${record.error}; again in ${Math.ceil(wait / 1000)}s` : `asked ${Math.round((now() - (record.askedAtMs ?? 0)) / 1000)}s ago` };
  const login = liveLogin(p);
  if (!login) return { status: "failed", detail: "no login saved for it" };
  if (state.dryRun) return { status: "ok", detail: "would ask Anthropic for the usage" };

  const failed = (error: string, retryAfter?: number): LiveResult => {
    const failures = (record.failures ?? 0) + 1;
    const backoff = Math.max(retryAfter ?? 0, Math.min(BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS));
    writeRecord(p.name, { ...record, askedAtMs: now(), failures, retryAtMs: now() + backoff, error });
    return { status: "failed", detail: error };
  };
  writeRecord(p.name, { ...record, askedAtMs: now() });

  let res: Awaited<ReturnType<Fetcher>>;
  try {
    const token = await accessToken(login.file, login.shared, fetcher, now);
    if ("error" in token) return failed(token.error);
    res = await fetcher(USAGE_URL, { method: "GET", headers: { authorization: `Bearer ${token.token}`, "anthropic-beta": BETA, "user-agent": USER_AGENT, "content-type": "application/json" } });
  } catch (err) {
    return failed(`couldn't reach Anthropic (${(err as Error).name === "TimeoutError" ? "timed out" : (err as Error).message})`);
  }
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    return failed("Anthropic asks to wait (429)", Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined);
  }
  if (res.status === 401) return failed("Anthropic refused the login (401); sign in again");
  if (res.status !== 200) return failed(`Anthropic answered ${errorText(res.status, res.text)}`);
  let utilization: unknown;
  try {
    utilization = JSON.parse(res.text);
  } catch {
    utilization = null;
  }
  const at = now();
  if (!normalize({ fetchedAtMs: at, utilization }, new Date(at))) return failed("Anthropic's answer is not a usage this dotagents reads");
  writeRecord(p.name, { fetchedAtMs: at, accountUuid: login.accountUuid, utilization, askedAtMs: at });
  return { status: "updated", detail: "asked Anthropic for the usage" };
}

// The profiles of this side; without any, the one in ~/.claude.
export function sideProfiles(): Profile[] {
  const profiles = loadProfiles();
  return profiles.length ? profiles : [{ name: "claude", color: PALETTE[0], default: true, configDir: defaultConfigDir() }];
}

// usage --refresh, and each tick of the dashboard's server: every profile of this side.
export async function refreshUsage(options: { fetcher?: Fetcher; now?: () => number } = {}) {
  section("Refresh");
  const profiles = sideProfiles();
  const results = await Promise.all(profiles.map(async (p) => ({ p, res: await fetchLive(p, options) })));
  for (const { p, res } of results) report(res.status === "ok" && state.dryRun ? "would update" : res.status, p.name, res.detail);
}
