// Codex's conversations on both sides of the machine, for the sessions list: one rollout each,
// $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl (CODEX_HOME, else ~/.codex), and on
// the other side the folder its ChatGPT profiles use, else its ~/.codex. A subagent's rollout (it
// names its parent) belongs to its parent's conversation and isn't listed.
//
// Codex keeps no record of the processes running a conversation, as Claude Code's sessions/<pid>.json,
// so a rollout written in the last RECENT_MS counts as running, on either side. A conversation is
// deleted through Codex itself (`codex delete --force <id>`, which also deletes its subagents'),
// here or on the other side; that runs a command, so it goes through an adapter the tests replace.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CODEX_INJECTED, firstRolloutLine } from "../../skills/archive/scripts/archive-session.ts";
import { codexHome } from "../accounts/providers/codex-config.ts";
import { peerCodexFolders } from "../accounts/providers/codex-usage.ts";
import { isWindows } from "../common.ts";
import { type Peer, loadMachine, sidePeer } from "../machine/machine-state.ts";
import { pathOnlyEnv, peerAgentLine, runOnPeer } from "../machine/peer.ts";
import { type Session, RECENT_MS, archiveRoot } from "./session.ts";

// A remote Codex folder carries both the peer and the origin used to revalidate it.
export type CodexDir = { side: string; home: string } & ({ peer?: never; origin?: never } | { peer: Peer; origin: NonNullable<Session["origin"]> });

export function codexDirs(side: (peer?: Peer) => string, warn?: (message: string) => void): CodexDir[] {
  const peer = loadMachine().peer;
  const dirs: CodexDir[] = [{ side: side(peer), home: codexHome() }];
  if (peer) {
    // The visible folder and the native one from the same reading, kept with the list
    const folders = peerCodexFolders(peer);
    if ("error" in folders) warn?.(`can't read Codex on ${peer.name}: ${folders.error}`);
    else if (fs.existsSync(folders.visible)) dirs.push({ side: peer.name, home: folders.visible, peer, origin: { home: peer.home, native: folders.native } });
  }
  return dirs;
}

const HEAD_BYTES = 256 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parse = (text: string): Record<string, any> | null => {
  try {
    const obj = JSON.parse(text);
    return typeof obj === "object" && obj !== null && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
};

const clip = (text: string, max: number) => {
  const flat = text.split(/\s+/).filter(Boolean).join(" ");
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : flat;
};

// The names Codex gives its conversations: session_index.jsonl, the last line for an id winning.
function titles(home: string) {
  const names = new Map<string, string>();
  let text = "";
  try {
    text = fs.readFileSync(path.join(home, "session_index.jsonl"), "utf8");
  } catch {
    return names;
  }
  for (const line of text.split("\n")) {
    const o = parse(line);
    if (o && typeof o.id === "string" && typeof o.thread_name === "string" && o.thread_name) names.set(o.id, o.thread_name);
  }
  return names;
}

// Only read the first record, the nearby prompt and the last timestamp.
function ends(file: string) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, HEAD_BYTES));
    const head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0));
    const first = firstRolloutLine(fd, head);
    if (first === null) throw new Error("the first rollout record exceeds 32 MiB");
    const afterMeta = first.length + 1;
    let prompts = head.subarray(afterMeta);
    if (afterMeta >= head.length && afterMeta < size) {
      const next = Buffer.alloc(Math.min(size - afterMeta, HEAD_BYTES));
      prompts = next.subarray(0, fs.readSync(fd, next, 0, next.length, afterMeta));
    }
    const tail = Buffer.alloc(Math.min(size, 64 * 1024));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    return { first, prompts, tail };
  } finally {
    fs.closeSync(fd);
  }
}

function summary(file: string) {
  const { first, prompts, tail } = ends(file);
  const meta = parse(first.toString("utf8"));
  const p = meta?.payload;
  if (meta?.type !== "session_meta" || typeof p?.id !== "string" || !ID.test(p.id)) throw new Error("the rollout's first record has no session metadata");
  const parent = p.parent_thread_id ?? p.source?.subagent?.thread_spawn?.parent_thread_id;
  const subagent = Boolean(parent || (p.source && typeof p.source === "object" && "subagent" in p.source));
  let prompt: string | null = null;
  for (const line of prompts.toString("utf8").split("\n")) {
    const o = parse(line);
    const p = o?.payload;
    if (o?.type === "response_item" && p?.type === "message" && p.role === "user") {
      const text = (Array.isArray(p.content) ? p.content : []).map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("\n").trim();
      if (text && !CODEX_INJECTED.test(text)) {
        prompt = text;
        break;
      }
    }
  }
  // The last activity: the timestamp of the last whole line
  let ended: string | null = null;
  for (const line of tail.toString("utf8").split("\n").reverse()) {
    const o = parse(line);
    if (o && typeof o.timestamp === "string") {
      ended = o.timestamp;
      break;
    }
  }
  return {
    id: p.id as string,
    parent: typeof parent === "string" ? parent : null,
    subagent,
    cwd: typeof p.cwd === "string" ? p.cwd : null,
    started: typeof meta.timestamp === "string" ? meta.timestamp : typeof p.timestamp === "string" ? p.timestamp : null,
    ended,
    accounts: typeof p.creator_user_id === "string" ? [p.creator_user_id] : [],
    prompt,
  };
}

