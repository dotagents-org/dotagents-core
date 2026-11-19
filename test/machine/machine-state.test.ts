// The machine state, through its interface, in a temporary state folder.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { claudeProfiles, forgetServer, peerPath, liveServer, loadProfiles, providerOf, loadWorkspaces, migrateLegacyProfiles, profilesFile, readServer, recordServer, registerWorkspace, removeProfile, saveProfile, serverFile, untrackWorkspace, workspacesFile } from "../../core/machine/machine-state.ts";
import { state } from "../../core/state.ts";
import { startServer } from "../../surfaces/web/server.ts";
import { quiet } from "../helpers.ts";

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
  registerWorkspace("/tmp/app-workspace", ["archive", "to-cards"]);
  assert.deepEqual(loadWorkspaces(), [{ path: "/tmp/app-workspace", skills: ["archive", "to-cards"] }]);
  assert.equal(JSON.parse(fs.readFileSync(workspacesFile(), "utf8")).version, 1);
  assert.equal(untrackWorkspace("/tmp/app-workspace"), true);
  assert.equal(untrackWorkspace("/tmp/app-workspace"), false);
  assert.deepEqual(loadWorkspaces(), []);
});

test("a renamed skill is read under its new name in the tracked list", (t) => {
  tempStateDir(t);
  quiet();
  registerWorkspace("/tmp/app-workspace", ["session-archive", "to-cards"]);
  assert.deepEqual(loadWorkspaces(), [{ path: "/tmp/app-workspace", skills: ["archive", "to-cards"] }]);
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

// The contract in docs/profiles-file.md: what is written, and what another tool's file must be.
test("the profiles file is written and read in the documented format", (t) => {
  const dir = tempStateDir(t);
  quiet();
  saveProfile({ name: "work", configDir: "/home/me/.claude", color: "#D77655", default: true });
  saveProfile({ name: "personal", configDir: "/home/me/.claude", color: "#376B80" });
  const written = {
    version: 1,
    profiles: [
      { name: "work", configDir: "/home/me/.claude", color: "#D77655", default: true },
      { name: "personal", configDir: "/home/me/.claude", color: "#376B80" },
    ],
  };
  assert.equal(fs.readFileSync(profilesFile(), "utf8"), `${JSON.stringify(written, null, 2)}\n`);
  // Another tool's file: fields it adds are ignored, and a newer format is refused.
  fs.writeFileSync(path.join(dir, "profiles.json"), JSON.stringify({ version: 1, profiles: [{ name: "work", configDir: "/home/me/.claude", color: "#D77655", avatar: "hexagon" }] }));
  assert.deepEqual(loadProfiles().map((p) => [p.name, p.configDir, p.color, Boolean(p.default)]), [["work", "/home/me/.claude", "#D77655", false]]);
  fs.writeFileSync(path.join(dir, "profiles.json"), JSON.stringify({ version: 3, profiles: [] }));
  assert.throws(() => loadProfiles(), /newer dotagents/);
});

test("a Codex profile raises the profiles file to version 2, and the Claude parts don't see it", (t) => {
  tempStateDir(t);
  quiet();
  saveProfile({ name: "work", configDir: "/home/me/.claude", color: "#D77655", provider: "claude" });
  assert.equal(JSON.parse(fs.readFileSync(profilesFile(), "utf8")).version, 1);
  assert.equal("provider" in loadProfiles()[0], false);
  saveProfile({ name: "codex-work", configDir: "/home/me/.codex", color: "#7B61A8", provider: "chatgpt" });
  const file = JSON.parse(fs.readFileSync(profilesFile(), "utf8"));
  assert.equal(file.version, 2);
  assert.deepEqual(file.profiles[1], { name: "codex-work", configDir: "/home/me/.codex", color: "#7B61A8", provider: "chatgpt" });
  assert.deepEqual(claudeProfiles().map((p) => p.name), ["work"]);
  assert.deepEqual(loadProfiles().map(providerOf), ["claude", "chatgpt"]);
  removeProfile("codex-work");
  assert.equal(JSON.parse(fs.readFileSync(profilesFile(), "utf8")).version, 1);
});

test("a profiles file with a bad entry stops the command", (t) => {
  const dir = tempStateDir(t);
  quiet();
  fs.writeFileSync(path.join(dir, "profiles.json"), JSON.stringify({ version: 1, profiles: [{ name: "x" }] }));
  assert.throws(() => loadProfiles(), /fix it or delete it/);
  fs.writeFileSync(path.join(dir, "profiles.json"), JSON.stringify({ version: 2, profiles: [{ name: "x", configDir: "/x", color: "#000000", provider: "gemini" }] }));
  assert.throws(() => loadProfiles(), /fix it or delete it/);
});

test("the running server leaves its address for the sidebar, only for the user, and takes it away, only its own", (t) => {
  tempStateDir(t);
  recordServer({ port: 7337, token: "secret" });
  assert.deepEqual(readServer(), { port: 7337, token: "secret", pid: process.pid });
  if (process.platform !== "win32") assert.equal(fs.statSync(serverFile()).mode & 0o777, 0o600);
  // Another server took over: this one leaves that file alone.
  fs.writeFileSync(serverFile(), JSON.stringify({ port: 7338, token: "other", pid: process.pid + 1 }));
  forgetServer();
  assert.equal(readServer()?.port, 7338);
  recordServer({ port: 7337, token: "secret" });
  forgetServer();
  assert.equal(readServer(), null);
});

test("the recorded server counts only while it answers with its token", async (t) => {
  tempStateDir(t);
  assert.equal(await liveServer(), null, "no start.json");
  const server = await startServer({ port: 0, read: () => ({}), token: "secret" });
  recordServer({ port: server.port, token: server.token });
  assert.equal((await liveServer())?.port, server.port);
  recordServer({ port: server.port, token: "another" });
  assert.equal(await liveServer(), null, "a wrong token is not ours");
  recordServer({ port: server.port, token: server.token });
  await server.close();
  assert.equal(await liveServer(), null, "a file left behind by a server that stopped");
});

test("a path the other side wrote is reached from here by whole folders, or by its drive", () => {
  const win = { name: "Windows", home: "/mnt/c/Users/Ana", nativeHome: "C:\\Users\\Ana" };
  if (process.platform !== "win32") {
    assert.equal(peerPath("C:\\Users\\Ana\\.codex", win), "/mnt/c/Users/Ana/.codex");
    assert.equal(peerPath("c:\\users\\ana\\.claude-x", win), "/mnt/c/Users/Ana/.claude-x");
    // Not under the home, though it starts with it
    assert.equal(peerPath("C:\\Users\\AnaBackup\\.codex", win), "/mnt/c/Users/AnaBackup/.codex");
    assert.equal(peerPath("D:\\Codex", win), "/mnt/d/Codex");
    assert.equal(peerPath("relative\\x", win), null);
  }
  const wsl = { name: "WSL", home: "\\\\wsl.localhost\\Ubuntu\\home\\ana", nativeHome: "/home/ana" };
  if (process.platform === "win32") {
    assert.equal(peerPath("/home/ana/.codex", wsl), "\\\\wsl.localhost\\Ubuntu\\home\\ana\\.codex");
    assert.equal(peerPath("/srv/codex", wsl), "\\\\wsl.localhost\\Ubuntu\\srv\\codex");
  } else {
    assert.equal(peerPath("/home/ana/.codex", { ...wsl, home: "/peer/home/ana" }), "/peer/home/ana/.codex");
    assert.equal(peerPath("/home/anabackup/.codex", { ...wsl, home: "/peer/home/ana" }), null);
  }
});
