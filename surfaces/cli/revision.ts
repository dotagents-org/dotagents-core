// `revision`: the opt-in prompt revision (core/revision.ts). Off by default; on adds its hook to the
// configuration's claude/settings.json, off removes it. It revises through the signed-in Claude
// account, or with --api through the user's API key.

import path from "node:path";
import * as p from "@clack/prompts";
import { type LogEntry, type Pending, pendingMessages, reviseSession, windowSpan, disable, enable, isEnabled, keyFile, logFile, readBackend, readKey, readLog, runHook, saveBackend, saveKey } from "../../core/revision.ts";
import { displayPath, finish, header, interactive, tone } from "../../core/output.ts";
import { type Session, accountLabels, archiveSession, listSessions } from "../../core/sessions.ts";
import { state } from "../../core/state.ts";
import { byIds } from "./sessions.ts";
import type { Command } from "./shared.ts";

const { bold, muted } = tone;
const AFTER = "On Linux it takes effect at once; on Windows, run dotagents install to copy the settings.";

export const revision: Command = {
  name: "revision",
  usage: "",
  summary: "say whether prompt revision is on",
  more: ["each message you send, proofread by the cheapest Claude model"],
  group: "Machine",
  run({ repo }) {
    const on = isEnabled(repo);
    const api = readBackend() === "api";
    const how = api ? "through your API key" : "through the signed-in Claude account";
    console.log(`Prompt revision is ${bold(on ? "on" : "off")}${on ? `, ${how}` : ""}${on && api && !readKey() ? `, but there is no API key: run ${bold("dotagents revision on --api")}` : ""}.`);
    console.log(muted(on ? "Turn it off with: dotagents revision off" : "Turn it on with: dotagents revision on"));
    const log = readLog();
    if (!log.length) return;
    console.log();
    const day = Date.now() - 24 * 60 * 60 * 1000;
    console.log(summary("Last 24 hours", log.filter((e) => Date.parse(e.at) >= day)));
    console.log(summary("Since the start", log));
    console.log(muted(`Each revision, with the account's quota when it ran: ${displayPath(logFile())}`));
  },
};

// "Last 24 hours  12 revisions  US$ 0.0060 (US$ 0.0005 each)", then one line per way of revising.
// Only the revisions through the Claude account count against its plan, so only they show its
// usage, and only within the current window: a window that restarted is never compared.
function summary(label: string, entries: LogEntry[]) {
  if (!entries.length) return `${bold(label)}  ${muted("none")}`;
  const total = (list: LogEntry[]) => {
    const cost = list.reduce((a, e) => a + (e.costUsd ?? 0), 0);
    return `${list.length} revision${list.length === 1 ? "" : "s"}  US$ ${cost.toFixed(4)} (US$ ${(cost / list.length).toFixed(4)} each)`;
  };
  const lines = [`${bold(label)}  ${total(entries)}`];
  const api = entries.filter((e) => e.backend === "api");
  const account = entries.filter((e) => e.backend === "claude");
  if (api.length && account.length) lines.push(`  ${muted("API key")}  ${total(api)}`, `  ${muted("Claude account")}  ${total(account)}`);
  const five = windowSpan(account, "fiveHour"), seven = windowSpan(account, "sevenDay");
  const span = (name: string, w: NonNullable<typeof five>) => `${name} ${w.from}% → ${w.to}% over ${w.revisions} revision${w.revisions === 1 ? "" : "s"}`;
  if (five && seven) lines.push(`  ${muted(`${account.at(-1)!.quota!.profile}, in the windows of the last one`)}  ${span("5h", five)}, ${span("7d", seven)} ${muted("(everything the account did, not the revisions alone)")}`);
  return lines.join("\n");
}

