// What every agent's conversation looks like in the sessions list, Claude Code's
// (core/sessions/sessions.ts) and Codex's (core/sessions/codex-sessions.ts).

import fs from "node:fs";
import path from "node:path";

export const RECENT_MS = 10 * 60_000;

export type Session = {
  id: string;
  // Whose conversation: Claude Code's transcript, or Codex's rollout (core/sessions/codex-sessions.ts).
  agent: "claude" | "codex";
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
  // .artifacts/sessions/. Null outside a workspace that follows the standard.
  root: string | null;
  running: boolean;
  // A Codex rollout held open on this side, even when the process probe was incomplete.
  rolloutOpen?: boolean;
  // The Claude Code process running it, on this side; null on the other side or with none.
  pid: number | null;
  // Whether `running` comes from the process records: always on this side; on the other side only
  // when its dotagents answered. When false, a session idle there for RECENT_MS counts as stopped.
  checked: boolean;
  // For a Codex conversation on the other side: what it was listed from (that side's home, and its CODEX_HOME
  // as that side names it), so a deletion goes where the list looked, or not at all.
  origin?: { home: string; native: string };
};

// The nearest folder at or above dir with .artifacts/sessions/.
export function archiveRoot(dir: string | null) {
  if (!dir) return null;
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    try {
      if (fs.statSync(path.join(at, ".artifacts", "sessions")).isDirectory()) return at;
    } catch {
      // Not here.
    }
    if (path.dirname(at) === at) return null;
  }
}
