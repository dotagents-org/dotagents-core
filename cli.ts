#!/usr/bin/env node
// `dotagents`: the entry file. Make it a command with `npm install && npm link` in the clone.
// It turns on Node's compile cache before main.ts loads the command, which roughly halves the
// start; main.ts's static imports would load before any line of its own. A dry run writes nothing,
// so it goes without the cache.

import fs from "node:fs";
import module from "node:module";
import os from "node:os";
import path from "node:path";

// Node runs what it finds in the cache, so it lives where only this user can write: never the
// temporary folder (Node's default, shared on Linux) nor a folder named by the environment, which
// could be shared. On Windows, LOCALAPPDATA is the user's own.
const home = os.homedir();
const windows = process.platform === "win32";
const localAppData = process.env.LOCALAPPDATA;
const cacheRoot = windows ? (localAppData && path.isAbsolute(localAppData) ? localAppData : path.join(home, "AppData", "Local")) : path.join(home, ".cache");
const cacheDir = path.join(cacheRoot, "dotagents", "compile-cache");

// On Linux and macOS, every folder from the home folder down to the cache is created for this user
// alone, belongs to them and no one else can write to it; otherwise the command runs without the cache.
function privateCache() {
  if (windows) return true;
  try {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const below = path.relative(home, cacheDir).split(path.sep);
    return below.every((_, i) => {
      const stat = fs.lstatSync(path.join(home, ...below.slice(0, i + 1)));
      return stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o022) === 0;
    });
  } catch {
    return false;
  }
}

// --dry-run or --dry-run=<anything>, as parseArgs (core/common.ts) reads it
const dryRun = process.argv.some((arg) => arg === "--dry-run" || arg.startsWith("--dry-run="));
if (!dryRun && !process.env.NODE_DISABLE_COMPILE_CACHE && privateCache()) module.enableCompileCache(cacheDir);
await import("./main.ts");
