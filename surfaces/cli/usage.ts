// `usage`: how much of each profile's plan is used, from Claude Code's cache and from what dotagents
// last asked of Anthropic; --refresh asks now.

import { readUsage, usageJson } from "../../core/snapshot.ts";
import { captureAsync, fancy, ink } from "../../core/output.ts";
import { refreshUsage } from "../../core/live.ts";
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
  console.log(`\n${ink.role("muted")(`${list.length} profile${list.length === 1 ? "" : "s"}; --refresh asks Anthropic for fresh numbers`)}`);
}

// One line per window, easy to grep: "<profile> <window> <pct> <resets at> fetched <at>", then
// "(live)" when the numbers came from Anthropic and "(from <side>)" when from the other side.
function plainView(list: ProfileUsage[]) {
  const width = Math.max(...list.map((a) => a.name.length)) + 2;
  for (const a of list) {
    if (a.state !== "ok" && a.state !== "stale") {
      console.log(`${a.name.padEnd(width)}${a.state}`);
      continue;
    }
    for (const w of a.windows) {
      const kind = w.kind === "model-week" ? `week-${(w.model ?? "").toLowerCase()}` : w.kind;
      console.log(`${a.name.padEnd(width)}${kind.padEnd(13)}${String(w.pct).padStart(3)}  ${w.resetsAt?.toISOString() ?? "-"}  fetched ${a.fetchedAt?.toISOString()}${a.source === "live" ? "  (live)" : ""}${a.state === "stale" ? "  (stale)" : ""}${a.from ? `  (from ${a.from})` : ""}`);
    }
  }
}

export const usage: Command = {
  name: "usage",
  usage: "[--refresh] [--short] [--json]",
  summary: "show how much of each profile's plan is used",
  more: ["from Claude Code's cache and the last live ask;", "--refresh: ask Anthropic for fresh numbers first"],
  group: "Profiles",
  async run({ args }) {
    if (args.watch) throw new Error("usage --watch was removed in 3.0.0 with the full-screen view; run usage --refresh, or usage again");
    if (args.refresh) {
      // Its lines would mix into the JSON or the short line: kept, and only failures shown.
      const events = await captureAsync(() => refreshUsage());
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
