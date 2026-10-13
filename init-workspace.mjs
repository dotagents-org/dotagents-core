#!/usr/bin/env node
// Applies the .agents/ and .artifacts/ standards to a workspace, or checks that it follows them.
// Works on Windows, Linux and macOS. Creates only what is missing and never overwrites your
// content.
//
// Usage: node init-workspace.mjs [path] [--skills a,b] [--check] [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFromTemplate,
  ensureDir,
  ensureDirLink,
  finish,
  lstat,
  parseArgs,
  report,
  samePath,
  section,
  state,
  toSlash,
  writeGenerated,
} from "./lib/common.mjs";

const HELP = `Usage: node init-workspace.mjs [path] [--skills a,b] [--check] [--dry-run]

  path        workspace folder (default: current folder)
  --skills    skills from this repository to link into .agents/skills/
  --check     only run the standards checklist, change nothing
  --dry-run   show what would be done, change nothing

Creates, when missing: AGENTS.md, INDEX.md and .artifacts/coding/pending.md from
templates/workspace/; CLAUDE.md with @AGENTS.md; .agents/README.md and .artifacts/README.md
pointing to standards/; .artifacts/session-archives/; one link per skill; and the
.claude/skills and .claude/rules links to .agents/.`;

const args = parseArgs(process.argv.slice(2), { booleans: ["check", "dry-run", "help"], lists: ["skills"] });
if (args.help) {
  console.log(HELP);
  process.exit(0);
}
state.dryRun = Boolean(args["dry-run"]);

const repo = path.dirname(fileURLToPath(import.meta.url));
const ws = path.resolve(args._[0] ?? process.cwd());
const skills = args.skills ?? [];

if (!fs.existsSync(ws)) throw new Error(`Workspace not found: ${ws}`);
const fromRepo = path.relative(repo, ws);
// Inside the repository: same folder, or a relative path that doesn't climb out. On Windows a
// different drive gives an absolute path, which is outside.
if (fromRepo === "" || (!fromRepo.startsWith("..") && !path.isAbsolute(fromRepo))) {
  throw new Error("The workspace can't be the agents repository itself.");
}

if (args.check) {
  check();
} else {
  init();
}

function init() {
  const available = fs.readdirSync(path.join(repo, "skills"));
  for (const skill of skills) {
    if (!fs.existsSync(path.join(repo, "skills", skill, "SKILL.md"))) {
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
    `# The \`.agents/\` folder\n\nThis workspace follows the standard in \`${repoSlash}/standards/agents.md\` (repository \`gabrieldulolmarques/agents\`).\n`
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
    `# The \`.artifacts/\` folder\n\nThis workspace follows the standard in \`${repoSlash}/standards/artifacts.md\` (repository \`gabrieldulolmarques/agents\`).\n`
  );
  createFromTemplate(path.join(repo, "templates", "workspace", "pending.md"), path.join(ws, ".artifacts", "coding", "pending.md"));
  ensureDir(path.join(ws, ".artifacts", "session-archives"));

  finish(`To check later: node ${toSlash(path.join(repo, "init-workspace.mjs"))} "${ws}" --check`);
}

function check() {
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
    let ok = false;
    try {
      ok = st.isSymbolicLink() && samePath(fs.realpathSync.native(link), fs.realpathSync.native(path.join(ws, ".agents", name)));
    } catch {}
    item(ok, `.claude/${name} links to .agents/${name}`, st.isSymbolicLink() ? "points elsewhere or is broken" : "a copied folder, not a link");
  }

  const skillsDir = path.join(ws, ".agents", "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir)) {
      const label = `.agents/skills/${entry}`;
      const dir = path.join(skillsDir, entry);
      let isDir = false;
      try {
        isDir = fs.statSync(dir).isDirectory();
      } catch {}
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
    }
  }

  const rulesDir = path.join(ws, ".agents", "rules");
  if (fs.existsSync(rulesDir)) {
    for (const rule of fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md"))) {
      item((agentsMd ?? "").includes(rule), `.agents/rules/${rule} is linked from AGENTS.md`);
    }
  }

  item(fs.existsSync(path.join(ws, ".artifacts", "coding", "pending.md")), ".artifacts/coding/pending.md exists");
  item(fs.existsSync(path.join(ws, ".artifacts", "session-archives")), ".artifacts/session-archives exists");

  const artifacts = path.join(ws, ".artifacts");
  if (fs.existsSync(artifacts)) {
    const dated = fs
      .readdirSync(artifacts, { recursive: true })
      .map(String)
      .filter((p) => !p.split(/[\\/]/).includes("session-archives") && /\d{4}-\d{2}-\d{2}/.test(path.basename(p)));
    item(dated.length === 0, "no file name with a full date outside session-archives", dated.join(", "));
  }

  finish(state.problems ? "" : "Everything follows the standards.");
}
