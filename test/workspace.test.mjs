// The workspace module, through its interface: applyWorkspace and verifyWorkspace.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { state } from "../lib/common.mjs";
import { resolveSkills } from "../lib/skills.mjs";
import { applyWorkspace, verifyWorkspace } from "../lib/workspace.mjs";
import { REPO, fakeInstaller, fakeThirdParty, quiet, tempWorkspace } from "./helpers.mjs";

const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");

test("an empty folder becomes a workspace that passes the checklist", async (t) => {
  const ws = tempWorkspace(t, "app-workspace");
  quiet();
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  assert.equal(state.problems, 0);

  assert.match(read(ws, "AGENTS.md"), /^# app\n/);
  assert.ok(!fs.existsSync(path.join(ws, "CLAUDE.md"))); // Claude Code reads AGENTS.md directly
  assert.equal(JSON.parse(read(ws, ".claude", "settings.json")).plansDirectory, ".artifacts/plans");
  assert.ok(fs.lstatSync(path.join(ws, ".agents", "skills", "to-cards")).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(ws, ".artifacts", "session-archives")));
  assert.ok(fs.existsSync(path.join(ws, ".artifacts", "plans")));

  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 0);
});

test("applying twice changes nothing the second time", async (t) => {
  const ws = tempWorkspace(t);
  quiet();
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  quiet();
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  assert.equal(state.counts.created, undefined);
  assert.equal(state.counts.updated, undefined);
  assert.ok(state.counts.ok > 0);
});

test("a dry run leaves the folder untouched", async (t) => {
  const ws = tempWorkspace(t);
  quiet({ dryRun: true });
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  assert.deepEqual(fs.readdirSync(ws), []);
  assert.ok(state.counts["would create"] > 0);
});

test("your own AGENTS.md is never overwritten", async (t) => {
  const ws = tempWorkspace(t);
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "# Mine\n");
  quiet();
  await applyWorkspace(REPO, ws, []);
  assert.equal(read(ws, "AGENTS.md"), "# Mine\n");
});

test("a copied skill instead of a link fails the checklist", async (t) => {
  const ws = tempWorkspace(t);
  quiet();
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  const link = path.join(ws, ".agents", "skills", "to-cards");
  fs.rmSync(link, { recursive: false, force: true });
  fs.cpSync(path.join(REPO, "skills", "to-cards"), link, { recursive: true });

  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 1);
});

test("with only third-party skills, .claude/skills is still a link", async (t) => {
  const ws = tempWorkspace(t);
  quiet();
  await applyWorkspace(REPO, ws, [fakeThirdParty], { installer: fakeInstaller });
  assert.ok(fs.lstatSync(path.join(ws, ".claude", "skills")).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(ws, ".claude", "skills", "fake-skill", "SKILL.md")));

  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 0);
});

test("a skill in the lock but missing from the folder fails the checklist", async (t) => {
  const ws = tempWorkspace(t);
  quiet();
  await applyWorkspace(REPO, ws, [fakeThirdParty], { installer: fakeInstaller });
  fs.rmSync(path.join(ws, ".agents", "skills", "fake-skill"), { recursive: true });

  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 1);
});

test("when the workspace is a git repository, the agent files stay out of it", async (t) => {
  const ws = tempWorkspace(t);
  git(ws, "init", "-q");
  quiet();
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  assert.equal(git(ws, "status", "--porcelain").stdout, "");

  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 0);
  assert.equal(state.counts.warnings, 1); // the wrapping layout is recommended
});

test("an agent file committed to the repository fails the checklist", async (t) => {
  const ws = tempWorkspace(t);
  git(ws, "init", "-q");
  quiet();
  await applyWorkspace(REPO, ws, []);
  git(ws, "add", "-f", "AGENTS.md");

  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 1);
});

test("AGENTS.md lists the repositories inside the workspace", async (t) => {
  const ws = tempWorkspace(t, "app-workspace");
  fs.mkdirSync(path.join(ws, "app"));
  git(path.join(ws, "app"), "init", "-q");
  quiet();
  await applyWorkspace(REPO, ws, []);
  assert.match(read(ws, "AGENTS.md"), /- `app\/`/);

  fs.mkdirSync(path.join(ws, "api"));
  git(path.join(ws, "api"), "init", "-q");
  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 1); // api/ isn't listed yet
});

test("the CLAUDE.md stub of earlier versions is removed, yours is kept with a warning", async (t) => {
  const old = tempWorkspace(t, "old");
  fs.writeFileSync(path.join(old, "CLAUDE.md"), "<!-- generated by gabrieldulolmarques/agents -->\n@AGENTS.md\n");
  quiet();
  await applyWorkspace(REPO, old, []);
  assert.ok(!fs.existsSync(path.join(old, "CLAUDE.md")));

  const mine = tempWorkspace(t, "mine");
  fs.writeFileSync(path.join(mine, "CLAUDE.md"), "# My notes\n");
  quiet();
  await applyWorkspace(REPO, mine, []);
  assert.equal(read(mine, "CLAUDE.md"), "# My notes\n");
  quiet();
  verifyWorkspace(REPO, mine);
  assert.equal(state.problems, 0);
  assert.equal(state.counts.warnings, 1); // Claude Code would read it instead of AGENTS.md
});

test("the workspace folder can have any name", async (t) => {
  const ws = tempWorkspace(t, "my-project");
  quiet();
  await applyWorkspace(REPO, ws, []);
  assert.match(read(ws, "AGENTS.md"), /^# my-project\n/);
  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 0);
});
