// What every command file exports, and the small helpers more than one command uses.

import os from "node:os";
import path from "node:path";

export type CliArgs = {
  _: string[];
  all?: boolean;
  "dry-run"?: boolean;
  help?: boolean;
  "no-pull"?: boolean;
  version?: boolean;
  wrap?: boolean;
  yes?: boolean;
  default?: boolean;
  color?: string;
  json?: boolean;
  short?: boolean;
  watch?: boolean;
  skills?: string[];
};

// repo: this clone. positional: the arguments after the command's own words
// ("dotagents skills add me/x" → ["me/x"]).
export type Context = { repo: string; args: CliArgs; positional: string[] };

export type Command = {
  // One or two words: "check", "skills add".
  name: string;
  // Shown in the help, next to the name.
  usage: string;
  summary: string;
  // Extra help lines under the summary.
  more?: string[];
  group: "Machine" | "Profiles" | "Workspace" | "Skills";
  run(ctx: Context): void | Promise<void>;
};

// Accepts ~ for the home folder, so the short paths dotagents prints can be pasted back (the
// Windows shells don't expand ~ for external commands).
export function expandHome(dir: string) {
  return dir === "~" || /^~[\\/]/.test(dir) ? path.join(os.homedir(), dir.slice(1)) : dir;
}

// The workspace a command acts on: its path argument, or the current folder.
export const workspaceArg = (ctx: Context) => path.resolve(expandHome(ctx.positional[0] ?? process.cwd()));

export function wrap(text: string, width: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// A prompt hint is one line: the author's full description, cut only where the terminal ends.
export const fitHint = (text: string, label: string) => truncate(text, Math.max(30, (process.stdout.columns || 100) - label.length - 14));
