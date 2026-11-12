// The session-archive skill's script: run as a process against a temporary Claude Code data folder
// (CLAUDE_CONFIG_DIR), so the real one is never touched, and imported the way dotagents uses it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { accountsText, parseTranscript, renderArchive } from "../config/skills/session-archive/scripts/archive-session.ts";
import { REPO } from "./helpers.ts";

const SCRIPT = path.join(REPO, "config", "skills", "session-archive", "scripts", "archive-session.ts");
const ID = "11111111-2222-3333-4444-555555555555";

const user = (text: string, ts: string, extra = {}) => ({ type: "user", sessionId: ID, timestamp: ts, cwd: "/w", message: { role: "user", content: text }, ...extra });
const assistant = (id: string, content: unknown[], ts: string, extra = {}) => ({
  type: "assistant",
  sessionId: ID,
  timestamp: ts,
  effort: "high",
  message: { id, model: "claude-test-1", content, usage: { input_tokens: 10, output_tokens: 1500, cache_read_input_tokens: 2_000_000, cache_creation_input_tokens: 0 } },
  ...extra,
});
const toolResult = (id: string, ts: string, extra = {}) => ({
  type: "user",
  sessionId: ID,
  timestamp: ts,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "out" }] },
  toolUseResult: {},
  ...extra,
});

