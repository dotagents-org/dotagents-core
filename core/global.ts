// `dotagents install`: applies the global configuration to this machine.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defaultConfigDir, stateFile, userFiles } from "./claude-code.ts";
import { backup, configRoot, ensureDirLink, ensureFile, isWindows, lstat, mkdirFor, removeLink, writeGenerated } from "./common.ts";
import { loadCopies, recordCopy } from "./machine-state.ts";
import { checkItem, checkWarn, displayPath, report, section, toSlash } from "./output.ts";
import { state } from "./state.ts";


// The global instructions (config/global/instructions.md) have no machine paths: {{AGENTS_REPO}} becomes
// this clone's location, {{AGENTS_CONFIG}} the configuration's, and the file for the current platform (config/global/env/win32.md, linux.md, darwin.md)
// is appended. The template isn't named AGENTS.md, so Claude Code never mistakes it for project instructions.

export function renderInstructions(repo: string) {
  let text = fs.readFileSync(path.join(configRoot(repo), "global", "instructions.md"), "utf8");
  const envFile = path.join(configRoot(repo), "global", "env", `${process.platform}.md`);
  if (fs.existsSync(envFile)) text = `${text.trimEnd()}\n\n${fs.readFileSync(envFile, "utf8")}`;
  return text.replaceAll("{{AGENTS_CONFIG}}", toSlash(configRoot(repo))).replaceAll("{{AGENTS_REPO}}", toSlash(repo));
}

// Applies the configuration to one Claude Code config folder: ~/.claude by default. The settings
// are a link to this repository, or a copy on Windows (copy), where links need admin rights.
export function installGlobal(repo: string, configDir = defaultConfigDir(), { copy = isWindows }: { copy?: boolean } = {}) {
  const files = userFiles(configDir);

  section("Global instructions");
  writeGenerated(files.instructions, renderInstructions(repo), { onForeign: "backup" });

  section("Global rules");
  ensureDirLink(files.rules, path.join(configRoot(repo), "rules"));

  section("Settings");
  if (copy) syncSettingsCopy(settingsSource(repo), files.settings);
  else ensureFile(settingsSource(repo), files.settings);

  applyGlobalConfig(repo, stateFile(configDir));
}

const settingsSource = (repo: string) => path.join(configRoot(repo), "claude", "settings.json");
const globalConfigSource = (repo: string) => path.join(configRoot(repo), "claude", "global-config.json");

const readText = (file: string) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};
// An editor or an app on Windows may save with CRLF, which isn't a change.
const normalized = (text: string) => text.replace(/\r\n/g, "\n");
const digest = (text: string) => crypto.createHash("sha256").update(normalized(text)).digest("hex");

// A settings copy against the repository and against what install last copied there: the same,
// missing, behind the repository (only the repository changed), changed in the profile (/config
// wrote to it), or unknown (different, with no record of the last copy).
type CopyState = "same" | "missing" | "behind" | "changed" | "unknown";

function copyState(source: string, dest: string): CopyState {
  const copy = readText(dest);
  if (copy === null) return "missing";
  if (normalized(copy) === normalized(readText(source) ?? "")) return "same";
  const last = loadCopies()[path.resolve(dest)];
  if (!last) return "unknown";
  return digest(copy) === last ? "behind" : "changed";
}

function syncSettingsCopy(source: string, dest: string) {
  const st = lstat(dest);
  const current = st?.isSymbolicLink() ? "missing" : copyState(source, dest);
  const text = readText(source) ?? "";
  if (current === "same") {
    recordCopy(dest, digest(text));
    return report("ok", dest);
  }
  if (current === "changed") return report("skipped", dest, "changed in this profile (/config); keep it with: dotagents settings pull, or delete the file to take the repository's");
  if (state.dryRun) return report(st ? "would update" : "would create", dest);
  let detail = "";
  if (st?.isSymbolicLink()) removeLink(dest);
  else if (current === "unknown") detail = `backup: ${backup(dest)}`;
  mkdirFor(dest);
  fs.copyFileSync(source, dest);
  recordCopy(dest, digest(text));
  report(st ? "updated" : "created", dest, detail);
}

// The options Claude Code keeps in .claude.json instead of settings.json (the /config "global
// config"), which config/claude/global-config.json sets in every profile. Only these keys: the file also
// holds the sign-in and per-project state, which dotagents never touches.
export const GLOBAL_CONFIG_KEYS = [
  "autoConnectIde",
  "autoInstallIdeExtension",
  "claudeInChromeDefaultEnabled",
  "copyFullResponse",
  "copyOnSelect",
  "defaultToAgentsView",
  "diffTool",
  "externalEditorContext",
  "leftArrowOpensAgents",
  "prStatusFooterEnabled",
];

