#!/usr/bin/env node
// Moves Claude Code's conversations (transcripts, session folders, memory) from the project of an
// old folder to the project of a new one, rewriting the working directory recorded in them, so
// `claude --resume` finds them from the new folder. Node 18+, no dependencies.
//
// Usage:
//   node move-sessions.mjs --from <old folder> --to <new folder> [--subdirs-to <folder>] [--dry-run]
//
//   --from         the folder the conversations were started in (it may no longer exist)
//   --to           the folder they should now belong to
//   --subdirs-to   where subfolders of --from live now (default: --to). Example: the old clone
//                  moved into a workspace, so its root maps to the workspace (--to) and its
//                  subfolders to the clone inside it (--subdirs-to <workspace>/<clone>).
//   --dry-run      report what would change, change nothing
//
// Safe to run again: conversations already moved are merged (lines they don't have yet are
// appended), which picks up the metadata Claude Code writes to the old project when a session
// closes after the move.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--dry-run") args.dryRun = true;
  else if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
}
if (!args.from || !args.to) {
  console.error("Usage: node move-sessions.mjs --from <old folder> --to <new folder> [--subdirs-to <folder>] [--dry-run]");
  process.exit(2);
}

const isWindows = process.platform === "win32";
const from = path.resolve(args.from);
const to = path.resolve(args.to);
const subdirsTo = path.resolve(args["subdirs-to"] ?? args.to);
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const projects = path.join(configDir, "projects");

// Claude Code names a project folder after its path, with every character that isn't a letter
// or a digit turned into "-": D:\work\app → D--work-app, /home/me/app → -home-me-app.
const projectName = (dir) => dir.replace(/[^a-zA-Z0-9]/g, "-");

// On Windows the drive letter's case varies (D--… and d--… are the same folder there).
function findProject(dir) {
  const name = projectName(dir);
  if (!fs.existsSync(projects)) return null;
  const match = fs.readdirSync(projects).find((n) => (isWindows ? n.toLowerCase() === name.toLowerCase() : n === name));
  return match ? path.join(projects, match) : null;
}

const srcProject = findProject(from);
if (!srcProject) {
  console.log(`No Claude Code project for ${from} (looked for ${path.join(projects, projectName(from))}). Nothing to move.`);
  process.exit(0);
}
const dstProject = findProject(to) ?? path.join(projects, projectName(to));
if (path.resolve(srcProject).toLowerCase() === path.resolve(dstProject).toLowerCase()) {
  console.error("--from and --to are the same project.");
  process.exit(2);
}

// The spellings a working directory takes in the transcripts: the native path, the other drive
// letter case on Windows, forward slashes, and Git Bash's /d/… form.
function spellings(dir) {
  const out = new Set([dir]);
  if (isWindows && /^[A-Za-z]:/.test(dir)) {
    const rest = dir.slice(2);
    for (const drive of [dir[0].toUpperCase(), dir[0].toLowerCase()]) {
      out.add(`${drive}:${rest}`);
      out.add(`${drive}:${rest.replace(/\\/g, "/")}`);
      out.add(`/${dir[0].toLowerCase()}${rest.replace(/\\/g, "/")}`);
    }
  }
  return [...out];
}

// The same spelling of the target, so a transcript keeps a consistent style.
function respell(oldSpelling, newDir) {
  if (!isWindows) return newDir;
  if (oldSpelling.startsWith("/")) return `/${newDir[0].toLowerCase()}${newDir.slice(2).replace(/\\/g, "/")}`;
  const drive = oldSpelling[0] === oldSpelling[0].toLowerCase() ? newDir[0].toLowerCase() : newDir[0].toUpperCase();
  const rest = newDir.slice(2);
  return `${drive}:${oldSpelling.includes("/") ? rest.replace(/\\/g, "/") : rest}`;
}

const jsonString = (s) => JSON.stringify(s).slice(1, -1); // how the path appears inside JSON

