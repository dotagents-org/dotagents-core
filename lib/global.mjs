// `agents install`: applies the global configuration to this machine.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDirLink, ensureFile, section, toSlash, writeGenerated } from "./common.mjs";

export const configHome = () => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");

// AGENTS.md has no machine paths: {{AGENTS_REPO}} becomes this clone's location, and the
// file for the current platform (env/win32.md, env/linux.md, env/darwin.md) is appended.
export function renderInstructions(repo) {
  let text = fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8");
  const envFile = path.join(repo, "env", `${process.platform}.md`);
  if (fs.existsSync(envFile)) text = `${text.trimEnd()}\n\n${fs.readFileSync(envFile, "utf8")}`;
  return text.replaceAll("{{AGENTS_REPO}}", toSlash(repo));
}

export function installGlobal(repo) {
  const home = os.homedir();

  section("Global instructions");
  const instructions = renderInstructions(repo);
  for (const dest of [
    path.join(home, ".claude", "CLAUDE.md"),
    path.join(home, ".codex", "AGENTS.md"),
    path.join(configHome(), "opencode", "AGENTS.md"),
  ]) {
    writeGenerated(dest, instructions, { onForeign: "backup" });
  }

  section("Global rules");
  ensureDirLink(path.join(home, ".claude", "rules"), path.join(repo, "rules"));

  section("Settings");
  ensureFile(path.join(repo, "claude", "settings.json"), path.join(home, ".claude", "settings.json"));
  ensureFile(path.join(repo, "opencode", "opencode.json"), path.join(configHome(), "opencode", "opencode.json"));
}
