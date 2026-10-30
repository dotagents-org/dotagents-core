// `usage`: how much of each profile's plan is used, from Claude Code's own cache.

import { readUsage, usageJson } from "../../core/snapshot.ts";
import { captureAsync, fancy, ink } from "../../core/output.ts";
import { refreshUsage } from "../../core/refresh.ts";
import { type Line, type ProfileUsage, shortLines, usageLines } from "../../core/usage.ts";
import { badge, colorLevel } from "../../core/theme.ts";
import type { Command } from "./shared.ts";

// The segments of a line, painted with the roles; a profile's name in its readable color.
function paintLine(line: Line) {
  return line
    .map((s) => {
      let text = s.profile ? ink.profile(s.profile)(s.text) : s.role ? ink.role(s.role)(s.text) : s.text;
      if (s.bold) text = ink.bold(text);
      return text;
    })
    .join("");
}

function terminalView(list: ProfileUsage[], now: Date) {
  console.log(`${badge(colorLevel())}  ${ink.bold("usage")}\n`);
  for (const line of usageLines(list, now)) console.log(paintLine(line));
  console.log(`\n${ink.role("muted")(`${list.length} profile${list.length === 1 ? "" : "s"}, local data, no network`)}`);
}

// One line per window, easy to grep: "<profile> <window> <pct> <resets at> fetched <at>", and
// "(from <side>)" when the numbers came from the other side of the machine.
function plainView(list: ProfileUsage[]) {
  const width = Math.max(...list.map((a) => a.name.length)) + 2;
  for (const a of list) {
    if (a.state !== "ok" && a.state !== "stale") {
      console.log(`${a.name.padEnd(width)}${a.state}`);
      continue;
    }
    for (const w of a.windows) {
      const kind = w.kind === "model-week" ? `week-${(w.model ?? "").toLowerCase()}` : w.kind;
      console.log(`${a.name.padEnd(width)}${kind.padEnd(13)}${String(w.pct).padStart(3)}  ${w.resetsAt?.toISOString() ?? "-"}  fetched ${a.fetchedAt?.toISOString()}${a.state === "stale" ? "  (stale)" : ""}${a.from ? `  (from ${a.from})` : ""}`);
    }
  }
}

export const usage: Command = {
  name: "usage",
  usage: "[--refresh] [--watch] [--short] [--json]",
  summary: "show how much of each profile's plan is used",
  more: ["from Claude Code's cache, no network;", "--refresh: ask Claude Code for fresh numbers first"],
  group: "Profiles",
  view: (args) => (args.watch ? "usage" : null),
  async run({ args }) {
    if (args.refresh) {
      // Its lines would mix into the JSON or the short line: kept, and only failures shown.
      const events = await captureAsync(() => refreshUsage(new Date()));
      for (const e of events) if (e.kind === "result" && e.status === "failed") console.error(`${e.target}: couldn't refresh: ${e.detail}`);
    }
    const now = new Date();
    const list = readUsage(now);
    if (args.json) return console.log(JSON.stringify(usageJson(list, now), null, 2));
    if (args.short) return console.log(shortLines(list, now).map(paintLine).join("\n"));
    if (!fancy) return plainView(list);
    terminalView(list, now);
  },
};
