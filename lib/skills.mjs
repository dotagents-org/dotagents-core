// The skills module: your skills (skills/ in this repository) and the registered third-party ones
// (skills/third-party-skills.json) behind one interface. Callers ask what exists, what a workspace has,
// and to apply or verify a set of skills; they never need to know where a skill comes from.
//
// In a workspace both kinds live in .agents/skills/:
// - own skills are links to this repository's skills/<name>;
// - third-party skills are folders installed by an installer adapter (npx skills add by
//   default), recorded in skills-lock.json.

import fs from "node:fs";
import path from "node:path";
import { backup, checkItem, ensureDirLink, lstat, realpath, report, samePath, sameTree, state, timestamp } from "./common.mjs";
import { loadCatalog, npxInstaller, parseSkill } from "./thirdparty.mjs";

// Every skill this repository knows: [{ name, kind: "own" | "third-party", source, description }].
export function listSkills(repo) {
  const dir = path.join(repo, "skills");
  const own = fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(path.join(dir, name, "SKILL.md")))
    .map((name) => ({
      name,
      kind: "own",
      source: path.join(dir, name),
      description: parseSkill(fs.readFileSync(path.join(dir, name, "SKILL.md"), "utf8")).description,
    }));
  const thirdParty = loadCatalog(repo)
    .filter((s) => !own.some((o) => o.name === s.name))
    .map((s) => ({ name: s.name, kind: "third-party", source: s.source, description: s.description ?? "" }));
  return [...own, ...thirdParty];
}

// Names → skills. Unknown names fail with the list of what is available.
export function resolveSkills(repo, names) {
  const all = listSkills(repo);
  const unknown = names.filter((n) => !all.some((s) => s.name === n));
  if (unknown.length) {
    throw new Error(
      `Unknown skill: ${unknown.join(", ")}. Available: ${all.map((s) => s.name).join(", ")}. ` +
        "Register a third-party one with: dotagents skills add <source>"
    );
  }
  return names.map((n) => all.find((s) => s.name === n));
}

const skillsDir = (ws) => path.join(ws, ".agents", "skills");

// Entries of skills-lock.json that sit at the top level instead of under "skills" (a hand edit
// that lost the wrapper). Both tools miss them until init rebuilds the lock.
const looseEntries = (data) => Object.keys(data ?? {}).filter((k) => k !== "skills" && typeof data[k]?.source === "string");

function lockNames(ws, { loose = false } = {}) {
  const file = path.join(ws, "skills-lock.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return [...Object.keys(data.skills ?? {}), ...(loose ? looseEntries(data) : [])];
  } catch {
    return undefined; // exists but unreadable
  }
}

// Names of the known skills already in the workspace, in whatever shape: own ones linked or
// copied, third-party ones installed (folder present and in the lock, even a lock that lost its
// "skills" key). The init questions start from this list.
export function skillsIn(repo, ws) {
  const locked = lockNames(ws, { loose: true }) ?? [];
  return listSkills(repo)
    .filter((s) => {
      const dir = path.join(skillsDir(ws), s.name);
      if (s.kind === "own") return Boolean(lstat(dir)?.isSymbolicLink()) || fs.existsSync(path.join(dir, "SKILL.md"));
      return locked.includes(s.name) && fs.existsSync(path.join(dir, "SKILL.md"));
    })
    .map((s) => s.name);
}

// A real folder where an own skill's link goes is an older copy of it. An identical copy just
// gives way to the link; a changed one moves to .agents/backups/<name>.bak-<date> first, so no
// local edit is lost. Returns true in a dry run, where the link isn't attempted.
function replaceCopy(ws, dest, source) {
  const st = lstat(dest);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return false;
  const same = sameTree(dest, source);
  if (state.dryRun) {
    report("would update", dest, same ? "a copy of the skill: becomes a link" : "a changed copy: kept in .agents/backups, then a link");
    return true;
  }
  if (same) {
    fs.rmSync(dest, { recursive: true });
    return false;
  }
  const kept = path.join(ws, ".agents", "backups", `${path.basename(dest)}.bak-${timestamp()}`);
  fs.mkdirSync(path.dirname(kept), { recursive: true });
  fs.renameSync(dest, kept);
  report("moved", kept, "a changed copy of the skill, kept before linking");
  return false;
}