// The rollouts a process on this side holds open: on Linux (WSL included) /proc says which files
// each process has, and Codex keeps its conversation's rollout open while it runs. Elsewhere it
// can't be told. An incomplete probe still keeps the open rollouts it saw.
export type RolloutProbe = () => { open: Set<string>; complete: boolean };
const gone = (err: unknown) => ["ENOENT", "ESRCH"].includes((err as NodeJS.ErrnoException).code ?? "");

export function openRollouts(): ReturnType<RolloutProbe> {
  const open = new Set<string>();
  if (process.platform !== "linux") return { open, complete: false };
  let pids: string[] = [];
  try {
    pids = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n));
  } catch {
    return { open, complete: false };
  }
  let complete = true;
  const checkProcess = (pid: string, err: unknown) => {
    if (gone(err)) return;
    try {
      if (/codex/i.test(fs.readFileSync(`/proc/${pid}/comm`, "utf8"))) complete = false;
    } catch (err) {
      // ENOENT can mean the PID exited. If /proc still lists it, its name is unknown.
      if (!gone(err) || fs.existsSync(`/proc/${pid}`)) complete = false;
    }
  };
  for (const pid of pids) {
    let fds: string[];
    try {
      fds = fs.readdirSync(`/proc/${pid}/fd`);
    } catch (err) {
      checkProcess(pid, err);
      continue;
    }
    for (const fd of fds) {
      try {
        const target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
        if (/\/rollout-[^/]*\.jsonl$/.test(target)) open.add(target);
      } catch (err) {
        checkProcess(pid, err);
      }
    }
  }
  return { open, complete };
}

// The file as /proc names it: with the links of its folders followed.
const physical = (file: string) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
};

// Whether a Codex conversation is running: its rollout open in a process on this side, its own
// conversation (CODEX_THREAD_ID, for a command run inside Codex), or written in the last RECENT_MS.
const rolloutOpen = (file: string, open: Set<string>) => open.has(file) || (open.size > 0 && open.has(physical(file)));

export function codexRunning(s: Pick<Session, "id" | "file" | "mtime">, here: boolean, now = Date.now(), open: Set<string> | null = here ? openRollouts().open : null) {
  const mine = process.env.CODEX_THREAD_ID === s.id;
  return mine || (here && !!open && rolloutOpen(s.file, open)) || now - s.mtime < RECENT_MS;
}

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// The rollouts of a conversation's subagents, and of theirs, in a Codex folder: each names its
// parent in its first line. live: in sessions/, which the archive can read; archived: those Codex
// itself archived (archived_sessions/*.jsonl.zst), which codex delete takes all the same.
// Every rollout file of a Codex folder: sessions/YYYY/MM/DD/rollout-*.jsonl.
function rolloutFiles(home: string) {
  const files: string[] = [];
  let complete = true;
  const walk = (at: string, depth: number) => {
    let entries: string[];
    try {
      entries = fs.readdirSync(at);
    } catch (err) {
      if (!gone(err) && (err as NodeJS.ErrnoException).code !== "ENOTDIR") complete = false;
      return;
    }
    for (const name of entries) {
      if (depth < 3) walk(path.join(at, name), depth + 1);
      else if (/^rollout-.*\.jsonl$/.test(name)) files.push(path.join(at, name));
    }
  };
  walk(path.join(home, "sessions"), 0);
  return { files, complete };
}

// The conversation as it is now, looked at again from where it was listed: null when the other side or
// its CODEX_HOME is not the one listed (a profile re-pointed, another distro), or the conversation is gone.
// Every rollout of it is looked at, so one a /revert added since is seen.
export function codexNow(s: Session, probe?: RolloutProbe) {
  let dir: CodexDir = { side: s.side, home: s.configDir };
  if (s.origin) {
    // One reading of the other side's profiles: its home, distro and CODEX_HOME must be the listed ones
    const peer = sidePeer();
    if (!peer || peer.name !== s.side || peer.home !== s.origin.home) return null;
    const folders = peerCodexFolders(peer);
    if ("error" in folders) return { error: folders.error };
    if (folders.native !== s.origin.native || folders.visible !== s.configDir) return null;
    dir = { side: peer.name, home: folders.visible, peer, origin: { home: peer.home, native: folders.native } };
  }
  const { list, complete } = scanCodexSessions([dir], { fromPeer: () => null, probe });
  if (!complete) return { error: "Codex rollout inventory is incomplete; fix unreadable rollouts and list the sessions again" };
  const session = list.find((x) => x.id === s.id);
  return session ? { session, peer: dir.peer } : null;
}

