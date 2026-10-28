// `usage`: how much of each account's plan is used, from Claude Code's own cache.

import { PALETTE } from "../lib/accounts.ts";
import { defaultConfigDir } from "../lib/claude-code.ts";
import { loadAccounts } from "../lib/machine-state.ts";
import { fancy, header, line, paint, rail, style } from "../lib/output.ts";
import { type AccountUsage, type UsageWindow, accountUsage, bar, pace } from "../lib/usage.ts";
import type { Command } from "./shared.ts";

const { bold, dim, cyan, gray, green, yellow, red } = style;

// Green below half, yellow up to 79%, red from 80%.
const level = (pct: number) => (pct >= 80 ? red : pct >= 50 ? yellow : green);

const label = (w: UsageWindow) => (w.kind === "session" ? "Session (5h)" : w.kind === "week" ? "Week" : `${w.model} week`);

const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const day = (d: Date) => `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${hhmm(d)}`;

function span(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h${String(minutes % 60).padStart(2, "0")}`;
  return `${Math.floor(hours / 24)} days`;
}

function resetText(w: UsageWindow, now: Date) {
  if (w.reset || !w.resetsAt) return w.kind === "session" ? "no window open" : "reset";
  if (w.kind === "session") return `resets ${hhmm(w.resetsAt)} · in ${span(w.resetsAt.getTime() - now.getTime())}`;
  return `resets ${day(w.resetsAt)}`;
}

const STATE_NOTE: Record<Exclude<AccountUsage["state"], "ok" | "stale">, (name: string) => string> = {
  "not-signed-in": (name) => `not signed in · sign in with: claude-${name} auth login`,
  "no-data": () => "no data yet · run /usage in this account",
  "other-account": () => "the cache is from an earlier sign-in · run /usage in this account",
};

function railView(list: AccountUsage[], now: Date) {
  header("usage");
  const width = 14;
  for (const a of list) {
    const color = paint(a.color);
    line();
    console.log(`${color("◇")}  ${bold(color(a.name))}${a.default ? `  ${cyan("● default")}` : ""}`);
    if (a.state !== "ok" && a.state !== "stale") {
      line(dim(STATE_NOTE[a.state](a.name)));
      continue;
    }
    for (const w of a.windows) {
      const paintLevel = level(w.pct);
      const cells = bar(w.pct);
      const filled = cells.replace(/·+$/, "");
      const meter = `${paintLevel(filled)}${gray(cells.slice(filled.length))}`;
      const pct = paintLevel(`${String(w.pct).padStart(3)}%`);
      line(`${label(w).padEnd(width)} ${meter}  ${pct}  ${dim(resetText(w, now))}`);
      const p = pace(w, now);
      if (p && "runsOutAt" in p) line(`${" ".repeat(width)} ${yellow(`⚠ at this pace, runs out at ${w.kind === "session" ? hhmm(p.runsOutAt) : day(p.runsOutAt)}`)}`);
      else if (p) line(`${" ".repeat(width)} ${gray(`~${p.leftAtReset}% left at reset`)}`);
    }
    if (a.fetchedAt) {
      const when = `data from ${hhmm(a.fetchedAt)} · ${span(now.getTime() - a.fetchedAt.getTime())} ago`;
      line(a.state === "stale" ? yellow(`└ ⚠ ${when}, stale: run /usage in this account`) : dim(`└ ${when}`));
    }
  }
  line();
  console.log(`${rail.end()}  ${dim(`${list.length} account${list.length === 1 ? "" : "s"} · local data, no network`)}\n`);
}

// One line per window, easy to grep: "<account> <window> <pct> <resets at> fetched <at>".
function plainView(list: AccountUsage[]) {
  const width = Math.max(...list.map((a) => a.name.length)) + 2;
  for (const a of list) {
    if (a.state !== "ok" && a.state !== "stale") {
      console.log(`${a.name.padEnd(width)}${a.state}`);
      continue;
    }
    for (const w of a.windows) {
      const kind = w.kind === "model-week" ? `week-${(w.model ?? "").toLowerCase()}` : w.kind;
      console.log(`${a.name.padEnd(width)}${kind.padEnd(13)}${String(w.pct).padStart(3)}  ${w.resetsAt?.toISOString() ?? "-"}  fetched ${a.fetchedAt?.toISOString()}${a.state === "stale" ? "  (stale)" : ""}`);
    }
  }
}

// "work 21%·20% │ personal 0%·0%": session · week, for a prompt or a status line.
function shortView(list: AccountUsage[]) {
  const pct = (w?: UsageWindow) => (w ? level(w.pct)(`${w.pct}%`) : dim("-"));
  return list
    .map((a) => {
      const name = paint(a.color)(a.name);
      if (a.state !== "ok" && a.state !== "stale") return `${name} ${dim("-")}`;
      return `${name} ${pct(a.windows.find((w) => w.kind === "session"))}${dim("·")}${pct(a.windows.find((w) => w.kind === "week"))}`;
    })
    .join(dim(" │ "));
}

export const usage: Command = {
  name: "usage",
  usage: "[--short] [--json]",
  summary: "show how much of each account's plan is used",
  more: ["from Claude Code's cache, no network;", "/usage in an account refreshes it"],
  group: "Accounts",
  run({ args }) {
    const now = new Date();
    const accounts = loadAccounts();
    // Without accounts, the one in ~/.claude.
    const list = (accounts.length ? accounts : [{ name: "claude", color: PALETTE[0], default: true, configDir: defaultConfigDir() }]).map((a) => accountUsage(a, now));
    if (args.json) return console.log(JSON.stringify(list, null, 2));
    if (args.short) return console.log(shortView(list));
    if (!fancy) return plainView(list);
    railView(list, now);
  },
};
