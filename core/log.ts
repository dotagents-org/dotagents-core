// The logs of what runs on its own (the local API and the commands here, the sidebar's extension and
// its host process): one text file each, in <stateDir>/logs/, so an error on either side of the
// machine can be read from files. The format is the contract docs/logs.md describes; the sidebar
// writes it with a copy of this writer of its own (it has no build and doesn't import from here).
//
// Writing never fails the program, and credentials never get in: every line is masked first.

import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./machine-state.ts";

export type LogName = "core" | "sidebar" | "host";
export type Level = "info" | "error";

// Past this size a file becomes <name>.log.1, replacing the one before, and starts again.
const ROTATE_AT = 1024 * 1024;

export const logsDir = (state = stateDir()) => path.join(state, "logs");
export const logFile = (name: LogName, state = stateDir()) => path.join(logsDir(state), `${name}.log`);

// A token, key or header's value, however it is written: sk-ant-..., "accessToken": "...",
// x-dotagents-token: ..., Bearer ....
const SECRETS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]"],
  [/((?:access|refresh)Token["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[redacted]"],
  [/(x-dotagents-token["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[redacted]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]"],
];

export const mask = (text: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), text);

// One line per event, `2026-11-13T15:53:52.881Z error start: the message`; what follows (a stack,
// a command's stderr) comes under it, indented.
export function format(level: Level, source: string, message: string | Error, now = new Date()) {
  const body = message instanceof Error ? message.stack || message.message : message;
  const [first, ...rest] = mask(body).replace(/\r/g, "").trimEnd().split("\n");
  return [`${now.toISOString()} ${level} ${source}: ${first}`, ...rest.map((l) => `  ${l.trim()}`)].join("\n") + "\n";
}

export function log(name: LogName, level: Level, source: string, message: string | Error) {
  try {
    const file = logFile(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > ROTATE_AT) {
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      }
    } catch {
      // no file yet
    }
    fs.appendFileSync(file, format(level, source, message), { mode: 0o600 });
  } catch {
    // a log that can't be written is not worth stopping for
  }
}

// For what fails again and again (the other side not answering every 15 s): written when the message
// changes, not on every try. null says it works now, so the next failure is written again.
const said = new Map<string, string | null>();
export function logChange(name: LogName, level: Level, source: string, message: string | null) {
  const key = `${name} ${source}`;
  if ((said.get(key) ?? null) === message) return;
  said.set(key, message);
  if (message !== null) log(name, level, source, message);
}
