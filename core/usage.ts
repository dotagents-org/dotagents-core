// How much of each profile's plan is used: the 5-hour session and the weekly limits. Read from
// the cache Claude Code keeps in each config folder's state file (cachedUsageUtilization), which
// it refreshes whenever it asks for the usage, /usage for one; core/live.ts keeps a record in the
// same shape, asked of Anthropic, and core/snapshot.ts shows the newer of the two.
//
// Everything here takes "now" as an argument, so the tests can fix it.

import fs from "node:fs";
import { type Activity, signedIn, stateFile } from "./claude-code.ts";
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
  // What gave the numbers: Claude Code's cache, or Anthropic's usage endpoint (core/live.ts).
  source?: "cache" | "live";
  // The profile's running sessions, for a profile whose login Claude Code is using.
  activity?: Activity;
  // Why the last live ask failed; the numbers shown are older than it.
  error?: string;
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
  return { ...base, ...account, state: stale ? "stale" : "ok", fetchedAt: usage.fetchedAt, windows: usage.windows, source: "cache" };
}

// At the average rate since the window opened: how much it will have used at the reset (rounded,
// with no cap) and, past 100%, when it runs out. In the window's first 10% the rate means little,
// so it says when the projection starts instead. Nothing for a window unused or reset.
export type Pace = { atResetPct: number; runsOutAt?: Date } | { from: Date } | null;

export function pace(w: UsageWindow, now: Date): Pace {
  if (w.reset || !w.resetsAt || w.pct <= 0) return null;
  const length = LENGTH[w.kind];
  const elapsed = length - (w.resetsAt.getTime() - now.getTime());
  if (elapsed < length * 0.1) return { from: new Date(w.resetsAt.getTime() - length * 0.9) };
  const perMs = w.pct / elapsed;
  const atResetPct = Math.round(perMs * length);
  if (perMs * length >= 100) return { atResetPct, runsOutAt: new Date(now.getTime() + (100 - w.pct) / perMs) };
  return { atResetPct };
}

// The avatar's state, one of the identity's seven, most urgent first: what the tray icon and the
// panel's cards show. The numbers stay in the bars and the text.
export const AVATAR_STATES = ["error", "limit", "waiting", "warn", "working", "ok", "asleep"] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

