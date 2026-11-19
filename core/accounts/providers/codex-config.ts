// Where Codex reads its configuration, and what `install` puts there. Codex has no rules folder,
// so the rules of the configuration go at the end of the one instructions file. The skills reach
// Codex as they reach Claude Code, per workspace: Codex reads .agents/skills in the repository and
// the folders above it, where the workspace standard links them. Each side of the machine writes
// its own Codex configuration when `install` runs there, as with Claude Code's (one config folder
// per side): this side never writes the other's. The accounts of Codex are in codex.ts.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { configRoot, writeGenerated } from "../../common.ts";
import { type McpServer, mcpServersFor, renderInstructions } from "../../global.ts";
import { checkItem, checkWarn, displayPath, report, section } from "../../output.ts";
import { state } from "../../state.ts";

// Codex's own folder: CODEX_HOME, or ~/.codex.
export const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

// The files dotagents writes in a Codex home folder. Codex reads AGENTS.override.md instead of
// AGENTS.md when the first has text, so dotagents never writes it, only warns about it.
export const codexFiles = (home: string) => ({
  instructions: path.join(home, "AGENTS.md"),
  override: path.join(home, "AGENTS.override.md"),
});

type OnPath = () => boolean;
// Whether a codex command is on the PATH.
export const codexOnPath: OnPath = () =>
  (process.env.PATH ?? "").split(path.delimiter).some((dir) => dir && ["codex", "codex.cmd", "codex.exe"].some((n) => fs.existsSync(path.join(dir, n))));

// Codex is installed on this side: the command on the PATH, or its home folder.
const installed = (onPath: OnPath) => onPath() || fs.existsSync(codexHome());

// The instructions, then each rule of the configuration under a heading of its own.
function codexInstructions(repo: string) {
  const dir = path.join(configRoot(repo), "rules");
  const rules = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort() : [];
  const text = renderInstructions(repo).trimEnd();
  if (!rules.length) return `${text}\n`;
  const body = rules.map((n) => fs.readFileSync(path.join(dir, n), "utf8").trim()).join("\n\n");
  return `${text}\n\n# Rules\n\nCodex has no rules folder, so the rules of the configuration follow here.\n\n${body}\n`;
}

// Runs the codex command (the MCP servers go through it): an adapter, so the tests use a fake one.
// Null when it doesn't run. From the temporary folder, so no trusted project's own servers mix
// with the user's. On Windows a codex that npm installed is a .cmd only a shell runs: there it
// doesn't run, and the servers are left for the user to add (no shell, so no argument of the
// configuration is ever read as a command).
export type CodexRun = (args: string[]) => string | null;
export const runCodex: CodexRun = (args) => {
  const res = spawnSync("codex", args, { encoding: "utf8", timeout: 60_000, windowsHide: true, cwd: os.tmpdir() });
  return res.status === 0 ? res.stdout : null;
};

// The MCP servers Codex has, as `codex mcp list --json` says them: name -> transport. Null when
// codex doesn't answer.
type Transport = { type?: string; command?: string; args?: string[] | null; env?: Record<string, string> | null; url?: string };
function codexMcpServers(run: CodexRun): Record<string, Transport> | null {
  const out = run(["mcp", "list", "--json"]);
  if (out === null) return null;
  try {
    const list = JSON.parse(out) as { name: string; transport: Transport }[];
    return Object.fromEntries(list.map((s) => [s.name, s.transport]));
  } catch {
    return null;
  }
}

