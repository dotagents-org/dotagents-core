// `agents init` and `agents check`: apply the .agents/ and .artifacts/ standards to a workspace,
// or check that it follows them.

import fs from "node:fs";
import path from "node:path";
import {
  createFromTemplate,
  ensureDir,
  ensureDirLink,
  lstat,
  report,
  samePath,
  section,
  toSlash,
  writeGenerated,
} from "./common.mjs";

export function repoSkills(repo) {
  return fs.readdirSync(path.join(repo, "skills")).filter((name) => fs.existsSync(path.join(repo, "skills", name, "SKILL.md")));
}

export function assertWorkspace(repo, ws) {
  if (!fs.existsSync(ws)) throw new Error(`Workspace not found: ${ws}`);
  const fromRepo = path.relative(repo, ws);
  // Inside the repository: same folder, or a relative path that doesn't climb out. On Windows a
  // different drive gives an absolute path, which is outside.
  if (fromRepo === "" || (!fromRepo.startsWith("..") && !path.isAbsolute(fromRepo))) {
    throw new Error("The workspace can't be the dotagents repository itself.");
  }
}

export function initWorkspace(repo, ws, skills) {
  const available = repoSkills(repo);
  for (const skill of skills) {
    if (!available.includes(skill)) {
      throw new Error(`Skill '${skill}' doesn't exist in ${path.join(repo, "skills")}. Available: ${available.join(", ")}`);
    }
  }
  const repoSlash = toSlash(repo);

  section("Root files");
  createFromTemplate(path.join(repo, "templates", "workspace", "AGENTS.md"), path.join(ws, "AGENTS.md"));
  createFromTemplate(path.join(repo, "templates", "workspace", "INDEX.md"), path.join(ws, "INDEX.md"));
  writeGenerated(path.join(ws, "CLAUDE.md"), "@AGENTS.md\n", { skipNote: "already exists; check that it starts with @AGENTS.md" });

  section(".agents/");
  writeGenerated(
    path.join(ws, ".agents", "README.md"),
    `# The \`.agents/\` folder\n\nThis workspace follows the standard in \`${repoSlash}/standards/agents.md\` (repository \`gabrieldulolmarques/dotagents\`).\n`
  );
  for (const skill of skills) {
    ensureDirLink(path.join(ws, ".agents", "skills", skill), path.join(repo, "skills", skill));
  }

  section(".claude/");
  for (const name of ["skills", "rules"]) {
    const source = path.join(ws, ".agents", name);
    const willExist = fs.existsSync(source) || (name === "skills" && skills.length > 0);
    if (willExist) ensureDirLink(path.join(ws, ".claude", name), source, { relative: true });
  }

  section(".artifacts/");
  writeGenerated(
    path.join(ws, ".artifacts", "README.md"),
    `# The \`.artifacts/\` folder\n\nThis workspace follows the standard in \`${repoSlash}/standards/artifacts.md\` (repository \`gabrieldulolmarques/dotagents\`).\n`
  );
  ensureDir(path.join(ws, ".artifacts", "session-archives"));
}

const realpath = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

function readLock(ws) {
  const file = path.join(ws, "skills-lock.json");
  if (!fs.existsSync(file)) return null;
  try {
    return Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).skills ?? {});
  } catch {
    return undefined; // exists but unreadable
  }
}

export function checkWorkspace(repo, ws) {
  section(`Checklist for ${ws}`);
  const item = (passed, text, detail = "") => report(passed ? "ok" : "failed", text, passed ? "" : detail);
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

  const agentsMd = read(path.join(ws, "AGENTS.md"));
  item(agentsMd !== null, "AGENTS.md exists");
  if (agentsMd !== null) {
    const kb = Buffer.byteLength(agentsMd) / 1024;
    item(kb <= 8, "AGENTS.md at most ~8 KB", `${kb.toFixed(1)} KB`);
  }

  const claudeMd = read(path.join(ws, "CLAUDE.md"));
  if (claudeMd === null) {
    item(false, "CLAUDE.md exists");
  } else {
    const first = claudeMd.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("<!--")) ?? "";
    item(first.trim() === "@AGENTS.md", "CLAUDE.md starts with @AGENTS.md", `first line: ${first}`);
  }

  for (const forbidden of [".agents/.agents", ".agents/commands", ".codex/skills"]) {
    item(!lstat(path.join(ws, forbidden)), `${forbidden} doesn't exist`);
  }

  for (const name of ["skills", "rules"]) {
    const link = path.join(ws, ".claude", name);
    const st = lstat(link);
    if (!st) continue;
    const target = realpath(link);
    const ok = st.isSymbolicLink() && target !== null && samePath(target, realpath(path.join(ws, ".agents", name)) ?? "");
    item(ok, `.claude/${name} links to .agents/${name}`, st.isSymbolicLink() ? "points elsewhere or is broken" : "a copied folder, not a link");
  }

  const ours = repoSkills(repo);
  const lock = readLock(ws);
  if (lock === undefined) item(false, "skills-lock.json is valid JSON");

  const skillsDir = path.join(ws, ".agents", "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir)) {
      const label = `.agents/skills/${entry}`;
      const dir = path.join(skillsDir, entry);
      const isDir = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
      if (!isDir) {
        item(false, `${label} is a skill folder`, lstat(dir)?.isSymbolicLink() ? "broken link" : "loose file in skills/");
        continue;
      }
      const skillMd = read(path.join(dir, "SKILL.md"));
      if (skillMd === null) {
        item(false, `${label} has SKILL.md`);
        continue;
      }
      const name = skillMd.match(/^name:\s*(.+)$/m)?.[1].trim();
      item(name === entry, `${label} name matches the folder`, `name: ${name}`);
      const lines = skillMd.split(/\r?\n/).length;
      item(lines < 500, `${label} under 500 lines`, `${lines} lines`);

      if (ours.includes(entry)) {
        // A skill from this repository must be a link, never a copy, and must not also be in the lock.
        const linked = lstat(dir).isSymbolicLink();
        const target = realpath(dir);
        const expected = realpath(path.join(repo, "skills", entry));
        item(linked, `${label} is a link to the dotagents repository`, `a copy; relink with: agents init "${ws}" --skills ${entry}`);
        if (linked && target && expected && !samePath(target, expected)) {
          report("ok", `${label} points to another clone`, target);
        }
        if (lock?.includes(entry)) item(false, `${label} is not also in skills-lock.json`, "same name as a skill in the dotagents repository");
      }
    }
  }

  for (const name of lock ?? []) {
    item(fs.existsSync(path.join(skillsDir, name, "SKILL.md")), `skills-lock.json: ${name} is installed`, "listed in the lock but missing; run: npx skills experimental_install");
  }

  const rulesDir = path.join(ws, ".agents", "rules");
  if (fs.existsSync(rulesDir)) {
    for (const rule of fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md"))) {
      item((agentsMd ?? "").includes(rule), `.agents/rules/${rule} is linked from AGENTS.md`);
    }
  }

  item(fs.existsSync(path.join(ws, ".artifacts", "session-archives")), ".artifacts/session-archives exists");
}
