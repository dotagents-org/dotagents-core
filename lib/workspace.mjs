// `dotagents init` and `dotagents check`: apply the .agents/ and .artifacts/ standards to a workspace,
// or check that it follows them.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  createFromTemplate,
  ensureDir,
  ensureDirLink,
  ensureJsonKey,
  lstat,
  checkItem,
  checkWarn,
  samePath,
  section,
  toSlash,
  writeGenerated,
} from "./common.mjs";
import { ensureExcluded, gitRepoOf, trackedAgentFiles, untrackedAgentFiles } from "./git.mjs";

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

  // First, so nothing created below ever shows up in the project's git status.
  section("Git");
  ensureExcluded(ws);

  section("Root files");
  createFromTemplate(path.join(repo, "templates", "workspace", "AGENTS.md"), path.join(ws, "AGENTS.md"), {
    NAME: workspaceName(ws),
    REPOS: reposList(ws),
  });
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
  // Plan mode writes its plans into the workspace instead of ~/.claude/plans.
  ensureJsonKey(path.join(ws, ".claude", "settings.json"), "plansDirectory", PLANS_DIR);

  section(".artifacts/");
  writeGenerated(
    path.join(ws, ".artifacts", "README.md"),
    `# The \`.artifacts/\` folder\n\nThis workspace follows the standard in \`${repoSlash}/standards/artifacts.md\` (repository \`gabrieldulolmarques/dotagents\`).\n`
  );
  ensureDir(path.join(ws, ".artifacts", "session-archives"));
  ensureDir(path.join(ws, ".artifacts", "plans"));
}

// Git repositories directly inside the workspace. The recommended layout keeps the agent files
// at a root that is not a repository, and each project repository in its own folder.
export function childRepos(ws) {
  if (!fs.existsSync(ws)) return [];
  return fs
    .readdirSync(ws, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && fs.existsSync(path.join(ws, e.name, ".git")))
    .map((e) => {
      const res = spawnSync("git", ["-C", path.join(ws, e.name), "remote", "get-url", "origin"], { encoding: "utf8" });
      return { name: e.name, remote: res.status === 0 ? res.stdout.trim() : "" };
    });
}

// "app-workspace" → "app".
export const workspaceName = (ws) => path.basename(ws).replace(/-workspace$/, "");

function reposList(ws) {
  const repos = childRepos(ws);
  if (!repos.length) return "<No repository yet. Clone one into this workspace with: dotagents new <git-url> .>";
  return repos.map((r) => `- \`${r.name}/\`${r.remote ? `: ${r.remote}` : ""}`).join("\n");
}

// Relative to the workspace root, with forward slashes (Claude Code ignores backslashes on
// Linux, macOS and WSL).
const PLANS_DIR = ".artifacts/plans";

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
  section("Checklist");
  const item = checkItem;

  // Recommended layout: agent files at a root that is not a repository.
  const inside = gitRepoOf(ws);
  if (inside) {
    checkWarn(
      samePath(inside.top, ws) ? "the workspace root is itself a git repository" : "the workspace is inside a git repository",
      "recommended: agent files at a root outside git and the repository in a subfolder (dotagents new <git-url>). Meanwhile they are kept out through .git/info/exclude"
    );
  }
  // The agent configuration never goes into the projects' git history.
  if (inside) {
    const tracked = trackedAgentFiles(ws);
    item(!tracked.length, "no agent file is tracked by git", `tracked: ${tracked.join(", ")}; untrack with: git rm -r --cached <path>`);
    const visible = untrackedAgentFiles(ws);
    item(!visible.length, "agent files are excluded from git", `git would add: ${visible.join(", ")}; fix with: dotagents init "${ws}"`);
  }
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

  const agentsMd = read(path.join(ws, "AGENTS.md"));
  item(agentsMd !== null, "AGENTS.md exists");
  for (const r of childRepos(ws)) {
    item((agentsMd ?? "").includes(r.name), `AGENTS.md mentions the repository ${r.name}/`, "list it under Repositories, so the agents know where the code is");
  }
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
        item(linked, `${label} is a link to the dotagents repository`, `a copy; relink with: dotagents init "${ws}" --skills ${entry}`);
        if (linked && target && expected && !samePath(target, expected)) {
          checkItem(true, `${label} points to another clone (${target})`);
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
  item(fs.existsSync(path.join(ws, ".artifacts", "plans")), ".artifacts/plans exists");
  let plansDirectory;
  try {
    plansDirectory = JSON.parse(fs.readFileSync(path.join(ws, ".claude", "settings.json"), "utf8")).plansDirectory;
  } catch {}
  item(plansDirectory === PLANS_DIR, `.claude/settings.json sets plansDirectory to ${PLANS_DIR}`, plansDirectory ? `set to ${plansDirectory}` : "not set");
}
