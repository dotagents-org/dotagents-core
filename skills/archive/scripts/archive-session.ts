#!/usr/bin/env node
// Writes a direct, readable transcript of a Claude Code or Codex session. No dependencies; Node 24+,
// which runs this TypeScript file directly.
//
// Reads the raw JSONL transcript that Claude Code keeps locally:
//
//   ~/.claude/projects/<project-slug>/<session-id>.jsonl
//
// and writes, in order, every user message and assistant reply plus a one-line entry per tool
// call, to:
//
//   <project-root>/.artifacts/sessions/<date>-<session-id>.md
//
// The replies are verbatim. A user message is verbatim too, unless the agent running the skill
// revised it (spelling, clarity): the revisions live next to the archive, in
// <date>-<session-id>.revisions.json, keyed by message id, so every later write keeps them.
//
// Re-running overwrites the file, so it is safe to checkpoint mid-session.
//
// A Codex conversation works the same way with --agent codex: its rollout,
// $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl (CODEX_HOME, else ~/.codex), in the
// same format; inside Codex the conversation's id is in $CODEX_THREAD_ID.
//
// Usage:
//   node archive-session.ts --session-id <uuid>
//   node archive-session.ts --agent codex --session-id <uuid>
//   node archive-session.ts --transcript /path/to/session.jsonl
//   node archive-session.ts                         # newest session for this project
//   node archive-session.ts --session-id <uuid> --prompts         # user messages not revised yet, as JSON
//   node archive-session.ts --session-id <uuid> --revise <file>   # add revisions ({ id: text }), then write
//
//   --project-root   override the detected project root
//   --claude-home    override the Claude Code data folder (CLAUDE_CONFIG_DIR, else ~/.claude)
//   --codex-home     override the Codex data folder (CODEX_HOME, else ~/.codex)
//
// dotagents imports this file too (`dotagents sessions rm` archives before it deletes), so the
// parser lives in one place: keep the exports below stable.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const LOCAL_STDOUT = /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g;
// The mark dotagents' prompt revision puts before the revised message (core/sessions/revision.ts).
const REVISED_MARK = "✎";
// How it hands the revised message to Claude (core/sessions/revision.ts): this first line, then the text,
// then a paragraph of instructions.
const REVISED_HEAD = "The user's message above, proofread (spelling, punctuation, grammar):\n\n";
const REVISED_TAIL = "\n\nFollow it;";

type Json = Record<string, any>;

// What the parser collects; renderArchive() lays it out.
export type ArchivedSession = {
  sessionId: string;
  agent: string;
  title: string | null;
  model: string | null;
  started: string | null;
  ended: string | null;
  out: string[];
  efforts: string[];
  userTurns: number;
  assistantMsgs: number;
  tools: Map<string, number>;
  tokens: Map<string, number>;
  changed: string[];
  userEdited: string[];
  cost: Json | null;
  // The claude.ai accounts that ran the session, in the order they first did: Claude Code records
  // the signed-in account in session-owner lines. More than one means the session went on after
  // the login changed (a `dotagents switch`, then "continue"). Empty when no line records it, as
  // in transcripts from older versions.
  accounts: string[];
  // Each user message: its id (the transcript line's uuid, else its timestamp), its text and its
  // line in `out`, so a revision can replace it.
  prompts: { id: string; text: string; at: number }[];
  revised: number;
};

// How an account is shown: "work (me@example.com)". Unknown ids show their first 8 characters.
export type AccountLabels = Map<string, string>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const addOnce = (list: string[], item: string) => {
  if (!list.includes(item)) list.push(item);
};
const bump = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

