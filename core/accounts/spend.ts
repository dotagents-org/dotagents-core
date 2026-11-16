// What 1% of each account's plan costs, in tokens and dollars, and where the spend went
// (`usage --spend`). Three pieces, none of which asks Anthropic anything more:
//
// - the history of the %: each live reading that changes a window's % adds a line to
//   <state>/usage/<profile>.history.jsonl;
// - the spend: the tokens of every assistant message in Claude Code's transcripts, on both sides of
//   the machine, put on the account the session ran under, at the API's prices (core/accounts/prices.ts);
// - the relation: between two readings of the same window, the spend over the % it went up.
//
// What uses the plan without leaving a transcript here (claude.ai, the Desktop outside Code,
// another machine) shows as % with no spend, and is counted as unexplained.

import fs from "node:fs";
import path from "node:path";
import { stateDir } from "../machine-state.ts";
import { costOf, type Tokens } from "./prices.ts";
import { configDirs, type ConfigDir } from "../sessions.ts";
import type { UsageWindow } from "./usage.ts";

export type Point = { at: string; session: number | null; week: number | null; sessionResetsAt: string | null; weekResetsAt: string | null };

export const historyFile = (name: string, dir = stateDir()) => path.join(dir, "usage", `${name}.history.jsonl`);

export function readHistory(name: string, dir?: string): Point[] {
  try {
    return fs.readFileSync(historyFile(name, dir), "utf8").split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l) as Point];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

// To the minute: the reset time Anthropic answers can move by seconds between readings
const minute = (d: Date | null) => (d ? new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString() : null);

