// Claude Code's sessions on both sides of the machine: list them, archive one into its project's
// .artifacts/session-archives/ (the session-archive skill's parser, so the archive is the same
// file the skill writes), and delete one with everything Claude Code keeps for it. Every config
// folder is read: this side's ~/.claude and the other side's (core/peer.ts), since a profile's
// sessions live in the slot of the side that ran them (ADR 0011).
//
// A session still running is deleted only when the caller asks (the user confirmed, and it is
// archived first), ending its Claude Code on this side first. Running means: on this side, its
// sessions/<pid>.json names it while the process lives; on the other side, whose processes can't be probed from here, dotagents asks
// that side's dotagents (`sessions --running`), when the caller passes that adapter. Either way a
// transcript written in the last RECENT_MS counts as running too.

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type AccountLabels, archiveFile, parseTranscript, promptText, renderArchive } from "../skills/session-archive/scripts/archive-session.ts";
import { type ProcessProbe, defaultConfigDir, runningProcess, signedIn } from "./claude-code.ts";
import { isWindows } from "./common.ts";
import { type Peer, loadMachine, loadProfiles } from "./machine-state.ts";
import { report } from "./output.ts";
import { state } from "./state.ts";
import { profileAccount } from "./switch.ts";

export const RECENT_MS = 10 * 60_000;

// A config folder and the side it belongs to. peer: set for the other side's, whose paths have to
// be translated to be reached from here.
export type ConfigDir = { side: string; dir: string; peer?: Peer };

const thisSide = (peer?: Peer) => (isWindows ? "Windows" : peer?.name === "Windows" ? "WSL" : process.platform === "darwin" ? "macOS" : "Linux");

export function configDirs(): ConfigDir[] {
  const peer = loadMachine().peer;
  const dirs: ConfigDir[] = [{ side: thisSide(peer), dir: defaultConfigDir() }];
  if (peer) {
    const dir = path.join(peer.home, ".claude");
    if (fs.existsSync(dir)) dirs.push({ side: peer.name, dir, peer });
  }
  return dirs;
}

// A path written on the other side, as this side reaches it: C:\x is /mnt/c/x from WSL, and /x is
// \\wsl.localhost\<distro>\x from Windows (peer.home is $HOME through that share). Null when there
// is no way there.
export function fromPeer(p: string, peer: Peer, here: "posix" | "win32" = isWindows ? "win32" : "posix"): string | null {
  if (here === "posix") {
    const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(p);
    if (drive) return path.posix.join("/mnt", drive[1].toLowerCase(), drive[2].replace(/\\/g, "/"));
    const share = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.*)$/i.exec(p);
    return share ? share[1].replace(/\\/g, "/") : null;
  }
  const mnt = /^\/mnt\/([a-z])(?:\/(.*))?$/.exec(p);
  if (mnt) return `${mnt[1].toUpperCase()}:\\${(mnt[2] ?? "").replace(/\//g, "\\")}`;
  if (!p.startsWith("/")) return null;
  const nativeHome = peer.nativeHome.replace(/\//g, "\\");
  if (!peer.home.endsWith(nativeHome)) return null;
  return peer.home.slice(0, peer.home.length - nativeHome.length) + p.replace(/\//g, "\\");
}

export type Session = {
  id: string;
  side: string;
  configDir: string;
  file: string;
  // The working directory the session started in, as written, and as reached from this side.
  cwd: string | null;
  localCwd: string | null;
  title: string;
  started: string | null;
  ended: string | null;
  bytes: number;
  mtime: number;
  accounts: string[];
  // The project folder its archive goes to: the nearest folder up from the working directory with
  // .artifacts/session-archives/. Null outside a workspace that follows the standard.
  root: string | null;
  running: boolean;
  // The Claude Code process running it, on this side; null on the other side or with none.
  pid: number | null;
  // Whether `running` comes from the process records: always on this side; on the other side only
  // when its dotagents answered. When false, a session idle there for RECENT_MS counts as stopped.
  checked: boolean;
};

// The nearest folder at or above dir with .artifacts/session-archives/.
export function archiveRoot(dir: string | null) {
  if (!dir) return null;
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    try {
      if (fs.statSync(path.join(at, ".artifacts", "session-archives")).isDirectory()) return at;
    } catch {
      // Not here.
    }
    if (path.dirname(at) === at) return null;
  }
}