// Cut by characters, not UTF-16 units, so an emoji is never split.
function clip(text: string, max: number) {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

function oneLine(label: string, val: string) {
  return `- \`${label}\` - ${clip(val.split(/\s+/).filter(Boolean).join(" "), 200)}`;
}

// The text of a user message, without injected context; a slash command as `/name args`.
export function promptText(content: unknown) {
  let text = Array.isArray(content)
    ? content.filter((b) => isObject(b) && b.type === "text").map((b) => (typeof b.text === "string" ? b.text : "")).join("\n")
    : typeof content === "string"
      ? content
      : "";
  text = text.replace(SYSTEM_REMINDER, "").trim();
  const command = COMMAND_NAME.exec(text);
  if (command) {
    const args = COMMAND_ARGS.exec(text)?.[1].trim();
    return `\`${command[1]}${args ? ` ${args}` : ""}\``;
  }
  return text.replace(LOCAL_STDOUT, "").trim();
}

function toolLine(block: Json) {
  const name = str(block.name) ?? "unknown";
  const input = isObject(block.input) ? block.input : {};
  for (const key of ["description", "command", "file_path", "path", "pattern", "query", "url", "prompt"]) {
    const val = str(input[key]);
    if (val) return oneLine(name, val);
  }
  return `- \`${name}\``;
}

// Every JSON object in a transcript, in order; broken or partial lines are skipped.
export function* transcriptLines(file: string): Generator<Json> {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (isObject(obj)) yield obj;
    } catch {
      // Being written, or not JSON: skipped.
    }
  }
}

export function parseTranscript(file: string): ArchivedSession {
  const s: ArchivedSession = {
    sessionId: path.basename(file, ".jsonl"),
    agent: "Claude",
    title: null,
    model: null,
    started: null,
    ended: null,
    out: [],
    efforts: [],
    userTurns: 0,
    assistantMsgs: 0,
    tools: new Map(),
    tokens: new Map(),
    changed: [],
    userEdited: [],
    cost: null,
    accounts: [],
    prompts: [],
    revised: 0,
  };
  const seenMsgs = new Set<string>();
  const toolLines = new Map<string, number>(); // tool_use id → index of its line in s.out
  let customTitle: string | null = null; // from /rename; wins over the ai-title written after it
  for (const obj of transcriptLines(file)) {
    s.sessionId = str(obj.sessionId) ?? s.sessionId;
    const ts = str(obj.timestamp);
    if (ts) {
      s.started ??= ts;
      s.ended = ts;
    }
    const t = obj.type;
    if (t === "ai-title") s.title = str(obj.aiTitle) ?? s.title;
    if (t === "custom-title") customTitle = str(obj.customTitle) ?? customTitle;
    if (t === "cost-state") s.cost = obj;
    if (t === "session-owner" && str(obj.accountUuid)) addOnce(s.accounts, obj.accountUuid);
    if (t === "attachment" && isObject(obj.attachment) && obj.attachment.type === "edited_text_file") addOnce(s.userEdited, str(obj.attachment.filename) ?? "?");
    // dotagents' prompt revision (dotagents revision on) hands Claude the revised message right
    // after it, as hook context starting with a fixed line: the archive shows that version. Before
    // 2026-11-14 it was found by the ✎ that started the chat line, with any spacing.
    if (t === "attachment" && isObject(obj.attachment) && (obj.attachment.hookEvent ?? obj.attachment.hookName) === "UserPromptSubmit") {
      const a = obj.attachment;
      const last = s.prompts.at(-1);
      let revised: string | null = null;
      if (a.type === "hook_additional_context") {
        const text = (Array.isArray(a.content) ? a.content : [a.content]).find((c: unknown) => typeof c === "string" && c.startsWith(REVISED_HEAD));
        if (text) revised = text.slice(REVISED_HEAD.length).split(REVISED_TAIL)[0];
      } else if (a.type === "hook_system_message" && str(a.content)?.trimStart().startsWith(REVISED_MARK)) {
        revised = str(a.content)!.trimStart().slice(REVISED_MARK.length);
      }
      if (revised?.trim() && last && s.out[last.at] === last.text) {
        s.out[last.at] = revised.trim();
        s.revised++;
      }
    }
    if (obj.isSidechain || obj.isMeta) continue;
    const msg = isObject(obj.message) ? obj.message : {};
    const content = msg.content;
    const isToolResult = Array.isArray(content) && content.some((b) => isObject(b) && b.type === "tool_result");
    if (t === "user" && ("toolUseResult" in obj || isToolResult)) {
      for (const block of Array.isArray(content) ? content : []) {
        if (!isObject(block) || block.type !== "tool_result") continue;
        const idx = toolLines.get(block.tool_use_id);
        if (idx === undefined) continue;
        if (block.is_error && !s.out[idx].endsWith("**(error)**")) s.out[idx] += " **(error)**";
        const answers = isObject(obj.toolUseResult) && isObject(obj.toolUseResult.answers) ? Object.entries(obj.toolUseResult.answers) : [];
        if (answers.length) {
          s.out.splice(idx + 1, 0, ...answers.map(([q, a]) => `  - **${q}** ${a}`));
          // Later indexes move past the inserted answer lines.
          for (const [k, v] of toolLines) if (v > idx) toolLines.set(k, v + answers.length);
          for (const p of s.prompts) if (p.at > idx) p.at += answers.length;
        }
      }
    } else if (t === "user") {
      const text = promptText(content);
      if (text) {
        s.userTurns++;
        s.out.push("", `## 👤 User - ${(ts ?? "").slice(0, 16).replace("T", " ")} UTC`, "", text, "");
        s.prompts.push({ id: str(obj.uuid) ?? ts ?? String(s.userTurns), text, at: s.out.length - 2 });
      }
    } else if (t === "assistant") {
      s.model = str(msg.model) ?? s.model;
      const effort = str(obj.perTurnEffort) ?? str(obj.effort);
      if (effort) addOnce(s.efforts, effort);
      const msgId = str(msg.id) ?? str(obj.uuid) ?? "";
      if (!seenMsgs.has(msgId)) {
        // One API message is split across several lines: counted once.
        seenMsgs.add(msgId);
        s.assistantMsgs++;
        const usage = isObject(msg.usage) ? msg.usage : {};
        bump(s.tokens, "in", Number(usage.input_tokens) || 0);
        bump(s.tokens, "out", Number(usage.output_tokens) || 0);
        bump(s.tokens, "cache read", Number(usage.cache_read_input_tokens) || 0);
        bump(s.tokens, "cache write", Number(usage.cache_creation_input_tokens) || 0);
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (!isObject(block)) continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          s.out.push("", `**🤖 ${s.agent}:**`, "", block.text.trim(), "");
        } else if (block.type === "tool_use") {
          bump(s.tools, str(block.name) ?? "unknown");
          toolLines.set(block.id, s.out.length);
          s.out.push(toolLine(block));
          const input = isObject(block.input) ? block.input : {};
          const target = str(input.file_path) ?? str(input.notebook_path);
          if (["Edit", "Write", "NotebookEdit"].includes(block.name) && target) addOnce(s.changed, target);
        }
      }
    }
  }
  s.title = customTitle ?? s.title;
  return s;
}