// npx skills keeps its entries under "skills". A lock whose entries sit at the top level (a hand
// edit that lost the wrapper) is rebuilt, with a backup, so both tools see those skills again.
function repairLock(ws) {
  const file = path.join(ws, "skills-lock.json");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return; // missing, or not JSON: verifySkills reports the latter
  }
  if (!data || typeof data !== "object" || data.skills) return;
  const loose = looseEntries(data);
  if (!loose.length) return;
  const detail = `moved ${loose.join(", ")} under "skills"`;
  if (state.dryRun) return report("would update", file, detail);
  const fixed = { ...Object.fromEntries(Object.entries(data).filter(([k]) => !loose.includes(k))), skills: Object.fromEntries(loose.map((k) => [k, data[k]])) };
  const kept = backup(file);
  fs.writeFileSync(file, `${JSON.stringify(fixed, null, 2)}\n`);
  report("updated", file, `${detail}; backup: ${kept}`);
}

// Puts the skills in the workspace. The .claude/skills link comes before any installation, so
// the installer finds it in place instead of creating a real .claude/skills folder.
export async function applySkills(ws, skills, { installer = npxInstaller } = {}) {
  repairLock(ws);
  for (const skill of skills.filter((s) => s.kind === "own")) {
    const dest = path.join(skillsDir(ws), skill.name);
    if (replaceCopy(ws, dest, skill.source)) continue;
    ensureDirLink(dest, skill.source);
  }
  if (skills.length || fs.existsSync(skillsDir(ws))) {
    if (!state.dryRun) fs.mkdirSync(skillsDir(ws), { recursive: true });
    ensureDirLink(path.join(ws, ".claude", "skills"), skillsDir(ws), { relative: true });
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
// copies) and not also in the lock, and every locked skill is installed.
export function verifySkills(repo, ws) {
  const own = listSkills(repo).filter((s) => s.kind === "own");
  const lock = lockNames(ws);
  if (lock === undefined) checkItem(false, "skills-lock.json is valid JSON");
  const loose = (lockNames(ws, { loose: true }) ?? []).filter((n) => !(lock ?? []).includes(n));
  if (loose.length) checkItem(false, "skills-lock.json keeps its entries under \"skills\"", `${loose.join(", ")} outside it; fix with: dotagents init "${ws}"`);

  const link = path.join(ws, ".claude", "skills");
  const st = lstat(link);
  if (st) {
    const ok = st.isSymbolicLink() && samePath(realpath(link) ?? "", realpath(skillsDir(ws)) ?? "?");
    checkItem(ok, ".claude/skills links to .agents/skills", st.isSymbolicLink() ? "points elsewhere or is broken" : "a copied folder, not a link");
  }

  const dir = skillsDir(ws);
  for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
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

    const mine = own.find((s) => s.name === entry);
    if (mine) {
      const linked = lstat(folder).isSymbolicLink();
      checkItem(linked, `${label} is a link to the dotagents repository`, `a copy; relink with: dotagents init "${ws}" --skills ${entry}`);
      const target = realpath(folder);
      const expected = realpath(mine.source);
      if (linked && target && expected && !samePath(target, expected)) checkItem(true, `${label} points to another clone (${target})`);
      if (lock?.includes(entry)) checkItem(false, `${label} is not also in skills-lock.json`, "same name as a skill in the dotagents repository");
    }
  }

  for (const name of lock ?? []) {
    checkItem(fs.existsSync(path.join(dir, name, "SKILL.md")), `skills-lock.json: ${name} is installed`, "listed in the lock but missing; run: npx skills experimental_install");
  }
}
