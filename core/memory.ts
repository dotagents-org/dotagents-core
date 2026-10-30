// Workspace memory. Claude Code keeps its auto memory per profile (<profile>/projects/<slug>/memory/),
// so profiles working in the same workspace would each learn alone. autoMemoryDirectory, set in the
// workspace's .claude/settings.local.json, points every profile at .artifacts/memory/ instead (one
// index, MEMORY.md, and a file per note), and init copies in what each profile had learned there
// before. No symlinks: Claude Code asks before every write through one (issue #98044).
//
// A session started inside a child repository doesn't read the workspace's settings and keeps its
// profile's memory; a session resumed from before the change keeps writing to the old folder
// (#101500). The checklist points out notes left behind either way.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir, ensureJsonKey, lstat } from "./common.ts";
import { checkItem, checkWarn, displayPath, report, section, toSlash } from "./output.ts";
import { state } from "./state.ts";

export const memoryDir = (ws: string) => path.join(ws, ".artifacts", "memory");
const localSettings = (ws: string) => path.join(ws, ".claude", "settings.local.json");

// Claude Code's own name for a project folder: the path with every character that isn't a letter
// or a digit turned into a dash.
export const projectSlug = (dir: string) => dir.replace(/[^a-zA-Z0-9]/g, "-");

// The value of autoMemoryDirectory: ~/... under the home folder, else the absolute path. Claude Code
// ignores a relative one.
function memorySetting(ws: string) {
  const rel = path.relative(os.homedir(), memoryDir(ws));
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? `~/${toSlash(rel)}` : memoryDir(ws);
}

// Claude Code loads only the first 200 lines or 25 KB of MEMORY.md.
const INDEX_LINES = 200;
const INDEX_BYTES = 25 * 1024;
// A transcript written this recently means a session is working in the workspace.
const BUSY_MS = 10_000;

const read = (file: string) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const notesIn = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md" && fs.statSync(path.join(dir, f)).isFile()) : []);
const linkTarget = (line: string) => /\]\(([^)]+)\)/.exec(line)?.[1] ?? null;
const indexLines = (text: string | null) => (text ?? "").split("\n").filter((l) => l.trim());

// Where a profile kept the workspace's memory before.
const profileMemory = (configDir: string, ws: string) => path.join(configDir, "projects", projectSlug(ws), "memory");

// Sets the key. A value that points to another .artifacts/memory is ours from before the workspace
// moved (init --wrap, a renamed folder) and is brought up to date; any other value is the user's.
function setMemoryKey(ws: string) {
  const file = localSettings(ws);
  const expected = memorySetting(ws);
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const current = data?.autoMemoryDirectory;
  if (typeof current !== "string" || current === expected || !/[\\/]\.artifacts[\\/]memory$/.test(current)) return ensureJsonKey(file, "autoMemoryDirectory", expected);
  const shown = `autoMemoryDirectory: ${JSON.stringify(expected)}, was ${JSON.stringify(current)}`;
  if (state.dryRun) return report("would update", file, shown);
  fs.writeFileSync(file, `${JSON.stringify({ ...data, autoMemoryDirectory: expected }, null, 2)}\n`);
  report("updated", file, shown);
}

