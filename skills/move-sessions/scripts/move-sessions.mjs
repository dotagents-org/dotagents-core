#!/usr/bin/env node
// Makes the conversations of Claude Code, Codex and OpenCode follow a project folder that moved,
// so each tool lists them again from the new folder. No dependencies; Node 18+ for Claude Code,
// Node 22.13+ for Codex and OpenCode (their stores are SQLite, read with node:sqlite).
//
// Usage:
//   node move-sessions.mjs --from <old folder> --to <new folder> [--subdirs-to <folder>]
//                          [--tools claude,codex,opencode] [--dry-run]
//
//   --from         the folder the conversations were started in (it may no longer exist)
//   --to           the folder they should belong to now
//   --subdirs-to   where subfolders of --from live now (default: --to). Example: a clone moved into
//                  a workspace maps its root to the workspace (--to) and its subfolders to the clone
//                  inside it (--subdirs-to <workspace>/<clone>).
//   --tools        which tools to handle (default: every one whose data is found)
//   --dry-run      report what would change, change nothing
//
// Data locations, overridable for tests: CLAUDE_CONFIG_DIR (~/.claude), CODEX_HOME (~/.codex),
// XDG_DATA_HOME (~/.local/share, for opencode/).
//
// Safe to run again: nothing already moved is moved twice, and Claude Code transcripts already in
// the new project are merged line by line (it writes title and cost records to the old project
// when a session closes, sometimes after the move).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Arguments ─────────────────────────────────────────────────────────────────────────────────

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--dry-run") args.dryRun = true;
  else if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
}
if (!args.from || !args.to) {
  console.error("Usage: node move-sessions.mjs --from <old folder> --to <new folder> [--subdirs-to <folder>] [--tools claude,codex,opencode] [--dry-run]");
  process.exit(2);
}

const isWindows = process.platform === "win32";
const from = path.resolve(args.from);
const to = path.resolve(args.to);
const subdirsTo = path.resolve(args["subdirs-to"] ?? args.to);
const home = os.homedir();
const dirs = {
  claude: process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
  codex: process.env.CODEX_HOME || path.join(home, ".codex"),
  opencode: path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode"),
};
const wanted = args.tools ? args.tools.split(",").map((t) => t.trim()) : Object.keys(dirs);
const unknown = wanted.filter((t) => !(t in dirs));
if (unknown.length) {
  console.error(`Unknown tool: ${unknown.join(", ")}. Use claude, codex, opencode.`);
  process.exit(2);
}

const say = (tool, msg) => console.log(`${tool.padEnd(9)}${args.dryRun ? "would " : ""}${msg}`);

// ── Paths ─────────────────────────────────────────────────────────────────────────────────────
// A folder appears in many spellings: native (D:\a), the other drive-letter case, forward
// slashes (D:/a, OpenCode's form), Git Bash (/d/a) and Windows' extended prefix (\\?\D:\a, in
// Codex's database). Each spelling maps to the same spelling of the new folder.

const styles = isWindows
  ? [
      (p) => p,
      (p) => p[0].toLowerCase() + p.slice(1),
      (p) => p.replace(/\\/g, "/"),
      (p) => (p[0].toLowerCase() + p.slice(1)).replace(/\\/g, "/"),
      (p) => `/${p[0].toLowerCase()}${p.slice(2).replace(/\\/g, "/")}`,
      (p) => `\\\\?\\${p}`,
    ]
  : [(p) => p];

const rules = [...new Set(styles.map((s) => s(from)))].map((old) => {
  const style = styles.find((s) => s(from) === old);
  return { old, sep: old.includes("/") ? "/" : "\\", root: style(to), sub: style(subdirsTo) };
});

// The new path for a path under --from, or null when it is somewhere else.
function mapPath(p) {
  if (typeof p !== "string") return null;
  for (const r of rules) {
    if (p === r.old) return r.root;
    if (p.startsWith(r.old + r.sep)) return r.sub + p.slice(r.old.length);
  }
  return null;
}

// Rewrites, in a parsed JSON value, the string values (or string arrays) of the given keys.
function rewriteKeys(value, keys) {
  let count = 0;
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v)) {
      if (keys.has(k)) {
        if (Array.isArray(val)) {
          val.forEach((item, i) => {
            const m = mapPath(item);
            if (m !== null) (val[i] = m), count++;
          });
        } else {
          const m = mapPath(val);
          if (m !== null) (v[k] = m), count++;
        }
      }
      walk(v[k]);
    }
  };
  walk(value);
  return count;
}

