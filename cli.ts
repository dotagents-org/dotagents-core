#!/usr/bin/env node
// `dotagents`: applies this repository's Claude Code configuration. Works on Windows, Linux and
// macOS with Node 22.18+, which runs this TypeScript file directly (type stripping, no build).
// Make it a command with `npm install && npm link` in the clone (the two dependencies,
// @clack/prompts and picocolors, draw the terminal output and the prompts).
//
// This file only reads the arguments, picks the command and prints the help. Each command
// lives in commands/<name>.ts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accountAdd, accountList, accountRemove } from "./commands/account.ts";
import { check } from "./commands/check.ts";
import { init } from "./commands/init.ts";
import { install } from "./commands/install.ts";
import { newWorkspace } from "./commands/new.ts";
import type { CliArgs, Command } from "./commands/shared.ts";
import { skills, skillsAdd, skillsRemove } from "./commands/skills.ts";
import { update } from "./commands/update.ts";
import { usage } from "./commands/usage.ts";
import { untrack, workspaces } from "./commands/workspaces.ts";
import { parseArgs } from "./lib/common.ts";
import { displayPath, fancy, style } from "./lib/output.ts";
import { state } from "./lib/state.ts";

// In the order the help lists them.
const COMMANDS: Command[] = [install, update, accountAdd, accountList, accountRemove, usage, newWorkspace, init, check, workspaces, untrack, skills, skillsAdd, skillsRemove];

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
  const groups = (["Machine", "Accounts", "Workspace", "Skills"] as const).map(
    (group) => `${title(group)}\n${COMMANDS.filter((c) => c.group === group).map(cmd).join("\n")}`
  );
  return `${bold(magenta("dotagents"))} ${dim(version)}  Claude Code configuration

${title("Usage")}
  dotagents ${dim("<command> [options]")}

${groups.join("\n\n")}

${title("Options")}
  ${cyan("--dry-run")}    show what would be done, change nothing
  ${cyan("--yes")}        (init) don't ask anything
  ${cyan("--wrap")}       (init) move a repository into <name>-workspace/ first
  ${cyan("--default")}    (account add) the account in ~/.claude
  ${cyan("--color")}      (account add) the account's color, #RRGGBB
  ${cyan("--short")}      (usage) one line, for a prompt or a status line
  ${cyan("--json")}       (usage) the data, for scripts
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
  throw new Error(`Unknown command '${words[0]}'. Run: dotagents --help`);
}

const args = parseArgs<CliArgs>(process.argv.slice(2), {
  booleans: ["all", "default", "dry-run", "help", "json", "no-pull", "short", "version", "wrap", "yes"],
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
      console.error(fancy ? `${red("✗")} ${bold("dotagents:")} ${err.message}` : `dotagents: ${err.message}`);
      process.exitCode = 1;
    });
}
