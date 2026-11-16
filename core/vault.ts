// Where each profile's saved login waits, <state>/vault/<profile>/, readable only by the user, and
// what every change to a login takes: one lock across dotagents' processes and whole-file writes.

import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./machine-state.ts";
import { state } from "./state.ts";

export const vaultDir = (name: string) => path.join(stateDir(), "vault", name);

// One lock across dotagents' processes around every change to a login (a switch, a renewal), so a
// switch never copies a token that a renewal is spending. A lock older than LOCK_STALE_MS was left
// by a process that died, and is taken over.
const lockFile = () => path.join(stateDir(), "logins.lock");
const LOCK_STALE_MS = 60_000;

export async function withLoginLock<T>(fn: () => T | Promise<T>, waitMs = 30_000): Promise<T> {
  if (state.dryRun) return fn();
  fs.mkdirSync(stateDir(), { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(lockFile(), `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const since = fs.statSync(lockFile(), { throwIfNoEntry: false })?.mtimeMs;
      if (since !== undefined && Date.now() - since > LOCK_STALE_MS) fs.rmSync(lockFile(), { force: true });
      else if (Date.now() > until) throw new Error(`Another dotagents is changing a login (${lockFile()}); try again`);
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lockFile(), { force: true });
  }
}

// Writes a file whole and in one step (a temporary file renamed over it), readable only by the user.
export function writePrivate(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.dotagents-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