// Rewrites "cwd":"<from>" and "cwd":"<from><sep>…" in a transcript. Other folders are left alone.
function rewriteCwd(text) {
  let count = 0;
  const replace = (from, to) => {
    const parts = text.split(from);
    count += parts.length - 1;
    text = parts.join(to);
  };
  for (const spelling of spellings(from)) {
    const sep = jsonString(spelling.includes("/") ? "/" : "\\");
    const root = jsonString(spelling);
    replace(`"cwd":"${root}"`, `"cwd":"${jsonString(respell(spelling, to))}"`);
    replace(`"cwd":"${root}${sep}`, `"cwd":"${jsonString(respell(spelling, subdirsTo))}${sep}`);
  }
  return { text, count };
}

const transcripts = fs.readdirSync(srcProject).filter((f) => f.endsWith(".jsonl"));
const recent = transcripts.filter((f) => Date.now() - fs.statSync(path.join(srcProject, f)).mtimeMs < 10_000);
if (recent.length) {
  console.error(`Changed in the last 10 seconds: ${recent.join(", ")}. A session is still open: close it and run this again.`);
  process.exit(1);
}

const act = (msg) => console.log(`${args.dryRun ? "would " : ""}${msg}`);
if (!args.dryRun) fs.mkdirSync(dstProject, { recursive: true });

for (const file of transcripts) {
  const src = path.join(srcProject, file);
  const dst = path.join(dstProject, file);
  const { text, count } = rewriteCwd(fs.readFileSync(src, "utf8"));
  if (fs.existsSync(dst)) {
    // Already moved: append only the lines it doesn't have (late metadata from a closing session).
    const current = fs.readFileSync(dst, "utf8");
    const have = new Set(current.split("\n"));
    const extra = text.split("\n").filter((l) => l && !have.has(l));
    act(`merge  ${file}: ${extra.length} new line(s)`);
    if (!args.dryRun) {
      if (extra.length) fs.appendFileSync(dst, `${current.endsWith("\n") ? "" : "\n"}${extra.join("\n")}\n`);
      fs.rmSync(src);
    }
  } else {
    act(`move   ${file}: ${count} working directory entries rewritten`);
    if (!args.dryRun) {
      fs.writeFileSync(dst, text);
      fs.rmSync(src);
    }
  }
  const folder = path.join(srcProject, file.replace(/\.jsonl$/, ""));
  if (fs.existsSync(folder) && !fs.existsSync(path.join(dstProject, path.basename(folder)))) {
    act(`move   ${path.basename(folder)}/ (session files)`);
    if (!args.dryRun) fs.renameSync(folder, path.join(dstProject, path.basename(folder)));
  }
}

// Memory: one note per file; the newer copy of each note wins.
const memSrc = path.join(srcProject, "memory");
if (fs.existsSync(memSrc)) {
  const memDst = path.join(dstProject, "memory");
  for (const note of fs.readdirSync(memSrc)) {
    const a = path.join(memSrc, note);
    const b = path.join(memDst, note);
    if (!fs.existsSync(b) || fs.statSync(a).mtimeMs > fs.statSync(b).mtimeMs) {
      act(`copy   memory/${note}`);
      if (!args.dryRun) {
        fs.mkdirSync(memDst, { recursive: true });
        fs.copyFileSync(a, b);
      }
    }
  }
  if (!args.dryRun) fs.rmSync(memSrc, { recursive: true });
}

// The old project folder goes only when nothing else is left in it.
if (!args.dryRun && fs.existsSync(srcProject) && fs.readdirSync(srcProject).length === 0) {
  fs.rmdirSync(srcProject);
  console.log(`removed ${srcProject}`);
}
console.log(`\n${args.dryRun ? "Dry run: nothing changed. " : ""}Project: ${dstProject}`);
console.log(`Resume from the new folder: cd "${to}" && claude --resume`);
