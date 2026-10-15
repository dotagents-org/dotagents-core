// Catalog of third-party skills: skills you use but don't maintain, registered once in
// third-party-skills.json (versioned with this repository) and offered by `init` and `new` next to
// your own skills. They are installed with `npx skills add`, so the workspace's skills-lock.json
// and `npx skills update` keep working as usual.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lstat, report, runWithSpinner, state } from "./common.mjs";

const FILE = "third-party-skills.json";
// The agents `npx skills add` installs for: .agents/skills (Codex, OpenCode) and .claude/skills.
const AGENTS = "claude-code codex opencode";

export function loadCatalog(repo) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repo, FILE), "utf8")).skills ?? [];
  } catch {
    return [];
  }
}

export function saveCatalog(repo, skills) {
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(repo, FILE), `${JSON.stringify({ skills: sorted }, null, 2)}\n`);
}

// name and description from a SKILL.md frontmatter.
export function parseSkill(text) {
  const front = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const name = front.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1].trim();
  const m = front.match(/^description:\s*(?:[|>]-?\s*\n((?:[ \t]+.*\n?)+)|(.+))/m);
  const description = (m?.[1] ?? m?.[2] ?? "").replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim();
  return { name, description };
}


// owner/repo → GitHub URL; URLs and local paths are used as given.
function cloneUrl(source) {
  if (/^[\w.-]+\/[\w.-]+$/.test(source) && !fs.existsSync(source)) return `https://github.com/${source}.git`;
  return source;
}

// Skills a source provides: a shallow clone into a temporary folder, then every SKILL.md in it.
export async function discoverSkills(source) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-"));
  try {
    const res = await runWithSpinner(`Reading ${source}`, "git", ["clone", "--depth", "1", "--quiet", cloneUrl(source), tmp]);
    if (res.code !== 0) throw new Error(`Couldn't clone ${source}: ${res.last}`);
    const found = [];
    const walk = (dir, depth) => {
      if (depth > 4) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.name === "SKILL.md") {
          const { name, description } = parseSkill(fs.readFileSync(full, "utf8"));
          if (name && !found.some((s) => s.name === name)) found.push({ name, description });
        }
      }
    };
    walk(tmp, 0);
    return found;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const lockNames = (ws) => {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(path.join(ws, "skills-lock.json"), "utf8")).skills ?? {});
  } catch {
    return [];
  }
};

// Third-party skills from the catalog already installed in the workspace.
export function installedThirdParty(ws, catalog) {
  const locked = lockNames(ws);
  return catalog.filter((s) => locked.includes(s.name) && fs.existsSync(path.join(ws, ".agents", "skills", s.name, "SKILL.md"))).map((s) => s.name);
}

// Installs catalog entries in the workspace with `npx skills add`, from its root.
export async function installThirdParty(ws, entries) {
  const installed = installedThirdParty(ws, entries);
  for (const entry of entries) {
    const dest = path.join(ws, ".agents", "skills", entry.name);
    if (installed.includes(entry.name)) {
      report("ok", dest, `from ${entry.source}`);
      continue;
    }
    if (lstat(dest)) {
      report("skipped", dest, "a folder with this name already exists; remove it to install the third-party skill");
      continue;
    }
    if (state.dryRun) {
      report("would create", dest, `npx skills add ${entry.source} -s ${entry.name}`);
      continue;
    }
    // A single command string with shell: true, so Windows finds npx.cmd. The values come from
    // the catalog, which only holds names checked by register (no spaces or shell characters).
    const cmd = `npx -y skills add ${entry.source} -s ${entry.name} -y -a ${AGENTS}`;
    const res = await runWithSpinner(`Installing ${entry.name}`, cmd, [], { cwd: ws, shell: true });
    const ok = res.code === 0 && fs.existsSync(path.join(dest, "SKILL.md"));
    report(ok ? "created" : "failed", dest, ok ? `from ${entry.source}` : res.last);
  }
}

// Only letters, digits and the punctuation of owner/repo, git URLs and paths: the source goes
// into a shell command.
export const SAFE_SOURCE = /^[\w@:./~\\-]+$/;
export const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
