// The archive skill's script: run as a process against a temporary Claude Code data folder
// (CLAUDE_CONFIG_DIR), so the real one is never touched, and imported the way dotagents uses it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { accountsText, archiveFile, parseRollout, parseTranscript, renderArchive } from "../../skills/archive/scripts/archive-session.ts";
import { REPO } from "../helpers.ts";

const SCRIPT = path.join(REPO, "skills", "archive", "scripts", "archive-session.ts");
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
  fs.symlinkSync(path.join(REPO, "skills", "archive"), path.join(skills, "archive"), "junction");
  const res = s.run(path.join(skills, "archive", "scripts", "archive-session.ts"), "--session-id", ID);
  assert.equal(res.status, 0, res.stderr);
  const out = path.join(ws, ".artifacts", "sessions", `2026-01-02-${ID}.md`);
  assert.match(res.stdout, /transcript written/);
  assert.ok(fs.readFileSync(out, "utf8").startsWith("# Fix the parser\n"));

  // Run again: the same file, overwritten.
  assert.equal(s.run(path.join(skills, "archive", "scripts", "archive-session.ts"), "--session-id", ID).status, 0);
  assert.deepEqual(fs.readdirSync(path.dirname(out)), [path.basename(out)]);
});

test("a name given with /rename wins over the generated titles written after it", (t) => {
  const s = setup(t);
  fs.appendFileSync(s.transcript, `${JSON.stringify({ type: "custom-title", customTitle: "parser-fix", sessionId: ID })}\n${JSON.stringify({ type: "ai-title", aiTitle: "Later title", sessionId: ID })}\n`);
  assert.equal(parseTranscript(s.transcript).title, "parser-fix");
});

test("without a session id, the newest transcript started inside the project root is archived", (t) => {
  const s = setup(t);
  const root = path.join(s.root, "proj");
  const res = s.run(SCRIPT, "--project-root", root);
  assert.equal(res.status, 1, "no transcript has a cwd inside proj");
  assert.match(res.stderr, /transcript not found/);

  fs.writeFileSync(s.transcript, fs.readFileSync(s.transcript, "utf8").replaceAll('"cwd":"/w"', `"cwd":${JSON.stringify(path.join(root, "sub"))}`));
  assert.equal(s.run(SCRIPT, "--project-root", root).status, 0);
  assert.ok(fs.existsSync(path.join(root, ".artifacts", "sessions", `2026-01-02-${ID}.md`)));
});

// ── Accounts ──────────────────────────────────────────────────────────────────────────────────

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const owner = (account: string) => JSON.stringify({ type: "session-owner", accountUuid: account, organizationUuid: "org", sessionId: ID });

test("the archive names the account that ran the session, and the others when it was shared", (t) => {
  const s = setup(t);
  fs.appendFileSync(s.transcript, `${owner(A)}\n${owner(A)}\n`);
  const labels = new Map([[A, "work (a@example.com)"], [B, "personal (b@example.com)"]]);
  assert.match(renderArchive(parseTranscript(s.transcript), labels), /^\| \*\*Account\*\* \| work \(a@example\.com\) \|$/m);

  fs.appendFileSync(s.transcript, `${owner(B)}\n${owner(A)}\n`);
  const session = parseTranscript(s.transcript);
  assert.deepEqual(session.accounts, [A, B]);
  assert.equal(accountsText(session.accounts, labels), "work (a@example.com); also used by personal (b@example.com)");
  assert.equal(accountsText(session.accounts), "`aaaaaaaa`; also used by `bbbbbbbb`", "an unknown account shows its id's start");
});

test("run as a command, the script names accounts from dotagents' vault and Claude Code's login", (t) => {
  const s = setup(t);
  fs.appendFileSync(s.transcript, `${owner(A)}\n${owner(B)}\n`);
  const vault = path.join(s.root, "state", "vault", "work");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "account.json"), JSON.stringify({ accountUuid: A, emailAddress: "a@example.com" }));
  fs.writeFileSync(path.join(vault, "credentials.json"), "{\"secret\":\"never-read\"}");
  fs.writeFileSync(path.join(s.claude, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: B, emailAddress: "b@example.com" } }));
  const root = path.join(s.root, "proj");
  assert.equal(s.run(SCRIPT, "--transcript", s.transcript, "--project-root", root).status, 0);
  const md = fs.readFileSync(path.join(root, ".artifacts", "sessions", `2026-01-02-${ID}.md`), "utf8");
  assert.match(md, /\| \*\*Account\*\* \| work \(a@example\.com\); also used by b@example\.com \|/);
  assert.ok(!md.includes("never-read"));
});

