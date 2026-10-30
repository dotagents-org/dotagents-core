// How much of each profile's plan is used: the 5-hour session and the weekly limits. Read from
// the cache Claude Code keeps in each config folder's state file (cachedUsageUtilization), which
// it refreshes whenever it asks for the usage, /usage for one. No network, no token.
//
// Everything here takes "now" as an argument, so the tests can fix it.

import fs from "node:fs";
import { signedIn, stateFile } from "./claude-code.ts";
import type { Role } from "./theme.ts";

export type UsageWindow = {
  kind: "session" | "week" | "model-week";
  // For a model's own weekly limit: "Opus".
  model?: string;
  pct: number;
  resetsAt: Date | null;
  // The reset time has passed: the window starts over, whatever the cache says.
  reset: boolean;
};

export type ProfileUsage = {
  name: string;
  color: string;
  default?: boolean;
  // stale: the data is older than STALE_MS; other-account: the cache belongs to a previous sign-in.
  state: "ok" | "stale" | "no-data" | "not-signed-in" | "other-account";
  fetchedAt: Date | null;
  windows: UsageWindow[];
  // The account signed in, to match the same account on the other side; never shown.
  accountUuid?: string;
  // Where the numbers came from, when not from this side: "Windows", "WSL".
  from?: string;
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

// home: whose home the folder is in, for the other side's folders.
export function profileUsage(profile: { name: string; color: string; default?: boolean; configDir: string }, now: Date, home?: string): ProfileUsage {
  const base = { name: profile.name, color: profile.color, ...(profile.default ? { default: true } : {}), fetchedAt: null, windows: [] };
  const who = signedIn(profile.configDir, home);
  if (!who) return { ...base, state: "not-signed-in" };
  let cache: unknown;
  try {
    cache = JSON.parse(fs.readFileSync(stateFile(profile.configDir, home), "utf8")).cachedUsageUtilization;
  } catch {
    cache = undefined;
  }
  const usage = normalize(cache, now);
  const account = { accountUuid: who.accountUuid };
  if (!usage) return { ...base, ...account, state: "no-data" };
  if (usage.accountUuid && usage.accountUuid !== who.accountUuid) return { ...base, ...account, state: "other-account" };
  const stale = now.getTime() - usage.fetchedAt.getTime() > STALE_MS;
  return { ...base, ...account, state: stale ? "stale" : "ok", fetchedAt: usage.fetchedAt, windows: usage.windows };
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

// A bar of a fixed width: the used cells, a one-cell gap, the rest of the track. The width is the
// same at every percentage: something used shows at least one cell, and below 100% the gap and one
// cell of track stay, so 91% never looks full.
export function bar(pct: number, width: number) {
  const p = Math.max(0, Math.min(100, pct));
  if (p >= 100) return { used: width, rest: 0 };
  if (p <= 0) return { used: 0, rest: width };
  const used = Math.max(1, Math.min(Math.round((p / 100) * width), width - 2));
  return { used, rest: width - used - 1 };
}

// ── The views (the usage command and its short form; later the visual app) ────────────────
// The core draws nothing: it gives each line as segments, text with a role, and each surface
// paints them its own way.

export type Segment = { text: string; role?: Role; bold?: boolean; profile?: string };
export type Line = Segment[];

// Below 70%, from 70%, from 90%. The digits carry the level; color and weight repeat it.
export const levelOf = (pct: number): "ok" | "warn" | "high" => (pct >= 90 ? "high" : pct >= 70 ? "warn" : "ok");

export const windowLabel = (w: UsageWindow) => (w.kind === "session" ? "5h" : w.kind === "week" ? "7d" : (w.model ?? "model"));

const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayTime = (d: Date) => `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${hhmm(d)}`;

// "<1m", "58m", "3h 17m", "4d 18h".
export function span(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const BAR_WIDTH = 32;
const SHORT_BAR_WIDTH = 8;

const barSegments = (pct: number, width: number, role: Role): Segment[] => {
  const { used, rest } = bar(pct, width);
  return [
    ...(used ? [{ text: "━".repeat(used), role }] : []),
    ...(used && rest ? [{ text: " " }] : []),
    ...(rest ? [{ text: "─".repeat(rest), role: "track" as Role }] : []),
  ];
};

const pctSegment = (pct: number, role: Role): Segment => ({ text: `${String(pct).padStart(3)}%`, role, bold: true });

// What a profile without numbers says.
function stateNote(a: ProfileUsage) {
  if (a.state === "not-signed-in") return `not signed in, sign in with: claude-${a.name} auth login`;
  if (a.state === "no-data") return "no data yet, run /usage in this profile";
  if (a.state === "other-account") return "the cache is from an earlier sign-in, run /usage in this profile";
  return null;
}

const nameSegment = (a: ProfileUsage): Segment => ({ text: a.name, bold: true, profile: a.color });

// The usage view: per profile, its name, [default] and the age of the data; then one line per
// window, the labels in one column for every profile: the bar, the percentage and the reset.
export function usageLines(list: ProfileUsage[], now: Date): Line[] {
  const labelWidth = Math.max(2, ...list.flatMap((a) => a.windows.map((w) => windowLabel(w).length))) + 3;
  const lines: Line[] = [];
  for (const a of list) {
    if (lines.length) lines.push([]);
    const stale = a.state === "stale";
    const head: Line = [nameSegment(a)];
    if (a.default) head.push({ text: "  " }, { text: "[default]", role: "muted" });
    const note = stateNote(a);
    if (note) {
      lines.push([...head, { text: "  " }, { text: note, role: "muted" }]);
      continue;
    }
    if (a.fetchedAt) {
      const age = `${span(now.getTime() - a.fetchedAt.getTime())} ago${a.from ? ` on ${a.from}` : ""}`;
      head.push({ text: "  " }, stale ? { text: `${age}, stale: run /usage in this profile`, role: "warn" } : { text: age, role: "muted" });
    }
    lines.push(head);
    for (const w of a.windows) {
      const level: Role = stale ? "muted" : levelOf(w.pct);
      const reset = w.reset || !w.resetsAt ? (w.kind === "session" ? "no window open" : "reset") : `resets ${span(w.resetsAt.getTime() - now.getTime())}`;
      lines.push([
        { text: `  ${windowLabel(w).padEnd(labelWidth)}` },
        ...barSegments(w.pct, BAR_WIDTH, level),
        { text: "  " },
        pctSegment(w.pct, level),
        { text: "  " },
        { text: reset, role: !stale && w.pct >= 70 && !w.reset ? level : "muted" },
      ]);
      const p = stale ? null : pace(w, now);
      if (p && "runsOutAt" in p)
        lines.push([{ text: `  ${" ".repeat(labelWidth)}` }, { text: `runs out ${w.kind === "session" ? hhmm(p.runsOutAt) : dayTime(p.runsOutAt)} at this pace`, role: "warn" }]);
    }
  }
  return lines;
}

// The face the usage calls for: at the limit (a window from 90%), warn (from 70%, or a pace that
// runs out before the reset), asleep (no profile with fresh data) or ok.
export function faceOf(list: ProfileUsage[], now: Date): "limit" | "warn" | "asleep" | "ok" {
  const live = list.filter((a) => a.state === "ok");
  if (!live.length) return "asleep";
  const windows = live.flatMap((a) => a.windows);
  if (windows.some((w) => w.pct >= 90)) return "limit";
  if (windows.some((w) => w.pct >= 70 || "runsOutAt" in (pace(w, now) ?? {}))) return "warn";
  return "ok";
}

// The short view, for a status line: one line per profile, the 5h and 7d windows with 8-cell
// bars, and the reset only from 70%, in a column of fixed width so the 7d lines up.
export function shortLines(list: ProfileUsage[], now: Date): Line[] {
  const nameWidth = Math.max(...list.map((a) => a.name.length)) + 2;
  return list.map((a) => {
    const line: Line = [nameSegment(a), { text: " ".repeat(nameWidth - a.name.length) }];
    if (a.state !== "ok" && a.state !== "stale") return [...line, { text: a.state === "not-signed-in" ? "not signed in" : a.state === "no-data" ? "no data" : "other account", role: "muted" }];
    const stale = a.state === "stale";
    const kinds = ["session", "week"] as const;
    kinds.forEach((kind, i) => {
      const w = a.windows.find((x) => x.kind === kind);
      line.push({ text: `${kind === "session" ? "5h" : "7d"} ` });
      if (!w) {
        line.push({ text: "-".padEnd(SHORT_BAR_WIDTH + 5), role: "muted" });
        if (i < kinds.length - 1) line.push({ text: " ".repeat(11) });
      } else {
        const level: Role = stale ? "muted" : levelOf(w.pct);
        line.push(...barSegments(w.pct, SHORT_BAR_WIDTH, level), { text: " " }, pctSegment(w.pct, level));
        const showReset = !stale && w.pct >= 70 && w.resetsAt && !w.reset;
        const reset = showReset ? ` ↻ ${span(w.resetsAt!.getTime() - now.getTime()).replace(" ", "")}` : "";
        if (i < kinds.length - 1) {
          if (reset) line.push({ text: reset, role: level });
          line.push({ text: " ".repeat(8 - reset.length + 3) });
        } else if (reset) line.push({ text: reset, role: level });
      }
    });
    if (stale) line.push({ text: "  stale", role: "muted" });
    return line;
  });
}
