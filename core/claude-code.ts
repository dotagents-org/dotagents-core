// Where Claude Code reads its configuration, so no other module spells these paths out.
// The user level lives in a config folder: ~/.claude, or the folder CLAUDE_CONFIG_DIR names for
// another account. The project level lives in the workspace.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const defaultConfigDir = () => path.join(os.homedir(), ".claude");

// The files dotagents writes or links in a config folder.
export const userFiles = (configDir: string) => ({
  instructions: path.join(configDir, "CLAUDE.md"),
  rules: path.join(configDir, "rules"),
  settings: path.join(configDir, "settings.json"),
});

// The files Claude Code reads in a workspace, next to AGENTS.md.
export const projectFiles = (ws: string) => ({
  // When present, read instead of AGENTS.md unless it imports it.
  instructions: path.join(ws, "CLAUDE.md"),
  skills: path.join(ws, ".claude", "skills"),
  rules: path.join(ws, ".claude", "rules"),
  settings: path.join(ws, ".claude", "settings.json"),
});

// Claude Code's own state file for a config folder: ~/.claude.json for the default folder, and
// <folder>/.claude.json when CLAUDE_CONFIG_DIR names another one. home: whose home the folder is
// in, for the other side's folders.
export function stateFile(configDir: string, home = os.homedir()) {
  const isDefault = path.resolve(configDir) === path.resolve(path.join(home, ".claude"));
  return isDefault ? path.join(home, ".claude.json") : path.join(configDir, ".claude.json");
}

export type SignedIn = { accountUuid: string; email: string };

// The claude.ai account signed in to a config folder, or null. Reads only the account fields.
export function signedIn(configDir: string, home?: string): SignedIn | null {
  try {
    const account = JSON.parse(fs.readFileSync(stateFile(configDir, home), "utf8")).oauthAccount;
    if (typeof account?.accountUuid !== "string") return null;
    return { accountUuid: account.accountUuid, email: typeof account.emailAddress === "string" ? account.emailAddress : "" };
  } catch {
    return null;
  }
}

// Variables that sign Claude Code in by themselves, over the config folder's login.
export const CREDENTIAL_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_PROFILE",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

// How many of a config folder's running sessions are working and how many wait on the user. Claude
// Code keeps one sessions/<pid>.json per interactive session, with its status (busy, waiting,
// idle); the file outlives a session that crashed, so one counts only while its process runs (on
// Linux, the same process: the start time it recorded, procStart, still matches). Read only.
export type Activity = { working: number; waiting: number };

export type ProcessProbe = (pid: number, procStart?: string) => boolean;

export const runningProcess: ProcessProbe = (pid, procStart) => {
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (process.platform !== "linux" || !procStart) return true;
  try {
    // Field 22 of /proc/<pid>/stat, counted after the command name, which may hold spaces.
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] === procStart;
  } catch {
    return false;
  }
};

export function sessionActivity(configDir: string, running: ProcessProbe = runningProcess): Activity {
  const activity = { working: 0, waiting: 0 };
  let names: string[];
  try {
    names = fs.readdirSync(path.join(configDir, "sessions")).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return activity;
  }
  for (const name of names.slice(0, 256)) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(configDir, "sessions", name), "utf8"));
      if (s?.status !== "busy" && s?.status !== "waiting") continue;
      if (typeof s.pid !== "number" || !running(s.pid, typeof s.procStart === "string" ? s.procStart : undefined)) continue;
      if (s.status === "busy") activity.working++;
      else activity.waiting++;
    } catch {
      // Being rewritten, or not one: skipped.
    }
  }
  return activity;
}