// The sessions this side's Claude Code processes are running: session id -> process id.
export function runningPids(configDir: string = defaultConfigDir(), running: ProcessProbe = runningProcess) {
  const ids = new Map<string, number>();
  let names: string[];
  try {
    names = fs.readdirSync(path.join(configDir, "sessions")).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return ids;
  }
  for (const name of names) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(configDir, "sessions", name), "utf8"));
      if (typeof s?.sessionId === "string" && typeof s.pid === "number" && running(s.pid, typeof s.procStart === "string" ? s.procStart : undefined)) ids.set(s.sessionId, s.pid);
    } catch {
      // Being rewritten: skipped.
    }
  }
  return ids;
}

// The sessions this side's Claude Code processes are running, by id.
export const runningIds = (configDir: string = defaultConfigDir(), running: ProcessProbe = runningProcess) => new Set(runningPids(configDir, running).keys());

const clip = (text: string, max: number) => {
  const flat = text.split(/\s+/).filter(Boolean).join(" ");
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : flat;
};

// What the list needs from a transcript, without the full parse: only the lines that carry it are
// read as JSON, so hundreds of long sessions list quickly.
const HEAD_BYTES = 256 * 1024;
const NL = 0x0a;
const parseLine = (text: string): Record<string, any> | null => {
  try {
    const obj = JSON.parse(text);
    return typeof obj === "object" && obj !== null && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
};

// Every line of buf holding marker, parsed. A byte search: the transcript is never decoded whole.
function linesWith(buf: Buffer, marker: string) {
  const needle = Buffer.from(marker);
  const found: Record<string, any>[] = [];
  for (let from = 0, at = buf.indexOf(needle); at >= 0; at = buf.indexOf(needle, from)) {
    const start = buf.lastIndexOf(NL, at) + 1;
    const end = buf.indexOf(NL, at);
    const obj = parseLine(buf.subarray(start, end < 0 ? buf.length : end).toString("utf8"));
    if (obj) found.push(obj);
    if (end < 0) break;
    from = end + 1;
  }
  return found;
}

function summary(file: string) {
  const buf = fs.readFileSync(file);
  let cwd: string | null = null;
  let started: string | null = null;
  let prompt: string | null = null;
  // The working directory, the start and the first prompt are near the top.
  for (const line of buf.subarray(0, HEAD_BYTES).toString("utf8").split("\n")) {
    if (cwd && started && prompt) break;
    const obj = parseLine(line);
    if (!obj) continue;
    if (!cwd && typeof obj.cwd === "string" && obj.cwd) cwd = obj.cwd;
    if (!started && typeof obj.timestamp === "string") started = obj.timestamp;
    if (!prompt && obj.type === "user" && !obj.isMeta && !obj.isSidechain && !("toolUseResult" in obj)) {
      const content = obj.message?.content;
      const isToolResult = Array.isArray(content) && content.some((b: any) => b?.type === "tool_result");
      prompt = (isToolResult ? "" : promptText(content)) || null;
    }
  }
  const titles = linesWith(buf, '"type":"ai-title"').map((o) => o.aiTitle).filter((t) => typeof t === "string" && t);
  const accounts: string[] = [];
  for (const o of linesWith(buf, '"type":"session-owner"')) if (typeof o.accountUuid === "string" && !accounts.includes(o.accountUuid)) accounts.push(o.accountUuid);
  // The last activity: the last timestamp, searched from the end.
  const key = Buffer.from('"timestamp":"');
  const tail = buf.lastIndexOf(key);
  const ended = tail >= 0 ? buf.subarray(tail + key.length, buf.indexOf(0x22, tail + key.length)).toString("utf8") : null;
  return { cwd, started, ended, accounts, title: clip(titles.at(-1) ?? prompt ?? "(no messages)", 80) };
}

// Asks the other side's dotagents which sessions its Claude Code is running; null when it can't
// say (no dotagents there, one older than `sessions --running`, or no answer in time). Runs a
// command there, so it goes through this adapter; the tests pass a fake one.
export type PeerRunning = (peer: Peer) => Set<string> | null;

// From Windows, bash -lic as in switch.ts: an interactive shell reads ~/.bashrc, where nvm sets Node
export const peerRunning: PeerRunning = () => {
  const run = isWindows
    ? spawnSync("wsl.exe", ["-e", "bash", "-lic", "dotagents sessions --running"], { encoding: "utf8", timeout: 30_000, windowsHide: true })
    : spawnSync("powershell.exe", ["-NoProfile", "-Command", "dotagents sessions --running"], { encoding: "utf8", timeout: 30_000, cwd: "/mnt/c" });
  if (run.status !== 0) return null;
  return new Set((run.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[0-9a-f-]{36}$/i.test(l)));
};

// The same question without blocking: a server that answers every 2 s can't wait the second or two
// powershell.exe or wsl.exe takes to start.
export const peerRunningLater = (): Promise<Set<string> | null> =>
  new Promise((resolve) => {
    const [command, args, cwd] = isWindows
      ? ["wsl.exe", ["-e", "bash", "-lic", "dotagents sessions --running"], undefined]
      : ["powershell.exe", ["-NoProfile", "-Command", "dotagents sessions --running"], "/mnt/c"];
    execFile(command, args, { encoding: "utf8", timeout: 30_000, windowsHide: true, cwd }, (err, stdout) => {
      resolve(err ? null : new Set(stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[0-9a-f-]{36}$/i.test(l))));
    });
  });

