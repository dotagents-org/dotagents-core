// The workspace module: the .agents/ and .artifacts/ standards as one list of items, each with
// how to apply it and how to verify it, side by side. `init`, `new` and `update --all` apply the
// list; `check` verifies it. A new rule of the standard is one more item here, never two edits
// in two places.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  checkItem,
  checkWarn,
  createFromTemplate,
  ensureDir,
  ensureDirLink,
  ensureJsonKey,
  lstat,
  realpath,
  samePath,
  section,
  toSlash,
  writeGenerated,
} from "./common.mjs";
import { ensureExcluded, gitRepoOf, isRepoRoot, trackedAgentFiles, untrackedAgentFiles } from "./git.mjs";
import { applySkills, verifySkills } from "./skills.mjs";

// Relative to the workspace root, with forward slashes (Claude Code ignores backslashes on
// Linux, macOS and WSL).
const PLANS_DIR = ".artifacts/plans";
const FIXED_ARTIFACTS = ["session-archives", "plans"];

export function assertWorkspace(repo, ws) {
  if (!fs.existsSync(ws)) throw new Error(`Workspace not found: ${ws}`);
  const fromRepo = path.relative(repo, ws);
  // Inside the repository: same folder, or a relative path that doesn't climb out. On Windows a
  // different drive gives an absolute path, which is outside.
  if (fromRepo === "" || (!fromRepo.startsWith("..") && !path.isAbsolute(fromRepo))) {
    throw new Error("The workspace can't be the dotagents repository itself.");
  }
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

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

const pointerReadme = (repo, folder, standard) =>
  `# The \`${folder}/\` folder\n\nThis workspace follows the standard in \`${toSlash(repo)}/standards/${standard}\` (repository \`gabrieldulolmarques/dotagents\`).\n`;

// ── The standard ─────────────────────────────────────────────────────────────────────────────
// Order matters for apply: git exclusion first (so nothing created later shows up in the
// project's git status), skills before .claude/ (the skills link comes with the skills).
// ctx: { repo, ws, skills (resolved), installer }.

const STANDARD = [
  {
    title: "Git",
    apply: ({ ws }) => ensureExcluded(ws),
    verify({ ws }) {
      // Recommended layout: agent files at a root that is not a repository.
      const inside = gitRepoOf(ws);
      if (!inside) return;
      checkWarn(
        isRepoRoot(ws, inside.top) ? "the workspace root is itself a git repository" : "the workspace is inside a git repository",
        "recommended: agent files at a root outside git and the repository in a subfolder (dotagents new <git-url>). Meanwhile they are kept out through .git/info/exclude"
      );
      // The agent configuration never goes into the projects' git history.
      const tracked = trackedAgentFiles(ws);
      checkItem(!tracked.length, "no agent file is tracked by git", `tracked: ${tracked.join(", ")}; untrack with: git rm -r --cached <path>`);
      const visible = untrackedAgentFiles(ws);
      checkItem(!visible.length, "agent files are excluded from git", `git would add: ${visible.join(", ")}; fix with: dotagents init "${ws}"`);
    },
  },
  {
    title: "Root files",
    apply({ repo, ws }) {
      const templates = path.join(repo, "templates", "workspace");
      createFromTemplate(path.join(templates, "AGENTS.md"), path.join(ws, "AGENTS.md"), { NAME: workspaceName(ws), REPOS: reposList(ws) });
      createFromTemplate(path.join(templates, "INDEX.md"), path.join(ws, "INDEX.md"));
      writeGenerated(path.join(ws, "CLAUDE.md"), "@AGENTS.md\n", { skipNote: "already exists; check that it starts with @AGENTS.md" });
    },
    verify({ ws }) {
      const agentsMd = read(path.join(ws, "AGENTS.md"));
      checkItem(agentsMd !== null, "AGENTS.md exists");
      if (agentsMd !== null) {
        const kb = Buffer.byteLength(agentsMd) / 1024;
        checkItem(kb <= 8, "AGENTS.md at most ~8 KB", `${kb.toFixed(1)} KB`);
      }
      for (const r of childRepos(ws)) {
        checkItem((agentsMd ?? "").includes(r.name), `AGENTS.md mentions the repository ${r.name}/`, "list it under Repositories, so the agents know where the code is");
      }
      const claudeMd = read(path.join(ws, "CLAUDE.md"));
      if (claudeMd === null) return checkItem(false, "CLAUDE.md exists");
      const first = claudeMd.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("<!--")) ?? "";
      checkItem(first.trim() === "@AGENTS.md", "CLAUDE.md starts with @AGENTS.md", `first line: ${first}`);
    },
  },
  {
    title: ".agents/",
    async apply(ctx) {
      writeGenerated(path.join(ctx.ws, ".agents", "README.md"), pointerReadme(ctx.repo, ".agents", "agents.md"));
      await applySkills(ctx.ws, ctx.skills, { installer: ctx.installer });
    },
    verify({ repo, ws }) {
      for (const forbidden of [".agents/.agents", ".agents/commands", ".codex/skills"]) {
        checkItem(!lstat(path.join(ws, forbidden)), `${forbidden} doesn't exist`);
      }
      verifySkills(repo, ws);
      const agentsMd = read(path.join(ws, "AGENTS.md")) ?? "";
      const rulesDir = path.join(ws, ".agents", "rules");
      for (const rule of fs.existsSync(rulesDir) ? fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md")) : []) {
        checkItem(agentsMd.includes(rule), `.agents/rules/${rule} is linked from AGENTS.md`);
      }
    },
  },
  {
    title: ".claude/",
    apply({ ws }) {
      const rules = path.join(ws, ".agents", "rules");
      if (fs.existsSync(rules)) ensureDirLink(path.join(ws, ".claude", "rules"), rules, { relative: true });
      // Plan mode writes its plans into the workspace instead of ~/.claude/plans.
      ensureJsonKey(path.join(ws, ".claude", "settings.json"), "plansDirectory", PLANS_DIR);
    },
    verify({ ws }) {
      const link = path.join(ws, ".claude", "rules");
      const st = lstat(link);
      if (st) {
        const ok = st.isSymbolicLink() && samePath(realpath(link) ?? "", realpath(path.join(ws, ".agents", "rules")) ?? "?");
        checkItem(ok, ".claude/rules links to .agents/rules", st.isSymbolicLink() ? "points elsewhere or is broken" : "a copied folder, not a link");
      }
      let plansDirectory;
      try {
        plansDirectory = JSON.parse(fs.readFileSync(path.join(ws, ".claude", "settings.json"), "utf8")).plansDirectory;
      } catch {}
      checkItem(plansDirectory === PLANS_DIR, `.claude/settings.json sets plansDirectory to ${PLANS_DIR}`, plansDirectory ? `set to ${plansDirectory}` : "not set");
    },
  },
  {
    title: ".artifacts/",
    apply({ repo, ws }) {
      writeGenerated(path.join(ws, ".artifacts", "README.md"), pointerReadme(repo, ".artifacts", "artifacts.md"));
      for (const dir of FIXED_ARTIFACTS) ensureDir(path.join(ws, ".artifacts", dir));
    },
    verify({ ws }) {
      for (const dir of FIXED_ARTIFACTS) checkItem(fs.existsSync(path.join(ws, ".artifacts", dir)), `.artifacts/${dir} exists`);
    },
  },
];

// Applies the standard to a workspace with the given (resolved) skills. installer: the adapter
// for third-party skills (npx skills add unless a test passes a fake one).
export async function applyWorkspace(repo, ws, skills = [], { installer } = {}) {
  const ctx = { repo, ws, skills, installer };
  for (const item of STANDARD) {
    section(item.title);
    await item.apply(ctx);
  }
}

// Runs the checklist of every item of the standard.
export function verifyWorkspace(repo, ws) {
  section("Checklist");
  const ctx = { repo, ws };
  for (const item of STANDARD) item.verify(ctx);
}
