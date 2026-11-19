#!/usr/bin/env node
// `dotagents`: the entry file. Make it a command with `npm install && npm link` in the clone.
// It turns on Node's compile cache before main.ts loads the command, which roughly halves the
// start; main.ts's static imports would load before any line of its own. A dry run writes nothing,
// so it goes without the cache.

import module from "node:module";

// --dry-run or --dry-run=<anything>, as parseArgs (core/common.ts) reads it
const dryRun = process.argv.some((arg) => arg === "--dry-run" || arg.startsWith("--dry-run="));
if (!dryRun) module.enableCompileCache();
await import("./main.ts");