// peerRunning: how to ask the other side; without it, its sessions count as running only by RECENT_MS.
export type ListOptions = { dirs?: ConfigDir[]; under?: string; now?: number; running?: ProcessProbe; peerRunning?: PeerRunning };

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// Every session of the config folders, newest first; under: only those started inside that folder.
export function listSessions({ dirs = configDirs(), under, now = Date.now(), running = runningProcess, peerRunning: askPeer }: ListOptions = {}): Session[] {
  const list: Session[] = [];
  for (const cd of dirs) {
    // The other side is asked once, and only when it has a session to ask about.
    let asked = false;
    let peerLive: Set<string> | null = null;
    const liveThere = () => {
      if (!asked && cd.peer && askPeer) peerLive = askPeer(cd.peer);
      asked = true;
      return peerLive;
    };
    const pids = cd.peer ? null : runningPids(cd.dir, running);
    const live = pids && new Set(pids.keys());
    const projects = path.join(cd.dir, "projects");
    let slugs: string[];
    try {
      slugs = fs.readdirSync(projects);
    } catch {
      continue;
    }
    for (const slug of slugs) {
      let names: string[];
      try {
        names = fs.readdirSync(path.join(projects, slug)).filter((n) => n.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const name of names) {
        const file = path.join(projects, slug, name);
        let st: fs.Stats;
        let info: ReturnType<typeof summary>;
        try {
          st = fs.statSync(file);
          info = summary(file);
        } catch {
          continue;
        }
        const localCwd = info.cwd && cd.peer ? fromPeer(info.cwd, cd.peer) : info.cwd;
        if (under && !(localCwd && inside(localCwd, under))) continue;
        const id = path.basename(name, ".jsonl");
        const known = live ?? liveThere();
        list.push({
          id,
          side: cd.side,
          configDir: cd.dir,
          file,
          cwd: info.cwd,
          localCwd,
          title: info.title,
          started: info.started,
          ended: info.ended,
          bytes: st.size,
          mtime: st.mtimeMs,
          accounts: info.accounts,
          root: archiveRoot(localCwd),
          running: Boolean(known?.has(id)) || now - st.mtimeMs < RECENT_MS,
          pid: pids?.get(id) ?? null,
          checked: known !== null,
        });
      }
    }
  }
  // By the last activity the transcript records: a session that closes writes a few records late
  // (its title, its cost), so the file's time is not when the work stopped.
  const last = (s: Session) => (s.ended && Date.parse(s.ended)) || s.mtime;
  return list.sort((a, b) => last(b) - last(a));
}

// How each account is named: its profile and email, from the profiles' saved logins, and the
// email of the login in this side's slot. Only ids and emails, never a credential.
export function accountLabels(): AccountLabels {
  const labels: AccountLabels = new Map();
  for (const profile of loadProfiles()) {
    const account = profileAccount(profile);
    if (account && !labels.has(account.accountUuid)) labels.set(account.accountUuid, account.email ? `${profile.name} (${account.email})` : profile.name);
  }
  const slot = signedIn(defaultConfigDir());
  if (slot && !labels.has(slot.accountUuid) && slot.email) labels.set(slot.accountUuid, slot.email);
  return labels;
}

// Each account's profile color, for the lists to paint its name the way every other view does.
export function accountColors(): Map<string, string> {
  const colors = new Map<string, string>();
  for (const profile of loadProfiles()) {
    const account = profileAccount(profile);
    if (account && !colors.has(account.accountUuid)) colors.set(account.accountUuid, profile.color);
  }
  return colors;
}

// Writes a session's archive into its project; the file, or why it couldn't. Honors --dry-run.
export function archiveSession(s: Session, labels: AccountLabels = new Map()): { ok: true; file: string } | { ok: false; error: string } {
  if (!s.root) return { ok: false, error: "no .artifacts/session-archives/ in its project" };
  try {
    const session = parseTranscript(s.file);
    const file = archiveFile(s.root, session);
    const existed = fs.existsSync(file);
    const text = renderArchive(session, labels);
    if (!state.dryRun) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    report(state.dryRun ? (existed ? "would update" : "would create") : existed ? "updated" : "created", file, `archive of ${s.id}`);
    return { ok: true, file };
  } catch (err) {
    const error = (err as Error).message;
    report("failed", s.file, `couldn't archive: ${error}`);
    return { ok: false, error };
  }
}

// What Claude Code keeps for a session: the transcript, its folder (subagents, tool results), its
// file history and its shell environment.
export const sessionFiles = (s: Pick<Session, "id" | "file" | "configDir">) => [
  s.file,
  path.join(path.dirname(s.file), s.id),
  path.join(s.configDir, "file-history", s.id),
  path.join(s.configDir, "session-env", s.id),
];

// Ends a Claude Code process: asks it to stop, waits up to 5 seconds for it to go (it writes its
// transcript as it closes), then kills it. False when it was already gone.
export type ProcessStopper = (pid: number) => boolean;
export const stopProcess: ProcessStopper = (pid) => {
  const alive = () => runningProcess(pid);
  if (!alive()) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  const tick = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; waited < 5_000 && alive(); waited += 100) Atomics.wait(tick, 0, 0, 100);
  if (alive()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone meanwhile.
    }
  }
  return true;
};

