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
// <folder>/.claude.json when CLAUDE_CONFIG_DIR names another one.
export function stateFile(configDir: string) {
  const isDefault = path.resolve(configDir) === path.resolve(defaultConfigDir());
  return isDefault ? path.join(os.homedir(), ".claude.json") : path.join(configDir, ".claude.json");
}

export type SignedIn = { accountUuid: string; email: string };

// The claude.ai account signed in to a config folder, or null. Reads only the account fields.
export function signedIn(configDir: string): SignedIn | null {
  try {
    const account = JSON.parse(fs.readFileSync(stateFile(configDir), "utf8")).oauthAccount;
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
