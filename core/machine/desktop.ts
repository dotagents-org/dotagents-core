// A Desktop app per profile, on Windows: Claude Desktop for a Claude profile, the ChatGPT app for a
// ChatGPT one. Both take --user-data-dir (an Electron and a Chromium flag, documented by neither
// company), so each profile other than its provider's default gets its own data folder. Every
// profile gets a Start menu shortcut, "Claude <Name>" or "ChatGPT <Name>"; the default profile's
// opens the normal app.
//
// The ChatGPT app runs Codex inside it, with the login in CODEX_HOME: the normal app reads ~/.codex,
// the slot dotagents switches, so it follows the switch; a profile's own app gets CODEX_HOME in its
// data folder, where it signs in once, apart from the slot and the vault (tested 2026-11-17).
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
import { configRoot, ensureDir, lstat, removeGenerated, writeGenerated } from "../common.ts";
import { loadMachine } from "./machine-state.ts";
import { checkItem, checkWarn, report, section } from "../output/output.ts";
import { state } from "../state.ts";
import { SHORTCUT_APP_ID_CS, appIdFor, taskbarWatcher, taskbarWatcherFile } from "./taskbar.ts";

// appId: the AppUserModelID that gives the profile its own taskbar button (core/machine/taskbar.ts).
export type Shortcut = { target: string; args: string; description: string; icon: string; appId: string };

// Reads and writes .lnk files. read returns null when the file doesn't exist.
export type Shortcuts = {
  read(lnk: string): Shortcut | null;
  write(lnk: string, shortcut: Shortcut): void;
};

const appData = () => process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const localAppData = () => process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");

// What differs between the two apps. Each provider names its own (core/accounts/providers).
export type DesktopApp = {
  // The app's name, the first word of its shortcuts and of its data folders.
  name: string;
  // The first part of its files' names: launchers, icons.
  prefix: string;
  // The execution alias its installer (MSIX) puts on the PATH.
  exe: () => string;
  install: string;
  // The VBScript lines that set the environment before the app starts.
  env: (dataDir: string, isDefault: boolean) => string[];
  // A folder inside the data folder made before the first start, as the data folder is.
  innerDir?: (dataDir: string) => string;
  // Its main process, which the taskbar watcher looks for (core/machine/taskbar.ts).
  process: string;
};