// ── Codex ─────────────────────────────────────────────────────────────────────────────────────

// What Codex puts in the user's role that the user didn't write: the environment, the AGENTS.md
// files, its own context.
export const CODEX_INJECTED = /^\s*(<environment_context>|<user_instructions>|<user_action>|<codex_internal_context|# AGENTS\.md instructions)/;

// The files an apply_patch names: "*** Add File: a", "*** Update File: b", "*** Move to: c".
const patchFiles = (patch: string) => [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map((m) => (m[1] ?? m[2]).trim());

// A Codex tool call as one line: the command for a shell, the first line of the code or patch for
// the others, the message for a subagent's.
function codexToolLine(name: string, input: string) {
  let shown = input;
  try {
    const args = JSON.parse(input);
    if (isObject(args)) {
      const command = Array.isArray(args.command) ? args.command.join(" ") : (str(args.command) ?? str(args.cmd));
      shown = command ?? str(args.message) ?? str(args.prompt) ?? str(args.path) ?? "";
    }
  } catch {
    // Not JSON: code or a patch, as it is
  }
  const first = shown.split("\n").find((l) => l.trim() && !/^\*\*\* Begin Patch/.test(l)) ?? "";
  return first ? oneLine(name, first) : `- \`${name}\``;
}

// A Codex rollout, as the same ArchivedSession a Claude transcript gives. titles: the names Codex
// keeps in session_index.jsonl ({ id: name }). Encrypted reasoning and injected context stay out.
export function parseRollout(file: string, titles: Record<string, string> = {}): ArchivedSession {
  const s: ArchivedSession = {
    sessionId: path.basename(file, ".jsonl").replace(/^rollout-[\dT-]+?-(?=[0-9a-f]{8}-)/, ""),
    agent: "Codex",
    title: null,
    model: null,
    started: null,
    ended: null,
    out: [],
    efforts: [],
    userTurns: 0,
    assistantMsgs: 0,
    tools: new Map(),
    tokens: new Map(),
    changed: [],
    userEdited: [],
    cost: null,
    accounts: [],
    prompts: [],
    revised: 0,
  };
  const toolLines = new Map<string, number>(); // call_id → index of its line in s.out
  let usage: Json | null = null;
  let metas = 0;
  let recorded = false;
  let firstPrompt: string | null = null;
  for (const obj of transcriptLines(file)) {
    const ts = str(obj.timestamp);
    if (ts) {
      s.started ??= ts;
      s.ended = ts;
    }
    const p = isObject(obj.payload) ? obj.payload : {};
    if (obj.type === "session_meta") {
      // The first one is the conversation's; a later one (a reverted history) names another
      if (metas++ > 0) continue;
      s.sessionId = str(p.id) ?? s.sessionId;
      if (str(p.creator_user_id)) addOnce(s.accounts, p.creator_user_id);
    } else if (obj.type === "turn_context") {
      s.model = str(p.model) ?? s.model;
      if (str(p.effort)) addOnce(s.efforts, p.effort);
    } else if (obj.type === "token_usage_record" && isObject(obj.thread_token_usage ?? p.thread_token_usage)) {
      usage = obj.thread_token_usage ?? p.thread_token_usage; // the thread's total so far
      recorded = true;
    } else if (!recorded && obj.type === "event_msg" && p.type === "token_count" && isObject(p.info?.total_token_usage)) {
      usage = p.info.total_token_usage; // older Codex: the same total, in its token_count events
    } else if (obj.type === "event_msg" && p.type === "item_completed" && isObject(p.item) && p.item.type === "FileChange") {
      const changes = p.item.changes;
      for (const f of Array.isArray(changes) ? changes.map((c) => (isObject(c) ? str(c.path) : null)) : isObject(changes) ? Object.keys(changes) : []) if (f) addOnce(s.changed, f);
    } else if (obj.type === "response_item" && p.type === "message") {
      const text = (Array.isArray(p.content) ? p.content : []).filter((b: unknown) => isObject(b) && typeof b.text === "string").map((b: Json) => b.text).join("\n").trim();
      if (!text) continue;
      if (p.role === "user" && !CODEX_INJECTED.test(text)) {
        s.userTurns++;
        firstPrompt ??= text;
        s.out.push("", `## 👤 User - ${(ts ?? "").slice(0, 16).replace("T", " ")} UTC`, "", text, "");
        s.prompts.push({ id: str(p.id) ?? ts ?? String(s.userTurns), text, at: s.out.length - 2 });
      } else if (p.role === "assistant") {
        s.assistantMsgs++;
        s.out.push("", `**🤖 ${s.agent}:**`, "", text, "");
      }
    } else if (obj.type === "response_item" && (p.type === "custom_tool_call" || p.type === "function_call")) {
      const name = str(p.name) ?? "unknown";
      const input = str(p.input) ?? str(p.arguments) ?? "";
      bump(s.tools, name);
      if (str(p.call_id)) toolLines.set(p.call_id, s.out.length);
      s.out.push(codexToolLine(name, input));
      if (name === "apply_patch") for (const f of patchFiles(input)) addOnce(s.changed, f);
    } else if (obj.type === "response_item" && (p.type === "custom_tool_call_output" || p.type === "function_call_output")) {
      const idx = toolLines.get(p.call_id);
      const out = isObject(p.output) ? p.output : null;
      const failed = (out && (out.success === false || (typeof out.exit_code === "number" && out.exit_code !== 0))) || /"exit_code":\s*[1-9]/.test(str(p.output) ?? "");
      if (idx !== undefined && failed && !s.out[idx].endsWith("**(error)**")) s.out[idx] += " **(error)**";
    }
  }
  if (usage) {
    bump(s.tokens, "in", (Number(usage.input_tokens) || 0) - (Number(usage.cached_input_tokens) || 0));
    bump(s.tokens, "out", Number(usage.output_tokens) || 0);
    bump(s.tokens, "cache read", Number(usage.cached_input_tokens) || 0);
  }
  s.title = titles[s.sessionId] ?? (firstPrompt ? clip(firstPrompt.split("\n")[0], 80) : null);
  return s;
}

// The names Codex gives its conversations: session_index.jsonl, one { id, thread_name } per line,
// the last one for an id winning.
export function codexTitles(codexHome: string): Record<string, string> {
  const titles: Record<string, string> = {};
  const file = path.join(codexHome, "session_index.jsonl");
  if (!fs.existsSync(file)) return titles;
  for (const obj of transcriptLines(file)) if (str(obj.id) && str(obj.thread_name)) titles[obj.id] = obj.thread_name;
  return titles;
}

// The ChatGPT accounts this machine knows, by profile: dotagents' usage record of each ChatGPT
// profile names its user (<state>/usage/<profile>.json); no login file is read.
export function knownCodexAccounts(): AccountLabels {
  const labels: AccountLabels = new Map();
  const usage = path.join(dotagentsState(), "usage");
  for (const name of fs.existsSync(usage) ? fs.readdirSync(usage).filter((n) => n.endsWith(".json")).sort() : []) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(usage, name), "utf8"));
      if (isObject(data) && data.provider === "chatgpt" && str(data.user) && !labels.has(data.user)) labels.set(data.user, name.slice(0, -5));
    } catch {
      // Being written, or not a record
    }
  }
  return labels;
}

