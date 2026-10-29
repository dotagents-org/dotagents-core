// The Claude profiles of this machine. Each one is a Claude Code config folder with its own
// sign-in: the default profile uses ~/.claude, the others ~/.claude-<name>, picked through
// CLAUDE_CONFIG_DIR. For each profile dotagents applies the same configuration as `install`
// and writes a launcher, claude-<name>, that runs Claude Code in that folder.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CREDENTIAL_VARIABLES, defaultConfigDir, signedIn } from "./claude-code.ts";
import { ensureDir, isWindows, lstat, realpath, removeGenerated, samePath, writeGenerated } from "./common.ts";
import { type Shortcuts, applyDesktop, powershellShortcuts, removeDesktop, verifyDesktop } from "./desktop.ts";
import { installGlobal } from "./global.ts";
import { type Profile, loadProfiles, migrateLegacyProfiles, profilesFile, removeProfile, saveProfile } from "./machine-state.ts";
import { checkItem, checkWarn, displayPath, report, section } from "./output.ts";
import { state } from "./state.ts";

// The colors given to profiles in the order they are added, unless --color picks one.
export const PALETTE = ["#D77655", "#376B80"];

const SAFE_PROFILE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

// ~/.local/bin is on the PATH of most Linux setups, and has to be added on Windows and macOS.
export const launcherDir = () => path.join(os.homedir(), ".local", "bin");
export const launcherFile = (name: string) => path.join(launcherDir(), isWindows ? `claude-${name}.cmd` : `claude-${name}`);

// The launcher clears the variables that would sign in over the folder's login, then points
// Claude Code at the folder. The default profile clears CLAUDE_CONFIG_DIR instead of naming
// ~/.claude: Claude Code keeps the default folder's state in ~/.claude.json only when the
// variable is unset.
function launcher(profile: Profile) {
  if (isWindows) {
    return [
      "@echo off",
      `rem Claude Code as the ${profile.name} profile.`,
      "setlocal",
      ...CREDENTIAL_VARIABLES.map((v) => `set ${v}=`),
      profile.default ? "set CLAUDE_CONFIG_DIR=" : `set "CLAUDE_CONFIG_DIR=${profile.configDir}"`,
      "claude %*",
      "",
    ].join("\r\n");
  }
  return [
    "#!/bin/sh",
    `# Claude Code as the ${profile.name} profile.`,
    `unset ${CREDENTIAL_VARIABLES.join(" ")}`,
    profile.default ? "unset CLAUDE_CONFIG_DIR" : `export CLAUDE_CONFIG_DIR='${profile.configDir}'`,
    'exec claude "$@"',
    "",
  ].join("\n");
}

// The second Desktop app (lib/desktop.ts): on Windows by default; the tests pass a fake one
// everywhere.
export type DesktopOption = { desktop?: { shortcuts: Shortcuts } | null };
const desktopDefault = () => (isWindows ? { shortcuts: powershellShortcuts } : null);

function applyProfile(repo: string, profile: Profile, desktop: { shortcuts: Shortcuts } | null) {
  section(`Profile ${profile.name}`);
  ensureDir(profile.configDir);
  installGlobal(repo, profile.configDir);
  section("Launcher");
  writeGenerated(launcherFile(profile.name), launcher(profile), { comment: isWindows ? "rem" : "#", executable: true, onForeign: "backup" });
  if (desktop) applyDesktop(repo, profile, { launcherDir: launcherDir(), shortcuts: desktop.shortcuts });
}

