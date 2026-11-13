// A Claude Desktop app per profile, on Windows: the app takes --user-data-dir (an Electron flag,
// not documented by Anthropic), so each profile other than the default gets its own data folder.
// Every profile gets a Start menu shortcut, "Claude <Name>"; the default profile's opens the
// normal app.
//
// The shortcut runs a small .vbs launcher, so no console window flashes: it clears
// CLAUDE_CONFIG_DIR, so the Code tab inside the app uses ~/.claude like every profile, and starts
// the app through its execution alias. Each app keeps its own sign-in in its data folder. Shortcuts are written through an adapter: PowerShell on
// Windows, a fake one in the tests.
//
// Known limits of a second instance: sign in with e-mail and code (Google sign-in comes back
// to the normal app), claude:// links open in the normal app, and an update reopens only the
// normal app.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configRoot, ensureDir, lstat, removeGenerated, writeGenerated } from "./common.ts";
import { loadMachine } from "./machine-state.ts";
import { checkItem, checkWarn, report, section } from "./output.ts";
import { state } from "./state.ts";
import { SHORTCUT_APP_ID_CS, appIdFor, taskbarWatcher, taskbarWatcherFile } from "./taskbar.ts";

// appId: the AppUserModelID that gives the profile its own taskbar button (lib/taskbar.ts).
export type Shortcut = { target: string; args: string; description: string; icon: string; appId: string };

// Reads and writes .lnk files. read returns null when the file doesn't exist.
export type Shortcuts = {
  read(lnk: string): Shortcut | null;
  write(lnk: string, shortcut: Shortcut): void;
};

const appData = () => process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const localAppData = () => process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");

// The execution alias the Claude installer (MSIX) puts on the PATH.
export const desktopExe = () => path.join(localAppData(), "Microsoft", "WindowsApps", "claude-desktop.exe");
// The alias is a reparse point that stat can't follow (EACCES), so fs.existsSync says false
// even when the app is installed: lstat sees it.
const desktopInstalled = () => Boolean(lstat(desktopExe()));
// Right under %APPDATA%: Cowork only works with the data folder there.
export const desktopDataDir = (name: string) => path.join(appData(), `Claude-${name}`);
// "lovelace" → "Claude Lovelace", "my-work" → "Claude My Work".
export const appTitle = (name: string) => `Claude ${name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}`;
export const shortcutFile = (name: string) => path.join(appData(), "Microsoft", "Windows", "Start Menu", "Programs", `${appTitle(name)}.lnk`);
export const desktopLauncherFile = (launcherDir: string, name: string) => path.join(launcherDir, `claude-desktop-${name}.vbs`);

const MARK = (name: string) => `dotagents:${name}`;