export function avatarState(p: ProfileUsage, now: Date): AvatarState {
  // No login, or one Anthropic refused (core/live.ts says to sign in again): it needs you.
  if (p.state === "not-signed-in" || /sign in again|couldn't renew the login/.test(p.error ?? "")) return "error";
  const open = p.state === "ok" ? p.windows.filter((w) => !w.reset) : [];
  if (open.some((w) => w.pct >= 100)) return "limit";
  if (p.activity?.waiting) return "waiting";
  if (open.some((w) => w.pct >= 70 || "runsOutAt" in (pace(w, now) ?? {}))) return "warn";
  if (p.activity?.working) return "working";
  return p.state === "ok" ? "ok" : "asleep";
}

// How much of the window has gone by, in percent: where the bar would be at a uniform pace. Null
// for a window that was reset or has no reset time.
export function elapsedPct(w: UsageWindow, now: Date): number | null {
  if (w.reset || !w.resetsAt) return null;
  const length = LENGTH[w.kind];
  return Math.round(Math.max(0, Math.min(100, ((length - (w.resetsAt.getTime() - now.getTime())) / length) * 100)));
}

// The notices at 70% and 90%, once per crossing: a window notifies when it rises to a level it
// hadn't reached, and the level is armed again only when the window falls 5 points below it (or
// resets), so a number moving around 70% doesn't notify every minute. levels: what the caller keeps
// between calls, the level each window last notified; a profile without fresh data keeps its own.
export type Alert = { profile: string; window: string; level: "warn" | "high"; pct: number };

export function thresholdAlerts(list: ProfileUsage[], levels: Record<string, number>): { alerts: Alert[]; levels: Record<string, number> } {
  const next = { ...levels };
  const alerts: Alert[] = [];
  for (const a of list) {
    if (a.state !== "ok") continue;
    for (const w of a.windows) {
      const key = `${a.name}/${windowLabel(w)}`;
      let held = next[key] ?? 0;
      while (held && w.pct < held - 5) held = held === 90 ? 70 : 0;
      const reached = w.pct >= 90 ? 90 : w.pct >= 70 ? 70 : 0;
      if (reached > held) {
        alerts.push({ profile: a.name, window: windowLabel(w), level: reached === 90 ? "high" : "warn", pct: w.pct });
        held = reached;
      }
      if (held) next[key] = held;
      else delete next[key];
    }
  }
  return { alerts, levels: next };
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
  if (a.state === "not-signed-in") return `no saved login: sign in with claude auth login, then run dotagents switch --save ${a.name}`;
  if (a.state === "no-data") return `no data yet, run: dotagents usage --refresh${a.error ? ` (last try: ${a.error})` : ""}`;
  if (a.state === "other-account") return `the cache is another account's, run: dotagents usage --refresh${a.error ? ` (last try: ${a.error})` : ""}`;
  return null;
}

const nameSegment = (a: ProfileUsage): Segment => ({ text: a.name, bold: true, profile: a.color });

// "2 working, 1 waiting", only the counts above zero; empty when nothing runs.
export const activityText = (a: Activity | undefined) =>
  a ? [a.working ? `${a.working} working` : "", a.waiting ? `${a.waiting} waiting` : ""].filter(Boolean).join(", ") : "";

// The usage view: per profile, its name, [default], the age of the data and its running sessions; then one line per
// window, the labels in one column for every profile: the bar, the percentage and the reset.
export function usageLines(list: ProfileUsage[], now: Date): Line[] {
  const labelWidth = Math.max(2, ...list.flatMap((a) => a.windows.map((w) => windowLabel(w).length))) + 3;
  const lines: Line[] = [];
  for (const a of list) {
    if (lines.length) lines.push([]);
    const stale = a.state === "stale";
    const head: Line = [nameSegment(a)];
    if (a.default) head.push({ text: "  " }, { text: "[default]", role: "muted" });
    const busy = activityText(a.activity);
    if (busy) head.push({ text: "  " }, { text: busy, role: "ok" });
    const note = stateNote(a);
    if (note) {
      lines.push([...head, { text: "  " }, { text: note, role: "muted" }]);
      continue;
    }
    if (a.fetchedAt) {
      const age = `${span(now.getTime() - a.fetchedAt.getTime())} ago${a.source === "live" ? ", live" : ""}${a.from ? ` on ${a.from}` : ""}`;
      head.push({ text: "  " }, stale ? { text: `${age}, stale: run dotagents usage --refresh`, role: "warn" } : { text: age, role: "muted" });
    }
    lines.push(head);
    if (a.error && stale) lines.push([{ text: `  last try: ${a.error}`, role: "warn" }]);
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
      // The projection, always in the same place under the window, so the view doesn't jump.
      const p = stale ? null : pace(w, now);
      const when = (d: Date) => (w.kind === "session" ? hhmm(d) : dayTime(d));
      const indent = { text: `  ${" ".repeat(labelWidth)}` };
      if (p && "from" in p) lines.push([indent, { text: `projection from ${when(p.from)}`, role: "muted" }]);
      else if (p?.runsOutAt) lines.push([indent, { text: `~${p.atResetPct}% at reset, runs out ${when(p.runsOutAt)}`, role: "warn" }]);
      else if (p) lines.push([indent, { text: `~${p.atResetPct}% at reset`, role: "muted" }]);
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
  if (windows.some((w) => { const p = pace(w, now); return w.pct >= 70 || (p !== null && "runsOutAt" in p); })) return "warn";
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
