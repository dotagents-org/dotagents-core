// Where Claude Code reads its configuration, so no other module spells these paths out.
// The user level lives in a config folder: ~/.claude, or the folder CLAUDE_CONFIG_DIR names for
// another account. The project level lives in the workspace.

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