// The rollout of a Codex conversation by its id, or the newest one started in the project.
function findRollout(codexHome: string, sessionId: string | undefined, projectRoot: string) {
  const files: { file: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number) => {
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const full = path.join(dir, name);
      if (depth < 3) walk(full, depth + 1);
      else if (/^rollout-.*\.jsonl$/.test(name)) files.push({ file: full, mtime: fs.statSync(full).mtimeMs });
    }
  };
  walk(path.join(codexHome, "sessions"), 0);
  files.sort((a, b) => b.mtime - a.mtime);
  if (sessionId) return files.find((f) => f.file.endsWith(`-${sessionId}.jsonl`))?.file ?? null;
  const root = projectRoot.toLowerCase();
  return (
    files.find((f) => {
      const meta = transcriptLines(f.file).next().value;
      const p = isObject(meta?.payload) ? meta.payload : {};
      return meta?.type === "session_meta" && !p.parent_thread_id && inProject(str(p.cwd), root);
    })?.file ?? null
  );
}

function duration(a: string | null, b: string | null) {
  if (!a || !b) return "?";
  const secs = Math.trunc((Date.parse(b) - Date.parse(a)) / 1000);
  if (Number.isNaN(secs)) return "?";
  const mins = Math.floor(secs / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));
const when = (ts: string | null) => (ts && ts.length >= 16 ? `${ts.slice(0, 10)} ${ts.slice(11, 16)} UTC` : "?");

