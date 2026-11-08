#!/usr/bin/env node
// Writes a direct, readable transcript of a Claude Code session. No dependencies; Node 22.18+,
// which runs this TypeScript file directly.
//
// Reads the raw JSONL transcript that Claude Code keeps locally:
//
//   ~/.claude/projects/<project-slug>/<session-id>.jsonl
//
// and writes, in order, every user message and assistant reply (verbatim) plus a one-line entry
// per tool call, to:
//
//   <project-root>/.artifacts/session-archives/<date>-<session-id>.md
//
// Re-running overwrites the file, so it is safe to checkpoint mid-session.
//
// Usage:
//   node archive-session.ts --session-id <uuid>
//   node archive-session.ts --transcript /path/to/session.jsonl
//   node archive-session.ts                         # newest session for this project
//
//   --project-root   override the detected project root
//   --claude-home    override the Claude Code data folder (CLAUDE_CONFIG_DIR, else ~/.claude)
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
};

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

function userText(content: unknown) {
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
  };
  const seenMsgs = new Set<string>();
  const toolLines = new Map<string, number>(); // tool_use id → index of its line in s.out
  for (const obj of transcriptLines(file)) {
    s.sessionId = str(obj.sessionId) ?? s.sessionId;
    const ts = str(obj.timestamp);
    if (ts) {
      s.started ??= ts;
      s.ended = ts;
    }
    const t = obj.type;
    if (t === "ai-title") s.title = str(obj.aiTitle) ?? s.title;
    if (t === "cost-state") s.cost = obj;
    if (t === "attachment" && isObject(obj.attachment) && obj.attachment.type === "edited_text_file") addOnce(s.userEdited, str(obj.attachment.filename) ?? "?");
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
        }
      }
    } else if (t === "user") {
      const text = userText(content);
      if (text) {
        s.userTurns++;
        s.out.push("", `## 👤 User - ${(ts ?? "").slice(0, 16).replace("T", " ")} UTC`, "", text, "");
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
  return s;
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

export function renderArchive(s: ArchivedSession) {
  const tools = [...s.tools].sort((a, b) => b[1] - a[1]);
  const header = [
    `# ${s.title ?? `${s.agent} session ${s.sessionId}`}`,
    "",
    "| | |",
    "|---|---|",
    `| **Agent** | ${s.agent} |`,
    `| **Session** | \`${s.sessionId}\` |`,
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

// Where a session's archive goes inside a project.
export const archiveFile = (projectRoot: string, s: ArchivedSession) =>
  path.join(projectRoot, ".artifacts", "session-archives", `${(s.started ?? "").slice(0, 10)}-${s.sessionId}.md`);

// Parses a transcript and writes its archive; returns the file written.
export function writeArchive(transcript: string, projectRoot: string) {
  const session = parseTranscript(transcript);
  const out = archiveFile(projectRoot, session);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderArchive(session));
  return out;
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
    const m = /^--(session-id|transcript|project-root|claude-home)$/.exec(argv[i]);
    if (m && argv[i + 1] !== undefined) args[m[1]] = argv[++i];
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("Usage: node archive-session.ts [--session-id <uuid> | --transcript <file>] [--project-root <dir>] [--claude-home <dir>]");
      return 0;
    } else {
      console.error(`error: unexpected argument ${argv[i]}`);
      return 2;
    }
  }
  const projectRoot = path.resolve(args["project-root"] ?? findProjectRoot(path.resolve(process.argv[1])));
  const claudeHome = args["claude-home"] ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  const transcript = args.transcript ?? findTranscript(claudeHome, args["session-id"], projectRoot);
  if (!transcript || !fs.statSync(transcript, { throwIfNoEntry: false })?.isFile()) {
    console.error("error: transcript not found; pass --session-id or --transcript");
    return 1;
  }
  console.log(`Claude transcript written -> ${writeArchive(transcript, projectRoot)}`);
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
