// The move-sessions skill's script, run as a process against a temporary Claude Code data folder
// (CLAUDE_CONFIG_DIR), so the real one is never touched.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.mjs";

const SCRIPT = path.join(REPO, "skills", "move-sessions", "scripts", "move-sessions.mjs");
const isWindows = process.platform === "win32";
const projectName = (dir) => dir.replace(/[^a-zA-Z0-9]/g, "-");
const gitBash = (dir) => `/${dir[0].toLowerCase()}${dir.slice(2).replace(/\\/g, "/")}`;

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-move-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = {
    root,
    claude: path.join(root, "claude"),
    from: path.join(root, "app"),
    to: path.join(root, "app-workspace"),
  };
  s.project = path.join(s.claude, "projects", projectName(s.from));
  s.target = path.join(s.claude, "projects", projectName(s.to));
  s.run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: s.claude },
    });
  return s;
}

const line = (cwd, extra = {}) => JSON.stringify({ type: "user", cwd, ...extra });
const age = (file) => fs.utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

function claudeTranscript(s, lines) {
  fs.mkdirSync(s.project, { recursive: true });
  const file = path.join(s.project, "abc.jsonl");
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  age(file);
  return file;
}

// ── Claude Code ───────────────────────────────────────────────────────────────────────────────

test("claude: conversations move to the new folder's project with the working directory rewritten", (t) => {
  const s = setup(t);
  const clone = path.join(s.to, "app");
  const other = path.join(s.root, "elsewhere");
  const lines = [line(s.from), line(path.join(s.from, "src")), line(other), line(s.from, { message: { text: s.from } })];
  if (isWindows) lines.push(line(gitBash(s.from)));
  claudeTranscript(s, lines);
  fs.mkdirSync(path.join(s.project, "abc"));
  fs.mkdirSync(path.join(s.project, "memory"));
  fs.writeFileSync(path.join(s.project, "memory", "note.md"), "note\n");

  const res = s.run("--from", s.from, "--to", s.to, "--subdirs-to", clone);
  assert.equal(res.status, 0, res.stderr);

  assert.ok(!fs.existsSync(s.project), "the old project is removed");
  const moved = fs.readFileSync(path.join(s.target, "abc.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(moved[0].cwd, s.to);
  assert.equal(moved[1].cwd, path.join(clone, "src"));
  assert.equal(moved[2].cwd, other);
  assert.equal(moved[3].message.text, s.from, "message text is never rewritten");
  if (isWindows) assert.equal(moved[4].cwd, gitBash(s.to));
  assert.ok(fs.existsSync(path.join(s.target, "abc")));
  assert.equal(fs.readFileSync(path.join(s.target, "memory", "note.md"), "utf8"), "note\n");
});

test("claude: a second run merges the records a closing session wrote late, without duplicates", (t) => {
  const s = setup(t);
  claudeTranscript(s, [line(s.from)]);
  assert.equal(s.run("--from", s.from, "--to", s.to).status, 0);

  const title = JSON.stringify({ type: "custom-title", customTitle: "My chat" });
  claudeTranscript(s, [line(s.from), title]); // Claude Code closes the session after the move
  assert.equal(s.run("--from", s.from, "--to", s.to).status, 0);

  const moved = fs.readFileSync(path.join(s.target, "abc.jsonl"), "utf8").trim().split("\n");
  assert.deepEqual(moved, [line(s.to), title]);
  assert.ok(!fs.existsSync(s.project));
});

test("claude: an open session stops the move", (t) => {
  const s = setup(t);
  const file = claudeTranscript(s, [line(s.from)]);
  fs.utimesSync(file, new Date(), new Date()); // just written
  const res = s.run("--from", s.from, "--to", s.to);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /close the session/);
  assert.ok(fs.existsSync(file));
});

test("a dry run changes nothing", (t) => {
  const s = setup(t);
  const file = claudeTranscript(s, [line(s.from)]);
  const res = s.run("--from", s.from, "--to", s.to, "--dry-run");
  assert.equal(res.status, 0);
  assert.match(res.stdout, /would move/);
  assert.equal(fs.readFileSync(file, "utf8"), `${line(s.from)}\n`);
  assert.ok(!fs.existsSync(s.target));
});

// ── Across systems ────────────────────────────────────────────────────────────────────────────

test("claude: conversations move from another system's ~/.claude, Windows paths included", (t) => {
  const s = setup(t);
  const otherClaude = path.join(s.root, "windows-claude");
  const winFrom = "D:\\work\\app";
  const project = path.join(otherClaude, "projects", "D--work-app");
  fs.mkdirSync(project, { recursive: true });
  const file = path.join(project, "abc.jsonl");
  fs.writeFileSync(file, [line(winFrom), line("d:\\work\\app\\src"), line("/d/work/app"), line("D:\\elsewhere")].join("\n") + "\n");
  age(file);

  const res = s.run("--from", winFrom, "--to", s.to, "--from-claude-dir", otherClaude);
  assert.equal(res.status, 0, res.stderr);

  assert.ok(!fs.existsSync(file), "the conversation left the other system");
  const cwds = fs.readFileSync(path.join(s.target, "abc.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).cwd);
  assert.equal(cwds[0], s.to);
  // On Windows the lowercase spelling keeps its style; on Linux every spelling becomes the plain path.
  assert.equal(cwds[1], isWindows ? `${s.to[0].toLowerCase()}${s.to.slice(1)}\\src` : `${s.to}/src`);
  assert.equal(cwds[2], isWindows ? gitBash(s.to) : s.to);
  assert.equal(cwds[3], "D:\\elsewhere");
});

test("a dry run goes on past an open session, noting it", (t) => {
  const s = setup(t);
  const file = claudeTranscript(s, [line(s.from)]);
  fs.utimesSync(file, new Date(), new Date()); // just written
  const res = s.run("--from", s.from, "--to", s.to, "--dry-run");
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /note: .*close the session/);
  assert.match(res.stdout, /would move/);
  assert.ok(fs.existsSync(file));
});
