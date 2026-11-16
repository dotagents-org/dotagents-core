// Live usage (ADR 0003): each profile's usage asked of Anthropic's OAuth usage endpoint, with the
// login Claude Code keeps, about once a minute. The access token is renewed here only when it is
// about to expire, and the rotated token written back at once to the copy it came from: a renewal
// spends the old refresh token, so a copy left behind signs that profile out. A copy Claude Code
// also uses (the slot, a profile's own folder) is renewed only once it has expired, since Claude
// Code renews before that while a session runs; the vault's copy is renewed a few minutes early.
//
// What comes back is kept in <state>/usage/<profile>.json, in the shape of Claude Code's own cache,
// so every surface reads it next to that cache (core/accounts/providers/claude-snapshot.ts) and none asks again. Errors and
// 429s back off. Tokens are never printed, logged or written anywhere but the copy they came from.
//
// The network goes through a Fetcher; the tests pass a fake one.

import { recordHistory } from "../spend.ts";
import fs from "node:fs";
import { PALETTE, type Profile, claudeProfiles } from "../../machine-state.ts";
import { readRecord } from "../usage-record.ts";
import { defaultConfigDir } from "../../claude-code.ts";
import { liveLogin, loginMark } from "./claude-store.ts";
import { withLoginLock, writePrivate } from "../vault.ts";
import type { Asked } from "../providers.ts";
import { normalize } from "../usage.ts";

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
// dotagents says who it is: the Usage Policy forbids misrepresenting the client being used.
const USER_AGENT = `dotagents/${JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version}`;

// At most one request per profile in this time, from any number of dotagents processes.
export const LIVE_EVERY_MS = 55_000;
// Early renewal of the vault's copy, which nobody else renews.
const RENEW_EARLY_MS = 5 * 60_000;

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
async function accessToken(file: string, shared: boolean, fetcher: Fetcher, now: () => number): Promise<{ token: string } | { error: string; refused?: boolean }> {
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
    // 400 and 401 are the refresh token turned down (invalid_grant); anything else may pass.
    if (res.status !== 200) return { error: `couldn't renew the login (${errorText(res.status, res.text)})`, refused: res.status === 400 || res.status === 401 };
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

// Asks Anthropic for one profile's usage: the answer as a record to keep, or why it failed. The
// pacing, the backoff and the writing are the common refresh's (core/accounts/usage-refresh.ts).
export async function askClaude(p: Profile, { fetcher = httpFetcher, now = Date.now }: { fetcher?: Fetcher; now?: () => number } = {}): Promise<Asked> {
  const login = liveLogin(p);
  if (!login) return { ok: false, error: "no login saved for it" };
  const fail = (error: string, { retryAfter, refused = false }: { retryAfter?: number; refused?: boolean } = {}): Asked => ({
    ok: false,
    error,
    retryAfter,
    // The login as it is now in its file: the one just refused.
    refusedMark: refused ? loginMark(fs.readFileSync(login.file, "utf8")) : null,
  });

  let res: Awaited<ReturnType<Fetcher>>;
  try {
    const token = await accessToken(login.file, login.shared, fetcher, now);
    if ("error" in token) return fail(token.error, { refused: token.refused });
    res = await fetcher(USAGE_URL, { method: "GET", headers: { authorization: `Bearer ${token.token}`, "anthropic-beta": BETA, "user-agent": USER_AGENT, "content-type": "application/json" } });
  } catch (err) {
    return fail(`couldn't reach Anthropic (${(err as Error).name === "TimeoutError" ? "timed out" : (err as Error).message})`);
  }
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    return fail("Anthropic asks to wait (429)", { retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined });
  }
  if (res.status === 401) return fail("Anthropic refused the login (401); sign in again", { refused: true });
  if (res.status !== 200) return fail(`Anthropic answered ${errorText(res.status, res.text)}`);
  let utilization: unknown;
  try {
    utilization = JSON.parse(res.text);
  } catch {
    utilization = null;
  }
  const at = now();
  const usage = normalize({ fetchedAtMs: at, utilization }, new Date(at));
  if (!usage) return fail("Anthropic's answer is not a usage this dotagents reads");
  // The history of the % that usage --spend reads, from this reading, once the reading is kept: no request of its own
  return { ok: true, record: { fetchedAtMs: at, accountUuid: login.accountUuid, utilization, askedAtMs: at }, afterWrite: () => recordHistory(p.name, usage.windows, new Date(at)) };
}

// The profiles of this side; without any, the one in ~/.claude.
export function sideProfiles(): Profile[] {
  const profiles = claudeProfiles();
  return profiles.length ? profiles : [{ name: "claude", color: PALETTE[0], default: true, configDir: defaultConfigDir() }];
}
