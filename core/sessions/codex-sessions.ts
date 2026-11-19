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
import { peerCodexHome } from "../accounts/providers/codex-usage.ts";
import { isWindows } from "../common.ts";
import { type Peer, loadMachine } from "../machine/machine-state.ts";
import { pathOnlyEnv, runOnPeer } from "../machine/peer.ts";
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
function summary(file: string) {
  const buf = fs.readFileSync(file);
  let meta: Record<string, any> | null = null;
  let prompt: string | null = null;
  for (const line of buf.subarray(0, HEAD_BYTES).toString("utf8").split("\n")) {
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
  const key = Buffer.from('"timestamp":"');
  const tail = buf.lastIndexOf(key);
  const ended = tail >= 0 ? buf.subarray(tail + key.length, buf.indexOf(0x22, tail + key.length)).toString("utf8") : null;
  return {
    id: p.id as string,
    cwd: typeof p.cwd === "string" ? p.cwd : null,
    started: typeof meta!.timestamp === "string" ? meta!.timestamp : typeof p.timestamp === "string" ? p.timestamp : null,
    ended,
    accounts: typeof p.creator_user_id === "string" ? [p.creator_user_id] : [],
    prompt,
  };
}

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// Every Codex conversation of the folders; under: only those started inside that folder.
export function listCodexSessions(dirs: CodexDir[], { under, now = Date.now(), fromPeer }: { under?: string; now?: number; fromPeer: (p: string, peer: Peer) => string | null }): Session[] {
  const list: Session[] = [];
  for (const dir of dirs) {
    const names = titles(dir.home);
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
    walk(path.join(dir.home, "sessions"), 0);
    for (const file of files) {
      let st: fs.Stats;
      let info: ReturnType<typeof summary>;
      try {
        st = fs.statSync(file);
        info = summary(file);
      } catch {
        continue;
      }
      if (!info) continue;
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
        bytes: st.size,
        mtime: st.mtimeMs,
        accounts: info.accounts,
        root: archiveRoot(localCwd),
        running: now - st.mtimeMs < RECENT_MS,
        pid: null,
        checked: false,
      });
    }
  }
  return list;
}

// Deletes a conversation through Codex: here, or on the other side when peer is set. True when
// Codex said it did. The id is a UUID, checked before it goes on a command line.
export type CodexDelete = (id: string, peer?: Peer) => boolean;
export const codexDelete: CodexDelete = (id, peer) => {
  if (!ID.test(id)) return false;
  if (peer) return runOnPeer(`codex delete --force ${id}`).status === 0;
  // On Windows a codex npm installed is a .cmd, which only a shell runs: from the PATH only
  return spawnSync("codex", ["delete", "--force", id], { encoding: "utf8", timeout: 60_000, windowsHide: true, shell: isWindows, env: pathOnlyEnv() }).status === 0;
};