// A Codex rollout, made by hand: the same shapes Codex 0.170 writes, with nothing real in it.
const CODEX_ID = "019a0000-aaaa-7bbb-8ccc-dddddddddddd";
function rollout(dir: string) {
  const line = (timestamp: string, type: string, payload: object) => JSON.stringify({ timestamp, type, payload });
  const msg = (role: string, text: string) => ({ type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] });
  const lines = [
    line("2026-11-18T10:00:00Z", "session_meta", { id: CODEX_ID, cwd: "/work/shop", creator_user_id: "user-hopper", source: "cli" }),
    line("2026-11-18T10:00:01Z", "turn_context", { model: "gpt-test-1", effort: "high", cwd: "/work/shop" }),
    line("2026-11-18T10:00:01Z", "response_item", msg("developer", "<permissions instructions>")),
    line("2026-11-18T10:00:01Z", "response_item", msg("user", "# AGENTS.md instructions for /work/shop\n\nrules")),
    line("2026-11-18T10:00:01Z", "response_item", msg("user", "<environment_context>\n  <cwd>/work/shop</cwd>\n</environment_context>")),
    line("2026-11-18T10:00:02Z", "response_item", msg("user", "fix the login form")),
    line("2026-11-18T10:00:03Z", "response_item", { type: "reasoning", encrypted_content: "secret-reasoning", summary: [] }),
    line("2026-11-18T10:00:04Z", "response_item", { type: "function_call", name: "shell", call_id: "c1", arguments: JSON.stringify({ command: ["npm", "test"] }) }),
    line("2026-11-18T10:00:05Z", "response_item", { type: "function_call_output", call_id: "c1", output: JSON.stringify({ exit_code: 1 }) }),
    line("2026-11-18T10:00:06Z", "response_item", { type: "custom_tool_call", name: "apply_patch", call_id: "c2", input: "*** Begin Patch\n*** Update File: src/login.ts\n@@\n-a\n+b\n*** Add File: test/login.test.ts\n+x\n*** End Patch" }),
    line("2026-11-18T10:00:07Z", "event_msg", { type: "item_completed", item: { type: "FileChange", changes: { "src/form.css": {} } } }),
    line("2026-11-18T10:00:08Z", "response_item", msg("assistant", "Fixed: the form now validates.")),
    JSON.stringify({ timestamp: "2026-11-18T10:00:09Z", type: "token_usage_record", thread_token_usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 300 } }),
  ];
  const day = path.join(dir, "sessions", "2026", "11", "18");
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, `rollout-2026-11-18T10-00-00-${CODEX_ID}.jsonl`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

test("a Codex rollout archives in the same format: the user's messages, not the injected context; tools, files, model and account", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-archive-codex-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex");
  rollout(codexHome);
  fs.writeFileSync(path.join(codexHome, "session_index.jsonl"), `${JSON.stringify({ id: CODEX_ID, thread_name: "Old name" })}\n${JSON.stringify({ id: CODEX_ID, thread_name: "Login form" })}\n`);
  const state = path.join(root, "state");
  fs.mkdirSync(path.join(state, "usage"), { recursive: true });
  fs.writeFileSync(path.join(state, "usage", "hopper.json"), JSON.stringify({ version: 1, provider: "chatgpt", user: "user-hopper" }));
  const project = path.join(root, "project");
  const run = spawnSync(process.execPath, [SCRIPT, "--agent", "codex", "--session-id", CODEX_ID, "--codex-home", codexHome, "--project-root", project], { encoding: "utf8", env: { ...process.env, DOTAGENTS_STATE_DIR: state } });
  assert.equal(run.status, 0, run.stderr);
  const text = fs.readFileSync(path.join(project, ".artifacts", "sessions", `2026-11-18-${CODEX_ID}.md`), "utf8");
  assert.match(text, /^# Login form\n/);
  assert.match(text, /\| \*\*Agent\*\* \| Codex \|/);
  assert.match(text, /\| \*\*Account\*\* \| hopper \|/);
  assert.match(text, /\| \*\*Model\*\* \| `gpt-test-1` \|/);
  assert.match(text, /\| \*\*Effort\*\* \| high \|/);
  assert.match(text, /\| \*\*Turns\*\* \| 1 user, 1 assistant \|/);
  assert.match(text, /\| \*\*Tokens\*\* \| in 1k, out 300, cache read 4k \|/);
  assert.match(text, /fix the login form/);
  assert.match(text, /- `shell` - npm test \*\*\(error\)\*\*/);
  assert.match(text, /- `apply_patch` - \*\*\* Update File: src\/login.ts/);
  for (const f of ["src/login.ts", "test/login.test.ts", "src/form.css"]) assert.match(text, new RegExp(`- \`${f}\``));
  assert.match(text, /Fixed: the form now validates\./);
  for (const hidden of ["AGENTS.md instructions", "environment_context", "secret-reasoning", "permissions instructions"]) assert.doesNotMatch(text, new RegExp(hidden));
});

