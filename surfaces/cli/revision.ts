// `revision`: the opt-in prompt revision (core/revision.ts). Off by default; on adds its hook to the
// configuration's claude/settings.json, off removes it. It revises through the signed-in Claude
// account, or with --api through the user's API key.

import * as p from "@clack/prompts";
import { type LogEntry, windowSpan, disable, enable, isEnabled, keyFile, logFile, readBackend, readKey, readLog, runHook, saveBackend, saveKey } from "../../core/revision.ts";
import { displayPath, finish, header, interactive, tone } from "../../core/output.ts";
import { state } from "../../core/state.ts";
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
