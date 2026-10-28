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
  report,
  samePath,
  section,
  state,
} from "./common.ts";
import { AGENT_FILES, ensureExcluded, gitRepoOf, isRepoRoot, removeExcluded, trackedAgentFiles, untrackedAgentFiles } from "./git.ts";
import { applySkills, verifySkills } from "./skills.ts";

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

// Turns a folder that is itself a git repository into the recommended layout: a new
// <name>-workspace/ next to it, with the repository moved inside. Agent files an earlier init
// left at the repository root (untracked, hidden by .git/info/exclude) move up to the
// workspace, and their exclude block goes away; files the project commits stay where they are.
// Returns the workspace path.
export function wrapRepository(dir, ws = `${dir}-workspace`) {
  const inside = gitRepoOf(dir);
  if (!inside || !isRepoRoot(dir, inside.top)) throw new Error(`${dir} is not the root of a git repository`);
  if (lstat(ws)) throw new Error(`${ws} already exists; pick another folder for the workspace`);
  const name = path.basename(dir);
  const tracked = trackedAgentFiles(dir);
  const moving = AGENT_FILES.map((f) => f.replace(/\/$/, "")).filter(
    (f) => lstat(path.join(dir, f)) && !tracked.some((t) => t === f || t.startsWith(`${f}/`))
  );

  section("Workspace");
  const repoAfter = path.join(ws, name);
  if (state.dryRun) {
    report("would move", repoAfter, `the repository, from ${dir}`);
    for (const f of moving) report("would move", path.join(ws, f), `out of ${name}/`);
    return ws;
  }
  fs.mkdirSync(ws);
  fs.renameSync(dir, repoAfter);
  report("moved", repoAfter, `the repository, from ${dir}`);
  for (const f of moving) {
    fs.renameSync(path.join(repoAfter, f), path.join(ws, f));
    report("moved", path.join(ws, f), `out of ${name}/`);
  }
  removeExcluded(repoAfter);
  const remote = childRepos(ws).find((r) => r.name === name)?.remote ?? "";
  listRepoInAgentsMd(ws, name, remote);
  return ws;
}

// Adds a repository to the "## Repositories" section of an existing AGENTS.md. Only that section
// is touched, and only when it exists; a new AGENTS.md gets the list from the template.
export function listRepoInAgentsMd(ws, name, url) {
  const file = path.join(ws, "AGENTS.md");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^## Repositories[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!match || match[1].includes(`\`${name}/\``)) return;
  const entry = `- \`${name}/\`${url ? `: ${url}` : ""}`;
  let body = match[1].replace(/^<No repository yet[^\n]*>\n?/m, "").replace(/\s*$/, "");
  body = `${body}\n${/^- `/m.test(body) ? "" : "\n"}${entry}\n\n`;
  fs.writeFileSync(file, text.replace(match[1], body));
  report("updated", file, `listed ${name}/ under Repositories`);
}

// "app-workspace" → "app".
export const workspaceName = (ws) => path.basename(ws).replace(/-workspace$/, "");

function reposList(ws) {
  const repos = childRepos(ws);
  if (!repos.length) return "<No repository yet. Clone one into this workspace with: dotagents new <git-url> .>";
  return repos.map((r) => `- \`${r.name}/\`${r.remote ? `: ${r.remote}` : ""}`).join("\n");
}

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

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
    },
    verify({ ws }) {
      const agentsMd = read(path.join(ws, "AGENTS.md"));
      checkItem(agentsMd !== null, "AGENTS.md exists");
      for (const r of childRepos(ws)) {
        checkItem((agentsMd ?? "").includes(r.name), `AGENTS.md mentions the repository ${r.name}/`, "list it under Repositories, so the agents know where the code is");
      }
      // A CLAUDE.md here makes Claude Code read it instead of AGENTS.md, unless it imports AGENTS.md.
      const claudeMd = read(path.join(ws, "CLAUDE.md"));
      // Claude Code expands @path anywhere in the text, not only on a line of its own.
      if (claudeMd !== null && !/(^|[\s(])@(\.\/)?AGENTS\.md(?![\w/-])/m.test(claudeMd)) {
        checkWarn("CLAUDE.md doesn't import AGENTS.md", "with a CLAUDE.md present, Claude Code reads it instead of AGENTS.md; add a line @AGENTS.md to it");
      }
    },
  },
  {
    title: ".agents/",
    async apply(ctx) {
      await applySkills(ctx.ws, ctx.skills, { installer: ctx.installer });
    },
    verify({ repo, ws }) {
      for (const forbidden of [".agents/.agents", ".agents/commands"]) {
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
      for (const dir of FIXED_ARTIFACTS) ensureDir(path.join(ws, ".artifacts", dir));
      createFromTemplate(path.join(repo, "templates", "workspace", "INDEX.md"), path.join(ws, ".artifacts", "INDEX.md"));
    },
    verify({ ws }) {
      for (const dir of FIXED_ARTIFACTS) checkItem(fs.existsSync(path.join(ws, ".artifacts", dir)), `.artifacts/${dir} exists`);
      checkItem(fs.existsSync(path.join(ws, ".artifacts", "INDEX.md")), ".artifacts/INDEX.md exists", `create it with: dotagents init "${ws}"`);
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
