// The machine level, through installGlobal, with a temporary home folder.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { configRoot } from "../core/common.ts";
import { state } from "../core/state.ts";
import { GLOBAL_CONFIG_KEYS, installGlobal, pullSettings, verifyGlobal } from "../core/global.ts";
import { execFileSync } from "node:child_process";
import { REPO, quiet } from "./helpers.ts";

// Each test here builds a clone of its own, with config/ inside.
delete process.env.DOTAGENTS_CONFIG;

function tempHome(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-home-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config") });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

test("install writes the global instructions with this clone's path", (t) => {
  const home = tempHome(t);
  quiet();
  installGlobal(REPO);
  assert.equal(state.problems, 0);
  const text = fs.readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf8");
  assert.ok(!text.includes("{{AGENTS_REPO}}"), "CLAUDE.md still has the placeholder");
  assert.ok(text.includes(REPO.replace(/\\/g, "/")), "CLAUDE.md doesn't mention the clone");
});

test("a second install changes nothing, even when a copy was saved with CRLF", (t) => {
  const home = tempHome(t);
  quiet();
  installGlobal(REPO);
  const settings = path.join(home, ".claude", "settings.json");
  const text = fs.readFileSync(settings, "utf8");
  if (!fs.lstatSync(settings).isSymbolicLink()) fs.writeFileSync(settings, text.replace(/\n/g, "\r\n"));
  quiet();
  installGlobal(REPO);
  assert.equal(state.counts.created, undefined);
  assert.equal(state.counts.updated, undefined);
});

test("a global CLAUDE.md you wrote is kept as a backup, not lost", (t) => {
  const home = tempHome(t);
  fs.mkdirSync(path.join(home, ".claude"));
  fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "# Mine\n");
  quiet();
  installGlobal(REPO);
  const backups = fs.readdirSync(path.join(home, ".claude")).filter((f) => f.startsWith("CLAUDE.md.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(home, ".claude", backups[0]), "utf8"), "# Mine\n");
});

test("install can target another config folder, for a second profile, and leaves ~/.claude alone", (t) => {
  const home = tempHome(t);
  const other = path.join(home, ".claude-work");
  quiet();
  installGlobal(REPO, other);
  assert.equal(state.problems, 0);
  assert.ok(fs.readFileSync(path.join(other, "CLAUDE.md"), "utf8").includes(REPO.replace(/\\/g, "/")));
  assert.ok(fs.existsSync(path.join(other, "rules", "commit-conventions.md")));
  assert.ok(fs.existsSync(path.join(other, "settings.json")));
  assert.ok(!fs.existsSync(path.join(home, ".claude")));
});

// A clone of our own to change: the files install reads, under git.
function tempRepo(t: TestContext) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-repo-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  for (const dir of ["global", "rules", "claude"]) fs.cpSync(path.join(REPO, "templates", "config", dir), path.join(repo, "config", dir), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  return repo;
}

const settingsOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
const setKey = (file: string, key: string, value: unknown) => {
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  fs.writeFileSync(file, `${JSON.stringify({ ...data, [key]: value }, null, 2)}\n`);
};

test("a settings copy follows the repository, but a change made in the profile is kept and reported", (t) => {
  const home = tempHome(t);
  const repo = tempRepo(t);
  const [a, b] = [path.join(home, ".claude"), path.join(home, ".claude-b")];
  quiet();
  for (const dir of [a, b]) installGlobal(repo, dir, { copy: true });
  assert.ok(!fs.lstatSync(path.join(a, "settings.json")).isSymbolicLink());

  // The repository changes: both copies follow.
  setKey(path.join(repo, "config", "claude", "settings.json"), "verbose", true);
  quiet();
  for (const dir of [a, b]) installGlobal(repo, dir, { copy: true });
  assert.equal(settingsOf(a).verbose, true);
  assert.equal(settingsOf(b).verbose, true);

  // /config changes the copy in one profile: install keeps it and says so.
  setKey(path.join(a, "settings.json"), "showTurnDuration", false);
  const events = quiet();
  installGlobal(repo, a, { copy: true });
  assert.equal(settingsOf(a).showTurnDuration, false);
  assert.ok(events.some((e) => e.kind === "result" && e.status === "skipped" && /settings pull/.test(e.detail)));
  const checks = quiet();
  verifyGlobal(repo, [a, b]);
  assert.ok(checks.some((e) => e.kind === "warning" && /changed in this profile/.test(e.text)));

  // settings pull takes it into the repository, and the next install brings it to the other profile.
  quiet();
  pullSettings(repo, [a, b]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, "config", "claude", "settings.json"), "utf8")).showTurnDuration, false);
  quiet();
  for (const dir of [a, b]) installGlobal(repo, dir, { copy: true });
  assert.equal(settingsOf(b).showTurnDuration, false);
  assert.equal(state.counts.skipped, undefined);
});

