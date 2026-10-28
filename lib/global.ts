// `dotagents install`: applies the global configuration to this machine.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConfigDir, userFiles } from "./claude-code.ts";
import { ensureDirLink, ensureFile, writeGenerated } from "./common.ts";
import { section, toSlash } from "./output.ts";

export const configHome = () => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");

// The global instructions (global/instructions.md) have no machine paths: {{AGENTS_REPO}} becomes this
// clone's location, and the file for the current platform (global/env/win32.md, linux.md, darwin.md)
// is appended. The template isn't named AGENTS.md, so Claude Code never mistakes it for project instructions.

export function renderInstructions(repo: string) {
  let text = fs.readFileSync(path.join(repo, "global", "instructions.md"), "utf8");
  const envFile = path.join(repo, "global", "env", `${process.platform}.md`);
  if (fs.existsSync(envFile)) text = `${text.trimEnd()}\n\n${fs.readFileSync(envFile, "utf8")}`;
  return text.replaceAll("{{AGENTS_REPO}}", toSlash(repo));
}

// Applies the configuration to one Claude Code config folder: ~/.claude by default.
export function installGlobal(repo: string, configDir = defaultConfigDir()) {
  const files = userFiles(configDir);

  section("Global instructions");
  writeGenerated(files.instructions, renderInstructions(repo), { onForeign: "backup" });

  section("Global rules");
  ensureDirLink(files.rules, path.join(repo, "rules"));

  section("Settings");
  ensureFile(path.join(repo, "claude", "settings.json"), files.settings);
}