// Adds a profile, or brings one up to date: its folder, the configuration and the launcher.
export function setUpProfile(
  repo: string,
  { name, isDefault = false, color, desktop = desktopDefault() }: { name: string; isDefault?: boolean; color?: string } & DesktopOption
) {
  if (!SAFE_PROFILE.test(name)) throw new Error(`'${name}' is not a valid profile name: use lowercase letters, digits and dashes`);
  if (color !== undefined && !HEX.test(color)) throw new Error(`'${color}' is not a color: use #RRGGBB`);
  const all = loadProfiles();
  const prior = all.find((a) => a.name === name);
  const isDefaultNow = isDefault || Boolean(prior?.default);
  const otherDefault = all.find((a) => a.default && a.name !== name);
  // The default profile owns ~/.claude; moving it to another profile means moving folders.
  if (isDefault && otherDefault) throw new Error(`${otherDefault.name} is already the default profile, in ${otherDefault.configDir}`);
  const profile: Profile = {
    name,
    configDir: prior?.configDir ?? (isDefaultNow ? defaultConfigDir() : path.join(os.homedir(), `.claude-${name}`)),
    color: color ?? prior?.color ?? PALETTE[all.filter((a) => a.name !== name).length % PALETTE.length],
    ...(isDefaultNow ? { default: true } : {}),
  };
  applyProfile(repo, profile, desktop);
  section("Profiles");
  const same = prior && JSON.stringify(prior) === JSON.stringify(profile);
  if (same) report("ok", profilesFile(), `${name}: ${profile.configDir}`);
  else {
    report(state.dryRun ? (prior ? "would update" : "would create") : prior ? "updated" : "created", profilesFile(), `${name}: ${profile.configDir}`);
    saveProfile(profile);
  }
}

// Forgets a profile: its record and its launcher. The folder, with the sign-in and the
// history, stays where it is.
export function dropProfile(name: string, { desktop = desktopDefault() }: DesktopOption = {}) {
  if (!loadProfiles().some((a) => a.name === name)) throw new Error(`There is no profile named ${name}`);
  section("Launcher");
  removeGenerated(launcherFile(name));
  if (desktop) removeDesktop(name, { launcherDir: launcherDir(), shortcuts: desktop.shortcuts });
  section("Profiles");
  report(state.dryRun ? "would update" : "updated", profilesFile(), `removed ${name}; its folder was kept`);
  removeProfile(name);
}

// The folder as Claude Code sees it, plus where it really is when it is a link or a junction
// ("~/.claude → ~/.claude-work"). Only a link counts: a resolved path can also differ by a
// Windows short name (RUNNER~1), which is the same folder.
export function showFolder(configDir: string) {
  const real = lstat(configDir)?.isSymbolicLink() ? realpath(configDir) : null;
  return real ? `${displayPath(configDir)} → ${displayPath(real)}` : displayPath(configDir);
}

// What `install` applies: the default folder, and every profile of this machine.
export function installProfiles(repo: string, { desktop = desktopDefault() }: DesktopOption = {}) {
  if (migrateLegacyProfiles()) {
    section("Profiles");
    report(state.dryRun ? "would update" : "updated", profilesFile(), "moved from accounts.json, the name before 2.0.0");
  }
  const profiles = loadProfiles();
  if (!profiles.some((a) => samePath(a.configDir, defaultConfigDir()))) installGlobal(repo);
  for (const profile of profiles) applyProfile(repo, profile, desktop);
}

// The profiles' checklist: folders and launchers in place, one claude.ai account per folder, and
// no variable that would sign every folder in as someone else.
export function verifyProfiles({ desktop = desktopDefault() }: DesktopOption = {}) {
  section("Profiles");
  const seen = new Map<string, string>();
  for (const profile of loadProfiles()) {
    if (desktop) verifyDesktop(profile.name, profile.default);
    checkItem(fs.existsSync(profile.configDir), `${profile.name}: ${showFolder(profile.configDir)} exists`, `create it with: dotagents profile add ${profile.name}`);
    checkItem(fs.existsSync(launcherFile(profile.name)), `${profile.name}: launcher ${path.basename(launcherFile(profile.name))} exists`, `write it with: dotagents install`);
    const who = signedIn(profile.configDir);
    if (!who) {
      checkWarn(`${profile.name} is not signed in`, `sign in with: claude-${profile.name} auth login`);
      continue;
    }
    const twin = seen.get(who.accountUuid);
    checkItem(!twin, `${profile.name} is a different claude.ai account`, `${profile.name} and ${twin} are signed in to the same account; sign one of them in again`);
    seen.set(who.accountUuid, profile.name);
  }
  const exported = CREDENTIAL_VARIABLES.filter((v) => process.env[v]);
  if (exported.length) checkWarn(`${exported.join(", ")} set in this shell`, "they sign Claude Code in over the profile folders; the launchers clear them");
}
