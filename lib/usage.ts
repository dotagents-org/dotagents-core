// How much of each account's plan is used: the 5-hour session and the weekly limits. Read from
// the cache Claude Code keeps in each config folder's state file (cachedUsageUtilization), which
// it refreshes whenever it asks for the usage, /usage for one. No network, no token.
//
// Everything here takes "now" as an argument, so the tests can fix it.

import fs from "node:fs";
import { signedIn, stateFile } from "./claude-code.ts";

export type UsageWindow = {
  kind: "session" | "week" | "model-week";
  // For a model's own weekly limit: "Opus".
  model?: string;
  pct: number;
  resetsAt: Date | null;
  // The reset time has passed: the window starts over, whatever the cache says.
  reset: boolean;
};

export type AccountUsage = {
  name: string;
  color: string;
  default?: boolean;
  // stale: the data is older than STALE_MS; other-account: the cache belongs to a previous sign-in.
  state: "ok" | "stale" | "no-data" | "not-signed-in" | "other-account";
  fetchedAt: Date | null;
  windows: UsageWindow[];
};

const HOUR = 3_600_000;
const LENGTH: Record<UsageWindow["kind"], number> = { session: 5 * HOUR, week: 7 * 24 * HOUR, "model-week": 7 * 24 * HOUR };
export const STALE_MS = 6 * HOUR;

const record = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// ISO text, or seconds or milliseconds since the epoch.
function toDate(v: unknown): Date | null {
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v);
  return null;
}

function window(kind: UsageWindow["kind"], pct: unknown, resetsAt: unknown, now: Date, model?: string): UsageWindow | null {
  if (typeof pct !== "number") return null;
  const when = toDate(resetsAt);
  const reset = Boolean(when && when.getTime() <= now.getTime());
  return { kind, ...(model ? { model } : {}), pct: reset ? 0 : Math.max(0, Math.min(100, pct)), resetsAt: when, reset };
}

// The limits list when there is one; otherwise the older five_hour / seven_day fields.
function windows(utilization: Record<string, unknown>, now: Date): UsageWindow[] | null {
  const limits = utilization.limits;
  if (limits !== undefined && !Array.isArray(limits)) return null;
  if (Array.isArray(limits)) {
    return limits
      .map((raw) => {
        const l = record(raw);
        if (!l) return null;
        if (l.kind === "session") return window("session", l.percent, l.resets_at, now);
        if (l.kind === "weekly_all") return window("week", l.percent, l.resets_at, now);
        const model = record(record(record(l.scope)?.model))?.display_name;
        if (l.kind === "weekly_scoped" && typeof model === "string") return window("model-week", l.percent, l.resets_at, now, model);
        return null;
      })
      .filter((w): w is UsageWindow => w !== null);
  }
  const field = (name: string, kind: UsageWindow["kind"], model?: string) => {
    const f = record(utilization[name]);
    return f ? window(kind, f.utilization, f.resets_at, now, model) : null;
  };
  return [field("five_hour", "session"), field("seven_day", "week"), field("seven_day_opus", "model-week", "Opus"), field("seven_day_sonnet", "model-week", "Sonnet")].filter(
    (w): w is UsageWindow => w !== null
  );
}

// The cache, normalized; null when it isn't one.
export function normalize(cache: unknown, now: Date): { fetchedAt: Date; accountUuid?: string; windows: UsageWindow[] } | null {
  const c = record(cache);
  const utilization = record(c?.utilization);
  const fetchedAt = toDate(c?.fetchedAtMs);
  if (!c || !utilization || !fetchedAt) return null;
  const list = windows(utilization, now);
  if (!list) return null;
  return { fetchedAt, ...(typeof c.accountUuid === "string" ? { accountUuid: c.accountUuid } : {}), windows: list };
}

