// usage --refresh: asks Claude Code itself for each profile's usage. `claude -p "/usage"` makes it
// fetch the usage, write it to the profile's cache and renew the profile's sign-in if needed,
// without a model reply (no quota spent) and, with --no-session-persistence, without leaving a
// session behind. dotagents never sees a token. Each profile is asked at most once every few
// minutes, since Claude Code's usage endpoint answers too many requests with 429.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CREDENTIAL_VARIABLES, defaultConfigDir } from "./claude-code.ts";
import { type Profile, loadProfiles, stateDir } from "./machine-state.ts";
import { PALETTE } from "./profiles.ts";
import { report, section } from "./output.ts";
import { state } from "./state.ts";

export const REFRESH_EVERY_MS = 3 * 60_000;

export type UsageAsker = (profile: Profile) => Promise<{ ok: boolean; detail: string }>;

// The real one: claude -p in the profile's folder, from the state folder, so Claude Code's project
// for it is that folder and not wherever the command ran.
export const claudeAsker: UsageAsker = (profile) =>
  new Promise((resolve) => {
    const env = { ...process.env };
    for (const v of CREDENTIAL_VARIABLES) delete env[v];
    if (profile.default) delete env.CLAUDE_CONFIG_DIR;
    else env.CLAUDE_CONFIG_DIR = profile.configDir;
    fs.mkdirSync(stateDir(), { recursive: true });
    const child = spawn("claude", ["-p", "--no-session-persistence", "/usage"], { cwd: stateDir(), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: process.platform === "win32" });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 90_000);
    child.on("error", (err) => (clearTimeout(timer), resolve({ ok: false, detail: err.message })));
    child.on("close", (code) => {
      clearTimeout(timer);
      const last = out.trim().split("\n").pop() ?? "";
      resolve(code === 0 && /used/i.test(out) ? { ok: true, detail: "" } : { ok: false, detail: last || `claude exited with ${code}` });
    });
  });

// When each profile was last asked, in the machine state.
const askedFile = () => path.join(stateDir(), "refresh.json");

function loadAsked(): Record<string, string> {
  try {
    const data = JSON.parse(fs.readFileSync(askedFile(), "utf8"));
    return typeof data?.asked === "object" && data.asked !== null ? data.asked : {};
  } catch {
    return {};
  }
}

function saveAsked(asked: Record<string, string>) {
  if (state.dryRun) return;
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(askedFile(), `${JSON.stringify({ version: 1, asked }, null, 2)}\n`);
}

export async function refreshUsage(now: Date, { ask = claudeAsker }: { ask?: UsageAsker } = {}) {
  section("Refresh");
  const saved = loadProfiles();
  const profiles = saved.length ? saved : [{ name: "claude", color: PALETTE[0], default: true, configDir: defaultConfigDir() }];
  const asked = loadAsked();
  const due = profiles.filter((p) => {
    const last = Date.parse(asked[p.name] ?? "");
    const wait = Number.isNaN(last) ? 0 : last + REFRESH_EVERY_MS - now.getTime();
    if (wait > 0) report("ok", p.name, `asked ${Math.ceil((now.getTime() - last) / 60_000)}m ago; again in ${Math.ceil(wait / 60_000)}m`);
    return wait <= 0;
  });
  if (state.dryRun) {
    for (const p of due) report("would update", p.name, "claude -p /usage");
    return;
  }
  for (const p of due) asked[p.name] = now.toISOString();
  saveAsked(asked);
  const results = await Promise.all(due.map(async (p) => ({ p, res: await ask(p) })));
  for (const { p, res } of results) report(res.ok ? "updated" : "failed", p.name, res.ok ? "asked Claude Code for the usage" : res.detail);
}
