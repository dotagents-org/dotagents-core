#!/usr/bin/env node
// `dotagents`: applies this repository's Claude Code configuration. Works on Windows, Linux and
// macOS with Node 22.18+, which runs this TypeScript file directly (type stripping, no build).
// Make it a command with `npm install && npm link` in the clone (@clack/prompts for the
// prompts; the colors are core/theme.ts).
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
import { settingsPull } from "./surfaces/cli/settings.ts";
import { skills, skillsAdd, skillsRemove } from "./surfaces/cli/skills.ts";
import { update } from "./surfaces/cli/update.ts";
import { usage } from "./surfaces/cli/usage.ts";
import { untrack, workspaces } from "./surfaces/cli/workspaces.ts";
import { parseArgs } from "./core/common.ts";
import { brand, displayPath, fancy, tone } from "./core/output.ts";
import { state } from "./core/state.ts";

// In the order the help lists them.
const COMMANDS: Command[] = [install, update, settingsPull, profileAdd, profileList, profileRemove, usage, newWorkspace, init, check, workspaces, untrack, skills, skillsAdd, skillsRemove];

const repo = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
const { bold, muted, high } = tone;

function help() {
  const cmd = ({ name, usage, summary, more = [] }: Command) => {
    const left = `${bold(name)}${usage ? ` ${muted(usage)}` : ""}`;
    const width = name.length + (usage ? usage.length + 1 : 0);
    const pad = " ".repeat(Math.max(2, 30 - width));
    return [`  ${left}${pad}${summary}`, ...more.map((text) => `${" ".repeat(32)}${text}`)].join("\n");
  };
  const title = (t: string) => bold(t.toUpperCase());
  const groups = (["Machine", "Profiles", "Workspace", "Skills"] as const).map(
    (group) => `${title(group)}\n${COMMANDS.filter((c) => c.group === group).map(cmd).join("\n")}`
  );
  return `${brand()} ${muted(version)}  Claude Code configuration

${title("Usage")}
  dotagents ${muted("<command> [options]")}

${groups.join("\n\n")}

${title("Options")}
  ${bold("--dry-run")}    show what would be done, change nothing
  ${bold("--yes")}        (init) don't ask anything
  ${bold("--wrap")}       (init) move a repository into <name>-workspace/ first
  ${bold("--default")}    (profile add) the profile in ~/.claude
  ${bold("--color")}      (profile add) the profile's color, #RRGGBB
  ${bold("--short")}      (usage) one line, for a prompt or a status line
  ${bold("--json")}       (usage) the data, for scripts
  ${bold("--refresh")}    (usage) ask Claude Code for fresh numbers first
  ${bold("--no-pull")}    (update) skip git pull, only reapply
  ${bold("--from")}       (settings pull) the profile to take the settings from
  ${bold("--help")}       show this help
  ${bold("--version")}    show the version

${title("Examples")}
  ${muted("$")} dotagents new git@github.com:me/app.git
  ${muted("$")} dotagents init
  ${muted("$")} dotagents init ~/projects/app --skills session-archive,to-cards
  ${muted("$")} dotagents check ~/projects/app
  ${muted("$")} dotagents update --all

${muted("Repository:")} ${displayPath(repo)}
${muted("Third-party skills:")} npx skills add <owner/repo> ${muted("(at the workspace root)")}`;
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
  booleans: ["all", "default", "dry-run", "help", "json", "no-pull", "refresh", "short", "version", "watch", "wrap", "yes"],
  lists: ["skills"],
});
state.dryRun = Boolean(args["dry-run"]);

if (args.version) {
  console.log(version);
} else if (args.help || !args._.length) {
  console.log(help());
} else {
  Promise.resolve()
    .then(() => {
      const { command, positional } = pick(args._);
      return command.run({ repo, args, positional });
    })
    .catch((err) => {
      console.error(fancy ? `${high("✗")} ${bold("dotagents:")} ${err.message}` : `dotagents: ${err.message}`);
      process.exitCode = 1;
    });
}
