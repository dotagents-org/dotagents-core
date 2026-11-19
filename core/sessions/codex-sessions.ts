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
import { CODEX_INJECTED } from "../../skills/archive/scripts/archive-session.ts";
import { codexHome } from "../accounts/providers/codex-config.ts";
import { peerCodexHome, peerCodexNative } from "../accounts/providers/codex-usage.ts";
import { isWindows } from "../common.ts";
import { type Peer, loadMachine } from "../machine/machine-state.ts";
import { pathOnlyEnv, peerAgentLine, runOnPeer } from "../machine/peer.ts";
import { type Session, RECENT_MS, archiveRoot } from "./session.ts";

// A Codex data folder and the side it belongs to; peer: set for the other side's.
export type CodexDir = { side: string; home: string; peer?: Peer };

export function codexDirs(side: (peer?: Peer) => string): CodexDir[] {
  const peer = loadMachine().peer;
  const dirs: CodexDir[] = [{ side: side(peer), home: codexHome() }];
  if (peer) {
    const home = peerCodexHome(peer);
    if (home && fs.existsSync(home)) dirs.push({ side: peer.name, home, peer });
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

// What the list needs from a rollout, from its head and its last timestamp; null for a subagent's
// or a file that isn't a conversation's.
// Only the head and the tail are read: a long rollout is never read whole to be listed.
function ends(file: string) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(size, HEAD_BYTES));
    fs.readSync(fd, head, 0, head.length, 0);
    const tail = Buffer.alloc(Math.min(size, 64 * 1024));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    return { head, tail };
  } finally {
    fs.closeSync(fd);
  }
}

function summary(file: string) {
  const { head, tail } = ends(file);
  let meta: Record<string, any> | null = null;
  let prompt: string | null = null;
  for (const line of head.toString("utf8").split("\n")) {
    const o = parse(line);
    if (!o) continue;
    if (!meta && o.type === "session_meta") meta = o;
    const p = o.payload;
    if (o.type === "response_item" && p?.type === "message" && p.role === "user") {
      const text = (Array.isArray(p.content) ? p.content : []).map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("\n").trim();
      if (text && !CODEX_INJECTED.test(text)) prompt = text;
    }
    if (meta && prompt) break;
  }
  const p = meta?.payload;
  if (!p || typeof p.id !== "string" || !ID.test(p.id)) return null;
  if (p.parent_thread_id || (p.source && typeof p.source === "object" && "subagent" in p.source)) return null;
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
    cwd: typeof p.cwd === "string" ? p.cwd : null,
    started: typeof meta!.timestamp === "string" ? meta!.timestamp : typeof p.timestamp === "string" ? p.timestamp : null,
    ended,
    accounts: typeof p.creator_user_id === "string" ? [p.creator_user_id] : [],
    prompt,
  };
}

// The rollouts a process on this side holds open: on Linux (WSL included) /proc says which files
// each process has, and Codex keeps its conversation's rollout open while it runs. Elsewhere it
// can't be told, so the empty set: the rollout's time is all there is.
export function openRollouts(): Set<string> | null {
  const open = new Set<string>();
  if (process.platform !== "linux") return null;
  let pids: string[] = [];
  try {
    pids = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n));
  } catch {
    return null; // no /proc to look at: the state is unknown, not "none open"
  }
  for (const pid of pids) {
    let fds: string[];
    try {
      fds = fs.readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue; // another user's, or gone
    }
    for (const fd of fds) {
      try {
        const target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
        if (/\/rollout-[^/]*\.jsonl$/.test(target)) open.add(target);
      } catch {
        // closed meanwhile
      }
    }
  }
  return open;
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
export function codexRunning(s: Pick<Session, "id" | "file" | "mtime">, here: boolean, now = Date.now(), open: Set<string> | null = here ? openRollouts() : null) {
  const mine = process.env.CODEX_THREAD_ID === s.id;
  return mine || (here && !!open && (open.has(s.file) || open.has(physical(s.file)))) || now - s.mtime < RECENT_MS;
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
  const walk = (at: string, depth: number) => {
    let entries: string[];
    try {
      entries = fs.readdirSync(at);
    } catch {
      return;
    }
    for (const name of entries) {
      if (depth < 3) walk(path.join(at, name), depth + 1);
      else if (/^rollout-.*\.jsonl$/.test(name)) files.push(path.join(at, name));
    }
  };
  walk(path.join(home, "sessions"), 0);
  return files;
}

