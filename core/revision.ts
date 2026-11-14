// Prompt revision: an opt-in UserPromptSubmit hook that rewrites each message the user sends
// (spelling, punctuation, grammar, same words) with the newest Sonnet at low effort: by default
// through the
// signed-in Claude account (a lean `claude -p`), or through the user's own Anthropic API key when
// they choose it. The revised text is shown in the chat (systemMessage) and handed to the model
// (additionalContext); Claude Code records both in the transcript, where the session archive
// reads it. The hook never blocks and never changes the prompt: any failure lets it through as is.
// ADR 0015 in the workspace's .artifacts/decisions/.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { defaultConfigDir, signedIn } from "./claude-code.ts";
import { configRoot, mkdirFor } from "./common.ts";
import { stateDir } from "./machine-state.ts";
import { report } from "./output.ts";
import { state } from "./state.ts";

// The mark that starts the revised text in the chat; the session archive looks for it.
// How the revision reaches Claude, around the revised text. The session archive finds it by the
// first line, so the chat line (systemMessage) is free to be just the text.
export const CONTEXT_HEAD = "The user's message above, proofread (spelling, punctuation, grammar):\n\n";
export const CONTEXT_TAIL = "\n\nFollow it; where it and the original differ in meaning, the original wins. If the request is vague, ask before acting.";
export const HOOK_COMMAND = "dotagents revision hook";
// Sonnet, not Haiku: on 2026-11-13 it got 9 of 12 test messages right against Haiku's 3, and was
// no slower (.artifacts/revision-eval/ in the workspace). Through the Claude account the "sonnet"
// alias always names the newest one; through the API, the model list does, else this.
export const FALLBACK_MODEL = "claude-sonnet-5-5";
// The hook has this long in all; past it, the message goes on unrevised.
const TIMEOUT_MS = 8_000;
const DAY = 24 * 60 * 60 * 1000;

// The rules, one copy for the hook and for the session-archive skill's own revision step.
export const RULES = fs.readFileSync(fileURLToPath(new URL("../skills/session-archive/references/revision-rules.md", import.meta.url)), "utf8").trim();

const dir = () => path.join(stateDir(), "revision");
export const keyFile = () => path.join(dir(), "api-key");
const modelFile = () => path.join(dir(), "model.json");
const backendFile = () => path.join(dir(), "backend");
export const logFile = () => path.join(dir(), "log.jsonl");

// One revision's answer, with what it cost: tokens, and dollars (what Claude Code reports through
// the account, at API prices; computed from the price list through the API).
export type Revision = { text: string; model: string; costUsd: number | null; tokens: { input: number; cacheRead: number; cacheWrite: number; output: number } };

// Dollars per million tokens, for the API's answers, which carry tokens but no cost.
const PRICES: Record<string, { input: number; cacheRead: number; cacheWrite: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
};

const tokensOf = (u: Record<string, unknown> | undefined) => ({
  input: Number(u?.input_tokens) || 0,
  cacheRead: Number(u?.cache_read_input_tokens) || 0,
  cacheWrite: Number(u?.cache_creation_input_tokens) || 0,
  output: Number(u?.output_tokens) || 0,
});

// The plan's usage of the account signed in to Claude Code right now, as dotagents' live usage last
// read it (<state>/usage/<profile>.json): what a revision through the account counts against.
export function quotaNow() {
  const account = signedIn(defaultConfigDir())?.accountUuid;
  const usage = path.join(stateDir(), "usage");
  if (!account || !fs.existsSync(usage)) return null;
  for (const file of fs.readdirSync(usage).filter((f) => f.endsWith(".json"))) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(usage, file), "utf8"));
      if (r.accountUuid !== account) continue;
      const five = r.utilization?.five_hour, seven = r.utilization?.seven_day;
      return {
        profile: path.basename(file, ".json"),
        fiveHourPct: (five?.utilization ?? null) as number | null,
        sevenDayPct: (seven?.utilization ?? null) as number | null,
        // When each window ends: a different value means the window restarted.
        fiveHourResetsAt: (five?.resets_at ?? null) as string | null,
        sevenDayResetsAt: (seven?.resets_at ?? null) as string | null,
        readAt: new Date(Number(r.fetchedAtMs)).toISOString(),
      };
    } catch {
      // A record half written: skipped.
    }
  }
  return null;
}

// Every revision goes to <state>/revision/log.jsonl, one line each, with the quota at that moment.
export function logRevision(backend: Backend, r: Revision, now = new Date()) {
  try {
    mkdirFor(logFile());
    fs.appendFileSync(logFile(), `${JSON.stringify({ at: now.toISOString(), backend, model: r.model, costUsd: r.costUsd, tokens: r.tokens, quota: quotaNow() })}\n`);
  } catch {
    // The log never stops a revision.
  }
}

