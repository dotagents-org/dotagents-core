// The machine state, through its interface, in a temporary state folder.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { loadProfiles, loadWorkspaces, migrateLegacyProfiles, profilesFile, registerWorkspace, removeProfile, saveProfile, untrackWorkspace, workspacesFile } from "../core/machine-state.ts";
import { state } from "../core/state.ts";
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

test("profiles are added once, one of them the default, and removed", (t) => {
  tempStateDir(t);
  quiet();
  assert.deepEqual(loadProfiles(), []);
  saveProfile({ name: "work", configDir: "/home/me/.claude", color: "#D77655", default: true });
  saveProfile({ name: "personal", configDir: "/home/me/.claude-personal", color: "#376B80" });
  saveProfile({ name: "personal", configDir: "/home/me/.claude-personal", color: "#000000" });
  assert.deepEqual(
    loadProfiles().map((a) => [a.name, a.color, Boolean(a.default)]),
    [
      ["work", "#D77655", true],
      ["personal", "#000000", false],
    ]
  );
  // A new default takes the mark from the old one.
  saveProfile({ name: "personal", configDir: "/home/me/.claude-personal", color: "#000000", default: true });
  assert.deepEqual(loadProfiles().filter((a) => a.default).map((a) => a.name), ["personal"]);
  assert.equal(removeProfile("work"), true);
  assert.equal(removeProfile("work"), false);
  assert.deepEqual(loadProfiles().map((a) => a.name), ["personal"]);
});

test("the accounts.json of earlier versions is read as the profiles, and moved on the first write", (t) => {
  const dir = tempStateDir(t);
  quiet();
  const legacy = path.join(dir, "accounts.json");
  fs.writeFileSync(legacy, JSON.stringify({ version: 1, accounts: [{ name: "work", configDir: "/home/me/.claude", color: "#D77655", default: true }] }));
  assert.deepEqual(loadProfiles().map((p) => p.name), ["work"]);
  state.dryRun = true;
  t.after(() => (state.dryRun = false));
  assert.equal(migrateLegacyProfiles(), true);
  assert.ok(fs.existsSync(legacy), "a dry run leaves the old file");
  assert.ok(!fs.existsSync(profilesFile()));
  state.dryRun = false;
  assert.equal(migrateLegacyProfiles(), true);
  assert.ok(!fs.existsSync(legacy));
  assert.deepEqual(JSON.parse(fs.readFileSync(profilesFile(), "utf8")).profiles.map((p: { name: string }) => p.name), ["work"]);
  assert.equal(migrateLegacyProfiles(), false, "a second run has nothing to move");
  // A write also moves it.
  fs.writeFileSync(legacy, JSON.stringify({ version: 1, accounts: [{ name: "old", configDir: "/x", color: "#000000" }] }));
  fs.rmSync(profilesFile());
  saveProfile({ name: "personal", configDir: "/home/me/.claude-personal", color: "#376B80" });
  assert.ok(!fs.existsSync(legacy));
  assert.deepEqual(loadProfiles().map((p) => p.name), ["old", "personal"]);
});

test("a profiles file with a bad entry stops the command", (t) => {
  const dir = tempStateDir(t);
  quiet();
  fs.writeFileSync(path.join(dir, "profiles.json"), JSON.stringify({ version: 1, profiles: [{ name: "x" }] }));
  assert.throws(() => loadProfiles(), /fix it or delete it/);
});
