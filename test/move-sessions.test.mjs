// The move-claude-sessions skill's script, run as a process against a temporary CLAUDE_CONFIG_DIR.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.mjs";

const SCRIPT = path.join(REPO, "skills", "move-claude-sessions", "scripts", "move-sessions.mjs");
const isWindows = process.platform === "win32";
const projectName = (dir) => dir.replace(/[^a-zA-Z0-9]/g, "-");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-move-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, "claude");
  const from = path.join(root, "app");
  const to = path.join(root, "app-workspace");
  const project = path.join(config, "projects", projectName(from));
  fs.mkdirSync(project, { recursive: true });
  return { root, config, from, to, project, target: path.join(config, "projects", projectName(to)) };
}

const run = (config, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
const line = (cwd, extra = {}) => JSON.stringify({ type: "user", cwd, ...extra });
const old = (file) => fs.utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

// The spellings a transcript holds for a folder: native, and on Windows also forward slashes and
// Git Bash's /d/… form.
const gitBash = (dir) => `/${dir[0].toLowerCase()}${dir.slice(2).replace(/\\/g, "/")}`;

test("conversations move to the new folder's project with the working directory rewritten", (t) => {
  const s = setup(t);
  const clone = path.join(s.to, "app");
  const other = path.join(s.root, "elsewhere");
  const lines = [line(s.from), line(path.join(s.from, "src")), line(other)];
  if (isWindows) lines.push(line(gitBash(s.from)));
  fs.writeFileSync(path.join(s.project, "abc.jsonl"), `${lines.join("\n")}\n`);
  fs.mkdirSync(path.join(s.project, "abc"));
  fs.mkdirSync(path.join(s.project, "memory"));
  fs.writeFileSync(path.join(s.project, "memory", "note.md"), "note\n");
  old(path.join(s.project, "abc.jsonl"));

  const res = run(s.config, "--from", s.from, "--to", s.to, "--subdirs-to", clone);
  assert.equal(res.status, 0, res.stderr);

  assert.ok(!fs.existsSync(s.project), "the old project is removed");
  const cwds = fs.readFileSync(path.join(s.target, "abc.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).cwd);
  assert.equal(cwds[0], s.to);
  assert.equal(cwds[1], path.join(clone, "src"));
  assert.equal(cwds[2], other);
  if (isWindows) assert.equal(cwds[3], gitBash(s.to));
  assert.ok(fs.existsSync(path.join(s.target, "abc")));
  assert.equal(fs.readFileSync(path.join(s.target, "memory", "note.md"), "utf8"), "note\n");
});

test("a second run merges the records a closing session wrote late, without duplicates", (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.project, "abc.jsonl"), `${line(s.from)}\n`);
  old(path.join(s.project, "abc.jsonl"));
  assert.equal(run(s.config, "--from", s.from, "--to", s.to).status, 0);

  // Claude Code closes the session and writes to the old project again.
  fs.mkdirSync(s.project);
  const title = JSON.stringify({ type: "custom-title", customTitle: "My chat" });
  fs.writeFileSync(path.join(s.project, "abc.jsonl"), `${line(s.from)}\n${title}\n`);
  old(path.join(s.project, "abc.jsonl"));
  assert.equal(run(s.config, "--from", s.from, "--to", s.to).status, 0);

  const moved = fs.readFileSync(path.join(s.target, "abc.jsonl"), "utf8").trim().split("\n");
  assert.deepEqual(moved, [line(s.to), title]);
  assert.ok(!fs.existsSync(s.project));
});

test("an open session stops the move", (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.project, "abc.jsonl"), `${line(s.from)}\n`); // just written
  const res = run(s.config, "--from", s.from, "--to", s.to);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /still open/);
  assert.ok(fs.existsSync(path.join(s.project, "abc.jsonl")));
});

test("a dry run changes nothing", (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.project, "abc.jsonl"), `${line(s.from)}\n`);
  old(path.join(s.project, "abc.jsonl"));
  const res = run(s.config, "--from", s.from, "--to", s.to, "--dry-run");
  assert.equal(res.status, 0);
  assert.match(res.stdout, /would move/);
  assert.equal(fs.readFileSync(path.join(s.project, "abc.jsonl"), "utf8"), `${line(s.from)}\n`);
  assert.ok(!fs.existsSync(s.target));
});