export function applyMemory(ws: string, configDirs: string[], { now = Date.now() }: { now?: number } = {}) {
  setMemoryKey(ws);
  const dest = memoryDir(ws);
  ensureDir(dest);
  const index = path.join(dest, "MEMORY.md");
  let lines = indexLines(read(index));
  const indexBefore = lines.join("\n");

  for (const configDir of configDirs) {
    const src = profileMemory(configDir, ws);
    if (!fs.existsSync(src)) continue;
    const project = path.dirname(src);
    const busy = fs.readdirSync(project).some((f) => f.endsWith(".jsonl") && now - fs.statSync(path.join(project, f)).mtimeMs < BUSY_MS);
    if (busy) {
      checkWarn(`a session is writing to ${displayPath(project)} right now`, "its memory moves in on the next init, once the session is done");
      continue;
    }
    for (const note of notesIn(src)) {
      const from = path.join(src, note);
      const to = path.join(dest, note);
      const theirs = read(from);
      const ours = read(to);
      if (ours === null) {
        if (state.dryRun) report("would create", to, `from ${displayPath(from)}`);
        else {
          fs.copyFileSync(from, to);
          report("created", to, `from ${displayPath(from)}`);
        }
      } else if (ours === theirs) report("ok", to);
      else checkWarn(`${note} differs in ${displayPath(src)}`, "the workspace's copy was kept; merge them by hand if the profile's has something new");
    }
    const known = new Set(lines.map(linkTarget));
    for (const line of indexLines(read(path.join(src, "MEMORY.md")))) {
      const target = linkTarget(line);
      if (target && known.has(target)) continue;
      lines.push(line);
      known.add(target);
    }
  }

  const text = lines.length ? `${lines.join("\n")}\n` : "";
  if (lstat(index) && lines.join("\n") === indexBefore) return report("ok", index);
  if (state.dryRun) return report(lstat(index) ? "would update" : "would create", index);
  fs.mkdirSync(dest, { recursive: true });
  report(lstat(index) ? "updated" : "created", index, lines.length ? `${lines.length} note${lines.length === 1 ? "" : "s"}` : "");
  fs.writeFileSync(index, text);
}

const blocksReads = (file: string) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))?.permissions?.blockReadsOutsideWorkingDirectories === true;
  } catch {
    return false;
  }
};

export function verifyMemory(ws: string, configDirs: string[]) {
  section("Workspace memory");
  let key: unknown;
  try {
    key = JSON.parse(fs.readFileSync(localSettings(ws), "utf8")).autoMemoryDirectory;
  } catch {}
  const expected = memorySetting(ws);
  checkItem(key === expected, `.claude/settings.local.json sets autoMemoryDirectory to ${expected}`, key ? `set to ${key}` : `set it with: dotagents init "${ws}"`);
  const dest = memoryDir(ws);
  const st = lstat(dest);
  checkItem(Boolean(st?.isDirectory()), ".artifacts/memory is a folder", st?.isSymbolicLink() ? "a link: Claude Code would ask before every write through it" : `create it with: dotagents init "${ws}"`);

  const index = read(path.join(dest, "MEMORY.md"));
  if (index !== null) {
    const count = index.split("\n").length - (index.endsWith("\n") ? 1 : 0);
    const bytes = Buffer.byteLength(index);
    checkItem(count <= INDEX_LINES && bytes <= INDEX_BYTES, `.artifacts/memory/MEMORY.md fits in what Claude Code loads (${INDEX_LINES} lines, 25 KB)`, `${count} lines, ${Math.round(bytes / 1024)} KB: shorten the index, the rest is never read`);
    const linked = new Set(indexLines(index).map(linkTarget));
    for (const note of notesIn(dest)) if (!linked.has(note)) checkWarn(`.artifacts/memory/${note} isn't in MEMORY.md`, "add a line for it to the index, or delete it");
    for (const target of linked) if (target && !fs.existsSync(path.join(dest, target))) checkWarn(`MEMORY.md links to ${target}, which doesn't exist`, "remove the line or restore the note");
  }

  for (const configDir of configDirs) {
    const src = profileMemory(configDir, ws);
    const left = notesIn(src).filter((note) => read(path.join(dest, note)) === null);
    if (left.length)
      checkWarn(
        `${left.length} note${left.length === 1 ? "" : "s"} in ${displayPath(src)} not in the workspace memory (${left.join(", ")})`,
        `a session there wrote to the old folder; bring them in with: dotagents init "${ws}"`
      );
  }

  const settings = [path.join(ws, ".claude", "settings.json"), localSettings(ws), ...configDirs.map((d) => path.join(d, "settings.json"))];
  const blocking = settings.filter(blocksReads);
  if (blocking.length)
    checkWarn(`blockReadsOutsideWorkingDirectories is on in ${blocking.map(displayPath).join(", ")}`, "with it, Claude Code ignores autoMemoryDirectory from the workspace's settings and the shared memory stops loading");
}
