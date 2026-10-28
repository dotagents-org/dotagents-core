// Catalog of third-party skills: skills you use but don't maintain, registered once in
// skills/third-party-skills.json (versioned with this repository) and offered by `init` and `new` next to
// your own skills. They are installed with `npx skills add`, so the workspace's skills-lock.json
// and `npx skills update` keep working as usual.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWithSpinner } from "./common.ts";

// The catalog sits next to my own skills.
export const catalogFile = (repo) => path.join(repo, "skills", "third-party-skills.json");
// The agent `npx skills add` installs for. The copy lands in .agents/skills, and .claude/skills
// already links there.
const AGENTS = "claude-code";

export function loadCatalog(repo) {
  try {
    return JSON.parse(fs.readFileSync(catalogFile(repo), "utf8")).skills ?? [];
  } catch {
    return [];
  }
}

export function saveCatalog(repo, skills) {
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(catalogFile(repo), `${JSON.stringify({ skills: sorted }, null, 2)}\n`);
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

// The installer adapter for third-party skills: `npx skills add`, run from the workspace root, so
// the skill lands in .agents/skills/ and in skills-lock.json. Returns { ok, detail }. Tests use a
// fake adapter with the same shape.
export async function npxInstaller(ws, skill) {
  // A single command string with shell: true, so Windows finds npx.cmd. The values come from
  // the catalog, which only holds names and sources checked by register (no shell characters).
  const cmd = `npx -y skills add ${skill.source} -s ${skill.name} -y -a ${AGENTS}`;
  const res = await runWithSpinner(`Installing ${skill.name}`, cmd, [], { cwd: ws, shell: true });
  const ok = res.code === 0 && fs.existsSync(path.join(ws, ".agents", "skills", skill.name, "SKILL.md"));
  return { ok, detail: ok ? `from ${skill.source}` : res.last };
}

// Only letters, digits and the punctuation of owner/repo, git URLs and paths: the source goes
// into a shell command.
export const SAFE_SOURCE = /^[\w@:./~\\-]+$/;
export const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