// The default profile opens the normal app, the others their own data folder; every one with
// CLAUDE_CONFIG_DIR cleared (~/.claude).
// Then it starts the taskbar watcher, hidden, for the profile's own button (lib/taskbar.ts).
function vbsLauncher(repo: string, launcherDir: string, name: string, isDefault: boolean) {
  const q = (s: string) => s.replace(/"/g, '""');
  const arg = (flag: string, value: string) => ` -${flag} ""${q(value)}""`;
  const watcher =
    `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${q(taskbarWatcherFile(launcherDir))}""` +
    arg("AppId", appIdFor(name)) +
    arg("DisplayName", appTitle(name)) +
    arg("Icon", windowIcon(repo, name)) +
    arg("Launcher", desktopLauncherFile(launcherDir, name)) +
    (isDefault ? "" : arg("DataDir", desktopDataDir(name)));
  return [
    `' Claude Desktop as the ${name} profile.`,
    'Set shell = CreateObject("WScript.Shell")',
    // Removed, never set empty: an empty CLAUDE_CONFIG_DIR makes Claude Code use the current folder.
    // Remove fails when the variable isn't set, hence On Error Resume Next around it.
    "On Error Resume Next",
    'shell.Environment("PROCESS").Remove "CLAUDE_CONFIG_DIR"',
    "On Error GoTo 0",
    isDefault ? `shell.Run """${q(desktopExe())}""", 1, False` : `shell.Run """${q(desktopExe())}"" --user-data-dir=""${q(desktopDataDir(name))}""", 1, False`,
    `shell.Run "${watcher}", 0, False`,
    "",
  ].join("\r\n");
}

const wscript = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe");

// The profile's own icon, config/assets/claude-<name>.ico, when there is one; else
// the app's. Shortcuts only take .ico (or an .exe), so the .svg next to it is the source.
export function profileIcon(repo: string, name: string) {
  const ico = path.join(configRoot(repo), "assets", `claude-${name}.ico`);
  return fs.existsSync(ico) ? `${ico},0` : `${desktopExe()},0`;
}

// The same icon for a window's taskbar button, which takes an .ico file as a plain path.
const windowIcon = (repo: string, name: string) => profileIcon(repo, name).replace(/\.ico,0$/i, ".ico");

function shortcutFor(repo: string, name: string, launcherDir: string): Shortcut {
  return { target: wscript(), args: `"${desktopLauncherFile(launcherDir, name)}"`, description: MARK(name), icon: profileIcon(repo, name), appId: appIdFor(name) };
}

const sameShortcut = (a: Shortcut, b: Shortcut) =>
  a.target.toLowerCase() === b.target.toLowerCase() &&
  a.args === b.args &&
  a.description === b.description &&
  a.icon.toLowerCase() === b.icon.toLowerCase() &&
  a.appId === b.appId;

function ensureShortcut(lnk: string, wanted: Shortcut, shortcuts: Shortcuts) {
  const current = lstat(lnk) ? shortcuts.read(lnk) : null;
  if (current && sameShortcut(current, wanted)) return report("ok", lnk);
  if (current && current.description !== wanted.description) return report("skipped", lnk, "a shortcut dotagents didn't make has this name");
  if (state.dryRun) return report(current ? "would update" : "would create", lnk);
  fs.mkdirSync(path.dirname(lnk), { recursive: true });
  shortcuts.write(lnk, wanted);
  report(current ? "updated" : "created", lnk);
}

// The data folder, the launcher and the shortcut of a profile's Desktop app.
// Opens a profile's Desktop app through its launcher, as its Start menu shortcut does (the accounts tab's
// "Open Desktop"). From WSL it runs the Windows side's launcher, through the interop (wscript.exe
// and the launcher's Windows path), since the app lives on Windows.
export type Launch = (command: string, args: string[]) => void;
const launch: Launch = (command, args) => {
  // An error here (wscript missing) is the launcher's: it never takes the server down.
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
};
const windowsPath = (p: string) => spawnSync("wslpath", ["-w", p], { encoding: "utf8" }).stdout.trim();

export function openDesktop(name: string, launcherDir: string, { run = launch, toWindows = windowsPath, peer = loadMachine().peer } = {}): { ok: boolean; detail: string } {
  const here = process.platform === "win32";
  if (!here && peer?.name !== "Windows") return { ok: false, detail: "the Desktop app opens on Windows" };
  // On Windows, this side's launcher; from WSL, the one in the Windows home (its ~/.local/bin).
  const launcher = here ? desktopLauncherFile(launcherDir, name) : desktopLauncherFile(path.join(peer!.home, ".local", "bin"), name);
  if (!fs.existsSync(launcher)) return { ok: false, detail: `${name} has no Desktop app; add it on Windows with: dotagents profile add ${name}` };
  if (here) run(wscript(), [launcher]);
  else run("wscript.exe", [toWindows(launcher)]);
  return { ok: true, detail: `opening ${appTitle(name)}` };
}

export function applyDesktop(
  repo: string,
  profile: { name: string; default?: boolean },
  { launcherDir, shortcuts = powershellShortcuts }: { launcherDir: string; shortcuts?: Shortcuts }
) {
  section("Desktop");
  if (!desktopInstalled()) {
    checkWarn("Claude Desktop isn't installed, so no desktop shortcut", "install it from claude.ai/download and run dotagents install again");
    return;
  }
  // Made before the first start: a folder the app creates itself lands in its MSIX container.
  if (!profile.default) ensureDir(desktopDataDir(profile.name));
  writeGenerated(taskbarWatcherFile(launcherDir), taskbarWatcher(), { comment: "#", onForeign: "backup" });
  writeGenerated(desktopLauncherFile(launcherDir, profile.name), vbsLauncher(repo, launcherDir, profile.name, Boolean(profile.default)), {
    comment: "'",
    onForeign: "backup",
  });
  ensureShortcut(shortcutFile(profile.name), shortcutFor(repo, profile.name, launcherDir), shortcuts);
}

// The tray panel (ADR 0010) was dropped for the panel in HTML (ADR 0012). Its launcher in the
// Startup folder, which install wrote, goes; a file there that isn't dotagents' stays.
export const trayStartupFile = () => path.join(appData(), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "dotagents-tray.vbs");

export function removeTray() {
  if (!lstat(trayStartupFile())) return;
  section("Tray panel");
  removeGenerated(trayStartupFile());
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

export function verifyDesktop(name: string, isDefault = false) {
  if (!desktopInstalled()) return;
  if (!isDefault) checkItem(fs.existsSync(desktopDataDir(name)), `${name}: desktop data folder exists`, "create it with: dotagents install");
  checkItem(fs.existsSync(shortcutFile(name)), `${name}: Start menu shortcut "${appTitle(name)}" exists`, "create it with: dotagents install");
}

// The real adapter: PowerShell and the WScript.Shell object. The values go through environment
// variables, so no quoting reaches the command line.
export const powershellShortcuts: Shortcuts = {
  read(lnk) {
    const script =
      "Add-Type -TypeDefinition $env:DA_CS; $s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:DA_LNK); " +
      "@{target=$s.TargetPath; args=$s.Arguments; description=$s.Description; icon=$s.IconLocation; appId=[DotagentsShortcutAppId]::Read($env:DA_LNK)} | ConvertTo-Json -Compress";
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", env: { ...process.env, DA_LNK: lnk, DA_CS: SHORTCUT_APP_ID_CS } });
    if (res.status !== 0) return null;
    try {
      return JSON.parse(res.stdout) as Shortcut;
    } catch {
      return null;
    }
  },
  write(lnk, s) {
    const script =
      "Add-Type -TypeDefinition $env:DA_CS; $s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:DA_LNK); " +
      "$s.TargetPath = $env:DA_TARGET; $s.Arguments = $env:DA_ARGS; $s.Description = $env:DA_DESCRIPTION; $s.IconLocation = $env:DA_ICON; $s.Save(); " +
      "[DotagentsShortcutAppId]::Write($env:DA_LNK, $env:DA_APPID)";
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      env: { ...process.env, DA_LNK: lnk, DA_CS: SHORTCUT_APP_ID_CS, DA_TARGET: s.target, DA_ARGS: s.args, DA_DESCRIPTION: s.description, DA_ICON: s.icon, DA_APPID: s.appId },
    });
    if (res.status !== 0) throw new Error(`Couldn't write ${lnk}: ${res.stderr.trim()}`);
  },
};

