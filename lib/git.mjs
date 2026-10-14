// Keeps the agent configuration out of the projects' git history. The files dotagents manages
// in a workspace are listed in the repository's .git/info/exclude: a local ignore file that git
// honors like .gitignore but that is never committed, so the projects carry no trace of it.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { report, state, toSlash } from "./common.mjs";

// Everything dotagents creates or relies on in a workspace root.
export const AGENT_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "INDEX.md",
  "skills-lock.json",
  "opencode.json",
  ".agents/",
  ".artifacts/",
  ".claude/",
  ".codex/",
  ".opencode/",
  // Other agents you have installed: their project folders are agent configuration too.
  ".copilot/",
  ".cursor/",
  ".gemini/",
];

const BEGIN = "# >>> dotagents: agent configuration, kept out of this repository";
const END = "# <<< dotagents";

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

// The git repository that contains the workspace folder, or null. Workspaces whose root is not a
// repository (only the projects inside are) need nothing: the files sit outside every repository.
export function gitRepoOf(ws) {
  const top = git(ws, "rev-parse", "--show-toplevel");
  if (!top) return null;
  const exclude = git(ws, "rev-parse", "--git-path", "info/exclude");
  return { top: path.resolve(top), exclude: path.resolve(ws, exclude) };
}

// Patterns anchored to the workspace, relative to the repository root.
function patternsFor(ws, top) {
  const prefix = toSlash(path.relative(top, ws));
  return AGENT_FILES.map((f) => `/${prefix ? `${prefix}/` : ""}${f}`);
}

export function ensureExcluded(ws) {
  const repo = gitRepoOf(ws);
  if (!repo) return report("ok", ws, "not inside a git repository: nothing to exclude");
  const block = [BEGIN, ...patternsFor(ws, repo.top), END].join("\n");
  const current = fs.existsSync(repo.exclude) ? fs.readFileSync(repo.exclude, "utf8") : "";
  // One block per workspace path; rewrite it when the list changes.
  const pattern = new RegExp(`${escape(BEGIN)}\\n(?:.*\\n)*?${escape(END)}`, "g");
  const blocks = current.match(pattern) ?? [];
  const mine = blocks.find((b) => b.includes(patternsFor(ws, repo.top)[0]));
  if (mine === block) return report("ok", repo.exclude, "agent files excluded from git");
  if (state.dryRun) return report(mine ? "would update" : "would create", repo.exclude, "exclude the agent files from git");
  const next = mine ? current.replace(mine, block) : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${block}\n`;
  fs.mkdirSync(path.dirname(repo.exclude), { recursive: true });
  fs.writeFileSync(repo.exclude, next);
  report(mine ? "updated" : "created", repo.exclude, "agent files excluded from git");
}

// Agent files that git already tracks (committed or staged). The exclude list doesn't hide them;
// they have to be removed from the index by hand, which dotagents never does on its own.
export function trackedAgentFiles(ws) {
  const repo = gitRepoOf(ws);
  if (!repo) return [];
  const prefix = toSlash(path.relative(repo.top, ws));
  const out = git(repo.top, "ls-files", "--", ...AGENT_FILES.map((f) => (prefix ? `${prefix}/` : "") + f.replace(/\/$/, "")));
  return out ? out.split("\n").filter(Boolean) : [];
}

// Agent files that git would pick up as new files (neither tracked nor ignored).
export function untrackedAgentFiles(ws) {
  const repo = gitRepoOf(ws);
  if (!repo) return [];
  const prefix = toSlash(path.relative(repo.top, ws));
  const paths = AGENT_FILES.map((f) => (prefix ? `${prefix}/` : "") + f.replace(/\/$/, ""));
  const out = git(repo.top, "ls-files", "--others", "--exclude-standard", "--directory", "--", ...paths);
  return out ? out.split("\n").filter(Boolean) : [];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
