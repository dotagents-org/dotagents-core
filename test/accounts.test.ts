// The accounts module, through its interface, with a temporary home and state folder.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { dropAccount, installAccounts, launcherFile, setUpAccount, showFolder, verifyAccounts } from "../lib/accounts.ts";
import { loadAccounts } from "../lib/machine-state.ts";
import { state } from "../lib/state.ts";
import { REPO, quiet } from "./helpers.ts";

const isWindows = process.platform === "win32";

function tempHome(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-home-"));
  const keys = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "DOTAGENTS_STATE_DIR", "ANTHROPIC_API_KEY"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  // APPDATA and LOCALAPPDATA too: on Windows the Desktop step must never touch the real Start menu.
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    DOTAGENTS_STATE_DIR: path.join(home, "state"),
  });
  delete process.env.ANTHROPIC_API_KEY;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

// Claude Code's state file with a signed-in account, as /login leaves it.
function signIn(file: string, accountUuid: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ oauthAccount: { accountUuid, emailAddress: `${accountUuid}@example.com` } }));
}

test("a default and a second account get their folders, the configuration and a launcher", (t) => {
  const home = tempHome(t);
  quiet();
  setUpAccount(REPO, { name: "work", isDefault: true });
  setUpAccount(REPO, { name: "personal" });
  assert.equal(state.problems, 0);
  for (const dir of [".claude", ".claude-personal"]) {
    assert.ok(fs.existsSync(path.join(home, dir, "CLAUDE.md")), `${dir}/CLAUDE.md`);
    assert.ok(fs.existsSync(path.join(home, dir, "settings.json")), `${dir}/settings.json`);
  }
  assert.ok(fs.existsSync(launcherFile("work")));
  assert.ok(fs.existsSync(launcherFile("personal")));
  assert.deepEqual(
    loadAccounts().map((a) => [a.name, a.configDir, a.color, Boolean(a.default)]),
    [
      ["work", path.join(home, ".claude"), "#D77655", true],
      ["personal", path.join(home, ".claude-personal"), "#376B80", false],
    ]
  );

  // A second run changes nothing.
  quiet();
  setUpAccount(REPO, { name: "personal" });
  installAccounts(REPO);
  assert.equal(state.counts.created, undefined);
  assert.equal(state.counts.updated, undefined);
});

test("a dry run creates no folder, launcher or record", (t) => {
  const home = tempHome(t);
  quiet({ dryRun: true });
  setUpAccount(REPO, { name: "personal" });
  assert.ok(!fs.existsSync(path.join(home, ".claude-personal")));
  assert.ok(!fs.existsSync(launcherFile("personal")));
  assert.deepEqual(loadAccounts(), []);
});

test("only one account is the default, and names are checked", (t) => {
  tempHome(t);
  quiet();
  setUpAccount(REPO, { name: "work", isDefault: true });
  assert.throws(() => setUpAccount(REPO, { name: "personal", isDefault: true }), /already the default/);
  assert.throws(() => setUpAccount(REPO, { name: "Not OK" }), /not a valid account name/);
  assert.throws(() => setUpAccount(REPO, { name: "personal", color: "blue" }), /#RRGGBB/);
});

test("removing an account drops its record and launcher, never its folder", (t) => {
  const home = tempHome(t);
  quiet();
  setUpAccount(REPO, { name: "personal" });
  dropAccount("personal");
  assert.deepEqual(loadAccounts(), []);
  assert.ok(!fs.existsSync(launcherFile("personal")));
  assert.ok(fs.existsSync(path.join(home, ".claude-personal", "CLAUDE.md")));
  assert.throws(() => dropAccount("personal"), /no account named/);
});

test("the checklist fails when two folders hold the same account, and warns about credential variables", (t) => {
  const home = tempHome(t);
  quiet();
  setUpAccount(REPO, { name: "work", isDefault: true });
  setUpAccount(REPO, { name: "personal" });
  signIn(path.join(home, ".claude.json"), "uuid-a");
  signIn(path.join(home, ".claude-personal", ".claude.json"), "uuid-b");
  quiet();
  verifyAccounts();
  assert.equal(state.problems, 0);

  signIn(path.join(home, ".claude-personal", ".claude.json"), "uuid-a");
  process.env.ANTHROPIC_API_KEY = "x";
  quiet();
  verifyAccounts();
  assert.equal(state.counts.failed, 1);
  assert.equal(state.counts.warnings, 1);
});

test("the launcher runs claude with the account's folder", (t) => {
  const home = tempHome(t);
  quiet();
  setUpAccount(REPO, { name: "work", isDefault: true });
  setUpAccount(REPO, { name: "personal" });
  // A fake claude that prints the folder it was given.
  const bin = path.join(home, "fake-bin");
  fs.mkdirSync(bin);
  if (isWindows) fs.writeFileSync(path.join(bin, "claude.cmd"), "@echo off\r\necho dir=[%CLAUDE_CONFIG_DIR%] key=[%ANTHROPIC_API_KEY%]\r\n");
  else fs.writeFileSync(path.join(bin, "claude"), '#!/bin/sh\necho "dir=[$CLAUDE_CONFIG_DIR] key=[$ANTHROPIC_API_KEY]"\n', { mode: 0o755 });
  const run = (name: string) =>
    spawnSync(launcherFile(name), [], {
      encoding: "utf8",
      shell: isWindows,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CLAUDE_CONFIG_DIR: "/somewhere/else", ANTHROPIC_API_KEY: "leaked" },
    }).stdout.trim();
  assert.equal(run("personal"), `dir=[${path.join(home, ".claude-personal")}] key=[]`);
  assert.equal(run("work"), "dir=[] key=[]");
});

test("an account folder that is a link shows where it points; a plain folder doesn't", (t) => {
  const home = tempHome(t);
  fs.mkdirSync(path.join(home, ".claude-work"));
  fs.symlinkSync(path.join(home, ".claude-work"), path.join(home, ".claude"), "junction");
  fs.mkdirSync(path.join(home, ".claude-personal"));
  assert.match(showFolder(path.join(home, ".claude")), /\.claude → .*\.claude-work$/);
  assert.doesNotMatch(showFolder(path.join(home, ".claude-personal")), /→/);
});
