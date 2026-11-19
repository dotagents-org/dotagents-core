#!/usr/bin/env node
// `dotagents`: the entry file. Make it a command with `npm install && npm link` in the clone.
// It turns on Node's compile cache before main.ts loads the command, which roughly halves the
// start; main.ts's static imports would load before any line of its own. A dry run writes nothing,
// so it goes without the cache.

import module from "node:module";
import os from "node:os";
import path from "node:path";

// This user's own cache folder: Node's default, the temporary folder, is shared on Linux, and another
// account could plant code in it.
const cacheRoot =
  process.platform === "win32"
    ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
    : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");

// --dry-run or --dry-run=<anything>, as parseArgs (core/common.ts) reads it
const dryRun = process.argv.some((arg) => arg === "--dry-run" || arg.startsWith("--dry-run="));
if (!dryRun) module.enableCompileCache(path.join(cacheRoot, "dotagents", "compile-cache"));
await import("./main.ts");
