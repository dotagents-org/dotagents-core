// `dotagents install`: applies the global configuration to this machine.

import { inWsl } from "./peer.ts";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defaultConfigDir, stateFile, userFiles } from "./claude-code.ts";
import { backup, configRoot, ensureDirLink, ensureFile, lstat, mkdirFor, removeLink, writeGenerated } from "./common.ts";
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
// are a copy of this repository's on every system (copy: false links them, for the tests), so
// what Claude Code writes there by itself (/model, /effort) never lands in the repository.
export function installGlobal(repo: string, configDir = defaultConfigDir(), { copy = true }: { copy?: boolean } = {}) {
  const files = userFiles(configDir);

  section("Global instructions");
  writeGenerated(files.instructions, renderInstructions(repo), { onForeign: "backup" });

  section("Global rules");
  ensureDirLink(files.rules, path.join(configRoot(repo), "rules"));

  section("Settings");
  if (copy) syncSettingsCopy(settingsSource(repo), files.settings);
  else ensureFile(settingsSource(repo), files.settings);

  applyGlobalConfig(repo, stateFile(configDir));
  applyMcpServers(repo, stateFile(configDir));
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

// The keys Claude Code writes into the settings by itself that belong to the machine, not to the
// configuration (docs/global-configuration.md): the model and effort chosen with /model and /effort,
// and the auto mode's environment, which /auto-mode-setup drafts from whichever project is open. A
// copy keeps its own: install doesn't overwrite them, settings pull doesn't take them, and a change
// in them is not a change.
export const MACHINE_KEYS = ["model", "modelSettings", "effortLevel", "autoMode"];

type Settings = Record<string, unknown>;
const parse = (text: string | null): Settings | null => {
  try {
    const data = JSON.parse(text ?? "");
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
};
const machineOf = (data: Settings) => Object.fromEntries(MACHINE_KEYS.filter((k) => k in data).map((k) => [k, data[k]]));
const withoutMachine = (data: Settings) => Object.fromEntries(Object.entries(data).filter(([k]) => !MACHINE_KEYS.includes(k)));
// The settings as compared: without the machine's keys (the text itself when it isn't JSON).
const shared = (text: string) => {
  const data = parse(text);
  return data ? JSON.stringify(withoutMachine(data)) : normalized(text);
};
const digest = (text: string) => crypto.createHash("sha256").update(shared(text)).digest("hex");
const asText = (data: Settings) => `${JSON.stringify(data, null, 2)}\n`;

// The repository's settings, with the machine's keys a copy already has (the repository's where it
// has none, so a new machine starts from them); the repository's text as it is when nothing differs.
function forCopy(source: string, copy: string | null) {
  const data = parse(source);
  const mine = parse(copy);
  if (!data || !mine) return source;
  const keep = machineOf(mine);
  return Object.entries(keep).every(([k, v]) => JSON.stringify(data[k]) === JSON.stringify(v)) ? source : asText({ ...data, ...keep });
}

// A settings copy against the repository and against what install last copied there: the same,
// missing, behind the repository (only the repository changed), changed in the profile (/config
// wrote to it), or unknown (different, with no record of the last copy).
type CopyState = "same" | "missing" | "behind" | "changed" | "unknown";

function copyState(source: string, dest: string): CopyState {
  const copy = readText(dest);
  if (copy === null) return "missing";
  if (shared(copy) === shared(readText(source) ?? "")) return "same";
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
  // A link (how Linux and macOS had it) points at the repository's file, whose machine keys it keeps
  const before = readText(dest);
  if (st?.isSymbolicLink()) removeLink(dest);
  else if (current === "unknown") detail = `backup: ${backup(dest)}`;
  mkdirFor(dest);
  fs.writeFileSync(dest, forCopy(text, before));
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

function writeJsonAtomic(file: string, data: Record<string, unknown>) {
  const tmp = `${file}.dotagents-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function applyGlobalConfig(repo: string, file: string) {
  const { keys, refused } = readGlobalConfig(repo);
  if (!Object.keys(keys).length && !refused.length) return;
  section("Global config");
  for (const key of refused) report("skipped", globalConfigSource(repo), `${key} is not a /config global option dotagents sets`);
  if (!Object.keys(keys).length) return;
  const text = readText(file);
  if (text === null) return report("skipped", file, "Claude Code hasn't run in this profile yet; run install again after it does");
  const data = parse(text);
  if (!data) return report("skipped", file, "not valid JSON");
  const changes = differing(data, keys);
  const shown = (list: [string, unknown][]) => list.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  if (!changes.length) return report("ok", file, shown(Object.entries(keys)));
  if (state.dryRun) return report("would update", file, shown(changes));
  // Claude Code rewrites this file often: write it whole and in one step, never half.
  writeJsonAtomic(file, { ...data, ...Object.fromEntries(changes) });
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
  const texts = new Set(picked.map((dir) => shared(readText(userFiles(dir).settings) ?? "")));
  if (texts.size > 1) throw new Error(`The settings changed differently in ${picked.map(displayPath).join(" and ")}; pick one with --from <profile>`);
  // The copy's settings, with the repository's machine keys: those stay the machine's
  const copy = readText(userFiles(picked[0]).settings) ?? "";
  const mine = parse(copy);
  const text = mine ? asText({ ...withoutMachine(mine), ...machineOf(parse(readText(source)) ?? {}) }) : copy;
  if (state.dryRun) return report("would update", source, `from ${displayPath(userFiles(picked[0]).settings)}`);
  fs.writeFileSync(source, text);
  for (const dir of picked) recordCopy(userFiles(dir).settings, digest(text));
  report("updated", source, `from ${displayPath(userFiles(picked[0]).settings)}`);
}

// The checklist of the configuration every profile shares: settings copies that changed or fell
// behind, global config options changed in a profile, and changes in the repository that no other
// clone will get until they're committed.
export function verifyGlobal(repo: string, configDirs: string[]) {
  section("Claude Code configuration");
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

// The MCP servers of claude/mcp-servers.json, with user scope, in each profile's .claude.json: what
// `claude mcp add --scope user` would write, for the system this runs on. The file names, for each
// server, how to run it on each system ("wsl", "win32", "linux", "darwin"): from WSL a server that
// drives Windows runs through cmd.exe, on Windows through cmd. Servers it doesn't name are left alone.
const mcpSource = (repo: string) => path.join(configRoot(repo), "claude", "mcp-servers.json");
export const mcpSystem = () => (process.platform === "linux" && inWsl() ? "wsl" : process.platform);

type McpServer = { type?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string };
const isServer = (v: unknown): v is McpServer => {
  const s = v as McpServer;
  return typeof v === "object" && v !== null && (typeof s.command === "string" || typeof s.url === "string") && (s.args === undefined || (Array.isArray(s.args) && s.args.every((a) => typeof a === "string")));
};

// This system's servers, as Claude Code writes them (a command is a stdio server with args and env).
export function mcpServersFor(repo: string, system = mcpSystem()): Record<string, McpServer> | null {
  const text = readText(mcpSource(repo));
  if (text === null) return null;
  const data = parse(text);
  if (!data) throw new Error(`${mcpSource(repo)} is not valid JSON`);
  const out: Record<string, McpServer> = {};
  for (const [name, systems] of Object.entries(data)) {
    const entry = (systems as Record<string, unknown> | null)?.[system];
    if (entry === undefined) continue;
    if (!isServer(entry)) throw new Error(`${mcpSource(repo)}: ${name} on ${system} needs a command or a url`);
    out[name] = entry.command ? { type: "stdio", command: entry.command, args: entry.args ?? [], env: entry.env ?? {} } : entry;
  }
  return out;
}

function applyMcpServers(repo: string, file: string) {
  const wanted = mcpServersFor(repo);
  if (!wanted || !Object.keys(wanted).length) return;
  section("MCP servers");
  const text = readText(file);
  if (text === null) return report("skipped", file, "Claude Code hasn't run in this profile yet; run install again after it does");
  const data = parse(text);
  if (!data) return report("skipped", file, "not valid JSON");
  const current = (data.mcpServers ?? {}) as Record<string, unknown>;
  const changes = Object.entries(wanted).filter(([name, server]) => JSON.stringify(current[name]) !== JSON.stringify(server));
  const names = (list: string[]) => list.join(", ");
  if (!changes.length) return report("ok", file, names(Object.keys(wanted)));
  if (state.dryRun) return report("would update", file, names(changes.map(([n]) => n)));
  // Claude Code rewrites this file often: write it whole and in one step, never half.
  writeJsonAtomic(file, { ...data, mcpServers: { ...current, ...Object.fromEntries(changes) } });
  report("updated", file, names(changes.map(([n]) => n)));
}