test("a Codex rollout from before token_usage_record gives its tokens from token_count", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-archive-codex-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "rollout-2026-11-18T10-00-00-019a0000-aaaa-7bbb-8ccc-000000000001.jsonl");
  const lines = [
    { timestamp: "2026-11-18T10:00:00Z", type: "session_meta", payload: { id: "019a0000-aaaa-7bbb-8ccc-000000000001", cwd: "/w" } },
    { timestamp: "2026-11-18T10:00:05Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 3000, cached_input_tokens: 1000, output_tokens: 200 } } } },
  ];
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  assert.match(renderArchive(parseRollout(file)), /\| \*\*Tokens\*\* \| in 2k, out 200, cache read 1k \|/);
});

test("an archive's name is never a path out of .artifacts/sessions/", () => {
  const s = parseRollout(path.join(REPO, "package.json")); // no rollout: only its defaults
  assert.throws(() => archiveFile("/p", { ...s, sessionId: "../../escape" }), /can't name a file/);
  assert.equal(archiveFile("/p", { ...s, sessionId: "abc-1", started: "../x" }), path.join("/p", ".artifacts", "sessions", "undated-abc-1.md"));
});

test("the archive skill refuses a rollout with a line cut in the middle, and one that isn't the id asked for", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-archive-codex-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex");
  const file = rollout(codexHome);
  const run = (...extra: string[]) => spawnSync(process.execPath, [SCRIPT, "--agent", "codex", "--codex-home", codexHome, "--project-root", path.join(root, "p"), ...extra], { encoding: "utf8" });
  assert.equal(run("--session-id", CODEX_ID).status, 0);
  // Cut in the middle, with whole lines after: not archived. Half a last line, still being written: archived
  const lines = fs.readFileSync(file, "utf8").split("\n");
  fs.writeFileSync(file, [lines[0], '{"timestamp":"2026-11-18T10:00:01Z","type":"respo', ...lines.slice(1)].join("\n"));
  const cut = run("--session-id", CODEX_ID);
  assert.equal(cut.status, 1);
  assert.match(cut.stderr, /line 2 is cut in the middle/);
  fs.writeFileSync(file, `${lines.slice(0, -1).join("\n")}\n{"timestamp":"2026-11-18T10:00:09Z","type":"respo`);
  assert.equal(run("--session-id", CODEX_ID).status, 0);
  // Another conversation inside: only with --transcript, which names the file itself
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(CODEX_ID, "019a0000-bbbb-7ccc-8ddd-eeeeeeeeeeee"));
  assert.match(run("--session-id", CODEX_ID).stderr, /isn't the conversation .*pass the rollout with --transcript/);
  assert.equal(run("--transcript", file).status, 0);
});

test("the archive skill refuses a reverted conversation: its rollouts together hold the history, no one file does", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-archive-codex-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex");
  const file = rollout(codexHome);
  const run = (...extra: string[]) => spawnSync(process.execPath, [SCRIPT, "--agent", "codex", "--codex-home", codexHome, "--project-root", path.join(root, "p"), ...extra], { encoding: "utf8" });
  // A /revert: a new rollout of the same conversation, its meta pointing at a base in the first
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const meta = JSON.parse(lines[0]);
  meta.payload.history_base = { rollout: path.basename(file), line: 5 };
  const next = path.join(path.dirname(file), "rollout-2026-11-18T11-00-00-019a0000-aaaa-7bbb-8ccc-0000000000ff.jsonl");
  fs.writeFileSync(next, [JSON.stringify(meta), ...lines.slice(1)].join("\n"));
  const byId = run("--session-id", CODEX_ID);
  assert.equal(byId.status, 1);
  assert.match(byId.stderr, /2 rollouts carry the conversation/);
  assert.equal(run("--transcript", next).status, 1, "naming the file doesn't get around it");
  // The old rollout gone, the new one alone: its history still starts in another
  fs.rmSync(file);
  const alone = run("--transcript", next);
  assert.equal(alone.status, 1);
  assert.match(alone.stderr, /history starts in another rollout/);
});

