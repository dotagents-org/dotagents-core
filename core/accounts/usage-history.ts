// The history of each profile's %: every live reading that changes a window's % or its reset adds
// a line to <state>/usage/<profile>.history.jsonl, Claude's and ChatGPT's alike, for usage --spend
// (core/accounts/spend.ts).

import fs from "node:fs";
import path from "node:path";
import { stateDir } from "../machine/machine-state.ts";
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
export function recordHistory(name: string, windows: Pick<UsageWindow, "kind" | "pct" | "resetsAt">[], at: Date, dir?: string) {
  const session = windows.find((w) => w.kind === "session");
  const week = windows.find((w) => w.kind === "week");
  const point: Point = { at: at.toISOString(), session: session?.pct ?? null, week: week?.pct ?? null, sessionResetsAt: minute(session?.resetsAt ?? null), weekResetsAt: minute(week?.resetsAt ?? null) };
  const last = readHistory(name, dir).at(-1);
  if (last && last.session === point.session && last.week === point.week && last.sessionResetsAt === point.sessionResetsAt && last.weekResetsAt === point.weekResetsAt) return;
  const file = historyFile(name, dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(point)}\n`, { mode: 0o600 });
}
