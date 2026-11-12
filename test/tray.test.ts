// The tray panel (surfaces/tray/): what can be checked without opening a window. Its look is
// checked by hand on Windows.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { AVATAR_STATES } from "../core/usage.ts";
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