// Rewrites a JSONL text line by line; lines without a matching path stay byte for byte.
function rewriteJsonl(text, keys) {
  let count = 0;
  const lines = text.split("\n").map((line) => {
    if (!line.trim()) return line;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return line;
    }
    const n = rewriteKeys(obj, keys);
    count += n;
    return n ? JSON.stringify(obj) : line;
  });
  return { text: lines.join("\n"), count };
}

const recentlyChanged = (file) => fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 10_000;

function walkFiles(dir, match, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, match, out);
    else if (match(e.name)) out.push(full);
  }
  return out;
}

// SQLite through node:sqlite, loaded only when needed, with its experimental warning silenced.
async function openDb(file) {
  process.removeAllListeners("warning");
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    throw new Error(`Node ${process.versions.node} has no node:sqlite; Codex and OpenCode need Node 22.13+`);
  }
  return new DatabaseSync(file);
}

// Rewrites the given columns of a database. A consistent copy is saved first (VACUUM INTO).
async function rewriteDb(tool, file, columns) {
  if (recentlyChanged(file) || recentlyChanged(`${file}-wal`)) {
    throw new Error(`${file} changed in the last 10 seconds: close ${tool} and run this again`);
  }
  const db = await openDb(file);
  try {
    const changes = [];
    for (const [table, column, key] of columns) {
      const cols = db.prepare(`pragma table_info("${table}")`).all().map((c) => c.name);
      // rowid is SQLite's implicit key: tables without an id column still have it.
      if (!cols.includes(column) || (key !== "rowid" && !cols.includes(key))) continue;
      for (const row of db.prepare(`select "${key}" as k, "${column}" as v from "${table}"`).all()) {
        const m = mapPath(row.v);
        if (m !== null) changes.push({ table, column, key, k: row.k, v: m });
      }
    }
    const summary = Object.entries(group(changes)).map(([k, v]) => `${v.length} ${k}`);
    say(tool, `update ${path.basename(file)}: ${summary.join(", ") || "nothing to change"}`);
    if (!changes.length || args.dryRun) return;
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    db.exec("BEGIN");
    for (const c of changes) db.prepare(`update "${c.table}" set "${c.column}" = ? where "${c.key}" = ?`).run(c.v, c.k);
    db.exec("COMMIT");
    say(tool, `  backup: ${path.basename(backup)}`);
  } finally {
    db.close();
  }
}

function group(changes) {
  const out = {};
  for (const c of changes) (out[`${c.table}.${c.column}`] ??= []).push(c);
  return out;
}

// ── Claude Code ───────────────────────────────────────────────────────────────────────────────
// ~/.claude/projects/<name>/: <name> is the folder's path with every character that isn't a letter
// or digit turned into "-". The conversations move from the old project to the new one.

async function claude() {
  const projects = path.join(dirs.claude, "projects");
  const name = (dir) => dir.replace(/[^a-zA-Z0-9]/g, "-");
  const find = (dir) => {
    if (!fs.existsSync(projects)) return null;
    const match = fs.readdirSync(projects).find((n) => (isWindows ? n.toLowerCase() === name(dir).toLowerCase() : n === name(dir)));
    return match ? path.join(projects, match) : null;
  };
  const src = find(from);
  if (!src) return say("claude", `nothing: no project for ${from}`);
  const dst = find(to) ?? path.join(projects, name(to));
  if (src.toLowerCase() === dst.toLowerCase()) throw new Error("--from and --to are the same Claude Code project");

  const transcripts = fs.readdirSync(src).filter((f) => f.endsWith(".jsonl"));
  const open = transcripts.filter((f) => recentlyChanged(path.join(src, f)));
  if (open.length) throw new Error(`Claude Code transcripts changed in the last 10 seconds (${open.join(", ")}): close the session and run this again`);
  if (!args.dryRun) fs.mkdirSync(dst, { recursive: true });

  for (const file of transcripts) {
    const { text, count } = rewriteJsonl(fs.readFileSync(path.join(src, file), "utf8"), new Set(["cwd"]));
    const target = path.join(dst, file);
    if (fs.existsSync(target)) {
      const current = fs.readFileSync(target, "utf8");
      const have = new Set(current.split("\n"));
      const extra = text.split("\n").filter((l) => l && !have.has(l));
      say("claude", `merge  ${file}: ${extra.length} new line(s)`);
      if (!args.dryRun && extra.length) fs.appendFileSync(target, `${current.endsWith("\n") ? "" : "\n"}${extra.join("\n")}\n`);
    } else {
      say("claude", `move   ${file}: ${count} working directories rewritten`);
      if (!args.dryRun) fs.writeFileSync(target, text);
    }
    if (!args.dryRun) fs.rmSync(path.join(src, file));
    const folder = path.join(src, file.replace(/\.jsonl$/, ""));
    const folderTarget = path.join(dst, path.basename(folder));
    if (fs.existsSync(folder) && !fs.existsSync(folderTarget)) {
      say("claude", `move   ${path.basename(folder)}/ (session files)`);
      if (!args.dryRun) fs.renameSync(folder, folderTarget);
    }
  }

  const mem = path.join(src, "memory");
  if (fs.existsSync(mem)) {
    for (const note of fs.readdirSync(mem)) {
      const a = path.join(mem, note);
      const b = path.join(dst, "memory", note);
      if (!fs.existsSync(b) || fs.statSync(a).mtimeMs > fs.statSync(b).mtimeMs) {
        say("claude", `copy   memory/${note}`);
        if (!args.dryRun) {
          fs.mkdirSync(path.dirname(b), { recursive: true });
          fs.copyFileSync(a, b);
        }
      }
    }
    if (!args.dryRun) fs.rmSync(mem, { recursive: true });
  }
  if (!args.dryRun && fs.existsSync(src) && !fs.readdirSync(src).length) {
    fs.rmdirSync(src);
    say("claude", `removed the old project ${path.basename(src)}`);
  }
}

