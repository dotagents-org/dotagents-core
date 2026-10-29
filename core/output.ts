// What the commands tell the user. The modules don't print: report, checkItem, checkWarn,
// section, header and finish count the result and hand an event to the current renderer.
//
// Renderers: in a terminal, the @clack/prompts look (one vertical rail from ┌ to └), icons,
// colors and short paths; piped or redirected (CI, scripts), plain "<status> <path> (<detail>)"
// lines that are easy to grep; in the tests, a list that collects the events. The colors follow
// core/theme.ts: NO_COLOR turns them off, FORCE_COLOR sets them.

import os from "node:os";
import path from "node:path";
import { S_BAR, S_BAR_END, S_BAR_START, S_STEP_SUBMIT } from "@clack/prompts";
import pc from "picocolors";
import { state } from "./state.ts";
import { SYMBOLS, colorLevel, hexColor } from "./theme.ts";

// The color level (core/theme.ts). The terminal look is on in a terminal, or when FORCE_COLOR
// asks for colors without one; FORCE_COLOR=0 keeps it plain.
const level = colorLevel();
export const fancy = Boolean(process.stdout.isTTY) || (Boolean(process.env.FORCE_COLOR) && level > 0);
// Prompts need a real keyboard, not just a colored output.
export const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
export const style = pc.createColors(level > 0);

export const toSlash = (p: string) => p.replace(/\\/g, "/");

// A color of our own, given as #RRGGBB (a profile's color).
export const paint = (hex: string) => hexColor(hex, level);

// The rail: ┌ opens a command, │ carries every line, ◇ marks a section, └ closes.
export const rail = {
  bar: () => style.gray(S_BAR),
  start: () => style.gray(S_BAR_START),
  end: () => style.gray(S_BAR_END),
};
export const line = (text = "") => console.log(text ? `${rail.bar()}  ${text}` : rail.bar());

const STATUS = {
  ok: { icon: SYMBOLS.passed, color: style.gray },
  created: { icon: SYMBOLS.created, color: style.green },
  updated: { icon: SYMBOLS.updated, color: style.yellow },
  skipped: { icon: SYMBOLS.warning, color: style.yellow },
  failed: { icon: SYMBOLS.failed, color: style.red },
  "would create": { icon: SYMBOLS.created, color: style.cyan },
  "would update": { icon: SYMBOLS.updated, color: style.cyan },
  moved: { icon: SYMBOLS.moved, color: style.green },
  "would move": { icon: SYMBOLS.moved, color: style.cyan },
} satisfies Record<string, { icon: string; color: (text: string) => string }>;

export type Status = keyof typeof STATUS;

export type Event =
  | { kind: "result"; status: Status; target: string; detail: string }
  | { kind: "check"; passed: boolean; text: string; detail: string }
  | { kind: "warning"; text: string; detail: string }
  | { kind: "section"; title: string }
  | { kind: "header"; command: string; subject: string }
  | { kind: "finish"; hint: string };

export type Renderer = (event: Event) => void;

const home = os.homedir();

// Shows a path relative to state.base when inside it, with ~ for the home folder, and forward
// slashes. Only in a terminal: piped output keeps the full path.
export function displayPath(p: string): string {
  if (!fancy || !p || !path.isAbsolute(p)) return p;
  if (state.base) {
    const rel = path.relative(state.base, p);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return toSlash(rel);
    if (rel === "") return ".";
  }
  const relHome = path.relative(home, p);
  if (!relHome.startsWith("..") && !path.isAbsolute(relHome)) return toSlash(path.join("~", relHome));
  return toSlash(p);
}

// Shortens the workspace and home folders inside a detail text ("-> C:\Users\me\x" → "→ ~/x").
function displayDetail(detail: string) {
  if (!fancy) return detail;
  let text = detail.replace(/^-> /, "→ ");
  const swap = (from: string, to: string) => {
    for (const variant of new Set([from, toSlash(from)])) text = text.split(variant).join(to);
  };
  if (state.base) swap(state.base + path.sep, "");
  swap(home, "~");
  return text.replace(/\\/g, "/");
}

const pluralize = (n: number, word: string) => `${n} ${word}`;

