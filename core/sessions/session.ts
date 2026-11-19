// What every agent's conversation looks like in the sessions list, Claude Code's
// (core/sessions/sessions.ts) and Codex's (core/sessions/codex-sessions.ts).


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
