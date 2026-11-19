#!/usr/bin/env node
// `dotagents`: the entry file. Make it a command with `npm install && npm link` in the clone.
// It turns on Node's compile cache before main.ts loads the command, which roughly halves the
// start; main.ts's static imports would load before any line of its own. A dry run writes nothing,
// so it goes without the cache.

import fs from "node:fs";
import module from "node:module";
import os from "node:os";
import path from "node:path";

// This user's own cache folder: Node's default, the temporary folder, is shared on Linux, and another
// account could plant code in it. A relative folder in the environment is ignored (the XDG spec says
// so): it would put the cache in whatever folder the command runs in.
const fromEnv = (name: string) => {
  const value = process.env[name];
  return value && path.isAbsolute(value) ? value : null;
};
const cacheRoot =
  process.platform === "win32"
    ? fromEnv("LOCALAPPDATA") ?? path.join(os.homedir(), "AppData", "Local")
    : fromEnv("XDG_CACHE_HOME") ?? path.join(os.homedir(), ".cache");

const cacheDir = path.join(cacheRoot, "dotagents", "compile-cache");

// Node runs what it finds in the cache, so it is used only when the folder is this user's and no
// one else can write to it; created for the user alone. Windows keeps LOCALAPPDATA per user.
function privateCache() {
  if (process.platform === "win32") return true;
  try {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(cacheDir);
    return stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

// --dry-run or --dry-run=<anything>, as parseArgs (core/common.ts) reads it
const dryRun = process.argv.some((arg) => arg === "--dry-run" || arg.startsWith("--dry-run="));
if (!dryRun && privateCache()) module.enableCompileCache(cacheDir);
await import("./main.ts");