function readGlobalConfig(repo: string) {
  const file = globalConfigSource(repo);
  const text = readText(file);
  if (text === null) return { keys: {}, refused: [] as string[] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`${file} must be a JSON object`);
  const entries = Object.entries(data);
  return {
    keys: Object.fromEntries(entries.filter(([k]) => GLOBAL_CONFIG_KEYS.includes(k))),
    refused: entries.map(([k]) => k).filter((k) => !GLOBAL_CONFIG_KEYS.includes(k)),
  };
}

const differing = (data: Record<string, unknown>, keys: Record<string, unknown>) =>
  Object.entries(keys).filter(([k, v]) => JSON.stringify(data[k]) !== JSON.stringify(v));

function applyGlobalConfig(repo: string, file: string) {
  const { keys, refused } = readGlobalConfig(repo);
  if (!Object.keys(keys).length && !refused.length) return;
  section("Global config");
  for (const key of refused) report("skipped", globalConfigSource(repo), `${key} is not a /config global option dotagents sets`);
  if (!Object.keys(keys).length) return;
  const text = readText(file);
  if (text === null) return report("skipped", file, "Claude Code hasn't run in this profile yet; run install again after it does");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return report("skipped", file, "not valid JSON");
  }
  const changes = differing(data, keys);
  const shown = (list: [string, unknown][]) => list.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  if (!changes.length) return report("ok", file, shown(Object.entries(keys)));
  if (state.dryRun) return report("would update", file, shown(changes));
  // Claude Code rewrites this file often: write it whole and in one step, never half.
  const tmp = `${file}.dotagents-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...data, ...Object.fromEntries(changes) }, null, 2)}\n`);
  fs.renameSync(tmp, file);
  report("updated", file, shown(changes));
}

// Brings a settings change made in a profile (a copy, on Windows, that /config wrote to) into the
// repository, from where install takes it to the other profiles. from: the profile folder to take
// it from, when several changed in different ways.
export function pullSettings(repo: string, configDirs: string[], { from }: { from?: string } = {}) {
  const source = settingsSource(repo);
  const changed = configDirs.filter((dir) => {
    const dest = userFiles(dir).settings;
    return !lstat(dest)?.isSymbolicLink() && ["changed", "unknown"].includes(copyState(source, dest));
  });
  const picked = from ? changed.filter((dir) => path.resolve(dir) === path.resolve(from)) : changed;
  if (from && !picked.length) throw new Error(`The settings in ${displayPath(from)} didn't change; nothing to take from it`);
  section("Settings");
  if (!picked.length) return report("ok", source, "no profile changed its settings");
  const texts = new Set(picked.map((dir) => normalized(readText(userFiles(dir).settings) ?? "")));
  if (texts.size > 1) throw new Error(`The settings changed differently in ${picked.map(displayPath).join(" and ")}; pick one with --from <profile>`);
  const [text] = texts;
  if (state.dryRun) return report("would update", source, `from ${displayPath(userFiles(picked[0]).settings)}`);
  fs.writeFileSync(source, text);
  for (const dir of picked) recordCopy(userFiles(dir).settings, digest(text));
  report("updated", source, `from ${displayPath(userFiles(picked[0]).settings)}`);
}

// The checklist of the configuration every profile shares: settings copies that changed or fell
// behind, global config options changed in a profile, and changes in the repository that no other
// clone will get until they're committed.
export function verifyGlobal(repo: string, configDirs: string[]) {
  section("Configuration");
  const source = settingsSource(repo);
  const { keys } = readGlobalConfig(repo);
  for (const dir of configDirs) {
    const dest = userFiles(dir).settings;
    const st = lstat(dest);
    if (st && !st.isSymbolicLink()) {
      const current = copyState(source, dest);
      if (current === "changed" || current === "unknown") checkWarn(`${displayPath(dest)} changed in this profile`, "bring it to the repository with: dotagents settings pull");
      else if (current === "behind") checkWarn(`${displayPath(dest)} is behind the repository`, "update it with: dotagents install");
      else checkItem(true, `${displayPath(dest)} matches the repository`, "");
    }
    const text = readText(stateFile(dir));
    if (text === null) continue;
    try {
      for (const [key, value] of differing(JSON.parse(text), keys))
        checkWarn(`${key} in ${displayPath(stateFile(dir))} isn't the repository's ${JSON.stringify(value)}`, "change config/claude/global-config.json, or put it back with: dotagents install");
    } catch {
      // Not valid JSON: Claude Code reports that itself.
    }
  }
  const status = spawnSync("git", ["-C", configRoot(repo), "status", "--porcelain", "--", "claude/settings.json", "claude/global-config.json"], { encoding: "utf8" });
  if (status.status === 0 && status.stdout.trim())
    checkWarn("config/claude/settings.json or global-config.json changed and not committed", `commit them so your other clones get them: git -C ${displayPath(configRoot(repo))} commit`);
}
