// The machine state, through its interface, in a temporary state folder.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { loadWorkspaces, registerWorkspace, untrackWorkspace, workspacesFile } from "../lib/machine-state.ts";
import { quiet } from "./helpers.ts";

function tempStateDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-state-"));
  const saved = process.env.DOTAGENTS_STATE_DIR;
  process.env.DOTAGENTS_STATE_DIR = dir;
  t.after(() => {
    saved === undefined ? delete process.env.DOTAGENTS_STATE_DIR : (process.env.DOTAGENTS_STATE_DIR = saved);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("a workspace is tracked, its skills merged, and untracked", (t) => {
  tempStateDir(t);
  quiet();
  assert.deepEqual(loadWorkspaces(), []);
  registerWorkspace("/tmp/app-workspace", ["to-cards"]);
  registerWorkspace("/tmp/app-workspace", ["session-archive", "to-cards"]);
  assert.deepEqual(loadWorkspaces(), [{ path: "/tmp/app-workspace", skills: ["session-archive", "to-cards"] }]);
  assert.equal(JSON.parse(fs.readFileSync(workspacesFile(), "utf8")).version, 1);
  assert.equal(untrackWorkspace("/tmp/app-workspace"), true);
  assert.equal(untrackWorkspace("/tmp/app-workspace"), false);
  assert.deepEqual(loadWorkspaces(), []);
});

test("a dry run writes nothing", (t) => {
  tempStateDir(t);
  quiet({ dryRun: true });
  registerWorkspace("/tmp/app-workspace", ["to-cards"]);
  assert.ok(!fs.existsSync(workspacesFile()));
});

test("a broken state file stops the command and is never overwritten", (t) => {
  const dir = tempStateDir(t);
  quiet();
  for (const text of ["{ not json", JSON.stringify({ version: 1, workspaces: [{ path: 3 }] }), "[]"]) {
    fs.writeFileSync(path.join(dir, "workspaces.json"), text);
    assert.throws(() => registerWorkspace("/tmp/app-workspace", []), /fix it or delete it/);
    assert.equal(fs.readFileSync(path.join(dir, "workspaces.json"), "utf8"), text);
  }
});

test("a state file from a newer dotagents is not read", (t) => {
  const dir = tempStateDir(t);
  quiet();
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify({ version: 2, workspaces: [] }));
  assert.throws(() => loadWorkspaces(), /newer dotagents/);
});
