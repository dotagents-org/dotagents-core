// What dotagents remembers about this machine, outside the repository. Kept in
// ~/.config/dotagents/ (or $DOTAGENTS_STATE_DIR):
// - workspaces.json: the workspaces tracked since `dotagents init` (until `dotagents untrack`),
//   so `dotagents update --all` can reach all of them;
// - profiles.json: the Claude profiles of this machine, each with its config folder (accounts.json
//   before 2.0.0, read and moved by the first write);
// - copies.json: what install last copied to each settings copy (Windows), so it can tell a change
//   made in the repository from one made in the profile.
//
// Every file carries a format version and is checked when read. A file that is not valid, or that
// a newer dotagents wrote, stops the command instead of being read as empty and overwritten.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { samePath } from "./common.ts";
import { state } from "./state.ts";

export const stateDir = () =>
  process.env.DOTAGENTS_STATE_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "dotagents");

export type TrackedWorkspace = { path: string; skills: string[] };

const WORKSPACES = { name: "workspaces.json", version: 1 };

export const workspacesFile = () => path.join(stateDir(), WORKSPACES.name);

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

const isWorkspace = (v: unknown): v is TrackedWorkspace =>
  typeof v === "object" && v !== null && typeof (v as TrackedWorkspace).path === "string" && isStringList((v as TrackedWorkspace).skills);

// The body of a state file, checked: null when the file doesn't exist yet.
function readStateFile(file: string, version: number): Record<string, unknown> | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON; fix it or delete it`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`${file} is not a dotagents state file; fix it or delete it`);
  const found = (data as { version?: unknown }).version;
  if (typeof found === "number" && found > version) throw new Error(`${file} was written by a newer dotagents (format ${found}); update this clone with: dotagents update`);
  return data as Record<string, unknown>;
}

function writeStateFile(file: string, version: number, body: Record<string, unknown>) {
  if (state.dryRun) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version, ...body }, null, 2)}\n`);
}

export type Profile = { name: string; configDir: string; color: string; default?: boolean };

const PROFILES = { name: "profiles.json", version: 1 };

export const profilesFile = () => path.join(stateDir(), PROFILES.name);

const isProfile = (v: unknown): v is Profile => {
  const a = v as Profile;
  return typeof v === "object" && v !== null && typeof a.name === "string" && typeof a.configDir === "string" && typeof a.color === "string" && (a.default === undefined || typeof a.default === "boolean");
};

// Before 2.0.0 the profiles were "accounts", in accounts.json.
const legacyProfilesFile = () => path.join(stateDir(), "accounts.json");

export function loadProfiles(): Profile[] {
  let file = profilesFile();
  let key = "profiles";
  if (!fs.existsSync(file) && fs.existsSync(legacyProfilesFile())) [file, key] = [legacyProfilesFile(), "accounts"];
  const data = readStateFile(file, PROFILES.version);
  const list = data?.[key] ?? [];
  if (!Array.isArray(list) || !list.every(isProfile)) throw new Error(`${file} has an invalid profile list; fix it or delete it`);
  return list;
}

// Writes the profiles, and drops the accounts.json they may have come from.
function writeProfiles(profiles: Profile[]) {
  writeStateFile(profilesFile(), PROFILES.version, { profiles });
  if (!state.dryRun) fs.rmSync(legacyProfilesFile(), { force: true });
}

// Moves accounts.json to profiles.json; true when there was one to move (or would be, in a dry run).
export function migrateLegacyProfiles() {
  if (fs.existsSync(profilesFile()) || !fs.existsSync(legacyProfilesFile())) return false;
  writeProfiles(loadProfiles());
  return true;
}

// Adds the profile or replaces the one with the same name. Only one profile is the default.
export function saveProfile(profile: Profile) {
  const all = loadProfiles();
  if (profile.default) for (const a of all) delete a.default;
  const i = all.findIndex((a) => a.name === profile.name);
  const entry = { ...profile };
  if (!entry.default) delete entry.default;
  if (i >= 0) all[i] = entry;
  else all.push(entry);
  writeProfiles(all);
}

export function removeProfile(name: string) {
  const all = loadProfiles();
  const kept = all.filter((a) => a.name !== name);
  writeProfiles(kept);
  return kept.length < all.length;
}

export function loadWorkspaces(): TrackedWorkspace[] {
  const data = readStateFile(workspacesFile(), WORKSPACES.version);
  const list = data?.workspaces ?? [];
  if (!Array.isArray(list) || !list.every(isWorkspace)) throw new Error(`${workspacesFile()} has an invalid workspace list; fix it or delete it`);
  return list;
}

// Adds the workspace, or merges the new skills into its entry.
export function registerWorkspace(ws: string, skills: string[]) {
  const all = loadWorkspaces();
  const entry = all.find((w) => samePath(w.path, ws));
  if (entry) entry.skills = [...new Set([...entry.skills, ...skills])].sort();
  else all.push({ path: ws, skills: [...new Set(skills)].sort() });
  writeStateFile(workspacesFile(), WORKSPACES.version, { workspaces: all });
}

export function untrackWorkspace(ws: string) {
  const all = loadWorkspaces();
  const kept = all.filter((w) => !samePath(w.path, ws));
  writeStateFile(workspacesFile(), WORKSPACES.version, { workspaces: kept });
  return kept.length < all.length;
}

const COPIES = { name: "copies.json", version: 1 };

export const copiesFile = () => path.join(stateDir(), COPIES.name);

// Destination path → digest of the text install last copied there.
export function loadCopies(): Record<string, string> {
  const data = readStateFile(copiesFile(), COPIES.version);
  const copies = data?.copies ?? {};
  if (typeof copies !== "object" || copies === null || Array.isArray(copies) || !Object.values(copies).every((v) => typeof v === "string"))
    throw new Error(`${copiesFile()} has an invalid copy list; fix it or delete it`);
  return copies as Record<string, string>;
}

export function recordCopy(dest: string, digest: string) {
  const copies = loadCopies();
  const key = path.resolve(dest);
  if (copies[key] === digest) return;
  copies[key] = digest;
  writeStateFile(copiesFile(), COPIES.version, { copies });
}
