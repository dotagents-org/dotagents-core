// Live usage of the Codex profiles (ADR 0007, plan phase 4). The source is the official
// `codex app-server`, over stdio JSON-RPC: `initialize`, the `initialized` notification, then
// `account/rateLimits/read`. dotagents never calls chatgpt.com, and no token, client id or
// User-Agent of ours goes on the wire: Codex does the call, with its own login.
//
// Whose folder Codex reads: the profile in this side's slot uses the real CODEX_HOME, as it is
// (Codex renews that login itself, and dotagents never copies it anywhere). Any other profile uses
// a temporary CODEX_HOME holding a copy of its vault auth.json, one at a time under dotagents' login
// lock; if Codex renewed the copy (the refresh token is single-use) and it is still the same
// ChatGPT user, the new copy goes back to the vault, even when the call failed, so the renewal
// is never lost.
//
// What comes back is kept in <state>/usage/<profile>.json, next to Claude's (core/accounts/providers/claude-usage.ts), in this
// shape: version 1; provider "chatgpt"; fetchedAtMs, user (the ChatGPT user the numbers are about),
// plan (Codex's planType, "team"), windows [{ kind: "session" | "week", pct, resetsAt (ms or
// null) }]; and the last attempt: askedAtMs, failures, retryAtMs, error, and refused, the mark
// (codexLoginMark in core/accounts/providers/codex.ts) of the login OpenAI last refused: the slot's auth.json for
// the slot's profile, the vault's for the others. A good answer clears error and refused.
//
// The app-server is started through a SpawnAppServer; the tests pass a fake one.

import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { type Peer, type Profile, peerPath, peerProfiles, peerStateDir, sideName, sidePeer } from "../../machine/machine-state.ts";
import type { PeerView } from "../snapshot.ts";
import { codexAccount, codexLoginMark, codexProfiles, codexSlotProfile, readLogin, slotFile, vaultFile, vaultLogin } from "./codex-store.ts";
import type { Asked } from "../providers.ts";
import { maskUsageError, readRecord } from "../usage-record.ts";
import { type ProfileUsage, STALE_MS, type UsageWindow, usageWindow } from "../usage.ts";
import { writePrivate } from "../vault.ts";
import { recordHistory } from "../usage-history.ts";

export type SpawnAppServer = (home: string) => ChildProcessWithoutNullStreams;

// On Windows codex may be a .cmd shim, which only a shell runs: one command line, as runCodex in
// core/accounts/providers/codex.ts. An API key in the environment would change how Codex signs in: not for this call.
export const spawnAppServer: SpawnAppServer = (home) => {
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  const options = { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"] };
  return process.platform === "win32" ? spawn("codex app-server", { ...options, shell: true }) : spawn("codex", ["app-server"], options);
};

const VERSION = JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version;

// A call that hangs is killed after this.
export const ASK_TIMEOUT_MS = 20_000;

export class RpcError extends Error {
  code?: number;
}

// Windows starts a .cmd shim through a shell. Killing only that shell leaves Codex running
// with its inherited pipes and temporary login. taskkill terminates the whole tree. The PID
// is an OS process id, passed as an argument, never interpolated into a shell command.
export function stopAppServer(
  child: Pick<ChildProcessWithoutNullStreams, "pid" | "kill">,
  signal: NodeJS.Signals = "SIGTERM",
  platform = process.platform,
  run = spawnSync
) {
  if (platform !== "win32") return child.kill(signal);
  if (!Number.isSafeInteger(child.pid) || child.pid! <= 0) return false;
  const stopped = run("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false, stdio: "ignore", windowsHide: true, timeout: 5_000 });
  return stopped.status === 0;
}

// The result of account/rateLimits/read; rejects with an RpcError for an error answer, or an Error
// for a timeout, a command that can't run or one that ends without answering. The process is gone
// when it settles, so a login it renewed is on disk.
export function askRateLimits(spawnIt: SpawnAppServer, home: string, timeoutMs = ASK_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawnIt(home);
    let outcome: { ok: true; value: unknown } | { ok: false; error: Error } | null = null;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      outcome && (outcome.ok ? resolve(outcome.value) : reject(outcome.error));
    };
    const finish = (o: NonNullable<typeof outcome>) => {
      if (outcome) return;
      outcome = o;
      stopAppServer(child);
      // A login may still be renewed until the process exits. Escalate a process that ignores
      // SIGTERM, and wait for close before its temporary home is copied back or removed.
      killTimer = setTimeout(() => stopAppServer(child, "SIGKILL"), 2_000);
      killTimer.unref();
    };
    const timer = setTimeout(() => finish({ ok: false, error: new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`) }), timeoutMs);
    const answer = (m: { result?: unknown; error?: { code?: unknown; message?: unknown } }) => {
      if (!m.error) return { ok: true as const, value: m.result };
      const err = new RpcError(typeof m.error.message === "string" ? m.error.message : "error answer");
      if (typeof m.error.code === "number") err.code = m.error.code;
      return { ok: false as const, error: err };
    };
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.on("error", () => {});
    child.stderr.resume();
    child.on("error", (err) => {
      outcome ??= { ok: false, error: new Error(`couldn't run codex (${err.message})`) };
      settle();
    });
    child.on("close", (code) => {
      outcome ??= { ok: false, error: new Error(`codex app-server ended (exit ${code}) without answering`) };
      settle();
    });
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m?.id === 1) {
        const a = answer(m);
        if (!a.ok) return finish(a);
        send({ method: "initialized" });
        send({ id: 2, method: "account/rateLimits/read" });
      } else if (m?.id === 2) finish(answer(m));
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "dotagents", version: VERSION } } });
  });
}

