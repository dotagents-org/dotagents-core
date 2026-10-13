#!/usr/bin/env node
// Installs this repository's global configuration for Claude Code, Codex and OpenCode.
// Works on Windows, Linux and macOS. Safe to run again: what is already right stays as is.
//
// Usage: node install.mjs [--dry-run]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDirLink, ensureFile, finish, parseArgs, section, state, toSlash, writeGenerated } from "./lib/common.mjs";

const HELP = `Usage: node install.mjs [--dry-run]

  Global instructions  AGENTS.md (+ env/<platform>.md) rendered into ~/.claude/CLAUDE.md,
                       ~/.codex/AGENTS.md and ~/.config/opencode/AGENTS.md
  Global rules         ~/.claude/rules linked to rules/
  Settings             claude/settings.json and opencode/opencode.json
                       (symlinks on Linux/macOS, copies on Windows)

Run it again after editing AGENTS.md, env/ or, on Windows, the settings files.
Skills are not global: each workspace links its own with init-workspace.mjs.`;

const args = parseArgs(process.argv.slice(2), { booleans: ["dry-run", "help"] });
if (args.help) {
  console.log(HELP);
  process.exit(0);
}
state.dryRun = Boolean(args["dry-run"]);

const repo = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");

// AGENTS.md has no machine paths: {{AGENTS_REPO}} becomes this clone's location, and the
// file for the current platform (env/win32.md, env/linux.md, env/darwin.md) is appended.
function renderInstructions() {
  let text = fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8");
  const envFile = path.join(repo, "env", `${process.platform}.md`);
  if (fs.existsSync(envFile)) text = `${text.trimEnd()}\n\n${fs.readFileSync(envFile, "utf8")}`;
  return text.replaceAll("{{AGENTS_REPO}}", toSlash(repo));
}

section("Global instructions");
const instructions = renderInstructions();
for (const dest of [
  path.join(home, ".claude", "CLAUDE.md"),
  path.join(home, ".codex", "AGENTS.md"),
  path.join(configHome, "opencode", "AGENTS.md"),
]) {
  writeGenerated(dest, instructions, { onForeign: "backup" });
}

section("Global rules");
ensureDirLink(path.join(home, ".claude", "rules"), path.join(repo, "rules"));

section("Settings");
ensureFile(path.join(repo, "claude", "settings.json"), path.join(home, ".claude", "settings.json"));
ensureFile(path.join(repo, "opencode", "opencode.json"), path.join(configHome, "opencode", "opencode.json"));

finish();