// Session scratch files are temporary and only add noise.
const keep = (p: string) => {
  const low = p.toLowerCase();
  return !low.includes("\\temp\\claude\\") && !low.includes("/temp/claude/") && !low.includes("/tmp/claude-");
};

export const accountLabel = (uuid: string, labels: AccountLabels = new Map()) => labels.get(uuid) ?? `\`${uuid.slice(0, 8)}\``;

// "work (a@x)", or "work (a@x); also used by personal (b@x)" for a session shared by accounts.
export function accountsText(accounts: string[], labels: AccountLabels = new Map()) {
  if (!accounts.length) return "unknown (not in the transcript)";
  const [owner, ...others] = accounts.map((a) => accountLabel(a, labels));
  return others.length ? `${owner}; also used by ${others.join(", ")}` : owner;
}

export function renderArchive(s: ArchivedSession, labels: AccountLabels = new Map()) {
  const tools = [...s.tools].sort((a, b) => b[1] - a[1]);
  const header = [
    `# ${s.title ?? `${s.agent} session ${s.sessionId}`}`,
    "",
    "| | |",
    "|---|---|",
    `| **Agent** | ${s.agent} |`,
    `| **Session** | \`${s.sessionId}\` |`,
    `| **Account** | ${accountsText(s.accounts, labels)} |`,
    `| **Model** | \`${s.model ?? "unknown"}\` |`,
    `| **Started** | ${when(s.started)} |`,
    `| **Last activity** | ${when(s.ended)} |`,
    `| **Duration** | ${duration(s.started, s.ended)} |`,
    `| **Effort** | ${s.efforts.join(", ") || "unknown"} |`,
    `| **Turns** | ${s.userTurns} user, ${s.assistantMsgs} assistant |`,
    `| **Tool calls** | ${tools.map(([n, c]) => `${n} ${c}`).join(", ") || "none"} |`,
    `| **Tokens** | ${[...s.tokens].map(([k, v]) => `${k} ${short(v)}`).join(", ") || "unknown"} |`,
  ];
  if (s.cost) header.push(`| **Cost** | US$ ${(Number(s.cost.totalCostUSD) || 0).toFixed(2)} |`);
  if (s.revised) header.push(`| **User messages** | ${s.revised} of ${s.userTurns} proofread, same meaning |`);

  const edited = s.changed.filter(keep);
  const outside = s.userEdited.filter((p) => keep(p) && !s.changed.includes(p));
  const footer: string[] = [];
  if (edited.length || outside.length) {
    footer.push("", "---", "", "## 📝 Files changed", "", ...edited.map((p) => `- \`${p}\``));
    if (outside.length) {
      footer.push("", "Also changed outside the edit tools (by the user, or by shell commands such as `sed`/`mv`):", "", ...outside.map((p) => `- \`${p}\``));
    }
    footer.push("", "Files created, moved or deleted only through shell commands are not listed.");
  }
  return `${[...header, ...s.out, ...footer].join("\n").trimEnd()}\n`;
}

