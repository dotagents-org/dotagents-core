// What dotagents keeps per profile of its last usage reading, <state>/usage/<profile>.json: written
// by core/accounts/providers/claude-usage.ts for Claude and core/accounts/providers/codex-usage.ts for Codex, each in its own shape, and read by
// the snapshot, the checks and the prompt revision.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mask } from "../log.ts";
import { stateDir } from "../machine-state.ts";
import { writePrivate } from "./vault.ts";

// Each profile of every provider is asked at most once in this time, from any number of dotagents
// processes: about once a minute, so start, which ticks every minute, asks each one on every tick.
export const ASK_EVERY_MS = 55_000;
export const BACKOFF_MS = 60_000;
export const MAX_BACKOFF_MS = 15 * 60_000;

// What dotagents keeps per profile: the last usage, as Claude Code's cache keeps it (fetchedAtMs,
// accountUuid, utilization), and the last attempt, with its error and when to try again.
// refused: the mark of the login Anthropic last refused (a 401, a renewal turned down; loginMark in
// core/accounts/providers/claude-store.ts), which the checklist and the switch read; a good answer clears it.
export type LiveRecord = { fetchedAtMs?: number; accountUuid?: string; utilization?: unknown; askedAtMs?: number; failures?: number; retryAtMs?: number; error?: string; refused?: string };

const recordFile = (name: string, dir = stateDir()) => path.join(dir, "usage", `${name}.json`);

// Provider error messages reach the terminal and the local API. Redact identities and credentials.
export const maskUsageError = (text: string) => mask(text)
  .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
  .replace(/[A-Za-z0-9_\-.+/=]{32,}/g, "[redacted]")
  .replace(/[\r\n]+/g, " ");

export function readRecord(name: string, dir?: string): LiveRecord {
  try {
    const data = JSON.parse(fs.readFileSync(recordFile(name, dir), "utf8"));
    if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
    // An older version may have stored an upstream error before masking it.
    if (typeof data.error === "string") data.error = maskUsageError(data.error);
    return data;
  } catch {
    return {};
  }
}

// In one step, so a surface reading it never sees half a file.
export const writeRecord = (name: string, record: Record<string, unknown>) => writePrivate(recordFile(name), `${JSON.stringify({ version: 1, ...record }, null, 2)}\n`);

// A stable, non-secret mark for comparing a refused login with its renewed copy.
export const hashMark = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);