// A reading of the live usage; written only when it changes a window's % or reset.
export function recordHistory(name: string, windows: UsageWindow[], at: Date, dir?: string) {
  const session = windows.find((w) => w.kind === "session");
  const week = windows.find((w) => w.kind === "week");
  const point: Point = { at: at.toISOString(), session: session?.pct ?? null, week: week?.pct ?? null, sessionResetsAt: minute(session?.resetsAt ?? null), weekResetsAt: minute(week?.resetsAt ?? null) };
  const last = readHistory(name, dir).at(-1);
  if (last && last.session === point.session && last.week === point.week && last.sessionResetsAt === point.sessionResetsAt && last.weekResetsAt === point.weekResetsAt) return;
  const file = historyFile(name, dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(point)}\n`, { mode: 0o600 });
}

// One assistant message: when, under which account, which model, in which folder, and its tokens.
export type Spend = { at: number; account: string | null; model: string; cwd: string; tokens: Tokens; costUsd: number | null };

const tokensOf = (u: Record<string, any> | undefined): Tokens => {
  const write1h = Number(u?.cache_creation?.ephemeral_1h_input_tokens) || 0;
  return {
    input: Number(u?.input_tokens) || 0,
    cacheRead: Number(u?.cache_read_input_tokens) || 0,
    cacheWrite: Math.max(0, (Number(u?.cache_creation_input_tokens) || 0) - write1h),
    cacheWrite1h: write1h,
    output: Number(u?.output_tokens) || 0,
  };
};

const lines = (file: string) => {
  try {
    return fs.readFileSync(file, "utf8").split("\n");
  } catch {
    return [];
  }
};

const sumUsd = (list: Spend[]) => list.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);

function ownerIn(line: string, current: string | null): string | null {
  if (!line.includes('"type":"session-owner"')) return current;
  try {
    return JSON.parse(line).accountUuid ?? current;
  } catch {
    return current;
  }
}

// The messages of one transcript since `since`. owner: the account of the session it belongs to, for a
// subagent's transcript, which names none. seen: message ids already counted (Claude Code writes a
// message once per content block, and a resumed session may carry earlier ones).
function readTranscript(file: string, since: number, seen: Set<string>, owner: string | null) {
  const out: Spend[] = [];
  let account = owner;
  for (const line of lines(file)) {
    if (line.includes('"type":"session-owner"')) {
      account = ownerIn(line, account);
      continue;
    }
    if (!line.includes('"type":"assistant"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const at = Date.parse(o.timestamp);
    const id = o.message?.id;
    if (!(at >= since) || !id || seen.has(id) || !o.message?.usage) continue;
    seen.add(id);
    const model = String(o.message.model ?? "");
    if (model === "<synthetic>") continue;
    const tokens = tokensOf(o.message.usage);
    out.push({ at, account, model, cwd: String(o.cwd ?? ""), tokens, costUsd: costOf(model, tokens) });
  }
  return out;
}

// The last account a transcript names.
function ownerOf(file: string) {
  let account: string | null = null;
  for (const line of lines(file)) {
    if (!line.includes('"type":"session-owner"')) continue;
    account = ownerIn(line, account);
  }
  return account;
}

function readdirOr(dir: string): string[];
function readdirOr(dir: string, withFileTypes: true): fs.Dirent[];
function readdirOr(dir: string, withFileTypes?: true): string[] | fs.Dirent[] {
  try {
    return withFileTypes ? fs.readdirSync(dir, { withFileTypes: true }) : fs.readdirSync(dir);
  } catch {
    return [];
  }
}

const subagentFiles = (folder: string, name: string) => readdirOr(path.join(folder, name, "subagents")).filter((file) => file.endsWith(".jsonl"));

// Every assistant message since `since` in the transcripts of these config folders (both sides by
// default): <dir>/projects/<project>/<session>.jsonl and its subagents' <session>/subagents/*.jsonl.
export function readSpend(since: number, dirs: ConfigDir[] = configDirs()): Spend[] {
  const seen = new Set<string>();
  const out: Spend[] = [];
  const fresh = (file: string) => {
    try {
      return fs.statSync(file).mtimeMs >= since;
    } catch {
      return false;
    }
  };
  for (const { dir } of dirs) {
    const projects = path.join(dir, "projects");
    const slugs = readdirOr(projects);
    for (const slug of slugs) {
      const folder = path.join(projects, slug);
      const entries = readdirOr(folder, true);
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith(".jsonl") && fresh(path.join(folder, e.name))) out.push(...readTranscript(path.join(folder, e.name), since, seen, null));
        if (!e.isDirectory()) continue;
        const subagents = path.join(folder, e.name, "subagents");
        const files = subagentFiles(folder, e.name);
        const owner = ownerOf(path.join(folder, `${e.name}.jsonl`));
        for (const f of files) if (fresh(path.join(subagents, f))) out.push(...readTranscript(path.join(subagents, f), since, seen, owner));
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export type Ratio = { window: "session" | "week"; usdPerPct: number | null; tokensPerPct: number | null; pairs: number; explainedPct: number; unexplainedPct: number };

const allTokens = (t: Tokens) => t.input + t.cacheRead + t.cacheWrite + (t.cacheWrite1h ?? 0) + t.output;

// For one account: over every two readings in a row of the same window where the % went up, the
// spend between them over the % it went up. A rise with no spend is unexplained.
export function ratios(points: Point[], spend: Spend[]): Ratio[] {
  return (["session", "week"] as const).map((window) => {
    const resets = window === "session" ? "sessionResetsAt" : "weekResetsAt";
    let usd = 0;
    let tokens = 0;
    let explainedPct = 0;
    let unexplainedPct = 0;
    let pairs = 0;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      const [from, to] = [a[window], b[window]];
      if (from === null || to === null || a[resets] !== b[resets] || to <= from) continue;
      const between = spend.filter((s) => s.at > Date.parse(a.at) && s.at <= Date.parse(b.at));
      const cost = sumUsd(between);
      if (!between.length) {
        unexplainedPct += to - from;
        continue;
      }
      usd += cost;
      tokens += between.reduce((sum, s) => sum + allTokens(s.tokens), 0);
      explainedPct += to - from;
      pairs++;
    }
    return { window, usdPerPct: explainedPct ? usd / explainedPct : null, tokensPerPct: explainedPct ? tokens / explainedPct : null, pairs, explainedPct, unexplainedPct };
  });
}

// The spend of a list, totaled by a key (the model, the folder).
export function totals(spend: Spend[], key: (s: Spend) => string) {
  const map = new Map<string, number>();
  for (const s of spend) map.set(key(s), (map.get(key(s)) ?? 0) + (s.costUsd ?? 0));
  return [...map].sort((a, b) => b[1] - a[1]);
}

const HOUR = 3_600_000;
const SPAN = { session: 5 * HOUR, week: 7 * 24 * HOUR };

export type WindowSpend = { from: string; totalUsd: number; models: [string, number][]; workspaces: [string, number][] };
export type ProfileSpend = { name: string; ratios: Ratio[]; session: WindowSpend | null; week: WindowSpend | null };

// The report of usage --spend, for profiles and the account each one is (null: no saved login).
// folder: how a session's folder is shown.
export function spendReport(profiles: { name: string; accountUuid: string | null }[], { now = Date.now(), dirs, folder = (cwd: string) => cwd }: { now?: number; dirs?: ConfigDir[]; folder?: (cwd: string) => string } = {}) {
  const histories = new Map(profiles.map((p) => [p.name, readHistory(p.name)]));
  const earliest = Math.min(now - SPAN.week, ...[...histories.values()].flat().map((pt) => Date.parse(pt.at)));
  const spend = readSpend(earliest, dirs);
  const report: ProfileSpend[] = profiles.map((p) => {
    const points = histories.get(p.name) ?? [];
    const mine = spend.filter((s) => s.account !== null && s.account === p.accountUuid);
    const last = points.at(-1);
    const windowOf = (kind: "session" | "week"): WindowSpend | null => {
      const resets = last?.[kind === "session" ? "sessionResetsAt" : "weekResetsAt"];
      if (!resets) return null;
      const from = Date.parse(resets) - SPAN[kind];
      const inside = mine.filter((s) => s.at >= from && s.at <= now);
      return { from: new Date(from).toISOString(), totalUsd: sumUsd(inside), models: totals(inside, (s) => s.model), workspaces: totals(inside, (s) => folder(s.cwd)) };
    };
    return { name: p.name, ratios: ratios(points, mine), session: windowOf("session"), week: windowOf("week") };
  });
  // Messages under an account no profile is
  const known = new Set(profiles.map((p) => p.accountUuid));
  const unattributedUsd = sumUsd(spend.filter((s) => !known.has(s.account)));
  return { profiles: report, unattributedUsd };
}