export type LogEntry = { at: string; backend: Backend; model: string; costUsd: number | null; tokens: Revision["tokens"]; quota: ReturnType<typeof quotaNow> };

// How far a window's usage went over the latest entries that share the last one's window: a window
// that restarted (another end, or a percentage that dropped) starts the count again, so a span
// never compares two windows. Entries from before the end was logged are split by the drop alone.
export function windowSpan(entries: LogEntry[], window: "fiveHour" | "sevenDay"): { from: number; to: number; revisions: number } | null {
  const pct = (e: LogEntry) => e.quota?.[`${window}Pct`] ?? null;
  const day = (e: LogEntry) => e.quota?.[`${window}ResetsAt`]?.slice(0, 13) ?? null; // to the hour: the end's seconds drift between reads
  const list = entries.filter((e) => pct(e) != null);
  const last = list.at(-1);
  if (!last) return null;
  let first = list.length - 1;
  while (first > 0) {
    const a = list[first - 1], b = list[first];
    if (a.quota!.profile !== last.quota!.profile || pct(a)! > pct(b)! || (day(a) && day(b) && day(a) !== day(b))) break;
    first--;
  }
  return { from: pct(list[first])!, to: pct(last)!, revisions: list.length - first };
}

export function readLog(): LogEntry[] {
  try {
    return fs.readFileSync(logFile(), "utf8").split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

// How this side revises: "claude", the signed-in Claude account (the default), or "api", the
// user's API key. Each side keeps its own, as each keeps its own key.
export type Backend = "claude" | "api";

export function readBackend(): Backend {
  try {
    return fs.readFileSync(backendFile(), "utf8").trim() === "api" ? "api" : "claude";
  } catch {
    return "claude";
  }
}

export function saveBackend(backend: Backend) {
  if (backend === "claude") return fs.rmSync(backendFile(), { force: true });
  mkdirFor(backendFile());
  fs.writeFileSync(backendFile(), "api\n");
}

// Runs a lean `claude -p` with the newest Sonnet at low effort: no tools, no settings (so this hook
// doesn't run inside it), no MCP, no saved session. About 3 s, measured on 2026-11-13; the defaults
// took 121 s.
export type ClaudeRunner = (text: string) => Promise<Revision | null>;

export const runClaude: ClaudeRunner = (text) =>
  new Promise((resolve) => {
    const args = ["-p", "--output-format", "json", "--model", "sonnet", "--effort", "low", "--no-session-persistence", "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--system-prompt", RULES];
    // On Windows, claude is a .cmd shim, which only a shell runs.
    const child = spawn("claude", args, { shell: process.platform === "win32", windowsHide: true, timeout: TIMEOUT_MS });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      try {
        const r = JSON.parse(out);
        if (code !== 0 || r.is_error || typeof r.result !== "string" || !r.result.trim()) return resolve(null);
        const model = Object.keys(r.modelUsage ?? {})[0] ?? "sonnet";
        resolve({ text: r.result.trim(), model, costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null, tokens: tokensOf(r.usage) });
      } catch {
        resolve(null);
      }
    });
    child.stdin.end(text);
  });

// The API key, kept apart from the environment: ANTHROPIC_API_KEY would make Claude Code itself
// bill the API instead of the subscription.
export function readKey() {
  try {
    return fs.readFileSync(keyFile(), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function saveKey(key: string) {
  mkdirFor(keyFile());
  fs.writeFileSync(keyFile(), `${key.trim()}\n`, { mode: 0o600 });
  fs.chmodSync(keyFile(), 0o600);
}

// The part of the SDK client the revision uses, so tests can pass a fake one.
export type Client = {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number; maxRetries?: number }): Promise<Anthropic.Message> };
  models: { list(): AsyncIterable<{ id: string; created_at: string }> };
};

// The model through the API: the newest Sonnet in the model list, checked once a day.
export async function currentModel(client: Client, now = Date.now()) {
  try {
    const cached = JSON.parse(fs.readFileSync(modelFile(), "utf8"));
    if (typeof cached.id === "string" && now - Number(cached.checkedAt) < DAY) return cached.id as string;
  } catch {
    // Not cached yet.
  }
  let newest: { id: string; created_at: string } | null = null;
  try {
    for await (const m of client.models.list()) {
      if (m.id.startsWith("claude-sonnet") && (!newest || m.created_at > newest.created_at)) newest = m;
    }
  } catch {
    return FALLBACK_MODEL;
  }
  const id = newest?.id ?? FALLBACK_MODEL;
  mkdirFor(modelFile());
  fs.writeFileSync(modelFile(), `${JSON.stringify({ id, checkedAt: now })}\n`);
  return id;
}

