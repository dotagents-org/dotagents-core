// `usage`: how much of each profile's plan is used, from Claude Code's own cache.

import { PALETTE } from "../../core/profiles.ts";
import { defaultConfigDir } from "../../core/claude-code.ts";
import { loadProfiles } from "../../core/machine-state.ts";
import { fancy, header, line, paint, rail, style } from "../../core/output.ts";
import { type ProfileUsage, type UsageWindow, profileUsage, bar, freshnessText, levelOf, paceText, resetText, stateNote, windowLabel } from "../../core/usage.ts";
import type { Command } from "./shared.ts";

const { bold, dim, cyan, gray, green, yellow, red } = style;

const LEVEL = { ok: green, warn: yellow, high: red };
const level = (pct: number) => LEVEL[levelOf(pct)];

function railView(list: ProfileUsage[], now: Date) {
  header("usage");
  const width = 14;
  for (const a of list) {
    const color = paint(a.color);
    line();
    console.log(`${color("◇")}  ${bold(color(a.name))}${a.default ? `  ${cyan("● default")}` : ""}`);
    const note = stateNote(a);
    if (note) {
      line(dim(note));
      continue;
    }
    for (const w of a.windows) {
      const paintLevel = level(w.pct);
      const cells = bar(w.pct);
      const filled = cells.replace(/·+$/, "");
      const meter = `${paintLevel(filled)}${gray(cells.slice(filled.length))}`;
      const pct = paintLevel(`${String(w.pct).padStart(3)}%`);
      line(`${windowLabel(w).padEnd(width)} ${meter}  ${pct}  ${dim(resetText(w, now))}`);
      const p = paceText(w, now);
      if (p) line(`${" ".repeat(width)} ${(p.warn ? yellow : gray)(p.text)}`);
    }
    const fresh = freshnessText(a, now);
    if (fresh) line(fresh.warn ? yellow(`└ ${fresh.text}`) : dim(`└ ${fresh.text}`));
  }
  line();
  console.log(`${rail.end()}  ${dim(`${list.length} profile${list.length === 1 ? "" : "s"} · local data, no network`)}\n`);
}

// One line per window, easy to grep: "<profile> <window> <pct> <resets at> fetched <at>".
function plainView(list: ProfileUsage[]) {
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
function shortView(list: ProfileUsage[]) {
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
  usage: "[--watch] [--short] [--json]",
  summary: "show how much of each profile's plan is used",
  more: ["from Claude Code's cache, no network;", "/usage in a profile refreshes it"],
  group: "Profiles",
  view: (args) => (args.watch ? "usage" : null),
  run({ args }) {
    const now = new Date();
    const profiles = loadProfiles();
    // Without profiles, the one in ~/.claude.
    const list = (profiles.length ? profiles : [{ name: "claude", color: PALETTE[0], default: true, configDir: defaultConfigDir() }]).map((a) => profileUsage(a, now));
    if (args.json) return console.log(JSON.stringify(list, null, 2));
    if (args.short) return console.log(shortView(list));
    if (!fancy) return plainView(list);
    railView(list, now);
  },
};
