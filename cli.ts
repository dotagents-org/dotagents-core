#!/usr/bin/env node
// `dotagents`: applies this repository's Claude Code configuration. Works on Windows, Linux and
// macOS with Node 22.18+, which runs this TypeScript file directly (type stripping, no build).
// Make it a command with `npm install && npm link` in the clone (@clack/prompts and picocolors
// draw the terminal output and the prompts; ink and react, the full-screen view in surfaces/tui/).
//
// This file only reads the arguments, picks the command and prints the help. Each command
// lives in surfaces/cli/<name>.ts, and uses the modules in core/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profileAdd, profileList, profileRemove } from "./surfaces/cli/profile.ts";
import { check } from "./surfaces/cli/check.ts";
import { init } from "./surfaces/cli/init.ts";
import { install } from "./surfaces/cli/install.ts";
import { newWorkspace } from "./surfaces/cli/new.ts";
import type { CliArgs, Command } from "./surfaces/cli/shared.ts";
import { skills, skillsAdd, skillsRemove } from "./surfaces/cli/skills.ts";
import { update } from "./surfaces/cli/update.ts";
import { usage } from "./surfaces/cli/usage.ts";
import { untrack, workspaces } from "./surfaces/cli/workspaces.ts";
import { parseArgs } from "./core/common.ts";
import { displayPath, fancy, interactive, style } from "./core/output.ts";
import { state } from "./core/state.ts";

// In the order the help lists them.
const COMMANDS: Command[] = [install, update, profileAdd, profileList, profileRemove, usage, newWorkspace, init, check, workspaces, untrack, skills, skillsAdd, skillsRemove];

const repo = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
const { bold, dim, cyan, red, magenta, gray } = style;

function help() {
  const cmd = ({ name, usage, summary, more = [] }: Command) => {
    const left = `${cyan(name)}${usage ? ` ${dim(usage)}` : ""}`;
    const width = name.length + (usage ? usage.length + 1 : 0);
    const pad = " ".repeat(Math.max(2, 30 - width));
    return [`  ${left}${pad}${summary}`, ...more.map((text) => `${" ".repeat(32)}${text}`)].join("\n");
  };
  const title = (t: string) => bold(t.toUpperCase());
  const groups = (["Machine", "Profiles", "Workspace", "Skills"] as const).map(
    (group) => `${title(group)}\n${COMMANDS.filter((c) => c.group === group).map(cmd).join("\n")}`
  );
  return `${bold(magenta("dotagents"))} ${dim(version)}  Claude Code configuration

${title("Usage")}
  dotagents ${dim("<command> [options]")}
  dotagents              ${dim("in a terminal, the full-screen view (usage, profiles, workspaces, skills)")}

${groups.join("\n\n")}

${title("Options")}
  ${cyan("--dry-run")}    show what would be done, change nothing
  ${cyan("--yes")}        (init) don't ask anything
  ${cyan("--wrap")}       (init) move a repository into <name>-workspace/ first
  ${cyan("--default")}    (profile add) the profile in ~/.claude
  ${cyan("--color")}      (profile add) the profile's color, #RRGGBB
  ${cyan("--short")}      (usage) one line, for a prompt or a status line
  ${cyan("--json")}       (usage) the data, for scripts
  ${cyan("--watch")}      (usage) the full-screen view, updated live
  ${cyan("--no-pull")}    (update) skip git pull, only reapply
  ${cyan("--help")}       show this help
  ${cyan("--version")}    show the version

${title("Examples")}
  ${gray("$")} dotagents new git@github.com:me/app.git
  ${gray("$")} dotagents init
  ${gray("$")} dotagents init ~/projects/app --skills session-archive,to-cards
  ${gray("$")} dotagents check ~/projects/app
  ${gray("$")} dotagents update --all

${dim("Repository:")} ${displayPath(repo)}
${dim("Third-party skills:")} npx skills add <owner/repo> ${dim("(at the workspace root)")}`;
}

// "skills add x" → the two-word command with ["x"]; "check x" → the one-word command.
function pick(words: string[]) {
  const two = COMMANDS.find((c) => c.name === `${words[0]} ${words[1]}`);
  if (two) return { command: two, positional: words.slice(2) };
  const one = COMMANDS.find((c) => c.name === words[0]);
  if (one) return { command: one, positional: words.slice(1) };
  if (words[0] === "account") throw new Error(`'account' is now 'profile' (since 2.0.0): dotagents profile ${words.slice(1).join(" ")}`.trimEnd());
  throw new Error(`Unknown command '${words[0]}'. Run: dotagents --help`);
}

const args = parseArgs<CliArgs>(process.argv.slice(2), {
  booleans: ["all", "default", "dry-run", "help", "json", "no-pull", "short", "version", "watch", "wrap", "yes"],
  lists: ["skills"],
});
state.dryRun = Boolean(args["dry-run"]);

if (args.version) {
  console.log(version);
} else if (!args._.length && !args.help && interactive) {
  // The full-screen view, loaded only when used, so the commands don't load React.
  import("./surfaces/tui/app.ts").then(({ runTui }) => runTui(repo));
} else if (args.help || !args._.length) {
  console.log(help());
} else {
  Promise.resolve()
    .then(() => {
      const { command, positional } = pick(args._);
      const screen = command.view?.(args);
      if (!screen) return command.run({ repo, args, positional });
      if (!interactive) throw new Error(`${command.name} opens the full-screen view, which needs a terminal`);
      return import("./surfaces/tui/app.ts").then(({ runTui }) => runTui(repo, screen));
    })
    .catch((err) => {
      console.error(fancy ? `${red("✗")} ${bold("dotagents:")} ${err.message}` : `dotagents: ${err.message}`);
      process.exitCode = 1;
    });
}