export const revisionOn: Command = {
  name: "revision on",
  usage: "[--api]",
  summary: "turn prompt revision on, through the signed-in Claude account",
  more: ["--api: through your Anthropic API key instead, asked for the first time"],
  group: "Machine",
  async run({ repo, args }) {
    header("revision on", args.api ? "API key" : "Claude account");
    if (args.api && !readKey() && !state.dryRun) {
      if (!interactive) throw new Error("There is no API key yet: run dotagents revision on --api in a terminal, which asks for it");
      const key = await p.password({ message: "Anthropic API key (console.anthropic.com), kept only on this machine", validate: (v) => (v?.trim().startsWith("sk-ant-") ? undefined : "An API key starts with sk-ant-") });
      if (p.isCancel(key)) throw new Error("Cancelled");
      saveKey(key);
      console.log(muted(`Key saved in ${displayPath(keyFile())}, readable only by you.`));
    }
    if (!state.dryRun) saveBackend(args.api ? "api" : "claude");
    enable(repo);
    finish(AFTER);
  },
};

export const revisionOff: Command = {
  name: "revision off",
  usage: "",
  summary: "turn prompt revision off; the API key stays saved",
  group: "Machine",
  run({ repo }) {
    header("revision off");
    disable(repo);
    finish(AFTER);
  },
};

// Proofreads, after the fact, the messages of sessions that ran without the revision on, or from
// before it existed, and rewrites their archives with them.
export const revisionFix: Command = {
  name: "revision fix",
  usage: "[ids…] [--all] [--yes]",
  summary: "proofread the messages of past sessions that were not revised",
  more: ["the sessions started in this folder, or the ids given; --all: every project's", "uses the way revision is set up (the Claude account or your API key); asks first unless --yes"],
  group: "Machine",
  async run({ args, positional }) {
    header("revision fix", positional.join(" ") || (args.all ? "every project" : ""));
    const api = readBackend() === "api";
    if (api && !readKey()) throw new Error("There is no API key yet: run dotagents revision on --api in a terminal, which asks for it");
    const list = positional.length ? byIds(positional, listSessions({})) : listSessions({ under: args.all ? undefined : path.resolve(process.cwd()) });
    const todo = list.flatMap((s) => {
      const pending = pendingMessages(s);
      return pending?.messages.length ? [{ s, pending }] : [];
    });
    const count = todo.reduce((n, t) => n + t.pending.messages.length, 0);
    const noRoot = list.filter((s) => !s.root).length;
    if (noRoot) console.log(muted(`${noRoot} session${noRoot === 1 ? "" : "s"} not in a workspace with .artifacts/sessions/, which has nowhere to keep revisions: skipped.`));
    if (!count) return finish("Nothing to revise.");
    const how = api ? `through your API key, about US$ ${(count * 0.0012).toFixed(2)}` : "through the Claude account, on its plan";
    console.log(`${bold(`${count} message${count === 1 ? "" : "s"}`)} in ${todo.length} session${todo.length === 1 ? "" : "s"} to revise, ${how}.`);
    if (state.dryRun) return finish("Nothing was called or written.");
    if (!args.yes) {
      if (!interactive) throw new Error("Pass --yes to revise without asking");
      const ok = await p.confirm({ message: "Revise them and rewrite those sessions' archives?", initialValue: false });
      if (p.isCancel(ok) || !ok) return finish("Nothing was revised.");
    }
    const labels = accountLabels();
    for (const { s, pending } of todo as { s: Session; pending: Pending }[]) {
      const r = await reviseSession(pending);
      const detail = `${r.revised} revised, ${r.unchanged} already fine${r.failed ? `, ${r.failed} left for the next run` : ""}`;
      console.log(`${s.id.slice(0, 8)}  ${detail}`);
      if (r.revised + r.unchanged) archiveSession(s, labels);
    }
    finish();
  },
};

// What the hook runs: Claude Code's input on stdin, the hook's answer on stdout.
export const revisionHook: Command = {
  name: "revision hook",
  usage: "",
  summary: "the hook prompt revision runs (Claude Code calls it)",
  group: "Machine",
  async run() {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const out = await runHook(input);
    if (out) process.stdout.write(JSON.stringify(out));
  },
};
