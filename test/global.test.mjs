// The machine level, through installGlobal, with a temporary home folder.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { state } from "../lib/common.mjs";
import { installGlobal } from "../lib/global.mjs";
import { REPO, quiet } from "./helpers.mjs";

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-home-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config") });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

test("install writes the instructions for the three tools with this clone's path", (t) => {
  const home = tempHome(t);
  quiet();
  installGlobal(REPO);
  assert.equal(state.problems, 0);
  for (const file of [".claude/CLAUDE.md", ".codex/AGENTS.md", ".config/opencode/AGENTS.md"]) {
    const text = fs.readFileSync(path.join(home, file), "utf8");
    assert.ok(!text.includes("{{AGENTS_REPO}}"), `${file} still has the placeholder`);
    assert.ok(text.includes(REPO.replace(/\\/g, "/")), `${file} doesn't mention the clone`);
  }
});

test("a second install changes nothing, even when a copy was saved with CRLF", (t) => {
  const home = tempHome(t);
  quiet();
  installGlobal(REPO);
  const settings = path.join(home, ".config", "opencode", "opencode.json");
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
