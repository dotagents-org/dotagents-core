// The skills module: your skills (config/skills/) and the registered third-party ones
// (config/skills/third-party-skills.json) behind one interface. Callers ask what exists, what a workspace has,
// and to apply or verify a set of skills; they never need to know where a skill comes from.
//
// In a workspace both kinds live in .agents/skills/:
// - own skills are links to config/skills/<name>;
// - third-party skills are folders installed by an installer adapter (npx skills add by
//   default), recorded in skills-lock.json.

import fs from "node:fs";
import path from "node:path";
import { projectFiles } from "./claude-code.ts";
import { configRoot, ensureDirLink, lstat, realpath, samePath } from "./common.ts";
import { checkItem, checkWarn, report } from "./output.ts";
import { state } from "./state.ts";
import { findRequires, loadCatalog, npxInstaller, parseSkill, type Installer } from "./thirdparty.ts";

// requires: the skills it calls, which a workspace needs next to it (findRequires).
export type Skill = { name: string; kind: "own" | "third-party"; source: string; description: string; requires: string[] };

// Every skill this repository knows: [{ name, kind: "own" | "third-party", source, description, requires }].
// An own skill's calls are read from its folder; a third-party one's, from the catalog.
export function listSkills(repo: string): Skill[] {
  const dir = path.join(configRoot(repo), "skills");
  const catalog = loadCatalog(repo);
  const ownNames = fs.readdirSync(dir).filter((name) => fs.existsSync(path.join(dir, name, "SKILL.md")));
  const known = [...ownNames, ...catalog.map((s) => s.name)];
  const own = ownNames.map((name): Skill => ({
    name,
    kind: "own",
    source: path.join(dir, name),
    description: parseSkill(fs.readFileSync(path.join(dir, name, "SKILL.md"), "utf8")).description,
    requires: findRequires(path.join(dir, name), known, name),
  }));
  const thirdParty = catalog
    .filter((s) => !ownNames.includes(s.name))
    .map((s): Skill => ({ name: s.name, kind: "third-party", source: s.source, description: s.description ?? "", requires: s.requires ?? [] }));
  return [...own, ...thirdParty];
}

// Names → skills, followed by every skill they call, and the ones those call (a router such as
// pixijs brings its whole family). Unknown names fail with the list of what is available.
export function resolveSkills(repo: string, names: string[]): Skill[] {
  const all = listSkills(repo);
  const unknown = names.filter((n) => !all.some((s) => s.name === n));
  if (unknown.length) {
    throw new Error(
      `Unknown skill: ${unknown.join(", ")}. Available: ${all.map((s) => s.name).join(", ")}. ` +
        "Register a third-party one with: dotagents skills add <source>"
    );
  }
  const byName = new Map(all.map((s) => [s.name, s]));
  const result: Skill[] = [];
  const visit = (name: string) => {
    const skill = byName.get(name);
    if (!skill || result.includes(skill)) return; // a call to a skill since unregistered is dropped
    result.push(skill);
    skill.requires.forEach(visit);
  };
  names.forEach(visit);
  // The names asked for first, in their order; then what came in through calls.
  return [...names.map((n) => byName.get(n)!), ...result.filter((s) => !names.includes(s.name))];
}

// The skills in resolved that came in because another one calls them, each with its callers.
export function addedByCalls(resolved: Skill[], names: string[]) {
  return resolved
    .filter((s) => !names.includes(s.name))
    .map((s) => ({ name: s.name, calledBy: resolved.filter((r) => r.requires.includes(s.name)).map((r) => r.name) }));
}

const skillsDir = (ws: string) => path.join(ws, ".agents", "skills");

function lockNames(ws: string): string[] | null | undefined {
  const file = path.join(ws, "skills-lock.json");
  if (!fs.existsSync(file)) return null;
  try {
    return Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).skills ?? {});
  } catch {
    return undefined; // exists but unreadable
  }
}

// Names of the known skills already in the workspace: own ones linked, third-party ones installed
// (folder present and in the lock). The init questions start from this list.
export function skillsIn(repo: string, ws: string) {
  const locked = lockNames(ws) ?? [];
  return listSkills(repo)
    .filter((s) => {
      const dir = path.join(skillsDir(ws), s.name);
      if (s.kind === "own") return Boolean(lstat(dir)?.isSymbolicLink());
      return locked.includes(s.name) && fs.existsSync(path.join(dir, "SKILL.md"));
    })
    .map((s) => s.name);
}

