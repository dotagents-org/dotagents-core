// The Claude profiles of this machine: one per claude.ai account the person holds. Every profile
// uses the same config folder, ~/.claude, the slot (ADR 0009 and ADR 0011): the history, settings
// and skills are shared, and `dotagents switch` puts a profile's login in it from the profile's
// vault. On Windows each profile also gets a Claude Desktop app of its own (core/desktop.ts), so
// the accounts can be open at the same time there.
//
// Profiles used to have a folder each (~/.claude-<name>) and a launcher, claude-<name>: install
// moves such a record to the slot and removes the launcher, and leaves the folder to be deleted.

import os from "node:os";
import path from "node:path";
import { CREDENTIAL_VARIABLES, defaultConfigDir } from "./claude-code.ts";
import { isWindows, lstat, removeGenerated, samePath } from "./common.ts";
import { type Shortcuts, applyDesktop, powershellShortcuts, removeDesktop, removeTray, verifyDesktop } from "./desktop.ts";
import { installGlobal } from "./global.ts";
import { type Profile, loadProfiles, migrateLegacyProfiles, profilesFile, removeProfile, saveProfile } from "./machine-state.ts";
import { checkItem, checkWarn, displayPath, report, section } from "./output.ts";
import { state } from "./state.ts";
import { profileAccount } from "./switch.ts";

// The colors given to profiles in the order they are added, unless --color picks one.
export const PALETTE = ["#D77655", "#376B80"];

const SAFE_PROFILE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

// Where the launchers of the folder per profile were, to remove them.
export const launcherDir = () => path.join(os.homedir(), ".local", "bin");
export const launcherFile = (name: string) => path.join(launcherDir(), isWindows ? `claude-${name}.cmd` : `claude-${name}`);

// The Desktop apps (core/desktop.ts): on Windows by default; the tests pass a fake one everywhere.
export type DesktopOption = { desktop?: { shortcuts: Shortcuts } | null };
const desktopDefault = () => (isWindows ? { shortcuts: powershellShortcuts } : null);

function applyProfile(repo: string, profile: Profile, desktop: { shortcuts: Shortcuts } | null) {
  if (lstat(launcherFile(profile.name))) {
    section("Launcher");
    removeGenerated(launcherFile(profile.name));
  }
  if (desktop) applyDesktop(repo, profile, { launcherDir: launcherDir(), shortcuts: desktop.shortcuts });
}

// Writes a profile's record when it changed.
function record(profile: Profile, prior: Profile | undefined) {
  section("Profiles");
  if (prior && JSON.stringify(prior) === JSON.stringify(profile)) return report("ok", profilesFile(), profile.name);
  const detail = prior && !samePath(prior.configDir, profile.configDir) ? `${profile.name}: now in ${displayPath(profile.configDir)}; ${displayPath(prior.configDir)} isn't used anymore, delete it when you no longer need it` : profile.name;
  report(state.dryRun ? (prior ? "would update" : "would create") : prior ? "updated" : "created", profilesFile(), detail);
  saveProfile(profile);
}

// Adds a profile, or brings one up to date: its record, the configuration and, on Windows, its
// Desktop app. Its login comes into the vault with: claude auth login, then dotagents switch --save.
export function setUpProfile(
  repo: string,
  { name, isDefault = false, color, desktop = desktopDefault() }: { name: string; isDefault?: boolean; color?: string } & DesktopOption
) {
  if (!SAFE_PROFILE.test(name)) throw new Error(`'${name}' is not a valid profile name: use lowercase letters, digits and dashes`);
  if (color !== undefined && !HEX.test(color)) throw new Error(`'${color}' is not a color: use #RRGGBB`);
  const all = loadProfiles();
  const prior = all.find((a) => a.name === name);
  const otherDefault = all.find((a) => a.default && a.name !== name);
  // The default profile is the one the normal Desktop app opens: only one.
  if (isDefault && otherDefault) throw new Error(`${otherDefault.name} is already the default profile`);
  const profile: Profile = {
    name,
    configDir: defaultConfigDir(),
    color: color ?? prior?.color ?? PALETTE[all.filter((a) => a.name !== name).length % PALETTE.length],
    ...(isDefault || prior?.default ? { default: true } : {}),
  };
  section("Configuration");
  installGlobal(repo);
  applyProfile(repo, profile, desktop);
  record(profile, prior);
}

// Forgets a profile: its record and, on Windows, its Desktop app. Its saved login stays in the
// vault, and the Desktop app's data folder stays too.
export function dropProfile(name: string, { desktop = desktopDefault() }: DesktopOption = {}) {
  if (!loadProfiles().some((a) => a.name === name)) throw new Error(`There is no profile named ${name}`);
  if (lstat(launcherFile(name))) {
    section("Launcher");
    removeGenerated(launcherFile(name));
  }
  if (desktop) removeDesktop(name, { launcherDir: launcherDir(), shortcuts: desktop.shortcuts });
  section("Profiles");
  report(state.dryRun ? "would update" : "updated", profilesFile(), `removed ${name}; its saved login was kept`);
  removeProfile(name);
}

// Every config folder dotagents configures: the slot.
export const configDirs = () => [defaultConfigDir()];

// What `install` applies: the slot, and every profile of this machine, a record from the folder per
// profile moved to the slot.
export function installProfiles(repo: string, { desktop = desktopDefault() }: DesktopOption = {}) {
  if (migrateLegacyProfiles()) {
    section("Profiles");
    report(state.dryRun ? "would update" : "updated", profilesFile(), "moved from accounts.json, the name before 2.0.0");
  }
  installGlobal(repo);
  for (const prior of loadProfiles()) {
    const profile = { ...prior, configDir: defaultConfigDir() };
    applyProfile(repo, profile, desktop);
    if (!samePath(prior.configDir, profile.configDir)) record(profile, prior);
  }
  // Windows: the dropped tray panel's launcher goes.
  if (desktop) removeTray();
}

// The profiles' checklist: each one's login saved, each a different claude.ai account, and no
// variable that would sign Claude Code in as someone else.
export function verifyProfiles({ desktop = desktopDefault() }: DesktopOption = {}) {
  section("Profiles");
  const seen = new Map<string, string>();
  for (const profile of loadProfiles()) {
    if (desktop) verifyDesktop(profile.name, profile.default);
    checkItem(samePath(profile.configDir, defaultConfigDir()), `${profile.name} uses ${displayPath(defaultConfigDir())}`, "move it there with: dotagents install");
    const account = profileAccount(profile);
    if (!account) {
      checkWarn(`${profile.name} has no saved login`, `sign in with claude auth login, then: dotagents switch --save ${profile.name}`);
      continue;
    }
    const twin = seen.get(account.accountUuid);
    checkItem(!twin, `${profile.name} is a different claude.ai account`, `${profile.name} and ${twin} hold the same account; sign one of them in again and save it with dotagents switch --save`);
    seen.set(account.accountUuid, profile.name);
  }
  const exported = CREDENTIAL_VARIABLES.filter((v) => process.env[v]);
  if (exported.length) checkWarn(`${exported.join(", ")} set in this shell`, "they sign Claude Code in over the slot's login; unset them");
}
