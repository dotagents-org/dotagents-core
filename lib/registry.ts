// Workspaces tracked since `dotagents init` (until `dotagents untrack`), so `dotagents update --all`
// can reach all of them.
// Kept per machine, outside the repository: ~/.config/dotagents/workspaces.json
// (or $DOTAGENTS_STATE_DIR/workspaces.json).

import fs from "node:fs";
import path from "node:path";
import { samePath, state } from "./common.ts";
import { configHome } from "./global.ts";

const file = () => path.join(process.env.DOTAGENTS_STATE_DIR || path.join(configHome(), "dotagents"), "workspaces.json");

export type TrackedWorkspace = { path: string; skills: string[] };

export function loadWorkspaces(): TrackedWorkspace[] {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")).workspaces ?? [];
  } catch {
    return [];
  }
}

function save(workspaces: TrackedWorkspace[]) {
  if (state.dryRun) return;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), `${JSON.stringify({ version: 1, workspaces }, null, 2)}\n`);
}

// Adds the workspace, or merges the new skills into its entry.
export function registerWorkspace(ws: string, skills: string[]) {
  const all = loadWorkspaces();
  const entry = all.find((w) => samePath(w.path, ws));
  if (entry) entry.skills = [...new Set([...entry.skills, ...skills])].sort();
  else all.push({ path: ws, skills: [...new Set(skills)].sort() });
  save(all);
}

export function untrackWorkspace(ws: string) {
  const all = loadWorkspaces();
  const kept = all.filter((w) => !samePath(w.path, ws));
  save(kept);
  return kept.length < all.length;
}

export const registryFile = file;