export const railRenderer: Renderer = (event) => {
  switch (event.kind) {
    case "result": {
      const { icon, color } = STATUS[event.status];
      const shown = displayPath(event.target);
      const text = `${color(icon)} ${color(event.status.padEnd(12))} ${event.status === "ok" ? style.gray(shown) : shown}`;
      return line(event.detail ? `${text}  ${style.dim(displayDetail(event.detail))}` : text);
    }
    case "check":
      if (event.passed) return line(`${style.green("✓")} ${style.gray(event.text)}`);
      line(`${style.red("✗")} ${event.text}`);
      if (event.detail) line(`  ${style.dim(`└ ${displayDetail(event.detail)}`)}`);
      return;
    case "warning":
      line(`${style.yellow("!")} ${event.text}`);
      if (event.detail) line(`  ${style.dim(`└ ${displayDetail(event.detail)}`)}`);
      return;
    case "section":
      line();
      return console.log(`${style.cyan(S_STEP_SUBMIT)}  ${style.bold(event.title)}`);
    case "header": {
      const dry = state.dryRun ? `  ${style.bgYellow(style.black(" dry run "))}` : "";
      const title = style.bgMagenta(style.white(style.bold(" dotagents ")));
      return console.log(`${rail.start()}  ${title} ${style.bold(event.command)}${event.subject ? `  ${style.dim(displayPath(event.subject))}` : ""}${dry}`);
    }
    case "finish": {
      // "└  ✓ 9 created · 2 already ok".
      const c = state.counts;
      const parts = [
        c.passed && style.green(pluralize(c.passed, "passed")),
        c.created && style.green(pluralize(c.created, "created")),
        c.updated && style.yellow(pluralize(c.updated, "updated")),
        c.moved && style.green(pluralize(c.moved, "moved")),
        c["would move"] && style.cyan(pluralize(c["would move"], "to move")),
        c["would create"] && style.cyan(pluralize(c["would create"], "to create")),
        c["would update"] && style.cyan(pluralize(c["would update"], "to update")),
        c.ok && style.gray(pluralize(c.ok, "already ok")),
        c.skipped && style.yellow(pluralize(c.skipped, "skipped")),
        c.warnings && style.yellow(pluralize(c.warnings, c.warnings === 1 ? "warning" : "warnings")),
        c.failed && style.red(pluralize(c.failed, "failed")),
      ].filter(Boolean);
      const icon = state.problems ? style.red("✗") : style.green("✓");
      line();
      if (state.dryRun) line(style.yellow("Dry run: nothing was changed."));
      if (state.problems) line(style.dim("See the lines marked with ! or ✗ above."));
      if (event.hint) for (const hint of event.hint.split("\n")) line(style.dim(hint));
      return console.log(`${rail.end()}  ${icon} ${parts.join(style.gray(" · ")) || "done"}\n`);
    }
  }
};

export const plainRenderer: Renderer = (event) => {
  switch (event.kind) {
    case "result":
      return console.log(`${event.status.padEnd(13)}${event.target}${event.detail ? `  (${event.detail})` : ""}`);
    case "check":
      return console.log(`${(event.passed ? "ok" : "failed").padEnd(13)}${event.text}${!event.passed && event.detail ? `  (${event.detail})` : ""}`);
    case "warning":
      return console.log(`${"warning".padEnd(13)}${event.text}${event.detail ? `  (${event.detail})` : ""}`);
    case "section":
      return console.log(`\n${event.title}`);
    case "header":
      return;
    case "finish":
      console.log("");
      if (state.dryRun) console.log("Dry run: nothing was changed.");
      if (state.problems) console.log(`${state.problems} item(s) skipped or failed: see the lines above.`);
      if (event.hint) console.log(event.hint);
      return;
  }
};

// Keeps the events instead of printing them (the tests).
export const collect =
  (into: Event[]): Renderer =>
  (event) => {
    into.push(event);
  };

let renderer: Renderer = fancy ? railRenderer : plainRenderer;

export function setRenderer(next: Renderer) {
  renderer = next;
}

export function report(status: Status, target: string, detail = "") {
  if (status === "skipped" || status === "failed") state.problems++;
  state.counts[status] = (state.counts[status] ?? 0) + 1;
  renderer({ kind: "result", status, target, detail });
}

// One checklist line: ✓ passed, ✗ failed (with the reason on the next line).
export function checkItem(passed: boolean, text: string, detail = "") {
  if (!passed) state.problems++;
  state.counts[passed ? "passed" : "failed"] = (state.counts[passed ? "passed" : "failed"] ?? 0) + 1;
  renderer({ kind: "check", passed, text, detail });
}

// A checklist note: shown with !, counted, but it doesn't fail the check.
export function checkWarn(text: string, detail = "") {
  state.counts.warnings = (state.counts.warnings ?? 0) + 1;
  renderer({ kind: "warning", text, detail });
}

export function section(title: string) {
  renderer({ kind: "section", title });
}

// Opens a command: "┌  dotagents init  ~/projects/app".
export function header(command: string, subject = "") {
  renderer({ kind: "header", command, subject });
}

// Closes a command with a summary, and sets the exit code from the problems counted.
export function finish(hint = "") {
  renderer({ kind: "finish", hint });
  process.exitCode = state.problems ? 1 : 0;
}

// Runs fn with its events kept instead of printed, and the run's counters left as they were:
// how a view other than the terminal (the TUI) shows what a module did. dryRun runs it as a
// preview (true) or for real (false) whatever --dry-run said.
type CaptureOptions = { dryRun?: boolean };

function swapIn(events: Event[], { dryRun }: CaptureOptions) {
  const saved = { renderer, dryRun: state.dryRun, problems: state.problems, counts: { ...state.counts }, base: state.base };
  renderer = collect(events);
  state.problems = 0;
  state.counts = {};
  if (dryRun !== undefined) state.dryRun = dryRun;
  return () => {
    renderer = saved.renderer;
    Object.assign(state, { dryRun: saved.dryRun, problems: saved.problems, counts: saved.counts, base: saved.base });
  };
}

export function capture(fn: () => void, options: CaptureOptions = {}): Event[] {
  const events: Event[] = [];
  const restore = swapIn(events, options);
  try {
    fn();
  } finally {
    restore();
  }
  return events;
}

// The same, for actions that wait on a process (git, npx).
export async function captureAsync(fn: () => Promise<void>, options: CaptureOptions = {}): Promise<Event[]> {
  const events: Event[] = [];
  const restore = swapIn(events, options);
  try {
    await fn();
  } finally {
    restore();
  }
  return events;
}

// The terminal spinner draws over the screen, so it only turns under the rail renderer.
export const spinnerAllowed = () => renderer === railRenderer;
