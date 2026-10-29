// What the commands tell the user. The modules don't print: report, checkItem, checkWarn,
// section, header and finish count the result and hand an event to the current renderer.
//
// Renderers: in a terminal, the identity's look (the badge, bold section titles, one line per item
// with its icon, no rail), colors and short paths; piped or redirected (CI, scripts), plain "<status> <path> (<detail>)"
// lines that are easy to grep; in the tests, a list that collects the events. The colors follow
// core/theme.ts: NO_COLOR turns them off, FORCE_COLOR sets them.

import os from "node:os";
import path from "node:path";
import { updateSettings } from "@clack/prompts";
import { state } from "./state.ts";
import { SYMBOLS, backgroundOf, badge, colorLevel, painter } from "./theme.ts";

// The color level (core/theme.ts). The terminal look is on in a terminal, or when FORCE_COLOR
// asks for colors without one; FORCE_COLOR=0 keeps it plain.
const level = colorLevel();
export const fancy = Boolean(process.stdout.isTTY) || (Boolean(process.env.FORCE_COLOR) && level > 0);
// Prompts need a real keyboard, not just a colored output.
export const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;

export const toSlash = (p: string) => p.replace(/\\/g, "/");

// The roles of core/theme.ts for this terminal, and a profile's color in its readable variant.
export const ink = painter(level, backgroundOf());
export const paint = (hex: string) => ink.profile(hex);
export const tone = { bold: ink.bold, muted: ink.role("muted"), ok: ink.role("ok"), warn: ink.role("warn"), high: ink.role("high") };
export const brand = () => badge(level);

// The prompts (@clack/prompts) without their rail, like the rest of the output.
updateSettings({ withGuide: false });

// A line of a view drawn by a command itself (lists, the usage).
export const line = (text = "") => console.log(text);

const STATUS = {
  ok: { icon: SYMBOLS.passed, color: tone.muted },
  created: { icon: SYMBOLS.created, color: tone.ok },
  updated: { icon: SYMBOLS.updated, color: tone.warn },
  skipped: { icon: SYMBOLS.skipped, color: tone.warn },
  failed: { icon: SYMBOLS.failed, color: tone.high },
  "would create": { icon: SYMBOLS.created, color: tone.muted },
  "would update": { icon: SYMBOLS.updated, color: tone.muted },
  moved: { icon: SYMBOLS.moved, color: tone.ok },
  "would move": { icon: SYMBOLS.moved, color: tone.muted },
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

// The terminal: the badge and the command, a bold title per section, one line per item, and a
// summary. No rail, no dots between words; the icon and the word say the status without color.
export const terminalRenderer: Renderer = (event) => {
  switch (event.kind) {
    case "result": {
      const { icon, color } = STATUS[event.status];
      const shown = displayPath(event.target);
      const text = `  ${color(icon)} ${color(event.status.padEnd(12))} ${event.status === "ok" ? tone.muted(shown) : shown}`;
      return line(event.detail ? `${text}  ${tone.muted(displayDetail(event.detail))}` : text);
    }
    case "check":
      if (event.passed) return line(`  ${tone.ok(SYMBOLS.passed)} ${tone.muted(event.text)}`);
      line(`  ${tone.high(SYMBOLS.failed)} ${event.text}`);
      if (event.detail) line(`    ${tone.muted(displayDetail(event.detail))}`);
      return;
    case "warning":
      line(`  ${tone.warn(SYMBOLS.warning)} ${event.text}`);
      if (event.detail) line(`    ${tone.muted(displayDetail(event.detail))}`);
      return;
    case "section":
      line();
      return line(tone.bold(event.title));
    case "header": {
      const dry = state.dryRun ? `  ${tone.warn("dry run")}` : "";
      return line(`${brand()}  ${tone.bold(event.command)}${event.subject ? `  ${tone.muted(displayPath(event.subject))}` : ""}${dry}`);
    }
    case "finish": {
      // "✓ 9 created, 2 already ok".
      const c = state.counts;
      const parts = [
        c.passed && tone.ok(pluralize(c.passed, "passed")),
        c.created && tone.ok(pluralize(c.created, "created")),
        c.updated && tone.warn(pluralize(c.updated, "updated")),
        c.moved && tone.ok(pluralize(c.moved, "moved")),
        c["would move"] && pluralize(c["would move"], "to move"),
        c["would create"] && pluralize(c["would create"], "to create"),
        c["would update"] && pluralize(c["would update"], "to update"),
        c.ok && tone.muted(pluralize(c.ok, "already ok")),
        c.skipped && tone.warn(pluralize(c.skipped, "skipped")),
        c.warnings && tone.warn(pluralize(c.warnings, c.warnings === 1 ? "warning" : "warnings")),
        c.failed && tone.high(pluralize(c.failed, "failed")),
      ].filter(Boolean);
      const icon = state.problems ? tone.high(SYMBOLS.failed) : tone.ok(SYMBOLS.passed);
      line();
      if (state.dryRun) line(tone.warn("Dry run: nothing was changed."));
      if (state.problems) line(tone.muted(`See the lines marked ${SYMBOLS.failed} or ${SYMBOLS.warning} above.`));
      if (event.hint) for (const hint of event.hint.split("\n")) line(tone.muted(hint));
      return line(`${icon} ${parts.join(tone.muted(", ")) || "done"}\n`);
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

let renderer: Renderer = fancy ? terminalRenderer : plainRenderer;

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

// A checklist note: shown with its own icon, counted, but it doesn't fail the check.
export function checkWarn(text: string, detail = "") {
  state.counts.warnings = (state.counts.warnings ?? 0) + 1;
  renderer({ kind: "warning", text, detail });
}

export function section(title: string) {
  renderer({ kind: "section", title });
}

// Opens a command: " dotagents  init  ~/projects/app".
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

// The terminal spinner draws over the screen, so it only turns under the terminal renderer.
export const spinnerAllowed = () => renderer === terminalRenderer;