// Deletes a session's files, and its project folder when nothing else is left in it. Refuses a
// running session unless evenRunning, which the caller sets only once the user confirmed and the
// session is archived: then its Claude Code process on this side is ended first, or the session
// would write its transcript again. One on the other side has only its files deleted. Honors
// --dry-run; files already gone are left alone, so it can run again.
export function deleteSession(s: Session, { evenRunning = false, stop = stopProcess }: { evenRunning?: boolean; stop?: ProcessStopper } = {}) {
  if (s.running && !evenRunning) {
    report("skipped", s.file, "still running; close it first");
    return false;
  }
  if (s.running && s.pid !== null) {
    if (state.dryRun) report("would update", s.file, `would end its Claude Code (process ${s.pid})`);
    else if (stop(s.pid)) report("updated", s.file, `ended its Claude Code (process ${s.pid})`);
  }
  for (const target of sessionFiles(s)) {
    if (!fs.existsSync(target)) continue;
    report(state.dryRun ? "would update" : "updated", target, "removed");
    if (!state.dryRun) fs.rmSync(target, { recursive: true, force: true });
  }
  const project = path.dirname(s.file);
  if (!state.dryRun && fs.existsSync(project) && !fs.readdirSync(project).length) {
    fs.rmdirSync(project);
    report("updated", project, "removed, now empty");
  }
  return true;
}
