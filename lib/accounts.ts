// The Claude accounts of this machine. Each one is a Claude Code config folder with its own
// sign-in: the default account uses ~/.claude, the others ~/.claude-<name>, picked through
// CLAUDE_CONFIG_DIR. For each account dotagents applies the same configuration as `install`
// and writes a launcher, claude-<name>, that runs Claude Code in that folder.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CREDENTIAL_VARIABLES, defaultConfigDir, signedIn } from "./claude-code.ts";
import { ensureDir, isWindows, lstat, realpath, removeGenerated, samePath, writeGenerated } from "./common.ts";
import { installGlobal } from "./global.ts";
import { type Account, accountsFile, loadAccounts, removeAccount, saveAccount } from "./machine-state.ts";
import { checkItem, checkWarn, displayPath, report, section } from "./output.ts";
import { state } from "./state.ts";

// The colors given to accounts in the order they are added, unless --color picks one.
export const PALETTE = ["#D77655", "#376B80"];

const SAFE_ACCOUNT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

// ~/.local/bin is on the PATH of most Linux setups, and has to be added on Windows and macOS.
export const launcherDir = () => path.join(os.homedir(), ".local", "bin");
export const launcherFile = (name: string) => path.join(launcherDir(), isWindows ? `claude-${name}.cmd` : `claude-${name}`);

// The launcher clears the variables that would sign in over the folder's login, then points
// Claude Code at the folder. The default account clears CLAUDE_CONFIG_DIR instead of naming
// ~/.claude: Claude Code keeps the default folder's state in ~/.claude.json only when the
// variable is unset.
function launcher(account: Account) {
  if (isWindows) {
    return [
      "@echo off",
      `rem Claude Code as the ${account.name} account.`,
      "setlocal",
      ...CREDENTIAL_VARIABLES.map((v) => `set ${v}=`),
      account.default ? "set CLAUDE_CONFIG_DIR=" : `set "CLAUDE_CONFIG_DIR=${account.configDir}"`,
      "claude %*",
      "",
    ].join("\r\n");
  }
  return [
    "#!/bin/sh",
    `# Claude Code as the ${account.name} account.`,
    `unset ${CREDENTIAL_VARIABLES.join(" ")}`,
    account.default ? "unset CLAUDE_CONFIG_DIR" : `export CLAUDE_CONFIG_DIR='${account.configDir}'`,
    'exec claude "$@"',
    "",
  ].join("\n");
}

function applyAccount(repo: string, account: Account) {
  section(`Account ${account.name}`);
  ensureDir(account.configDir);
  installGlobal(repo, account.configDir);
  section("Launcher");
  writeGenerated(launcherFile(account.name), launcher(account), { comment: isWindows ? "rem" : "#", executable: true, onForeign: "backup" });
}

// Adds an account, or brings one up to date: its folder, the configuration and the launcher.
export function setUpAccount(repo: string, { name, isDefault = false, color }: { name: string; isDefault?: boolean; color?: string }) {
  if (!SAFE_ACCOUNT.test(name)) throw new Error(`'${name}' is not a valid account name: use lowercase letters, digits and dashes`);
  if (color !== undefined && !HEX.test(color)) throw new Error(`'${color}' is not a color: use #RRGGBB`);
  const all = loadAccounts();
  const prior = all.find((a) => a.name === name);
  const isDefaultNow = isDefault || Boolean(prior?.default);
  const otherDefault = all.find((a) => a.default && a.name !== name);
  // The default account owns ~/.claude; moving it to another account means moving folders.
  if (isDefault && otherDefault) throw new Error(`${otherDefault.name} is already the default account, in ${otherDefault.configDir}`);
  const account: Account = {
    name,
    configDir: prior?.configDir ?? (isDefaultNow ? defaultConfigDir() : path.join(os.homedir(), `.claude-${name}`)),
    color: color ?? prior?.color ?? PALETTE[all.filter((a) => a.name !== name).length % PALETTE.length],
    ...(isDefaultNow ? { default: true } : {}),
  };
  applyAccount(repo, account);
  section("Accounts");
  const same = prior && JSON.stringify(prior) === JSON.stringify(account);
  if (same) report("ok", accountsFile(), `${name}: ${account.configDir}`);
  else {
    report(state.dryRun ? (prior ? "would update" : "would create") : prior ? "updated" : "created", accountsFile(), `${name}: ${account.configDir}`);
    saveAccount(account);
  }
}

// Forgets an account: its record and its launcher. The folder, with the sign-in and the
// history, stays where it is.
export function dropAccount(name: string) {
  if (!loadAccounts().some((a) => a.name === name)) throw new Error(`There is no account named ${name}`);
  section("Launcher");
  removeGenerated(launcherFile(name));
  section("Accounts");
  report(state.dryRun ? "would update" : "updated", accountsFile(), `removed ${name}; its folder was kept`);
  removeAccount(name);
}

// The folder as Claude Code sees it, plus where it really is when it is a link or a junction
// ("~/.claude → ~/.claude-work"). Only a link counts: a resolved path can also differ by a
// Windows short name (RUNNER~1), which is the same folder.
export function showFolder(configDir: string) {
  const real = lstat(configDir)?.isSymbolicLink() ? realpath(configDir) : null;
  return real ? `${displayPath(configDir)} → ${displayPath(real)}` : displayPath(configDir);
}

// What `install` applies: the default folder, and every account of this machine.
export function installAccounts(repo: string) {
  const accounts = loadAccounts();
  if (!accounts.some((a) => samePath(a.configDir, defaultConfigDir()))) installGlobal(repo);
  for (const account of accounts) applyAccount(repo, account);
}

// The accounts' checklist: folders and launchers in place, one claude.ai account per folder, and
// no variable that would sign every folder in as someone else.
export function verifyAccounts() {
  section("Accounts");
  const seen = new Map<string, string>();
  for (const account of loadAccounts()) {
    checkItem(fs.existsSync(account.configDir), `${account.name}: ${showFolder(account.configDir)} exists`, `create it with: dotagents account add ${account.name}`);
    checkItem(fs.existsSync(launcherFile(account.name)), `${account.name}: launcher ${path.basename(launcherFile(account.name))} exists`, `write it with: dotagents install`);
    const who = signedIn(account.configDir);
    if (!who) {
      checkWarn(`${account.name} is not signed in`, `sign in with: claude-${account.name} auth login`);
      continue;
    }
    const twin = seen.get(who.accountUuid);
    checkItem(!twin, `${account.name} is a different claude.ai account`, `${account.name} and ${twin} are signed in to the same account; sign one of them in again`);
    seen.set(who.accountUuid, account.name);
  }
  const exported = CREDENTIAL_VARIABLES.filter((v) => process.env[v]);
  if (exported.length) checkWarn(`${exported.join(", ")} set in this shell`, "they sign Claude Code in over the account folders; the launchers clear them");
}