// A transcript with what the archive keeps and what it drops.
const LINES = [
  { type: "ai-title", aiTitle: "Fix the parser", sessionId: ID },
  user("<system-reminder>injected</system-reminder>Fix the parser please", "2026-01-02T10:00:00.000Z"),
  assistant("m1", [{ type: "text", text: "Looking.\n" }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls   -la\nsrc", description: "List   the sources" } }], "2026-01-02T10:00:05.000Z"),
  assistant("m1", [{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/w/src/parser.ts" } }], "2026-01-02T10:00:06.000Z"),
  toolResult("t1", "2026-01-02T10:00:07.000Z"),
  { ...toolResult("t2", "2026-01-02T10:00:08.000Z"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "no" }] } },
  assistant("m2", [{ type: "tool_use", id: "t3", name: "AskUserQuestion", input: {} }], "2026-01-02T10:01:00.000Z"),
  toolResult("t3", "2026-01-02T10:01:30.000Z", { toolUseResult: { answers: { "Which one?": "The first" } } }),
  assistant("m3", [{ type: "text", text: "Subagent thinking" }], "2026-01-02T10:02:00.000Z", { isSidechain: true }),
  user("<command-name>/model</command-name><command-args> opus </command-args>", "2026-01-02T10:03:00.000Z"),
  { type: "attachment", attachment: { type: "edited_text_file", filename: "/w/notes.md" } },
  { type: "cost-state", totalCostUSD: 1.234 },
  "not json {",
  assistant("m4", [{ type: "text", text: "Done." }], "2026-01-02T11:15:00.000Z"),
];

function setup(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-archive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claude = path.join(root, "claude");
  const project = path.join(claude, "projects", "-w");
  fs.mkdirSync(project, { recursive: true });
  const transcript = path.join(project, `${ID}.jsonl`);
  fs.writeFileSync(transcript, `${LINES.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n")}\n`);
  const run = (script: string, ...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd: root, env: { ...process.env, CLAUDE_CONFIG_DIR: claude, DOTAGENTS_STATE_DIR: path.join(root, "state") } });
  return { root, claude, transcript, run };
}

test("the archive keeps the conversation verbatim, one line per tool call, and the header", (t) => {
  const s = setup(t);
  const md = renderArchive(parseTranscript(s.transcript));
  const expected = [
    "# Fix the parser",
    "| **Session** | `11111111-2222-3333-4444-555555555555` |",
    "| **Account** | unknown (not in the transcript) |",
    "| **Model** | `claude-test-1` |",
    "| **Started** | 2026-01-02 10:00 UTC |",
    "| **Duration** | 1 h 15 min |",
    "| **Effort** | high |",
    "| **Turns** | 2 user, 3 assistant |",
    "| **Tool calls** | Bash 1, Edit 1, AskUserQuestion 1 |",
    "| **Tokens** | in 30, out 5k, cache read 6.0M, cache write 0 |",
    "| **Cost** | US$ 1.23 |",
    "## 👤 User - 2026-01-02 10:00 UTC\n\nFix the parser please",
    "**🤖 Claude:**\n\nLooking.",
    "- `Bash` - List the sources",
    "- `Edit` - /w/src/parser.ts **(error)**",
    "- `AskUserQuestion`\n  - **Which one?** The first",
    "`/model opus`",
    "## 📝 Files changed\n\n- `/w/src/parser.ts`",
    "- `/w/notes.md`",
  ];
  for (const text of expected) assert.ok(md.includes(text), `missing: ${text}\n---\n${md}`);
  assert.ok(!md.includes("injected"), "system reminders are stripped");
  assert.ok(!md.includes("Subagent thinking"), "sidechains are left out");
  assert.ok(md.endsWith("Done.\n\n\n---\n\n## 📝 Files changed\n\n- `/w/src/parser.ts`\n\nAlso changed outside the edit tools (by the user, or by shell commands such as `sed`/`mv`):\n\n- `/w/notes.md`\n\nFiles created, moved or deleted only through shell commands are not listed.\n"));
});

test("run from a workspace's skill link, the script finds the session by id and writes into that workspace", (t) => {
  const s = setup(t);
  const ws = path.join(s.root, "ws");
  const skills = path.join(ws, ".agents", "skills");
  fs.mkdirSync(skills, { recursive: true });
  fs.symlinkSync(path.join(REPO, "config", "skills", "session-archive"), path.join(skills, "session-archive"), "junction");
  const res = s.run(path.join(skills, "session-archive", "scripts", "archive-session.ts"), "--session-id", ID);
  assert.equal(res.status, 0, res.stderr);
  const out = path.join(ws, ".artifacts", "session-archives", `2026-01-02-${ID}.md`);
  assert.match(res.stdout, /transcript written/);
  assert.ok(fs.readFileSync(out, "utf8").startsWith("# Fix the parser\n"));

  // Run again: the same file, overwritten.
  assert.equal(s.run(path.join(skills, "session-archive", "scripts", "archive-session.ts"), "--session-id", ID).status, 0);
  assert.deepEqual(fs.readdirSync(path.dirname(out)), [path.basename(out)]);
});

test("without a session id, the newest transcript started inside the project root is archived", (t) => {
  const s = setup(t);
  const root = path.join(s.root, "proj");
  const res = s.run(SCRIPT, "--project-root", root);
  assert.equal(res.status, 1, "no transcript has a cwd inside proj");
  assert.match(res.stderr, /transcript not found/);

  fs.writeFileSync(s.transcript, fs.readFileSync(s.transcript, "utf8").replaceAll('"cwd":"/w"', `"cwd":${JSON.stringify(path.join(root, "sub"))}`));
  assert.equal(s.run(SCRIPT, "--project-root", root).status, 0);
  assert.ok(fs.existsSync(path.join(root, ".artifacts", "session-archives", `2026-01-02-${ID}.md`)));
});

// ── Accounts ──────────────────────────────────────────────────────────────────────────────────

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const owner = (account: string) => JSON.stringify({ type: "session-owner", accountUuid: account, organizationUuid: "org", sessionId: ID });

test("the archive names the account that ran the session, and the others when it was shared", (t) => {
  const s = setup(t);
  fs.appendFileSync(s.transcript, `${owner(A)}\n${owner(A)}\n`);
  const labels = new Map([[A, "turing (a@example.com)"], [B, "lovelace (b@example.com)"]]);
  assert.match(renderArchive(parseTranscript(s.transcript), labels), /^\| \*\*Account\*\* \| turing \(a@example\.com\) \|$/m);

  fs.appendFileSync(s.transcript, `${owner(B)}\n${owner(A)}\n`);
  const session = parseTranscript(s.transcript);
  assert.deepEqual(session.accounts, [A, B]);
  assert.equal(accountsText(session.accounts, labels), "turing (a@example.com); also used by lovelace (b@example.com)");
  assert.equal(accountsText(session.accounts), "`aaaaaaaa`; also used by `bbbbbbbb`", "an unknown account shows its id's start");
});

test("run as a command, the script names accounts from dotagents' vault and Claude Code's login", (t) => {
  const s = setup(t);
  fs.appendFileSync(s.transcript, `${owner(A)}\n${owner(B)}\n`);
  const vault = path.join(s.root, "state", "vault", "turing");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "account.json"), JSON.stringify({ accountUuid: A, emailAddress: "a@example.com" }));
  fs.writeFileSync(path.join(vault, "credentials.json"), "{\"secret\":\"never-read\"}");
  fs.writeFileSync(path.join(s.claude, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: B, emailAddress: "b@example.com" } }));
  const root = path.join(s.root, "proj");
  assert.equal(s.run(SCRIPT, "--transcript", s.transcript, "--project-root", root).status, 0);
  const md = fs.readFileSync(path.join(root, ".artifacts", "session-archives", `2026-01-02-${ID}.md`), "utf8");
  assert.match(md, /\| \*\*Account\*\* \| turing \(a@example\.com\); also used by b@example\.com \|/);
  assert.ok(!md.includes("never-read"));
});
