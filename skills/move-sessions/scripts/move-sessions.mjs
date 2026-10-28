#!/usr/bin/env node
// Makes the conversations of Claude Code follow a project folder that moved, so it lists them
// again from the new folder. No dependencies; Node 18+.
//
// Usage:
//   node move-sessions.mjs --from <old folder> --to <new folder> [--subdirs-to <folder>]
//                          [--from-claude-dir <dir>] [--dry-run]
//
//   --from         the folder the conversations were started in (it may no longer exist)
//   --to           the folder they should belong to now
//   --subdirs-to   where subfolders of --from live now (default: --to). Example: a clone moved into
//                  a workspace maps its root to the workspace (--to) and its subfolders to the clone
//                  inside it (--subdirs-to <workspace>/<clone>).
//   --from-claude-dir  read Claude Code conversations from another system's ~/.claude, to move
//                  them across systems (Windows to WSL: /mnt/c/Users/<you>/.claude). --from may
//                  then be a Windows path even when this runs on Linux.
//   --dry-run      report what would change, change nothing
//
// Data location, overridable for tests: CLAUDE_CONFIG_DIR (~/.claude).
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
  console.error("Usage: node move-sessions.mjs --from <old folder> --to <new folder> [--subdirs-to <folder>] [--from-claude-dir <dir>] [--dry-run]");
  process.exit(2);
}

const isWindows = process.platform === "win32";
// A Windows path is kept as written even on Linux, so sessions can move from Windows to WSL (or
// another machine): --from D:\work\app --to /home/me/work/app --from-claude-dir /mnt/c/Users/me/.claude
const isWindowsPath = (p) => /^[A-Za-z]:[\\/]/.test(p);
const resolveArg = (p) => (isWindowsPath(p) && !isWindows ? p.replace(/\//g, "\\").replace(/\\+$/, "") : path.resolve(p));
const from = resolveArg(args.from);
const to = resolveArg(args.to);
const subdirsTo = resolveArg(args["subdirs-to"] ?? args.to);
const home = os.homedir();
const dirs = {
  claude: process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
  // Where the conversations are read from: another system's ~/.claude when they move across systems.
  claudeFrom: args["from-claude-dir"] ? path.resolve(args["from-claude-dir"]) : null,
};

const say = (tool, msg) => console.log(`${tool.padEnd(9)}${args.dryRun ? "would " : ""}${msg}`);

// ── Paths ─────────────────────────────────────────────────────────────────────────────────────
// A folder appears in many spellings: native (D:\a), the other drive-letter case, forward
// slashes (D:/a), Git Bash (/d/a) and Windows' extended prefix (\\?\D:\a). Each spelling maps to
// the same spelling of the new folder.

const windowsStyles = [
  (p) => p,
  (p) => p[0].toLowerCase() + p.slice(1),
  (p) => p.replace(/\\/g, "/"),
  (p) => (p[0].toLowerCase() + p.slice(1)).replace(/\\/g, "/"),
  (p) => `/${p[0].toLowerCase()}${p.slice(2).replace(/\\/g, "/")}`,
  (p) => `\\\\?\\${p}`,
];
const styles = isWindowsPath(from) ? windowsStyles : [(p) => p];

// Same family (Windows to Windows): keep each spelling's style. Across systems (Windows to Linux):
// every old spelling becomes the plain new path.
const restyle = (style, p) => (isWindowsPath(from) === isWindowsPath(p) ? style(p) : p);
const rules = [...new Set(styles.map((s) => s(from)))].map((old) => {
  const style = styles.find((s) => s(from) === old);
  const sep = old.includes("/") ? "/" : "\\";
  const newSep = isWindowsPath(from) === isWindowsPath(to) ? sep : isWindowsPath(to) ? "\\" : "/";
  return { old, sep, newSep, root: restyle(style, to), sub: restyle(style, subdirsTo) };
});

// The new path for a path under --from, or null when it is somewhere else.
function mapPath(p) {
  if (typeof p !== "string") return null;
  for (const r of rules) {
    if (p === r.old) return r.root;
    if (p.startsWith(r.old + r.sep)) return r.sub + p.slice(r.old.length).split(r.sep).join(r.newSep);
  }
  return null;
}

// Rewrites, in a parsed JSON value, the string values of the given keys.
function rewriteKeys(value, keys) {
  let count = 0;
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v)) {
      if (keys.has(k)) {
        const m = mapPath(val);
        if (m !== null) (v[k] = m), count++;
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

// A file changed in the last seconds means the tool is still open: the move stops, while a dry run
// only notes it, since it changes nothing.
function stopIfOpen(tool, message) {
  if (!args.dryRun) throw new Error(message);
  console.log(`${tool.padEnd(9)}note: ${message} (before the real run)`);
}

// ── Claude Code ───────────────────────────────────────────────────────────────────────────────
// ~/.claude/projects/<name>/: <name> is the folder's path with every character that isn't a letter
// or digit turned into "-". The conversations move from the old project to the new one.

async function claude() {
  const projects = path.join(dirs.claude, "projects");
  const srcProjects = path.join(dirs.claudeFrom ?? dirs.claude, "projects");
  const name = (dir) => dir.replace(/[^a-zA-Z0-9]/g, "-");
  // Project folders of Windows paths vary in drive-letter case (D--… and d--…).
  const find = (base, dir) => {
    if (!fs.existsSync(base)) return null;
    const loose = isWindows || isWindowsPath(dir);
    const match = fs.readdirSync(base).find((n) => (loose ? n.toLowerCase() === name(dir).toLowerCase() : n === name(dir)));
    return match ? path.join(base, match) : null;
  };
  const src = find(srcProjects, from);
  if (!src) return say("claude", `nothing: no project for ${from} in ${srcProjects}`);
  const dst = find(projects, to) ?? path.join(projects, name(to));
  if (src.toLowerCase() === dst.toLowerCase()) throw new Error("--from and --to are the same Claude Code project");

  const transcripts = fs.readdirSync(src).filter((f) => f.endsWith(".jsonl"));
  const open = transcripts.filter((f) => recentlyChanged(path.join(src, f)));
  if (open.length) stopIfOpen("claude", `Claude Code transcripts changed in the last 10 seconds (${open.join(", ")}): close the session and run this again`);
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

// ── Run ───────────────────────────────────────────────────────────────────────────────────────

try {
  await claude();
} catch (err) {
  console.error(`${"claude".padEnd(9)}error: ${err.message}`);
  process.exitCode = 1;
}
console.log(`\n${args.dryRun ? "Dry run: nothing changed. " : ""}Resume from the new folder: cd "${to}", then claude --resume.`);