// What the list of the other side was made from: its home, and its CODEX_HOME as it names it.
const originOf = (peer: Peer) => ({ home: peer.home, native: peerCodexNative(peer) });

// The conversation as it is now, looked at again from where it was listed: null when the other side or
// its CODEX_HOME is not the one listed (a profile re-pointed, another distro), or the conversation is gone.
// Every rollout of it is looked at, so one a /revert added since is seen.
export function codexNow(s: Session, probe?: () => Set<string> | null): Session | null {
  const peer = s.origin ? loadMachine().peer : undefined;
  if (s.origin && (!peer || peer.home !== s.origin.home || peerCodexNative(peer) !== s.origin.native)) return null;
  const dirs: CodexDir[] = [{ side: s.side, home: s.configDir, ...(peer ? { peer } : {}) }];
  return listCodexSessions(dirs, { fromPeer: () => null, ...(probe ? { probe } : {}) }).find((x) => x.id === s.id) ?? null;
}

// Every Codex conversation of the folders; under: only those started inside that folder.
export function listCodexSessions(dirs: CodexDir[], { under, now = Date.now(), fromPeer, probe = openRollouts }: { under?: string; now?: number; fromPeer: (p: string, peer: Peer) => string | null; probe?: () => Set<string> | null }): Session[] {
  const list: Session[] = [];
  const open = dirs.some((d) => !d.peer) ? probe() : null;
  for (const dir of dirs) {
    const names = titles(dir.home);
    // A conversation with more than one rollout (a /revert starts a new one, same id inside) is one
    // entry: the newest rollout; codex delete takes them all
    const byId = new Map<string, { file: string; st: fs.Stats; info: NonNullable<ReturnType<typeof summary>> }[]>();
    for (const file of rolloutFiles(dir.home)) {
      let st: fs.Stats;
      let info: ReturnType<typeof summary>;
      try {
        st = fs.statSync(file);
        info = summary(file);
      } catch {
        continue;
      }
      if (info) byId.set(info.id, [...(byId.get(info.id) ?? []), { file, st, info }]);
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
        running: group.some((g) => codexRunning({ id: info.id, file: g.file, mtime: g.st.mtimeMs }, !dir.peer, now, open)),
        pid: null,
        // Told only where the processes can be seen (Linux, WSL: /proc), and on this side
        checked: !dir.peer && open !== null,
        ...(dir.peer ? { origin: originOf(dir.peer) } : {}),
      });
    }
  }
  return list;
}

// Deletes a conversation through Codex: here, or on the other side when peer is set, in that side's
// CODEX_HOME when its ChatGPT profiles use one. True when Codex said it did. The id is a UUID, checked
// before it goes on a command line, and codex is looked for in the PATH's absolute folders only.
export type CodexDelete = (id: string, peer?: Peer) => boolean;
export const codexDelete: CodexDelete = (id, peer) => {
  if (!ID.test(id)) return false;
  if (peer) {
    return runOnPeer(peerAgentLine("codex", `delete --force ${id}`, process.platform, { CODEX_HOME: peerCodexNative(peer) })).status === 0;
  }
  const env = pathOnlyEnv();
  if (!Object.entries(env).some(([k, v]) => k.toUpperCase() === "PATH" && v)) return false; // an empty PATH searches the current folder
  // On Windows a codex npm installed is a .cmd, which only a shell runs
  return spawnSync("codex", ["delete", "--force", id], { encoding: "utf8", timeout: 60_000, windowsHide: true, shell: isWindows, env }).status === 0;
};