type StoredWindow = { kind: "session" | "week"; pct: number; resetsAt: number | null };

// Windows are told apart by their length, as the spike saw them: 300 minutes is the session, 10080
// the week. Any other shape is refused, never guessed, and no window at all is unknown, not 0.
const KIND: Record<number, StoredWindow["kind"]> = { 300: "session", 10080: "week" };

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// An idle window: Codex gives a 0% window with nothing used a reset a whole window from the time it
// is asked, where Claude gives none. Read the same as Claude's, as no window open (2 minutes of slack).
const IDLE_SLACK_MS = 2 * 60_000;

export function normalizeRateLimits(result: unknown, nowMs = Date.now()): { plan: string | null; windows: StoredWindow[] } {
  const r = rec(result);
  const snapshot = rec(rec(r?.rateLimitsByLimitId)?.codex) ?? rec(r?.rateLimits);
  if (!snapshot) throw new Error("the answer has no rate limits");
  const windows: StoredWindow[] = [];
  for (const name of ["primary", "secondary"]) {
    if (snapshot[name] === null || snapshot[name] === undefined) continue;
    const w = rec(snapshot[name]);
    const kind = typeof w?.windowDurationMins === "number" ? KIND[w.windowDurationMins] : undefined;
    if (!w || typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) throw new Error(`the ${name} window has no usedPercent`);
    if (!kind) throw new Error(`the ${name} window is ${String(w.windowDurationMins)} minutes long, not a 5-hour or 7-day one`);
    if (windows.some((x) => x.kind === kind)) throw new Error(`two ${kind} windows`);
    if (w.resetsAt !== null && w.resetsAt !== undefined && typeof w.resetsAt !== "number") throw new Error(`the ${name} window's resetsAt is not a time`);
    const resetsAt = typeof w.resetsAt === "number" ? w.resetsAt * 1000 : null;
    const idle = w.usedPercent === 0 && resetsAt !== null && Math.abs(resetsAt - (nowMs + (w.windowDurationMins as number) * 60_000)) <= IDLE_SLACK_MS;
    windows.push({ kind, pct: w.usedPercent, resetsAt: idle ? null : resetsAt });
  }
  if (!windows.length) throw new Error("the answer has no window");
  return { plan: typeof snapshot.planType === "string" ? snapshot.planType : null, windows: windows.sort((a, b) => Number(b.kind === "session") - Number(a.kind === "session")) };
}

// What the app-server says when OpenAI turns the login down (a 401, a spent or revoked refresh
// token), or when there is none to use.
const REFUSED = /\b401\b|unauthori[sz]ed|refresh_token_reused|invalidated|expired|revoked|authentication required/i;