// Every Codex conversation of the folders; under: only those started inside that folder.
type ScanOptions = { under?: string; now?: number; fromPeer: (p: string, peer: Peer) => string | null; probe?: RolloutProbe };

export function listCodexSessions(dirs: CodexDir[], options: ScanOptions): Session[] {
  return scanCodexSessions(dirs, options).list;
}

function scanCodexSessions(dirs: CodexDir[], { under, now = Date.now(), fromPeer, probe = openRollouts }: ScanOptions) {
  const list: Session[] = [];
  let complete = true;
  const processes = dirs.some((d) => !d.peer) ? probe() : null;
  for (const dir of dirs) {
    const names = titles(dir.home);
    // A conversation with more than one rollout (a /revert starts a new one, same id inside) is one
    // entry: the newest rollout; codex delete takes them all
    const byId = new Map<string, { file: string; st: fs.Stats; info: ReturnType<typeof summary> }[]>();
    const parents = new Map<string, string>();
    const open = dir.peer ? undefined : processes?.open;
    const openIds = new Set<string>();
    const inventory = rolloutFiles(dir.home);
    complete &&= inventory.complete;
    for (const file of inventory.files) {
      let st: fs.Stats;
      let info: ReturnType<typeof summary>;
      try {
        st = fs.statSync(file);
        info = summary(file);
      } catch {
        complete = false;
        continue;
      }
      if (open && rolloutOpen(file, open)) openIds.add(info.id);
      if (info.parent) parents.set(info.id, info.parent);
      if (!info.subagent) byId.set(info.id, [...(byId.get(info.id) ?? []), { file, st, info }]);
    }
    // Deleting a thread also deletes its descendants. Set iteration visits added ancestors too.
    for (const id of openIds) {
      const parent = parents.get(id);
      if (parent) openIds.add(parent);
    }
    for (const group of byId.values()) {
      group.sort((x, y) => y.st.mtimeMs - x.st.mtimeMs);
      const { file, st, info } = group[0];
      const localCwd = info.cwd && dir.peer ? fromPeer(info.cwd, dir.peer) : info.cwd;
      if (under && !(localCwd && inside(localCwd, under))) continue;
      list.push({
        id: info.id,
        agent: "codex",
        side: dir.side,
        configDir: dir.home,
        file,
        cwd: info.cwd,
        localCwd,
        title: clip(names.get(info.id) ?? info.prompt ?? "(no messages)", 80),
        started: info.started,
        ended: info.ended,
        bytes: group.reduce((sum, g) => sum + g.st.size, 0),
        mtime: st.mtimeMs,
        accounts: info.accounts,
        root: archiveRoot(localCwd),
        running: openIds.has(info.id) || codexRunning({ id: info.id, file, mtime: st.mtimeMs }, !dir.peer, now, null),
        rolloutOpen: openIds.has(info.id),
        pid: null,
        // Told only where the processes can be seen (Linux, WSL: /proc), and on this side
        checked: !dir.peer && processes?.complete === true,
        ...(dir.origin ? { origin: dir.origin } : {}),
      });
    }
  }
  return { list, complete };
}

// Deletes a conversation through Codex: here, or on the other side when peer is set, in that side's
// CODEX_HOME when its ChatGPT profiles use one. True when Codex said it did. The id is a UUID, checked
// before it goes on a command line, and codex is looked for in the PATH's absolute folders only.
export type CodexDelete = (id: string, peer?: Peer, origin?: { home: string; native: string }) => boolean;
export const codexDelete: CodexDelete = (id, peer, origin) => {
  if (!ID.test(id)) return false;
  if (peer || origin) {
    // The origin the list was made from (validated just before), never read again: its CODEX_HOME and distro
    if (!peer || !origin) return false;
    return runOnPeer(peerAgentLine("codex", `delete --force ${id}`, process.platform, { CODEX_HOME: origin.native }), origin.home).status === 0;
  }
  const env = pathOnlyEnv();
  if (!Object.entries(env).some(([k, v]) => k.toUpperCase() === "PATH" && v)) return false; // an empty PATH searches the current folder
  // On Windows a codex npm installed is a .cmd, which only a shell runs
  return spawnSync("codex", ["delete", "--force", id], { encoding: "utf8", timeout: 60_000, windowsHide: true, shell: isWindows, env }).status === 0;
};