// Puts the skills in the workspace. The .claude/skills link comes before any installation, so
// the installer finds it in place instead of creating a real .claude/skills folder.
export async function applySkills(ws: string, skills: Skill[], { installer = npxInstaller }: { installer?: Installer } = {}) {
  for (const skill of skills.filter((s) => s.kind === "own")) {
    ensureDirLink(path.join(skillsDir(ws), skill.name), skill.source);
  }
  if (skills.length || fs.existsSync(skillsDir(ws))) {
    if (!state.dryRun) fs.mkdirSync(skillsDir(ws), { recursive: true });
    ensureDirLink(projectFiles(ws).skills, skillsDir(ws), { relative: true });
  }

  const installed = lockNames(ws) ?? [];
  for (const skill of skills.filter((s) => s.kind === "third-party")) {
    const dest = path.join(skillsDir(ws), skill.name);
    if (installed.includes(skill.name) && fs.existsSync(path.join(dest, "SKILL.md"))) {
      report("ok", dest, `from ${skill.source}`);
    } else if (lstat(dest)) {
      report("skipped", dest, "a folder with this name already exists; remove it to install the third-party skill");
    } else if (state.dryRun) {
      report("would create", dest, `npx skills add ${skill.source} -s ${skill.name}`);
    } else {
      const { ok, detail } = await installer(ws, skill);
      report(ok ? "created" : "failed", dest, detail);
    }
  }
}

// Checklist of the workspace's skills: every folder is a valid skill, own skills are links (not
// copies) and not also in the lock, every locked skill is installed, and a warning for each skill
// another one calls that isn't in the workspace.
export function verifySkills(repo: string, ws: string) {
  const all = listSkills(repo);
  const own = all.filter((s) => s.kind === "own");
  const lock = lockNames(ws);
  if (lock === undefined) checkItem(false, "skills-lock.json is valid JSON");

  const link = projectFiles(ws).skills;
  const st = lstat(link);
  if (st) {
    const ok = st.isSymbolicLink() && samePath(realpath(link) ?? "", realpath(skillsDir(ws)) ?? "?");
    checkItem(ok, ".claude/skills links to .agents/skills", st.isSymbolicLink() ? "points elsewhere or is broken" : "a copied folder, not a link");
  }

  const dir = skillsDir(ws);
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const known = [...new Set([...all.map((s) => s.name), ...entries])];
  const calls: { label: string; requires: string[] }[] = [];
  for (const entry of entries) {
    const label = `.agents/skills/${entry}`;
    const folder = path.join(dir, entry);
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      checkItem(false, `${label} is a skill folder`, lstat(folder)?.isSymbolicLink() ? "broken link" : "loose file in skills/");
      continue;
    }
    const skillMd = path.join(folder, "SKILL.md");
    if (!fs.existsSync(skillMd)) {
      checkItem(false, `${label} has SKILL.md`);
      continue;
    }
    const text = fs.readFileSync(skillMd, "utf8");
    const { name } = parseSkill(text);
    checkItem(name === entry, `${label} name matches the folder`, `name: ${name}`);
    const lines = text.split(/\r?\n/).length;
    checkItem(lines < 500, `${label} under 500 lines`, `${lines} lines`);
    calls.push({ label, requires: findRequires(folder, known, entry) });

    const mine = own.find((s) => s.name === entry);
    if (mine) {
      const linked = Boolean(lstat(folder)?.isSymbolicLink());
      checkItem(linked, `${label} is a link to the dotagents repository`, `a copy; delete it and run: dotagents init "${ws}" --skills ${entry}`);
      const target = realpath(folder);
      const expected = realpath(mine.source);
      if (linked && target && expected && !samePath(target, expected)) checkItem(true, `${label} points to another clone (${target})`);
      if (lock?.includes(entry)) checkItem(false, `${label} is not also in skills-lock.json`, "same name as a skill in the dotagents repository");
    }
  }

  for (const name of lock ?? []) {
    checkItem(fs.existsSync(path.join(dir, name, "SKILL.md")), `skills-lock.json: ${name} is installed`, "listed in the lock but missing; run: npx skills experimental_install");
  }

  // Read from the installed folders, so a third-party skill is judged by the version in place.
  // Only known names are found, so the missing one can always be added by init.
  for (const { label, requires } of calls) {
    for (const name of requires.filter((n) => !fs.existsSync(path.join(dir, n, "SKILL.md")))) {
      checkWarn(`${label} calls ${name}, which isn't in this workspace`, `add it: dotagents init "${ws}" --skills ${name}`);
    }
  }
}