test("settings pull refuses two profiles changed in different ways, unless told which one", (t) => {
  const home = tempHome(t);
  const repo = tempRepo(t);
  const [a, b] = [path.join(home, ".claude"), path.join(home, ".claude-b")];
  quiet();
  for (const dir of [a, b]) installGlobal(repo, dir, { copy: true });
  setKey(path.join(a, "settings.json"), "verbose", true);
  setKey(path.join(b, "settings.json"), "verbose", false);
  quiet();
  assert.throws(() => pullSettings(repo, [a, b]), /changed differently/);
  quiet();
  pullSettings(repo, [a, b], { from: b });
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, "config", "claude", "settings.json"), "utf8")).verbose, false);
});

test("the global config keys go into each profile's .claude.json, leaving the rest of it alone", (t) => {
  const home = tempHome(t);
  const repo = tempRepo(t);
  const other = path.join(home, ".claude-b");
  fs.writeFileSync(path.join(repo, "config", "claude", "global-config.json"), JSON.stringify({ copyOnSelect: false, oauthAccount: { x: 1 } }));
  // Claude Code has run in the default profile only: ~/.claude.json exists, .claude-b/.claude.json doesn't.
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ numStartups: 3, copyOnSelect: true }));
  const events = quiet();
  installGlobal(repo, undefined, { copy: true });
  installGlobal(repo, other, { copy: true });
  const config = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
  assert.deepEqual(config, { numStartups: 3, copyOnSelect: false });
  assert.ok(!fs.existsSync(path.join(other, ".claude.json")), "a profile Claude Code never ran in gets no .claude.json");
  assert.ok(events.some((e) => e.kind === "result" && e.status === "skipped" && /oauthAccount/.test(e.detail)), "keys outside the list are refused");
  assert.ok(GLOBAL_CONFIG_KEYS.includes("copyOnSelect"));

  // /config changes it in the profile: the checklist says so, install puts the repository's value back.
  setKey(path.join(home, ".claude.json"), "copyOnSelect", true);
  const checks = quiet();
  verifyGlobal(repo, [path.join(home, ".claude")]);
  assert.ok(checks.some((e) => e.kind === "warning" && /copyOnSelect/.test(e.text)));
  quiet();
  installGlobal(repo, undefined, { copy: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8")).copyOnSelect, false);
});

test("the checklist warns about settings changed in the repository and not committed", (t) => {
  const home = tempHome(t);
  const repo = tempRepo(t);
  quiet();
  installGlobal(repo, path.join(home, ".claude"));
  let checks = quiet();
  verifyGlobal(repo, [path.join(home, ".claude")]);
  assert.ok(!checks.some((e) => e.kind === "warning"));
  setKey(path.join(repo, "config", "claude", "settings.json"), "verbose", true);
  checks = quiet();
  verifyGlobal(repo, [path.join(home, ".claude")]);
  assert.ok(checks.some((e) => e.kind === "warning" && /not committed/.test(e.text)));
});

test("the configuration is the folder DOTAGENTS_CONFIG names, else config/ in the clone, else dotagents-config beside it", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "dotagents-core");
  fs.mkdirSync(repo);
  assert.equal(configRoot(repo), path.join(root, "dotagents-config"));
  fs.mkdirSync(path.join(repo, "config"));
  assert.equal(configRoot(repo), path.join(repo, "config"));
  process.env.DOTAGENTS_CONFIG = "/mine";
  t.after(() => delete process.env.DOTAGENTS_CONFIG);
  assert.equal(configRoot(repo), path.resolve("/mine"));
});
