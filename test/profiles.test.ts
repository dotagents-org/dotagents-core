// The profiles module, through its interface, with a temporary home and state folder.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { writeGenerated } from "../core/common.ts";
import { dropProfile, installProfiles, launcherFile, setUpProfile, verifyProfiles } from "../core/profiles.ts";
import { loadProfiles, saveProfile } from "../core/machine-state.ts";
import { state } from "../core/state.ts";
import { REPO, quiet } from "./helpers.ts";

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

// A profile's login saved in its vault, as dotagents switch --save leaves it. Fake credentials.
function saveLogin(home: string, name: string, accountUuid: string) {
  const dir = path.join(home, "state", "vault", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "credentials.json"), "{}");
  fs.writeFileSync(path.join(dir, "account.json"), JSON.stringify({ accountUuid, emailAddress: `${accountUuid}@example.com` }));
}

test("every profile uses ~/.claude: the configuration goes there once, each profile is a record, with no launcher", (t) => {
  const home = tempHome(t);
  quiet();
  setUpProfile(REPO, { name: "work", isDefault: true });
  setUpProfile(REPO, { name: "personal" });
  assert.equal(state.problems, 0);
  assert.ok(fs.existsSync(path.join(home, ".claude", "CLAUDE.md")));
  assert.ok(fs.existsSync(path.join(home, ".claude", "settings.json")));
  assert.ok(!fs.existsSync(path.join(home, ".claude-personal")), "no folder of its own");
  assert.ok(!fs.existsSync(launcherFile("personal")), "no launcher");
  assert.deepEqual(
    loadProfiles().map((a) => [a.name, a.configDir, a.color, Boolean(a.default)]),
    [
      ["work", path.join(home, ".claude"), "#D77655", true],
      ["personal", path.join(home, ".claude"), "#376B80", false],
    ]
  );

  // A second run changes nothing.
  quiet();
  setUpProfile(REPO, { name: "personal" });
  installProfiles(REPO);
  assert.equal(state.counts.created, undefined);
  assert.equal(state.counts.updated, undefined);
});

test("a profile from the folder per profile moves to ~/.claude: its launcher goes, its folder stays", (t) => {
  const home = tempHome(t);
  quiet();
  saveProfile({ name: "work", configDir: path.join(home, ".claude"), color: "#D77655", default: true });
  saveProfile({ name: "personal", configDir: path.join(home, ".claude-personal"), color: "#376B80" });
  fs.mkdirSync(path.join(home, ".claude-personal"), { recursive: true });
  writeGenerated(launcherFile("personal"), "#!/bin/sh\nexec claude\n", { comment: "#" });
  writeGenerated(launcherFile("work"), "#!/bin/sh\nexec claude\n", { comment: "#" });
  quiet();
  installProfiles(REPO);
  assert.deepEqual(loadProfiles().map((a) => a.configDir), [path.join(home, ".claude"), path.join(home, ".claude")]);
  assert.ok(!fs.existsSync(launcherFile("personal")) && !fs.existsSync(launcherFile("work")));
  assert.ok(fs.existsSync(path.join(home, ".claude-personal")), "the old folder is left for you to delete");
  quiet();
  installProfiles(REPO);
  assert.equal(state.counts.updated, undefined, "the second run changes nothing");
});

test("a dry run writes no record or configuration", (t) => {
  const home = tempHome(t);
  quiet({ dryRun: true });
  setUpProfile(REPO, { name: "personal" });
  assert.ok(!fs.existsSync(path.join(home, ".claude", "CLAUDE.md")));
  assert.deepEqual(loadProfiles(), []);
});

test("only one profile is the default, and names are checked", (t) => {
  tempHome(t);
  quiet();
  setUpProfile(REPO, { name: "work", isDefault: true });
  assert.throws(() => setUpProfile(REPO, { name: "personal", isDefault: true }), /already the default/);
  assert.throws(() => setUpProfile(REPO, { name: "Not OK" }), /not a valid profile name/);
  assert.throws(() => setUpProfile(REPO, { name: "personal", color: "blue" }), /#RRGGBB/);
});

test("removing a profile drops its record, never its saved login", (t) => {
  const home = tempHome(t);
  quiet();
  setUpProfile(REPO, { name: "personal" });
  saveLogin(home, "personal", "uuid-b");
  dropProfile("personal");
  assert.deepEqual(loadProfiles(), []);
  assert.ok(fs.existsSync(path.join(home, "state", "vault", "personal", "account.json")));
  assert.throws(() => dropProfile("personal"), /no profile named/);
});

test("the checklist fails when two profiles hold the same account, warns about a profile without a login and about credential variables", (t) => {
  const home = tempHome(t);
  quiet();
  setUpProfile(REPO, { name: "work", isDefault: true });
  setUpProfile(REPO, { name: "personal" });
  saveLogin(home, "work", "uuid-a");
  saveLogin(home, "personal", "uuid-b");
  quiet();
  verifyProfiles();
  assert.equal(state.problems, 0);

  saveLogin(home, "personal", "uuid-a");
  process.env.ANTHROPIC_API_KEY = "x";
  quiet();
  verifyProfiles();
  assert.equal(state.counts.failed, 1);
  assert.equal(state.counts.warnings, 1);

  fs.rmSync(path.join(home, "state", "vault", "personal"), { recursive: true });
  delete process.env.ANTHROPIC_API_KEY;
  quiet();
  verifyProfiles();
  assert.equal(state.counts.warnings, 1, "personal has no saved login");
});
