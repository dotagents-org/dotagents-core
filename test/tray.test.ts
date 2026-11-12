// The tray panel (surfaces/tray/): what can be checked without opening a window. Its look is
// checked by hand on Windows.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import os from "node:os";
import { trayFor, usageJson } from "../core/snapshot.ts";
import { AVATAR_STATES, type ProfileUsage } from "../core/usage.ts";
import { REPO } from "./helpers.ts";

const TRAY = path.join(REPO, "surfaces", "tray");

test("every avatar state has the brand's strip, the fallback of an account without its own", () => {
  const missing = AVATAR_STATES.filter((s) => !fs.existsSync(path.join(TRAY, "assets", `dotagents-${s}.png`)));
  assert.deepEqual(missing, []);
});

test("the panel's script and window are ASCII, which Windows PowerShell reads right without a BOM", () => {
  for (const file of ["tray.ps1", "panel.xaml"]) assert.doesNotMatch(fs.readFileSync(path.join(TRAY, file), "utf8"), /[^\x00-\x7f]/, file);
});

test("Windows PowerShell parses the script and WPF loads the window", { skip: process.platform !== "win32" }, () => {
  const script = [
    "$errs = $null",
    "[void][System.Management.Automation.Language.Parser]::ParseFile($env:DA_PS1, [ref]$null, [ref]$errs)",
    "if ($errs.Count) { $errs | ForEach-Object { $_.Extent.StartLineNumber.ToString() + ': ' + $_.Message }; exit 1 }",
    "Add-Type -AssemblyName PresentationFramework",
    "[xml]$x = Get-Content -Raw $env:DA_XAML",
    "$w = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $x))",
    "if (-not $w.FindName('Cards')) { exit 2 }",
  ].join("; ");
  const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, DA_PS1: path.join(TRAY, "tray.ps1"), DA_XAML: path.join(TRAY, "panel.xaml") },
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test("no two variables in the script differ only in case, which PowerShell takes for one", () => {
  const spellings = new Map<string, Set<string>>();
  for (const m of fs.readFileSync(path.join(TRAY, "tray.ps1"), "utf8").matchAll(/\$(?:script:)?([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const key = m[1].toLowerCase();
    spellings.set(key, (spellings.get(key) ?? new Set()).add(m[1]));
  }
  assert.deepEqual([...spellings.values()].filter((s) => s.size > 1).map((s) => [...s]), []);
});

test("the panel builds its icon and window from real usage data, shows and hides", { skip: process.platform !== "win32" }, (t) => {
  const now = new Date();
  const list: ProfileUsage[] = [
    { name: "work", color: "#D77655", state: "ok", fetchedAt: now, activity: { working: 1, waiting: 0 }, windows: [{ kind: "session", pct: 40, resetsAt: new Date(now.getTime() + 3_600_000), reset: false }, { kind: "model-week", model: "Opus", pct: 75, resetsAt: new Date(now.getTime() + 86_400_000), reset: false }] },
    { name: "personal", color: "#376B80", state: "not-signed-in", fetchedAt: null, windows: [] },
  ];
  const slots = { Windows: "work", WSL: "personal" };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-tray-")), "usage.json");
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  fs.writeFileSync(file, JSON.stringify({ ...usageJson(list, now), slots, tray: trayFor(list, slots, now), peer: { name: "WSL", up: true } }));
  const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", path.join(TRAY, "tray.ps1"), "-Check", file], { encoding: "utf8", timeout: 60_000 });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});
