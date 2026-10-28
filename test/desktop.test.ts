// The second Desktop app per account, through the accounts module, with a fake shortcut adapter
// (any system) and, on Windows, the real PowerShell one.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { dropAccount, launcherDir, setUpAccount } from "../lib/accounts.ts";
import { type Shortcut, type Shortcuts, appTitle, desktopDataDir, desktopExe, desktopLauncherFile, powershellShortcuts, shortcutFile } from "../lib/desktop.ts";
import { state } from "../lib/state.ts";
import { REPO, quiet } from "./helpers.ts";

function tempWindowsHome(t: TestContext, { withDesktop = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-desktop-"));
  const keys = ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "DOTAGENTS_STATE_DIR"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    DOTAGENTS_STATE_DIR: path.join(home, "state"),
  });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(home, { recursive: true, force: true });
  });
  if (withDesktop) {
    fs.mkdirSync(path.dirname(desktopExe()), { recursive: true });
    fs.writeFileSync(desktopExe(), "");
  }
  return home;
}

// Keeps the shortcuts in memory, and leaves a file where each one would be.
function fakeShortcuts() {
  const saved = new Map<string, Shortcut>();
  const shortcuts: Shortcuts = {
    read: (lnk) => saved.get(lnk) ?? null,
    write: (lnk, s) => {
      saved.set(lnk, { ...s });
      fs.writeFileSync(lnk, "lnk");
    },
  };
  return { saved, desktop: { shortcuts } };
}

test("every account gets a Start menu shortcut, \"Claude <Name>\"; only the second one a data folder of its own", (t) => {
  tempWindowsHome(t);
  const { saved, desktop } = fakeShortcuts();
  quiet();
  setUpAccount(REPO, { name: "work", isDefault: true, desktop });
  setUpAccount(REPO, { name: "personal", desktop });
  assert.equal(state.problems, 0);
  assert.ok(shortcutFile("personal").endsWith("Claude Personal.lnk"));
  assert.equal(appTitle("my-work"), "Claude My Work");
  // The default account opens the normal app, with its own data and ~/.claude.
  assert.equal(saved.get(shortcutFile("work"))?.description, "dotagents:work");
  assert.ok(!fs.existsSync(desktopDataDir("work")));
  const defaultVbs = fs.readFileSync(desktopLauncherFile(launcherDir(), "work"), "utf8");
  assert.ok(defaultVbs.includes('.Remove "CLAUDE_CONFIG_DIR"'));
  assert.ok(!defaultVbs.includes("--user-data-dir"));
  assert.ok(fs.existsSync(desktopDataDir("personal")));
  const vbs = fs.readFileSync(desktopLauncherFile(launcherDir(), "personal"), "utf8");
  assert.ok(vbs.includes(`"CLAUDE_CONFIG_DIR") = "${path.join(os.homedir(), ".claude-personal")}"`));
  assert.ok(vbs.includes(`--user-data-dir=""${desktopDataDir("personal")}""`));
  const lnk = saved.get(shortcutFile("personal"));
  assert.equal(lnk?.description, "dotagents:personal");
  assert.ok(lnk?.args.includes("claude-desktop-personal.vbs"));

  // A second run changes nothing.
  quiet();
  setUpAccount(REPO, { name: "personal", desktop });
  assert.equal(state.counts.created, undefined);
  assert.equal(state.counts.updated, undefined);
});

test("the app's execution alias counts as installed, though stat can't follow it", { skip: process.platform === "win32" }, (t) => {
  tempWindowsHome(t, { withDesktop: false });
  // Like the alias: lstat finds it, fs.existsSync doesn't.
  fs.mkdirSync(path.dirname(desktopExe()), { recursive: true });
  fs.symlinkSync(path.join(os.tmpdir(), "nowhere-dotagents"), desktopExe());
  assert.equal(fs.existsSync(desktopExe()), false);
  const { saved, desktop } = fakeShortcuts();
  quiet();
  setUpAccount(REPO, { name: "personal", desktop });
  assert.ok(saved.has(shortcutFile("personal")));
});

test("a dry run makes no folder, launcher or shortcut", (t) => {
  tempWindowsHome(t);
  const { saved, desktop } = fakeShortcuts();
  quiet({ dryRun: true });
  setUpAccount(REPO, { name: "personal", desktop });
  assert.ok(!fs.existsSync(desktopDataDir("personal")));
  assert.equal(saved.size, 0);
});

test("a shortcut someone else made with the same name is left alone", (t) => {
  tempWindowsHome(t);
  const { saved, desktop } = fakeShortcuts();
  fs.mkdirSync(path.dirname(shortcutFile("personal")), { recursive: true });
  desktop.shortcuts.write(shortcutFile("personal"), { target: "x.exe", args: "", description: "mine", icon: "" });
  quiet();
  setUpAccount(REPO, { name: "personal", desktop });
  assert.equal(saved.get(shortcutFile("personal"))?.description, "mine");
  assert.equal(state.counts.skipped, 1);
});

test("without Claude Desktop, only a note: no shortcut and no failure", (t) => {
  tempWindowsHome(t, { withDesktop: false });
  const { saved, desktop } = fakeShortcuts();
  quiet();
  setUpAccount(REPO, { name: "personal", desktop });
  assert.equal(state.problems, 0);
  assert.equal(state.counts.warnings, 1);
  assert.equal(saved.size, 0);
});

test("removing the account removes its launcher and shortcut, never the data folder", (t) => {
  tempWindowsHome(t);
  const { desktop } = fakeShortcuts();
  quiet();
  setUpAccount(REPO, { name: "personal", desktop });
  dropAccount("personal", { desktop });
  assert.ok(!fs.existsSync(shortcutFile("personal")));
  assert.ok(!fs.existsSync(desktopLauncherFile(launcherDir(), "personal")));
  assert.ok(fs.existsSync(desktopDataDir("personal")));
});

test("the PowerShell adapter writes a shortcut and reads it back", { skip: process.platform !== "win32" }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-lnk-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lnk = path.join(dir, "Claude test.lnk");
  const wanted = { target: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe"), args: '"C:\\x y\\a.vbs"', description: "dotagents:test", icon: "C:\\Windows\\notepad.exe,0" };
  powershellShortcuts.write(lnk, wanted);
  const read = powershellShortcuts.read(lnk);
  assert.equal(read?.description, "dotagents:test");
  assert.equal(read?.args, wanted.args);
  assert.equal(read?.target.toLowerCase(), wanted.target.toLowerCase());
});