function describe(err: unknown, name: string): { error: string; refused: boolean } {
  const e = err as RpcError;
  const message = maskUsageError(e.message ?? String(err)).slice(0, 160);
  if (e instanceof RpcError) {
    if (e.code === -32601 || /unknown variant|method not found/i.test(e.message)) return { error: "this Codex doesn't offer account/rateLimits/read; update Codex", refused: false };
    if (REFUSED.test(e.message)) return { error: `OpenAI refused the login (${message}); sign in again with: dotagents login ${name}`, refused: true };
  }
  return { error: `couldn't read the usage from codex app-server (${message})`, refused: false };
}

// Asks codex app-server for one profile's usage: the answer as a record to keep, or why it
// failed. The pacing, the backoff and the writing are the common refresh's (core/accounts/usage-refresh.ts).
export async function askCodex(
  p: Profile,
  { spawnIt = spawnAppServer, now = Date.now, timeoutMs = ASK_TIMEOUT_MS }: { spawnIt?: SpawnAppServer; now?: () => number; timeoutMs?: number } = {}
): Promise<Asked> {
  const inSlot = codexSlotProfile()?.name === p.name;
  const login = inSlot ? readLogin(slotFile()) : vaultLogin(p.name);
  if (!login) return { ok: false, error: "no login saved for it" };

  let result: unknown;
  let mark: string | null = null;
  let failure: unknown = null;
  try {
    if (inSlot) {
      try {
        result = await askRateLimits(spawnIt, path.dirname(slotFile()), timeoutMs);
      } catch (err) {
        failure = err;
      }
      const after = readLogin(slotFile());
      if (after?.id !== login.id) return { ok: false, error: "the Codex slot changed accounts while reading usage; try again", discard: true };
      mark = codexLoginMark(after.text);
    } else {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-codex-usage-"));
        try {
          fs.chmodSync(home, 0o700);
          // A file, never the system keyring, so the copy is the login Codex reads.
          fs.writeFileSync(path.join(home, "config.toml"), 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
          fs.writeFileSync(path.join(home, "auth.json"), login.text, { mode: 0o600 });
          try {
            result = await askRateLimits(spawnIt, home, timeoutMs);
          } catch (err) {
            failure = err;
          }
          // Codex renews with a single-use refresh token: the vault keeps the renewed copy.
          const after = readLogin(path.join(home, "auth.json"));
          if (after && after.text !== login.text && after.id === login.id) writePrivate(vaultFile(p.name), after.text);
        } finally {
          fs.rmSync(home, { recursive: true, force: true });
        }
      mark = codexLoginMark(vaultLogin(p.name)?.text ?? "");
    }
  } catch (err) {
    failure = err;
  }

  if (failure) {
    const { error, refused } = describe(failure, p.name);
    return { ok: false, error, refusedMark: refused ? mark : null };
  }
  const at = now();
  let usage;
  try {
    usage = normalizeRateLimits(result, at);
  } catch (err) {
    return { ok: false, error: `Codex's answer is not a usage this dotagents reads (${maskUsageError((err as Error).message).slice(0, 160)})`, refusedMark: null };
  }
  // The %'s history, for usage --spend, as Claude's (core/accounts/spend.ts)
  const history = usage.windows.map((w) => ({ kind: w.kind, pct: w.pct, resetsAt: w.resetsAt === null ? null : new Date(w.resetsAt) }));
  return { ok: true, record: { provider: "chatgpt", fetchedAtMs: at, user: login.id, plan: usage.plan, windows: usage.windows }, afterWrite: () => recordHistory(p.name, history, new Date(at)) };
}

// The usage kept for a Codex profile, as the snapshot reads it: its windows as of now, when they
// were read, the plan, and the last error. Null windows when it was never read, or was read for
// another account than the one saved now.
export function codexLiveUsage(name: string, user: string, now: Date, dir?: string) {
  const r: Record<string, unknown> = readRecord(name, dir);
  const error = typeof r.error === "string" ? r.error : null;
  const rows = Array.isArray(r.windows) ? r.windows : [];
  if (r.user !== user || typeof r.fetchedAtMs !== "number" || !rows.length) return { fetchedAt: null, windows: [] as UsageWindow[], plan: null, error };
  const windows = rows.flatMap((w) => {
    const row = rec(w);
    const win = row && (row.kind === "session" || row.kind === "week") && typeof row.pct === "number" ? usageWindow(row.kind, row.pct, row.resetsAt, now) : null;
    return win ? [win] : [];
  });
  return { fetchedAt: new Date(r.fetchedAtMs), windows, plan: typeof r.plan === "string" ? r.plan : null, error };
}

// The Codex profiles, for the start API (ADR 0007): who they are, and what dotagents last asked of
// codex app-server for their usage (core/accounts/providers/codex-usage.ts), with the plan Codex reports. `no-data` is
// a saved login with nothing read yet; windows are never made up.
// As Claude's: when the other side read the same ChatGPT account later, its numbers win, with where
// they came from. That side's profile may have another name, so its records are matched by user.
// view: as for Claude, the other side only while it is up; without it, whenever it is known.
export function readCodexUsage(now = new Date(), view?: PeerView): ProfileUsage[] {
  const peer = sidePeer();
  const there = peer && !(view && !view.up(peer)) ? peerProfiles(peer).filter((p) => p.provider === "chatgpt") : [];
  return codexProfiles().map((p) => {
    const account = codexAccount(p);
    // The plan the live usage recorded, else the one the saved login says.
    const base = { name: p.name, color: p.color, provider: "chatgpt" as const, fetchedAt: null, windows: [], ...(p.default ? { default: true } : {}), ...(account?.plan ? { plan: account.plan } : {}) };
    if (!account) return { ...base, state: "not-signed-in" };
    let live = codexLiveUsage(p.name, account.user, now);
    let from: string | undefined;
    for (const other of there) {
      const twin = codexLiveUsage(other.name, account.user, now, peerStateDir(peer!));
      if (twin.fetchedAt && !(live.fetchedAt && live.fetchedAt >= twin.fetchedAt)) [live, from] = [{ ...twin, error: live.error }, peer!.name];
    }
    const error = live.error ? { error: live.error } : {};
    if (!live.fetchedAt) return { ...base, ...error, state: "no-data" };
    const stale = now.getTime() - live.fetchedAt.getTime() > STALE_MS;
    return { ...base, ...error, state: stale ? "stale" : "ok", fetchedAt: live.fetchedAt, windows: live.windows, source: "live" as const, ...(live.plan ? { plan: live.plan } : {}), ...(from ? { from } : {}) };
  });
}

// The other side's Codex folder, as this side reaches it: the one its ChatGPT profiles use (its
// CODEX_HOME when they were added), else its ~/.codex. Null when the configured one can't be reached
// from here: never another folder's login in its place.
// The other side's CODEX_HOME as that side names it, when its ChatGPT profiles use one of their own.
export function peerCodexNative(peer: Peer): string | null {
  const configured = peerProfiles(peer).find((p) => p.provider === "chatgpt" && typeof p.configDir === "string");
  return configured ? configured.configDir : null;
}

export function peerCodexHome(peer: Peer) {
  const configured = peerProfiles(peer).find((p) => p.provider === "chatgpt" && typeof p.configDir === "string");
  if (!configured) return path.join(peer.home, ".codex");
  const home = peerPath(configured.configDir, peer);
  return home && fs.existsSync(home) ? home : null;
}

// Which Codex profile is in each side's slot. The other side's slot is told apart by the ChatGPT
// user in its auth.json, matched against this side's vault (the same account on both sides); only
// while that side is up. Its slot is the folder its ChatGPT profiles use (its CODEX_HOME when they
// were added), else its ~/.codex.
export function readCodexSlots(view?: PeerView): Record<string, string> {
  const slots: Record<string, string> = {};
  const here = codexSlotProfile()?.name;
  if (here) slots[sideName()] = here;
  const peer = sidePeer();
  if (!peer || (view && !view.up(peer))) return slots;
  const home = peerCodexHome(peer);
  const user = home ? readLogin(path.join(home, "auth.json"))?.id : undefined;
  const there = user ? codexProfiles().find((p) => codexAccount(p)?.user === user)?.name : undefined;
  if (there) slots[peer.name] = there;
  return slots;
}