// Codex keeps the env sorted by key, so the order doesn't count
const sorted = (env: Record<string, string> | null | undefined) => JSON.stringify(Object.entries(env ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const sameServer = (have: Transport | undefined, want: McpServer) =>
  have?.type === "stdio" && have.command === want.command && JSON.stringify(have.args ?? []) === JSON.stringify(want.args ?? []) && sorted(have.env) === sorted(want.env);

const NO_ANSWER = "codex didn't answer (on Windows, a codex installed with npm runs only through a shell)";

// The servers of claude/mcp-servers.json for this system, against Codex's: the command ones (stdio)
// it lacks or has otherwise, and the remote ones, which go to Codex by hand (they may carry headers
// or a transport Codex doesn't take, and adding one may start a browser sign-in). Null when the
// file names none; error when codex doesn't answer. ask: false only says what is wanted (--dry-run
// doesn't run codex, which writes in its folder even to list).
function mcpChanges(repo: string, run: CodexRun, ask = true) {
  const all = Object.entries(mcpServersFor(repo) ?? {});
  if (!all.length) return null;
  const wanted = all.filter(([, s]) => s.command);
  const remote = all.filter(([, s]) => !s.command).map(([n]) => n);
  if (!ask) return { wanted, remote, changes: wanted };
  const have = wanted.length ? codexMcpServers(run) : {};
  if (!have) return { error: NO_ANSWER, wanted, remote };
  return { wanted, remote, changes: wanted.filter(([name, server]) => !sameServer(have[name], server)) };
}

const names = (list: [string, McpServer][]) => list.map(([n]) => n).join(", ");
const remoteHint = (remote: string[]) => `add ${remote.join(", ")} to Codex by hand: codex mcp add <name> --url <url>`;

// The same MCP servers as Claude Code's, in Codex through its own `codex mcp add`, which writes them
// in [mcp_servers] of config.toml and leaves the rest of the file alone. Servers the file doesn't
// name stay as they are.
function applyCodexMcp(repo: string, run: CodexRun) {
  const found = mcpChanges(repo, run, !state.dryRun);
  if (!found) return;
  const target = displayPath(path.join(codexHome(), "config.toml"));
  if (found.remote.length) report("skipped", target, remoteHint(found.remote));
  if (!found.wanted.length) return;
  if ("error" in found) return report("skipped", target, `MCP servers: ${found.error}; add ${names(found.wanted)} with codex mcp add`);
  if (!found.changes.length) return report("ok", target, `MCP servers: ${names(found.wanted)}`);
  if (state.dryRun) return report("would update", target, `MCP servers Codex lacks among ${names(found.changes)}`);
  const failed = found.changes.filter(([name, s]) => {
    const env = Object.entries(s.env ?? {}).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
    return run(["mcp", "add", name, ...env, "--", s.command!, ...(s.args ?? [])]) === null;
  });
  if (failed.length) report("failed", target, `codex mcp add failed for ${names(failed)}`);
  else report("updated", target, `MCP servers: ${names(found.changes)}`);
}

// Applies the configuration to Codex, when it is installed here: AGENTS.md (an older one dotagents
// generated is replaced, any other is backed up first), and the MCP servers through codex itself.
// Nothing else in config.toml: Codex writes to it itself.
export function installCodex(repo: string, { onPath = codexOnPath, run = runCodex }: { onPath?: OnPath; run?: CodexRun } = {}) {
  if (!installed(onPath)) return;
  section("Codex configuration");
  writeGenerated(codexFiles(codexHome()).instructions, codexInstructions(repo), { onForeign: "backup" });
  applyCodexMcp(repo, run);
}

// The checklist of that configuration: the instructions current, and nothing shadowing them.
export function verifyCodexConfig(repo: string, { onPath = codexOnPath, run = runCodex }: { onPath?: OnPath; run?: CodexRun } = {}) {
  if (!installed(onPath)) return;
  section("Codex configuration");
  const files = codexFiles(codexHome());
  let current: string | null = null;
  try {
    current = fs.readFileSync(files.instructions, "utf8").replace(/\r\n/g, "\n");
  } catch {
    // Missing: said below.
  }
  const [marker = "", ...rest] = (current ?? "").split("\n");
  if (current === null) checkItem(false, `${displayPath(files.instructions)} is missing`, "write it with: dotagents install");
  else if (!marker.includes("generated by dotagents")) checkWarn(`${displayPath(files.instructions)} isn't generated by dotagents`, "install keeps a backup and replaces it: dotagents install");
  else checkItem(rest.join("\n") === codexInstructions(repo), `${displayPath(files.instructions)} has the instructions and the rules`, "update it with: dotagents install");
  try {
    if (fs.readFileSync(files.override, "utf8").trim()) checkWarn(`${displayPath(files.override)} has text, so Codex reads it instead of AGENTS.md`, "remove it, or put what it says in the configuration");
  } catch {
    // No override: the normal case.
  }
  const mcp = mcpChanges(repo, run);
  if (!mcp || !mcp.wanted.length) return;
  if ("error" in mcp) checkWarn(`Codex's MCP servers can't be read: ${mcp.error}`, `add ${names(mcp.wanted)} with codex mcp add`);
  else checkItem(!mcp.changes.length, `Codex has the MCP servers of the configuration: ${names(mcp.wanted)}`, `add ${names(mcp.changes)} with: dotagents install`);
}