const q = (s: string) => s.replace(/"/g, '""');
// Removed, never set empty (an empty CLAUDE_CONFIG_DIR makes Claude Code use the current folder).
// Remove fails when the variable isn't set, hence On Error Resume Next around it.
const unset = (variable: string) => ["On Error Resume Next", `shell.Environment("PROCESS").Remove "${variable}"`, "On Error GoTo 0"];

export const CLAUDE_DESKTOP: DesktopApp = {
  name: "Claude",
  prefix: "claude",
  exe: () => path.join(localAppData(), "Microsoft", "WindowsApps", "claude-desktop.exe"),
  install: "install it from claude.ai/download",
  // Every one with CLAUDE_CONFIG_DIR cleared, so the Code tab inside the app uses ~/.claude.
  env: () => unset("CLAUDE_CONFIG_DIR"),
  process: "claude.exe",
};

const codexHomeIn = (dataDir: string) => path.join(dataDir, "codex-home");
export const CHATGPT_DESKTOP: DesktopApp = {
  name: "ChatGPT",
  prefix: "chatgpt",
  exe: () => path.join(localAppData(), "Microsoft", "WindowsApps", "chatgpt-desktop.exe"),
  install: "install it from chatgpt.com/download",
  // The normal app reads ~/.codex (the slot); a profile's own app, CODEX_HOME in its data folder.
  env: (dataDir, isDefault) => (isDefault ? unset("CODEX_HOME") : [`shell.Environment("PROCESS")("CODEX_HOME") = "${q(codexHomeIn(dataDir))}"`]),
  innerDir: codexHomeIn,
  process: "ChatGPT.exe",
};

export const desktopExe = (app = CLAUDE_DESKTOP) => app.exe();
// The alias is a reparse point that stat can't follow (EACCES), so fs.existsSync says false
// even when the app is installed: lstat sees it.
const desktopInstalled = (app: DesktopApp) => Boolean(lstat(app.exe()));
// Right under %APPDATA%: Cowork only works with the data folder there, and a folder made before the
// first start keeps the ChatGPT app's data out of its MSIX container too.
export const desktopDataDir = (name: string, app = CLAUDE_DESKTOP) => path.join(appData(), `${app.name}-${name}`);
// "personal" → "Claude Personal", "my-work" → "ChatGPT My Work".
export const appTitle = (name: string, app = CLAUDE_DESKTOP) => `${app.name} ${name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}`;
export const shortcutFile = (name: string, app = CLAUDE_DESKTOP) => path.join(appData(), "Microsoft", "Windows", "Start Menu", "Programs", `${appTitle(name, app)}.lnk`);
export const desktopLauncherFile = (launcherDir: string, name: string, app = CLAUDE_DESKTOP) => path.join(launcherDir, `${app.prefix}-desktop-${name}.vbs`);

const MARK = (name: string) => `dotagents:${name}`;

// The default profile opens the normal app, the others their own data folder, each with the app's
// environment. Then it starts the taskbar watcher, hidden, for the profile's own button and look
// (core/machine/taskbar.ts).
function vbsLauncher(repo: string, launcherDir: string, name: string, isDefault: boolean, app: DesktopApp) {
  const exe = app.exe();
  const dataDir = desktopDataDir(name, app);
  const arg = (flag: string, value: string) => ` -${flag} ""${q(value)}""`;
  const watcher =
    `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${q(taskbarWatcherFile(launcherDir))}""` +
    arg("AppId", appIdFor(name, app.prefix)) +
    arg("DisplayName", appTitle(name, app)) +
    arg("Icon", windowIcon(repo, name, app)) +
    arg("Launcher", desktopLauncherFile(launcherDir, name, app)) +
    (isDefault ? "" : arg("DataDir", dataDir)) +
    arg("Exe", app.process);
  return [
    `' ${app.name} as the ${name} profile.`,
    'Set shell = CreateObject("WScript.Shell")',
    ...app.env(dataDir, isDefault),
    isDefault ? `shell.Run """${q(exe)}""", 1, False` : `shell.Run """${q(exe)}"" --user-data-dir=""${q(dataDir)}""", 1, False`,
    `shell.Run "${watcher}", 0, False`,
    "",
  ].join("\r\n");
}

const wscript = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe");

// The profile's own icon, config/assets/claude-<name>.ico (chatgpt-<name>.ico), when there is one;
// else the app's. Shortcuts only take .ico (or an .exe), so the .svg next to it is the source.
function iconFile(repo: string, name: string, app: DesktopApp) {
  const ico = path.join(configRoot(repo), "assets", `${app.prefix}-${name}.ico`);
  return fs.existsSync(ico) ? ico : app.exe();
}
export const profileIcon = (repo: string, name: string, app = CLAUDE_DESKTOP) => `${iconFile(repo, name, app)},0`;

// The same icon for a window's taskbar button, which takes an .ico file as a plain path.
const windowIcon = (repo: string, name: string, app: DesktopApp) => iconFile(repo, name, app);

function shortcutFor(repo: string, name: string, launcherDir: string, app: DesktopApp): Shortcut {
  return { target: wscript(), args: `"${desktopLauncherFile(launcherDir, name, app)}"`, description: MARK(name), icon: profileIcon(repo, name, app), appId: appIdFor(name, app.prefix) };
}

const sameShortcut = (a: Shortcut, b: Shortcut) =>
  a.target.toLowerCase() === b.target.toLowerCase() &&
  a.args === b.args &&
  a.description === b.description &&
  a.icon.toLowerCase() === b.icon.toLowerCase() &&
  (a.appId || "") === (b.appId || "");

function ensureShortcut(lnk: string, wanted: Shortcut, shortcuts: Shortcuts) {
  const current = lstat(lnk) ? shortcuts.read(lnk) : null;
  if (current && sameShortcut(current, wanted)) return report("ok", lnk);
  if (current && current.description !== wanted.description) return report("skipped", lnk, "a shortcut dotagents didn't make has this name");
  if (state.dryRun) return report(current ? "would update" : "would create", lnk);
  fs.mkdirSync(path.dirname(lnk), { recursive: true });
  shortcuts.write(lnk, wanted);
  report(current ? "updated" : "created", lnk);
}

// Opens a profile's Desktop app through its launcher, as its Start menu shortcut does (the accounts tab's
// "Open Desktop"). From WSL it runs the Windows side's launcher, through the interop (wscript.exe
// and the launcher's Windows path), since the app lives on Windows.
export type Launch = (command: string, args: string[]) => void;
const launch: Launch = (command, args) => {
  // An error here (wscript missing) is the launcher's: it never takes the server down.
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
};
const windowsPath = (p: string) => spawnSync("wslpath", ["-w", p], { encoding: "utf8" }).stdout.trim();

export function openDesktop(name: string, launcherDir: string, { run = launch, toWindows = windowsPath, peer = loadMachine().peer, app = CLAUDE_DESKTOP } = {}): { ok: boolean; detail: string } {
  const here = process.platform === "win32";
  if (!here && peer?.name !== "Windows") return { ok: false, detail: "the Desktop app opens on Windows" };
  // On Windows, this side's launcher; from WSL, the one in the Windows home (its ~/.local/bin).
  const launcher = here ? desktopLauncherFile(launcherDir, name, app) : desktopLauncherFile(path.join(peer!.home, ".local", "bin"), name, app);
  if (!fs.existsSync(launcher)) return { ok: false, detail: `${name} has no Desktop app; add it on Windows with: dotagents install` };
  if (here) run(wscript(), [launcher]);
  else run("wscript.exe", [toWindows(launcher)]);
  return { ok: true, detail: `opening ${appTitle(name, app)}` };
}

// The data folder, the launcher and the shortcut of a profile's Desktop app.
export function applyDesktop(
  repo: string,
  profile: { name: string; default?: boolean },
  { launcherDir, shortcuts = powershellShortcuts, app = CLAUDE_DESKTOP }: { launcherDir: string; shortcuts?: Shortcuts; app?: DesktopApp }
) {
  section("Desktop");
  if (!desktopInstalled(app)) {
    checkWarn(`${app.name} Desktop isn't installed, so no desktop shortcut for ${profile.name}`, `${app.install} and run dotagents install again`);
    return;
  }
  // Made before the first start: a folder the app creates itself lands in its MSIX container.
  if (!profile.default) {
    ensureDir(desktopDataDir(profile.name, app));
    if (app.innerDir) ensureDir(app.innerDir(desktopDataDir(profile.name, app)));
  }
  writeGenerated(taskbarWatcherFile(launcherDir), taskbarWatcher(), { comment: "#", onForeign: "backup" });
  writeGenerated(desktopLauncherFile(launcherDir, profile.name, app), vbsLauncher(repo, launcherDir, profile.name, Boolean(profile.default), app), {
    comment: "'",
    onForeign: "backup",
  });
  ensureShortcut(shortcutFile(profile.name, app), shortcutFor(repo, profile.name, launcherDir, app), shortcuts);
}

// The tray panel was dropped for the panel in the sidebar. Its launcher in the
// Startup folder, which install wrote, goes; a file there that isn't dotagents' stays.
export const trayStartupFile = () => path.join(appData(), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "dotagents-tray.vbs");

export function removeTray() {
  if (!lstat(trayStartupFile())) return;
  section("Tray panel");
  removeGenerated(trayStartupFile());
}

// Removes the launcher and the shortcut; the data folder, with the sign-in, stays.
export function removeDesktop(name: string, { launcherDir, shortcuts = powershellShortcuts, app = CLAUDE_DESKTOP }: { launcherDir: string; shortcuts?: Shortcuts; app?: DesktopApp }) {
  const lnk = shortcutFile(name, app);
  const current = lstat(lnk) ? shortcuts.read(lnk) : null;
  if (!current && !lstat(desktopLauncherFile(launcherDir, name, app))) return;
  section("Desktop");
  removeGenerated(desktopLauncherFile(launcherDir, name, app));
  if (!current) return;
  if (current.description !== MARK(name)) return report("skipped", lnk, "not made by dotagents; remove it by hand");
  if (state.dryRun) return report("would update", lnk, "remove");
  fs.unlinkSync(lnk);
  report("updated", lnk, "removed");
}

export function verifyDesktop(name: string, isDefault = false, app = CLAUDE_DESKTOP) {
  if (!desktopInstalled(app)) return;
  if (!isDefault) checkItem(fs.existsSync(desktopDataDir(name, app)), `${name}: desktop data folder exists`, "create it with: dotagents install");
  checkItem(fs.existsSync(shortcutFile(name, app)), `${name}: Start menu shortcut "${appTitle(name, app)}" exists`, "create it with: dotagents install");
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
      "if ($env:DA_APPID) { [DotagentsShortcutAppId]::Write($env:DA_LNK, $env:DA_APPID) }";
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      env: { ...process.env, DA_LNK: lnk, DA_CS: SHORTCUT_APP_ID_CS, DA_TARGET: s.target, DA_ARGS: s.args, DA_DESCRIPTION: s.description, DA_ICON: s.icon, DA_APPID: s.appId },
    });
    if (res.status !== 0) throw new Error(`Couldn't write ${lnk}: ${res.stderr.trim()}`);
  },
};

