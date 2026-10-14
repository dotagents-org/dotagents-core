// List of workspaces set up with `agents init`, so `agents update --all` can reach all of them.
// Kept per machine, outside the repository: ~/.config/agents/workspaces.json
// (or $AGENTS_STATE_DIR/workspaces.json).

import fs from "node:fs";
import path from "node:path";
import { samePath, state } from "./common.mjs";
import { configHome } from "./global.mjs";

const file = () => path.join(process.env.AGENTS_STATE_DIR || path.join(configHome(), "agents"), "workspaces.json");

export function loadWorkspaces() {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")).workspaces ?? [];
  } catch {
    return [];
  }
}

function save(workspaces) {
  if (state.dryRun) return;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), `${JSON.stringify({ version: 1, workspaces }, null, 2)}\n`);
}

// Adds the workspace, or merges the new skills into its entry.
export function registerWorkspace(ws, skills) {
  const all = loadWorkspaces();
  const entry = all.find((w) => samePath(w.path, ws));
  if (entry) entry.skills = [...new Set([...entry.skills, ...skills])].sort();
  else all.push({ path: ws, skills: [...new Set(skills)].sort() });
  save(all);
}

export function forgetWorkspace(ws) {
  const all = loadWorkspaces();
  const kept = all.filter((w) => !samePath(w.path, ws));
  save(kept);
  return kept.length < all.length;
}

export const registryFile = file;
