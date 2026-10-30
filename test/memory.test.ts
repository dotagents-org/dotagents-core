// Workspace memory: every profile's Claude Code keeps its auto memory for a workspace in the
// workspace's .artifacts/memory/, through autoMemoryDirectory, and init moves in what each profile
// had learned there before.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { applyMemory, memoryDir, projectSlug, verifyMemory } from "../core/memory.ts";
import { state } from "../core/state.ts";
import { quiet } from "./helpers.ts";

function setup(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-memory-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  Object.assign(process.env, { HOME: home, USERPROFILE: home });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(home, { recursive: true, force: true });
  });
  const ws = path.join(home, "projects", "app-workspace");
  fs.mkdirSync(ws, { recursive: true });
  const profiles = [path.join(home, ".claude"), path.join(home, ".claude-personal")];
  return { home, ws, profiles };
}

// What a profile's Claude Code had written for the workspace before.
function oldMemory(profile: string, ws: string, files: Record<string, string>) {
  const dir = path.join(profile, "projects", projectSlug(ws), "memory");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

const settingsOf = (ws: string) => JSON.parse(fs.readFileSync(path.join(ws, ".claude", "settings.local.json"), "utf8"));

test("the slug is the path with every other character turned into a dash, as Claude Code names it", () => {
  assert.equal(projectSlug("/home/me/my.app-workspace"), "-home-me-my-app-workspace");
  assert.equal(projectSlug("C:\\Users\\me\\app"), "C--Users-me-app");
});

test("init points every profile's memory at .artifacts/memory, in the ~/ form under the home folder, and makes the index", (t) => {
  const { ws, profiles } = setup(t);
  quiet();
  applyMemory(ws, profiles);
  assert.equal(settingsOf(ws).autoMemoryDirectory, "~/projects/app-workspace/.artifacts/memory");
  assert.ok(fs.statSync(memoryDir(ws)).isDirectory());
  assert.equal(fs.readFileSync(path.join(memoryDir(ws), "MEMORY.md"), "utf8"), "");
  const second = quiet();
  applyMemory(ws, profiles);
  assert.ok(second.every((e) => e.kind !== "result" || e.status === "ok"), "a second run changes nothing");
});

test("a dry run writes nothing", (t) => {
  const { ws, profiles } = setup(t);
  oldMemory(profiles[0], ws, { "MEMORY.md": "- [A](a.md) — a\n", "a.md": "a" });
  quiet({ dryRun: true });
  t.after(() => (state.dryRun = false));
  applyMemory(ws, profiles);
  assert.ok(!fs.existsSync(path.join(ws, ".claude")));
  assert.ok(!fs.existsSync(memoryDir(ws)));
});

test("the profiles' memory moves in: copied, never deleted, the index lines joined, a clash kept as the workspace has it", (t) => {
  const { ws, profiles } = setup(t);
  const a = oldMemory(profiles[0], ws, { "MEMORY.md": "- [Repo layout](repo-layout.md) — where the code is\n- [Same](same.md) — x\n", "repo-layout.md": "layout", "same.md": "x" });
  oldMemory(profiles[1], ws, { "MEMORY.md": "- [Same](same.md) — x\n- [Deploy](deploy.md) — how to deploy\n", "same.md": "x", "deploy.md": "deploy" });
  const events = quiet();
  applyMemory(ws, profiles);
  const dir = memoryDir(ws);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["MEMORY.md", "deploy.md", "repo-layout.md", "same.md"]);
  assert.equal(
    fs.readFileSync(path.join(dir, "MEMORY.md"), "utf8"),
    "- [Repo layout](repo-layout.md) — where the code is\n- [Same](same.md) — x\n- [Deploy](deploy.md) — how to deploy\n"
  );
  assert.ok(fs.existsSync(path.join(a, "repo-layout.md")), "the profile's copy stays");
  assert.ok(!events.some((e) => e.kind === "warning"));

  // A note changed in a profile after the move: the workspace keeps its own, and init says so.
  fs.writeFileSync(path.join(a, "repo-layout.md"), "layout, changed");
  const again = quiet();
  applyMemory(ws, profiles);
  assert.equal(fs.readFileSync(path.join(dir, "repo-layout.md"), "utf8"), "layout");
  assert.ok(again.some((e) => e.kind === "warning" && /repo-layout\.md/.test(e.text)));
});

test("a profile with a session writing to the workspace right now is left for later", (t) => {
  const { ws, profiles } = setup(t);
  const dir = oldMemory(profiles[0], ws, { "MEMORY.md": "- [A](a.md) — a\n", "a.md": "a" });
  fs.writeFileSync(path.join(path.dirname(dir), "session.jsonl"), "{}\n");
  const events = quiet();
  applyMemory(ws, profiles, { now: Date.now() });
  assert.ok(!fs.existsSync(path.join(memoryDir(ws), "a.md")));
  assert.ok(events.some((e) => e.kind === "warning" && /session/.test(e.text)));
});

test("the checklist: the key, the folder, the index within Claude Code's limit, notes left in a profile, and a setting that would hide it", (t) => {
  const { ws, profiles } = setup(t);
  quiet();
  applyMemory(ws, profiles);
  let checks = quiet();
  verifyMemory(ws, profiles);
  assert.equal(state.problems, 0);
  assert.ok(!checks.some((e) => e.kind === "warning"));

  fs.writeFileSync(path.join(memoryDir(ws), "MEMORY.md"), "x\n".repeat(201));
  fs.writeFileSync(path.join(memoryDir(ws), "orphan.md"), "nobody links me");
  oldMemory(profiles[1], ws, { "late.md": "written after the move" });
  fs.writeFileSync(path.join(ws, ".claude", "settings.json"), JSON.stringify({ permissions: { blockReadsOutsideWorkingDirectories: true } }));
  checks = quiet();
  verifyMemory(ws, profiles);
  const text = checks.map((e) => ("text" in e ? e.text : "")).join("\n");
  assert.match(text, /MEMORY\.md .*200 lines/);
  assert.match(text, /orphan\.md/);
  assert.match(text, /late\.md|1 note/);
  assert.match(text, /blockReadsOutsideWorkingDirectories/);
});
