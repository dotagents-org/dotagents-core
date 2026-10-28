// A second Claude Desktop app per account, on Windows: the app takes --user-data-dir (an
// Electron flag, not documented by Anthropic), so each account gets its own data folder and a
// Start menu shortcut, "Claude <name>". The default account keeps the normal app.
//
// The shortcut runs a small .vbs launcher, so no console window flashes: it sets
// CLAUDE_CONFIG_DIR, for the Code tab inside the app to use the account's folder, and starts
// the app through its execution alias. Shortcuts are written through an adapter: PowerShell on
// Windows, a fake one in the tests.
//
// Known limits of a second instance: sign in with e-mail and code (Google sign-in comes back
// to the normal app), claude:// links open in the normal app, and an update reopens only the
// normal app.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir, lstat, removeGenerated, writeGenerated } from "./common.ts";
import { checkItem, checkWarn, report, section } from "./output.ts";
import { state } from "./state.ts";

export type Shortcut = { target: string; args: string; description: string; icon: string };

// Reads and writes .lnk files. read returns null when the file doesn't exist.
export type Shortcuts = {
  read(lnk: string): Shortcut | null;
  write(lnk: string, shortcut: Shortcut): void;
};

const appData = () => process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const localAppData = () => process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");

// The execution alias the Claude installer (MSIX) puts on the PATH.
export const desktopExe = () => path.join(localAppData(), "Microsoft", "WindowsApps", "claude-desktop.exe");
// Right under %APPDATA%: Cowork only works with the data folder there.
export const desktopDataDir = (name: string) => path.join(appData(), `Claude-${name}`);
export const shortcutFile = (name: string) => path.join(appData(), "Microsoft", "Windows", "Start Menu", "Programs", `Claude ${name}.lnk`);
export const desktopLauncherFile = (launcherDir: string, name: string) => path.join(launcherDir, `claude-desktop-${name}.vbs`);

const MARK = (name: string) => `dotagents:${name}`;

function vbsLauncher(name: string, configDir: string) {
  const q = (s: string) => s.replace(/"/g, '""');
  return [
    `' Claude Desktop as the ${name} account.`,
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Environment("PROCESS")("CLAUDE_CONFIG_DIR") = "${q(configDir)}"`,
    `shell.Run """${q(desktopExe())}"" --user-data-dir=""${q(desktopDataDir(name))}""", 1, False`,
    "",
  ].join("\r\n");
}

const wscript = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe");

function shortcutFor(name: string, launcherDir: string): Shortcut {
  return { target: wscript(), args: `"${desktopLauncherFile(launcherDir, name)}"`, description: MARK(name), icon: `${desktopExe()},0` };
}

const sameShortcut = (a: Shortcut, b: Shortcut) =>
  a.target.toLowerCase() === b.target.toLowerCase() && a.args === b.args && a.description === b.description && a.icon.toLowerCase() === b.icon.toLowerCase();

function ensureShortcut(lnk: string, wanted: Shortcut, shortcuts: Shortcuts) {
  const current = lstat(lnk) ? shortcuts.read(lnk) : null;
  if (current && sameShortcut(current, wanted)) return report("ok", lnk);
  if (current && current.description !== wanted.description) return report("skipped", lnk, "a shortcut dotagents didn't make has this name");
  if (state.dryRun) return report(current ? "would update" : "would create", lnk);
  fs.mkdirSync(path.dirname(lnk), { recursive: true });
  shortcuts.write(lnk, wanted);
  report(current ? "updated" : "created", lnk);
}

// The data folder, the launcher and the shortcut of an account's Desktop app.
export function applyDesktop(account: { name: string; configDir: string }, { launcherDir, shortcuts = powershellShortcuts }: { launcherDir: string; shortcuts?: Shortcuts }) {
  section("Desktop");
  if (!fs.existsSync(desktopExe())) {
    checkWarn("Claude Desktop isn't installed, so no desktop shortcut", "install it from claude.ai/download and run dotagents install again");
    return;
  }
  // Made before the first start: a folder the app creates itself lands in its MSIX container.
  ensureDir(desktopDataDir(account.name));
  writeGenerated(desktopLauncherFile(launcherDir, account.name), vbsLauncher(account.name, account.configDir), { comment: "'", onForeign: "backup" });
  ensureShortcut(shortcutFile(account.name), shortcutFor(account.name, launcherDir), shortcuts);
}

// Removes the launcher and the shortcut; the data folder, with the sign-in, stays.
export function removeDesktop(name: string, { launcherDir, shortcuts = powershellShortcuts }: { launcherDir: string; shortcuts?: Shortcuts }) {
  const lnk = shortcutFile(name);
  const current = lstat(lnk) ? shortcuts.read(lnk) : null;
  if (!current && !lstat(desktopLauncherFile(launcherDir, name))) return;
  section("Desktop");
  removeGenerated(desktopLauncherFile(launcherDir, name));
  if (!current) return;
  if (current.description !== MARK(name)) return report("skipped", lnk, "not made by dotagents; remove it by hand");
  if (state.dryRun) return report("would update", lnk, "remove");
  fs.unlinkSync(lnk);
  report("updated", lnk, "removed");
}

export function verifyDesktop(name: string) {
  if (!fs.existsSync(desktopExe())) return;
  checkItem(fs.existsSync(desktopDataDir(name)), `${name}: desktop data folder exists`, "create it with: dotagents install");
  checkItem(fs.existsSync(shortcutFile(name)), `${name}: Start menu shortcut "Claude ${name}" exists`, "create it with: dotagents install");
}

// The real adapter: PowerShell and the WScript.Shell object. The values go through environment
// variables, so no quoting reaches the command line.
export const powershellShortcuts: Shortcuts = {
  read(lnk) {
    const script = "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:DA_LNK); @{target=$s.TargetPath; args=$s.Arguments; description=$s.Description; icon=$s.IconLocation} | ConvertTo-Json -Compress";
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", env: { ...process.env, DA_LNK: lnk } });
    if (res.status !== 0) return null;
    try {
      return JSON.parse(res.stdout) as Shortcut;
    } catch {
      return null;
    }
  },
  write(lnk, s) {
    const script =
      "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:DA_LNK); $s.TargetPath = $env:DA_TARGET; $s.Arguments = $env:DA_ARGS; $s.Description = $env:DA_DESCRIPTION; $s.IconLocation = $env:DA_ICON; $s.Save()";
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      env: { ...process.env, DA_LNK: lnk, DA_TARGET: s.target, DA_ARGS: s.args, DA_DESCRIPTION: s.description, DA_ICON: s.icon },
    });
    if (res.status !== 0) throw new Error(`Couldn't write ${lnk}: ${res.stderr.trim()}`);
  },
};