// ── Codex ─────────────────────────────────────────────────────────────────────────────────────
// Rollouts (sessions/YYYY/MM/DD/*.jsonl, archived_sessions/*.jsonl) record the folder in
// session_meta and turn_context; state_*.sqlite indexes the threads by it, which is what
// `codex resume` filters on. Both are rewritten in place.

async function codex() {
  const rollouts = [...walkFiles(path.join(dirs.codex, "sessions"), (n) => n.endsWith(".jsonl")), ...walkFiles(path.join(dirs.codex, "archived_sessions"), (n) => n.endsWith(".jsonl"))];
  const keys = new Set(["cwd", "workdir", "runtime_workspace_roots"]);
  let touched = 0;
  for (const file of rollouts) {
    const original = fs.readFileSync(file, "utf8");
    const { text, count } = rewriteJsonl(original, keys);
    if (!count) continue;
    if (recentlyChanged(file)) throw new Error(`${path.basename(file)} changed in the last 10 seconds: close Codex and run this again`);
    touched++;
    say("codex", `update ${path.basename(file)}: ${count} paths`);
    if (!args.dryRun) {
      fs.writeFileSync(`${file}.tmp`, text);
      fs.renameSync(`${file}.tmp`, file);
    }
  }
  if (!touched) say("codex", "nothing: no rollout under the old folder");
  const dbs = fs.existsSync(dirs.codex) ? fs.readdirSync(dirs.codex).filter((n) => /^state_\d+\.sqlite$/.test(n)) : [];
  for (const db of dbs) {
    await rewriteDb("codex", path.join(dirs.codex, db), [
      ["threads", "cwd", "id"],
      ["project_roots", "path", "rowid"],
    ]);
  }
}

// ── OpenCode ──────────────────────────────────────────────────────────────────────────────────
// Everything lives in opencode.db: sessions by directory, projects by worktree.

async function opencode() {
  const file = path.join(dirs.opencode, "opencode.db");
  await rewriteDb("opencode", file, [
    ["session", "directory", "id"],
    ["project", "worktree", "id"],
    ["project_directory", "directory", "rowid"],
    ["workspace", "directory", "id"],
  ]);
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────

const handlers = { claude, codex, opencode };
const present = {
  claude: () => fs.existsSync(path.join(dirs.claude, "projects")),
  codex: () => fs.existsSync(dirs.codex),
  opencode: () => fs.existsSync(path.join(dirs.opencode, "opencode.db")),
};

let failed = false;
for (const tool of wanted) {
  if (!present[tool]()) {
    if (args.tools) say(tool, `nothing: no data in ${dirs[tool]}`);
    continue;
  }
  try {
    await handlers[tool]();
  } catch (err) {
    failed = true;
    console.error(`${tool.padEnd(9)}error: ${err.message}`);
  }
}
console.log(`\n${args.dryRun ? "Dry run: nothing changed. " : ""}Resume from the new folder: cd "${to}", then claude --resume, codex resume or opencode.`);
process.exitCode = failed ? 1 : 0;