// Where a session's archive goes inside a project. The id and the date come from the transcript, so
// they are checked before they name a file: never a path out of .artifacts/sessions/.
export const archiveFile = (projectRoot: string, s: ArchivedSession) => {
  const day = (s.started ?? "").slice(0, 10);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s.sessionId)) throw new Error(`the session id ${JSON.stringify(s.sessionId.slice(0, 80))} can't name a file`);
  return path.join(projectRoot, ".artifacts", "sessions", `${/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "undated"}-${s.sessionId}.md`);
};

// The revised user messages of an archive ({ id: text }), kept next to it.
export const revisionsFile = (archive: string) => archive.replace(/\.md$/, ".revisions.json");

export function readRevisions(archive: string): Record<string, string> {
  try {
    const data = JSON.parse(fs.readFileSync(revisionsFile(archive), "utf8"));
    return isObject(data) ? Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === "string" && v.trim())) : {};
  } catch {
    return {};
  }
}

// Puts each revised user message in place of the verbatim one.
export function revise(s: ArchivedSession, revisions: Record<string, string>) {
  for (const p of s.prompts) {
    const text = revisions[p.id]?.trim();
    if (!text) continue;
    if (s.out[p.at] === p.text) s.revised++;
    s.out[p.at] = text;
  }
  return s;
}

// Parses a transcript and writes its archive, with the revisions saved next to it; returns the
// file written.
// parse: parseTranscript for Claude Code, or a parseRollout for Codex.
export function writeArchive(transcript: string, projectRoot: string, labels: AccountLabels = new Map(), parse: (file: string) => ArchivedSession = parseTranscript) {
  const session = parse(transcript);
  const out = archiveFile(projectRoot, session);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderArchive(revise(session, readRevisions(out)), labels));
  return out;
}

// dotagents' state folder: DOTAGENTS_STATE_DIR, else ~/.config/dotagents.
const dotagentsState = () => process.env.DOTAGENTS_STATE_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "dotagents");

// The accounts this machine knows, to name them: dotagents keeps each profile's account in
// <state>/vault/<profile>/account.json (DOTAGENTS_STATE_DIR, else ~/.config/dotagents), and Claude
// Code the signed-in one in ~/.claude.json. Only the id and the email are read, never a credential.
export function knownAccounts(claudeHome: string): AccountLabels {
  const labels: AccountLabels = new Map();
  const read = (file: string) => {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return isObject(data) ? data : null;
    } catch {
      return null;
    }
  };
  const vault = path.join(dotagentsState(), "vault");
  for (const name of fs.existsSync(vault) ? fs.readdirSync(vault).sort() : []) {
    const account = read(path.join(vault, name, "account.json"));
    if (str(account?.accountUuid)) labels.set(account!.accountUuid, str(account!.emailAddress) ? `${name} (${account!.emailAddress})` : name);
  }
  // ~/.claude.json for the default folder, <folder>/.claude.json for another one.
  const isDefault = path.resolve(claudeHome) === path.join(os.homedir(), ".claude");
  const oauth = read(isDefault ? path.join(os.homedir(), ".claude.json") : path.join(claudeHome, ".claude.json"))?.oauthAccount;
  if (isObject(oauth) && str(oauth.accountUuid) && !labels.has(oauth.accountUuid) && str(oauth.emailAddress)) labels.set(oauth.accountUuid, oauth.emailAddress);
  return labels;
}

// ── Command line ──────────────────────────────────────────────────────────────────────────────

