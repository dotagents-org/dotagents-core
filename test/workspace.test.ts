// The workspace module, through its interface: applyWorkspace and verifyWorkspace.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { state } from "../core/state.ts";
import { resolveSkills } from "../core/skills.ts";
import { applyWorkspace, verifyWorkspace, wrapRepository } from "../core/workspace.ts";
import { REPO, fakeInstaller, fakeThirdParty, quiet, tempWorkspace } from "./helpers.ts";

const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf8");

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
  assert.match(read(ws, ".artifacts", "INDEX.md"), /\[AGENTS\.md\]\(\.\.\/AGENTS\.md\)/);
  assert.ok(!fs.existsSync(path.join(ws, "INDEX.md")));
  assert.match(read(ws, "AGENTS.md"), /\(\.artifacts\/INDEX\.md\)/);
  assert.ok(!fs.existsSync(path.join(ws, ".agents", "README.md"))); // AGENTS.md and the global instructions point to the standards
  assert.ok(!fs.existsSync(path.join(ws, ".artifacts", "README.md")));

  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 0);
});

test("a CLAUDE.md that imports AGENTS.md in the middle of a sentence passes without a warning", async (t) => {
  const ws = tempWorkspace(t);
  fs.writeFileSync(path.join(ws, "CLAUDE.md"), "# CLAUDE.md\n\nBefore any task, read @AGENTS.md.\n");
  quiet();
  await applyWorkspace(REPO, ws, []);
  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 0);
  assert.equal(state.counts.warnings, undefined);
});

test("applying twice changes nothing the second time", async (t) => {
  const ws = tempWorkspace(t);
  quiet();
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  quiet();
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  assert.equal(state.counts.created, undefined);
  assert.equal(state.counts.updated, undefined);
  assert.ok((state.counts.ok ?? 0) > 0);
});

test("a dry run leaves the folder untouched", async (t) => {
  const ws = tempWorkspace(t);
  quiet({ dryRun: true });
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  assert.deepEqual(fs.readdirSync(ws), []);
  assert.ok((state.counts["would create"] ?? 0) > 0);
});

test("a long AGENTS.md is the project's choice, not a failed check", async (t) => {
  const ws = tempWorkspace(t);
  fs.writeFileSync(path.join(ws, "AGENTS.md"), `# Long\n\n${"A line the project wants every agent to read.\n".repeat(500)}`);
  quiet();
  await applyWorkspace(REPO, ws, []);
  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 0);
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

// A repository whose root an earlier init already set up, with one commit of its own.
async function initializedRepo(t: TestContext, name = "app") {
  const dir = tempWorkspace(t, name);
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "main.py"), "print('hi')\n");
  git(dir, "add", "main.py");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
  quiet();
  await applyWorkspace(REPO, dir, resolveSkills(REPO, ["to-cards"]));
  return dir;
}

test("wrapping a repository moves it into <name>-workspace with the agent files outside it", async (t) => {
  const dir = await initializedRepo(t);
  quiet();
  const ws = wrapRepository(dir);
  assert.equal(ws, `${dir}-workspace`);
  assert.ok(!fs.existsSync(dir));

  const moved = path.join(ws, "app");
  assert.equal(read(moved, "main.py"), "print('hi')\n");
  assert.equal(git(moved, "status", "--porcelain").stdout, "");
  assert.ok(!fs.existsSync(path.join(moved, "AGENTS.md")));
  assert.ok(fs.lstatSync(path.join(ws, ".agents", "skills", "to-cards")).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(ws, ".artifacts", "INDEX.md")));
  assert.doesNotMatch(read(moved, ".git", "info", "exclude"), /dotagents/);
  assert.match(read(ws, "AGENTS.md"), /- `app\/`/);

  quiet();
  await applyWorkspace(REPO, ws, resolveSkills(REPO, ["to-cards"]));
  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 0);
  assert.equal(state.counts.warnings, undefined); // the recommended layout now
});

test("wrapping leaves agent files the project commits inside the repository", async (t) => {
  const dir = await initializedRepo(t);
  git(dir, "add", "-f", "AGENTS.md");
  quiet();
  const ws = wrapRepository(dir);
  assert.ok(fs.existsSync(path.join(ws, "app", "AGENTS.md")));
  assert.ok(!fs.existsSync(path.join(ws, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(ws, ".agents")));
});

test("wrapping in a dry run moves nothing", async (t) => {
  const dir = await initializedRepo(t);
  quiet({ dryRun: true });
  const ws = wrapRepository(dir);
  assert.ok(!fs.existsSync(ws));
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));
  assert.ok((state.counts["would move"] ?? 0) > 1);
});

test("wrapping refuses a folder that isn't a repository root or a workspace that exists", async (t) => {
  const plain = tempWorkspace(t, "plain");
  assert.throws(() => wrapRepository(plain), /not the root of a git repository/);

  const dir = await initializedRepo(t);
  fs.mkdirSync(`${dir}-workspace`);
  assert.throws(() => wrapRepository(dir), /already exists/);
  assert.ok(fs.existsSync(path.join(dir, ".git")));
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

test("your CLAUDE.md is kept, with a warning when it doesn't import AGENTS.md", async (t) => {
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
  const ws = tempWorkspace(t, "Acme-Platform");
  quiet();
  await applyWorkspace(REPO, ws, []);
  assert.match(read(ws, "AGENTS.md"), /^# Acme-Platform\n/);
  quiet();
  verifyWorkspace(REPO, ws);
  assert.equal(state.problems, 0);
});