export function accountUsage(account: { name: string; color: string; default?: boolean; configDir: string }, now: Date): AccountUsage {
  const base = { name: account.name, color: account.color, ...(account.default ? { default: true } : {}), fetchedAt: null, windows: [] };
  const who = signedIn(account.configDir);
  if (!who) return { ...base, state: "not-signed-in" };
  let cache: unknown;
  try {
    cache = JSON.parse(fs.readFileSync(stateFile(account.configDir), "utf8")).cachedUsageUtilization;
  } catch {
    cache = undefined;
  }
  const usage = normalize(cache, now);
  if (!usage) return { ...base, state: "no-data" };
  if (usage.accountUuid && usage.accountUuid !== who.accountUuid) return { ...base, state: "other-account" };
  const stale = now.getTime() - usage.fetchedAt.getTime() > STALE_MS;
  return { ...base, state: stale ? "stale" : "ok", fetchedAt: usage.fetchedAt, windows: usage.windows };
}

// At the rate used so far in the window: when it runs out (before the reset), or how much is
// left at the reset. Nothing for a window that just started, is unused or was reset.
export function pace(w: UsageWindow, now: Date): { runsOutAt: Date } | { leftAtReset: number } | null {
  if (w.reset || !w.resetsAt || w.pct <= 0) return null;
  const length = LENGTH[w.kind];
  const elapsed = length - (w.resetsAt.getTime() - now.getTime());
  if (elapsed < length * 0.1) return null;
  const perMs = w.pct / elapsed;
  const atReset = perMs * length;
  if (atReset >= 100) return { runsOutAt: new Date(now.getTime() + (100 - w.pct) / perMs) };
  return { leftAtReset: Math.round(100 - atReset) };
}

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

// A fixed-width bar, in eighths of a cell; the empty part is a dotted track.
export function bar(pct: number, width = 30) {
  const eighths = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width * 8);
  const full = Math.floor(eighths / 8);
  const part = EIGHTHS[eighths % 8];
  return "█".repeat(full) + part + "·".repeat(width - full - (part ? 1 : 0));
}

// ── Words for the views (the usage command and the TUI show the same thing) ──────────────────

// Below half, up to 79%, from 80%: green, yellow, red in both views.
export const levelOf = (pct: number) => (pct >= 80 ? "high" : pct >= 50 ? "warn" : "ok");

export const windowLabel = (w: UsageWindow) => (w.kind === "session" ? "Session (5h)" : w.kind === "week" ? "Week" : `${w.model} week`);

const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const day = (d: Date) => `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${hhmm(d)}`;

export function span(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h${String(minutes % 60).padStart(2, "0")}`;
  return `${Math.floor(hours / 24)} days`;
}

export function resetText(w: UsageWindow, now: Date) {
  if (w.reset || !w.resetsAt) return w.kind === "session" ? "no window open" : "reset";
  if (w.kind === "session") return `resets ${hhmm(w.resetsAt)} · in ${span(w.resetsAt.getTime() - now.getTime())}`;
  return `resets ${day(w.resetsAt)}`;
}

// The pace as a sentence, and whether it is a warning.
export function paceText(w: UsageWindow, now: Date): { text: string; warn: boolean } | null {
  const p = pace(w, now);
  if (!p) return null;
  if ("runsOutAt" in p) return { text: `⚠ at this pace, runs out at ${w.kind === "session" ? hhmm(p.runsOutAt) : day(p.runsOutAt)}`, warn: true };
  return { text: `~${p.leftAtReset}% left at reset`, warn: false };
}

// How old the account's data is, and whether that's too old.
export function freshnessText(a: AccountUsage, now: Date): { text: string; warn: boolean } | null {
  if (!a.fetchedAt) return null;
  const when = `data from ${hhmm(a.fetchedAt)} · ${span(now.getTime() - a.fetchedAt.getTime())} ago`;
  return a.state === "stale" ? { text: `⚠ ${when}, stale: run /usage in this account`, warn: true } : { text: when, warn: false };
}

// What an account without numbers says instead.
export function stateNote(a: AccountUsage) {
  if (a.state === "not-signed-in") return `not signed in · sign in with: claude-${a.name} auth login`;
  if (a.state === "no-data") return "no data yet · run /usage in this account";
  if (a.state === "other-account") return "the cache is from an earlier sign-in · run /usage in this account";
  return null;
}