// The skill lives in <root>/{.agents,.claude}/skills/...; the path as invoked, not the link's
// target, so a skill linked into a workspace finds that workspace.
function findProjectRoot(script: string) {
  for (let dir = path.dirname(script); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const name = path.basename(dir);
    if (name === ".agents" || name === ".claude") return path.dirname(dir);
  }
  return process.cwd();
}

const inProject = (cwd: string | null, root: string) => Boolean(cwd) && (cwd!.toLowerCase() === root || cwd!.toLowerCase().startsWith(root + path.sep));

function firstCwd(file: string) {
  for (const obj of transcriptLines(file)) if (str(obj.cwd)) return obj.cwd as string;
  return null;
}

function findTranscript(claudeHome: string, sessionId: string | undefined, projectRoot: string) {
  const projects = path.join(claudeHome, "projects");
  const files: { file: string; mtime: number }[] = [];
  for (const dir of fs.existsSync(projects) ? fs.readdirSync(projects) : []) {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(projects, dir));
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith(".jsonl"))) {
      const file = path.join(projects, dir, name);
      files.push({ file, mtime: fs.statSync(file).mtimeMs });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  if (sessionId) return files.find((f) => path.basename(f.file, ".jsonl") === sessionId)?.file ?? null;
  const root = projectRoot.toLowerCase();
  return files.find((f) => inProject(firstCwd(f.file), root))?.file ?? null;
}

function main(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(session-id|transcript|project-root|claude-home|codex-home|agent|revise)$/.exec(argv[i]);
    if (m && argv[i + 1] !== undefined) args[m[1]] = argv[++i];
    else if (argv[i] === "--prompts") args.prompts = "yes";
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("Usage: node archive-session.ts [--agent claude|codex] [--session-id <uuid> | --transcript <file>] [--project-root <dir>] [--claude-home <dir>] [--codex-home <dir>] [--prompts | --revise <file>]");
      return 0;
    } else {
      console.error(`error: unexpected argument ${argv[i]}`);
      return 2;
    }
  }
  const agent = args.agent ?? "claude";
  if (agent !== "claude" && agent !== "codex") {
    console.error(`error: --agent is claude or codex, not ${agent}`);
    return 2;
  }
  const projectRoot = path.resolve(args["project-root"] ?? findProjectRoot(path.resolve(process.argv[1])));
  const claudeHome = args["claude-home"] ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  const codexHome = args["codex-home"] ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const transcript = args.transcript ?? (agent === "codex" ? findRollout(codexHome, args["session-id"], projectRoot) : findTranscript(claudeHome, args["session-id"], projectRoot));
  if (!transcript || !fs.statSync(transcript, { throwIfNoEntry: false })?.isFile()) {
    console.error("error: transcript not found; pass --session-id or --transcript");
    return 1;
  }
  const titles = agent === "codex" ? codexTitles(codexHome) : {};
  const parse = agent === "codex" ? (file: string) => parseRollout(file, titles) : parseTranscript;
  const archive = archiveFile(projectRoot, parse(transcript));
  if (args.prompts) {
    // The user messages with no revision yet, for the agent to revise
    // Not those revised already: by an earlier --revise, or by the prompt revision hook.
    const done = readRevisions(archive);
    const s = parse(transcript);
    console.log(JSON.stringify(s.prompts.filter((p) => !done[p.id] && s.out[p.at] === p.text).map(({ id, text }) => ({ id, text })), null, 2));
    return 0;
  }
  if (args.revise) {
    let added: unknown;
    try {
      added = JSON.parse(fs.readFileSync(args.revise, "utf8"));
    } catch (err) {
      console.error(`error: ${args.revise} is not a JSON file: ${(err as Error).message}`);
      return 1;
    }
    if (!isObject(added) || !Object.values(added).every((v) => typeof v === "string")) {
      console.error(`error: ${args.revise} must be an object of message id to revised text`);
      return 1;
    }
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(revisionsFile(archive), `${JSON.stringify({ ...readRevisions(archive), ...added }, null, 2)}\n`);
  }
  const labels = agent === "codex" ? knownCodexAccounts() : knownAccounts(claudeHome);
  console.log(`${agent === "codex" ? "Codex" : "Claude"} transcript written -> ${writeArchive(transcript, projectRoot, labels, parse)}`);
  return 0;
}

const invoked = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invoked) process.exitCode = main(process.argv.slice(2));