export async function revise(client: Client, text: string, model: string) {
  const res = await client.messages.create(
    {
      model,
      // Required by the API; high enough that a revision never reaches it.
      max_tokens: 16_384,
      // No thinking (Sonnet 5.5 takes between_tools for that; with no tools, none happens).
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      system: RULES,
      messages: [{ role: "user", content: text }],
    },
    { timeout: TIMEOUT_MS, maxRetries: 0 },
  );
  if (res.stop_reason !== "end_turn") return null;
  const answer = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!answer) return null;
  const tokens = tokensOf(res.usage as unknown as Record<string, unknown>);
  const price = PRICES[model];
  const costUsd = price ? (tokens.input * price.input + tokens.cacheRead * price.cacheRead + tokens.cacheWrite * price.cacheWrite + tokens.output * price.output) / 1e6 : null;
  return { text: answer, model, costUsd, tokens } satisfies Revision;
}

// The parts of a message a proofread must never touch: code in backticks, URLs, paths and file
// names, and numbers. A revision that loses one is dropped, as prompt-preflight does.
const HARD = /`[^`]+`|https?:\/\/\S+|(?:[\w.~-]*\/)+[\w.-]+|\b[\w-]+\.[a-z]{1,5}\b|\d+(?:[.,]\d+)*/gi;

export function keepsHardTokens(original: string, revised: string) {
  return (original.match(HARD) ?? []).every((t) => revised.includes(t.replace(/[.,;:!?)]+$/, "")));
}

// What the hook prints for a prompt and its revision: nothing when they are the same, or when the
// revision lost a part it must keep.
export function hookOutput(prompt: string, revised: string | null) {
  if (!revised || revised === prompt.trim() || !keepsHardTokens(prompt, revised)) return null;
  return {
    systemMessage: revised,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `${CONTEXT_HEAD}${revised}${CONTEXT_TAIL}`,
    },
  };
}

// The hook: reads Claude Code's input, revises the prompt on this side's backend, prints the
// output. Never throws. Tests pass a fake runner or client.
export async function runHook(input: string, deps: { claude?: ClaudeRunner; client?: Client } = {}) {
  try {
    const prompt = JSON.parse(input)?.prompt;
    if (typeof prompt !== "string" || !prompt.trim() || prompt.trim().startsWith("/")) return null;
    const backend = readBackend();
    let r: Revision | null;
    if (backend === "claude") r = await (deps.claude ?? runClaude)(prompt);
    else {
      const key = readKey();
      if (!deps.client && !key) return null;
      const c = deps.client ?? (new Anthropic({ apiKey: key! }) as unknown as Client);
      r = await revise(c, prompt, await currentModel(c));
    }
    if (r) logRevision(backend, r);
    return hookOutput(prompt, r?.text ?? null);
  } catch {
    return null;
  }
}

// ── The switch: the hook's entry in the configuration's claude/settings.json ──────────────────────

type Settings = { hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }[]> };

const settingsFile = (repo: string) => path.join(configRoot(repo), "claude", "settings.json");
const isOurs = (h: { command: string }) => h.command === HOOK_COMMAND;

function readSettings(file: string): Settings {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function isEnabled(repo: string) {
  try {
    return (readSettings(settingsFile(repo)).hooks?.UserPromptSubmit ?? []).some((g) => g.hooks.some(isOurs));
  } catch {
    return false;
  }
}

function write(file: string, data: Settings) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function enable(repo: string) {
  const file = settingsFile(repo);
  if (isEnabled(repo)) return report("ok", file, "prompt revision is on");
  if (state.dryRun) return report("would update", file, "add the prompt revision hook");
  const data = fs.existsSync(file) ? readSettings(file) : {};
  data.hooks ??= {};
  (data.hooks.UserPromptSubmit ??= []).push({ hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 10 }] });
  mkdirFor(file);
  write(file, data);
  report("updated", file, "added the prompt revision hook");
}

export function disable(repo: string) {
  const file = settingsFile(repo);
  if (!isEnabled(repo)) return report("ok", file, "prompt revision is off");
  if (state.dryRun) return report("would update", file, "remove the prompt revision hook");
  const data = readSettings(file);
  const groups = data.hooks!.UserPromptSubmit!.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isOurs(h)) })).filter((g) => g.hooks.length);
  if (groups.length) data.hooks!.UserPromptSubmit = groups;
  else delete data.hooks!.UserPromptSubmit;
  if (!Object.keys(data.hooks!).length) delete data.hooks;
  write(file, data);
  report("updated", file, "removed the prompt revision hook");
}