test("Codex's own tool calls (a web search) are in the archive, and a rollout Codex archived is refused", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-archive-codex-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "codex", "sessions", "2026", "11", "18", "rollout-2026-11-18T10-00-00-019a0000-aaaa-7bbb-8ccc-000000000009.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    { timestamp: "2026-11-18T10:00:00Z", type: "session_meta", payload: { id: "019a0000-aaaa-7bbb-8ccc-000000000009", cwd: "/w" } },
    { timestamp: "2026-11-18T10:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "look it up" }] } },
    { timestamp: "2026-11-18T10:00:02Z", type: "response_item", payload: { type: "web_search_call", action: { type: "search", query: "codex rollout format" } } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  const text = renderArchive(parseRollout(file));
  assert.match(text, /\| \*\*Tool calls\*\* \| web_search 1 \|/);
  assert.match(text, /- `web_search` - codex rollout format/);
  // In archived_sessions: its conversation's other rollouts are out of reach
  const archived = path.join(root, "codex", "archived_sessions", path.basename(file));
  fs.mkdirSync(path.dirname(archived), { recursive: true });
  fs.copyFileSync(file, archived);
  const run = spawnSync(process.execPath, [SCRIPT, "--agent", "codex", "--transcript", archived, "--project-root", path.join(root, "p")], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /archived by Codex; `codex unarchive`/);
});

test("a Codex archive by path checks the canonical rollout home and refuses archived targets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-archive-codex-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "codex");
  const file = rollout(home);
  const newer = path.join(path.dirname(file), "rollout-2026-11-18T11-00-00-019a0000-aaaa-7bbb-8ccc-0000000000ff.jsonl");
  fs.copyFileSync(file, newer);
  const archived = path.join(home, "archived_sessions", path.basename(file));
  fs.mkdirSync(path.dirname(archived));
  fs.copyFileSync(file, archived);
  const env = { ...process.env, CODEX_HOME: path.join(root, "different-home"), DOTAGENTS_STATE_DIR: path.join(root, "state") };
  const project = path.join(root, "p");
  const stderr = path.join(root, "stderr");
  const run = (transcript: string, ...extra: string[]) => {
    const fd = fs.openSync(stderr, "w");
    try {
      const result = spawnSync(process.execPath, [SCRIPT, "--agent", "codex", "--transcript", transcript, "--project-root", project, ...extra], { env, stdio: ["ignore", "ignore", fd] });
      assert.ifError(result.error);
      return { status: result.status, stderr: fs.readFileSync(stderr, "utf8") };
    } finally {
      fs.closeSync(fd);
    }
  };
  const inferred = run(file);
  assert.equal(inferred.status, 1, "the rollout's home takes precedence over the shell's");
  assert.match(inferred.stderr, /2 rollouts carry the conversation/);
  assert.equal(fs.existsSync(project), false);
  if (process.platform !== "win32") {
    const linked = path.join(root, "linked.jsonl");
    fs.symlinkSync(file, linked);
    assert.match(run(linked).stderr, /2 rollouts carry the conversation/);
    const archivedLink = path.join(root, "linked-archive.jsonl");
    fs.symlinkSync(archived, archivedLink);
    assert.match(run(archivedLink, "--codex-home", env.CODEX_HOME).stderr, /archived by Codex/);
  }
  assert.match(run(archived, "--codex-home", env.CODEX_HOME).stderr, /archived by Codex/);
  const loose = path.join(root, "copied.jsonl");
  fs.copyFileSync(file, loose);
  assert.match(run(loose).stderr, /pass --codex-home to check for related rollouts/);
  assert.match(run(loose, "--codex-home", home).stderr, /2 rollouts carry the conversation/);
  assert.equal(run(file, "--codex-home", env.CODEX_HOME).status, 0, "an explicit home takes precedence");
  assert.ok(fs.existsSync(path.join(project, ".artifacts", "sessions", `2026-11-18-${CODEX_ID}.md`)));
});
