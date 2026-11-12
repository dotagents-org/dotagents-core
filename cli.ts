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
import { sessions, sessionsRm } from "./surfaces/cli/sessions.ts";
import { settingsPull } from "./surfaces/cli/settings.ts";
import { switchCommand } from "./surfaces/cli/switch.ts";
import { login } from "./surfaces/cli/login.ts";
import { skills, skillsAdd, skillsRemove } from "./surfaces/cli/skills.ts";
import { update } from "./surfaces/cli/update.ts";
import { usage } from "./surfaces/cli/usage.ts";
import { startServer } from "./surfaces/web/server.ts";
import { readSlots, readUsage, currentFor, usageJson, watchPeer } from "./core/snapshot.ts";
import { openDesktop } from "./core/desktop.ts";
import { forgetServer, loadMachine, loadProfiles, recordServer } from "./core/machine-state.ts";
import { launcherDir } from "./core/profiles.ts";
import { switchProfile } from "./core/switch.ts";
import { LIVE_EVERY_MS, refreshUsage } from "./core/live.ts";
import { untrack, workspaces } from "./surfaces/cli/workspaces.ts";
import { UsageError, parseArgs } from "./core/common.ts";
import { brand, captureAsync, displayPath, fancy, tone } from "./core/output.ts";
import { state } from "./core/state.ts";

// The dashboard's server. Defined here, at the root, because it joins two surfaces: the command
// line starts it, surfaces/web/ serves it.
const start: Command = {
  name: "start",
  usage: "[--port <n>]",
  summary: "start the dashboard's server on 127.0.0.1, live",
  more: ["asks Anthropic for each profile's usage every minute;", "reads the other side only while it runs, never waking WSL;", "prints the address to open, with its token;", "Ctrl+C stops it"],
  group: "Profiles",
  async run({ args }) {
    const port = args.port === undefined ? undefined : Number(args.port);
    if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port < 65536)) throw new UsageError(`--port takes a number, not ${args.port}`);
    // The other side: whether it runs, asked every 5 s, and its running sessions, every 15 s.
    const view = watchPeer();
    // The refresh and the switch capture their events through one shared sink: one at a time, or
    // one's failures land in the other's list.
    let queue: Promise<unknown> = Promise.resolve();
    const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
      const run = queue.then(fn, fn);
      queue = run.catch(() => {});
      return run;
    };
    const known = (body: unknown) => {
      const name = (body as { profile?: unknown } | null)?.profile;
      return typeof name === "string" && loadProfiles().some((p) => p.name === name) ? name : null;
    };
    const server = await startServer({
      read: () => {
        const now = new Date();
        const list = readUsage(now, view);
        // Which account is in each side's slot, and the current one (the worse of the two).
        const slots = readSlots(list, view);
        const json = { ...usageJson(list, now), slots, current: currentFor(list, slots, now) };
        let peer;
        try {
          peer = loadMachine().peer;
        } catch {
          peer = undefined;
        }
        return peer ? { ...json, peer: { name: peer.name, up: view.up(peer) } } : json;
      },
      port,
      // The tray panel's buttons.
      actions: {
        switch: async (body) => {
          const name = known(body);
          if (!name) return { status: 404, body: { ok: false, detail: "no such profile" } };
          try {
            const events = await oneAtATime(() => captureAsync(() => switchProfile({ name })));
            const failed = events.filter((e) => e.kind === "result" && e.status === "failed");
            return { status: failed.length ? 502 : 200, body: { ok: !failed.length, detail: failed.map((e) => ("detail" in e ? e.detail : "")).join("; ") || `now ${name}` } };
          } catch (err) {
            return { status: 409, body: { ok: false, detail: (err as Error).message } };
          }
        },
        desktop: (body) => {
          const name = known(body);
          if (!name) return { status: 404, body: { ok: false, detail: "no such profile" } };
          const opened = openDesktop(name, launcherDir());
          return { status: opened.ok ? 200 : 409, body: opened };
        },
      },
    });
    // Where the tray panel finds it, taken away when it stops.
    recordServer({ port: server.port, token: server.token });
    process.on("exit", forgetServer);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0));
    console.log(`${brand()}  ${bold("start")}\n\nOpen ${server.url}\n${muted("Only this machine reaches it, and only with the token in that address. Ctrl+C stops it.")}`);
    // The live usage, every minute; a failure is printed when it changes, not on every tick.
    const said = new Map<string, string>();
    const tick = async () => {
      const events = await oneAtATime(() => captureAsync(() => refreshUsage()));
      for (const e of events) {
        if (e.kind !== "result" || e.status === "ok") continue;
        const text = e.status === "failed" ? e.detail : "";
        if ((said.get(e.target) ?? "") !== text && text) console.error(`${new Date().toLocaleTimeString("en-GB")}  ${e.target}: ${text}`);
        said.set(e.target, text);
      }
    };
    await tick();
    setInterval(tick, LIVE_EVERY_MS + 5_000).unref();
  },
};

// In the order the help lists them.
const COMMANDS: Command[] = [install, update, settingsPull, profileAdd, profileList, profileRemove, switchCommand, login, usage, start, newWorkspace, init, check, workspaces, untrack, sessions, sessionsRm, skills, skillsAdd, skillsRemove];

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
  ${bold("--yes")}        (init, sessions rm) don't ask anything
  ${bold("--wrap")}       (init) move a repository into <name>-workspace/ first
  ${bold("--default")}    (profile add) the profile in ~/.claude
  ${bold("--color")}      (profile add) the profile's color, #RRGGBB
  ${bold("--short")}      (usage) one line, for a prompt or a status line
  ${bold("--json")}       (usage, sessions) the data, for scripts
  ${bold("--all")}        (sessions) every project's sessions, not only this folder's; (login) every login running out
  ${bold("--refresh")}    (usage) ask Claude Code for fresh numbers first
  ${bold("--no-pull")}    (update) skip git pull, only reapply
  ${bold("--no-archive")} (sessions rm) delete without archiving
  ${bold("--from")}       (settings pull) the profile to take the settings from
  ${bold("--port")}       (start) the server's port; 0 picks a free one
  ${bold("--here")}       (switch) only this side of the machine
  ${bold("--save")}       (switch) keep the login in ~/.claude as this profile's
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
  throw new UsageError(`Unknown command '${words[0]}'. Run: dotagents --help`);
}

// One line for an error, never a stack trace; 2 when the command line itself is wrong.
function fail(err: Error) {
  console.error(fancy ? `${high("✗")} ${bold("dotagents:")} ${err.message}` : `dotagents: ${err.message}`);
  process.exitCode = err instanceof UsageError ? 2 : 1;
}

let args: CliArgs | null = null;
try {
  args = parseArgs<CliArgs>(process.argv.slice(2), {
    booleans: ["all", "default", "dry-run", "help", "here", "json", "no-archive", "no-pull", "refresh", "running", "short", "version", "watch", "wrap", "yes"],
    lists: ["skills"],
    values: ["color", "from", "port", "save"],
  });
} catch (err) {
  fail(err as Error);
}

if (!args) {
  // The command line was refused above.
} else if (args.version) {
  console.log(version);
} else if (args.help || !args._.length) {
  console.log(help());
} else {
  state.dryRun = Boolean(args["dry-run"]);
  const parsed = args;
  Promise.resolve()
    .then(() => {
      const { command, positional } = pick(parsed._);
      return command.run({ repo, args: parsed, positional });
    })
    .catch(fail);
}
