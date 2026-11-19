// The other side of the machine: Windows seen from WSL, or WSL seen from Windows. install finds it
// once and records it in machine.json, so the usage can read that side's caches without asking
// Windows or WSL every time. Finding it runs a command on the other side, so it goes through an
// adapter: the tests pass a fake one.

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import { type Peer, loadMachine, machineFile, saveMachine } from "./machine-state.ts";
import { report, section } from "../output/output.ts";
import { state } from "../state.ts";
import { log } from "./log.ts";

export type PeerFinder = () => Peer | null;

const run = (command: string, args: string[], cwd?: string) => {
  const res = spawnSync(command, args, { encoding: "utf8", timeout: 15_000, cwd, windowsHide: true });
  if (res.status !== 0) log("core", "error", "peer find", `${command} ${args.join(" ")}: exit ${res.status}${res.error ? `, ${res.error.message}` : ""}\n${res.stderr ?? ""}`);
  return res.status === 0 ? res.stdout.replace(/\r/g, "").trim() : "";
};

export const inWsl = () => {
  try {
    return process.platform === "linux" && /microsoft/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
};

// WSL: Windows' %USERPROFILE%, reached through /mnt. Windows: the default distro's $HOME, reached
// through \\wsl.localhost. Nothing when there's no other side or it doesn't answer.
export const findPeer: PeerFinder = () => {
  if (inWsl()) {
    const native = run("cmd.exe", ["/c", "echo %USERPROFILE%"], "/mnt/c");
    const home = native && run("wslpath", ["-u", native]);
    return home && fs.existsSync(home) ? { name: "Windows", home, nativeHome: native } : null;
  }
  if (process.platform === "win32") {
    const native = run("wsl.exe", ["-e", "sh", "-c", "echo $HOME"]);
    const distro = run("wsl.exe", ["-e", "sh", "-c", "echo $WSL_DISTRO_NAME"]);
    if (!native.startsWith("/") || !distro) return null;
    const home = `\\\\wsl.localhost\\${distro}${native.replace(/\//g, "\\")}`;
    return fs.existsSync(home) ? { name: "WSL", home, nativeHome: native } : null;
  }
  return null;
};

// Whether the other side is up, without waking it: reading \\wsl.localhost starts the distro, so
// Windows asks wsl.exe which distros run (its list comes out in UTF-16). From WSL, Windows is up.
// Answers later, so a server that reads every 2 s never waits on wsl.exe.
export type PeerUp = (peer: Peer) => boolean | Promise<boolean>;

export const peerUp: PeerUp = (peer) => {
  if (process.platform !== "win32") return true;
  return new Promise((resolve) => {
    execFile("wsl.exe", ["--list", "--running", "--quiet"], { encoding: "buffer", timeout: 10_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      const names = stdout.toString("utf16le").replace(/\0/g, "").split(/\r?\n/).map((n) => n.trim().toLowerCase()).filter(Boolean);
      // \\wsl.localhost\<distro>\home\me
      const distro = peer.home.split("\\").filter(Boolean)[1]?.toLowerCase();
      resolve(distro ? names.includes(distro) : names.length > 0);
    });
  });
};

export function applyPeer(find: PeerFinder = findPeer) {
  section("Other side");
  const found = find();
  const known = loadMachine().peer;
  const same = JSON.stringify(found ?? null) === JSON.stringify(known ?? null);
  const shown = found ? `${found.name}: ${found.home}` : "none";
  if (same) return report("ok", machineFile(), shown);
  report(state.dryRun ? "would update" : "updated", machineFile(), shown);
  saveMachine(found ? { peer: found } : {});
}

// Whether a Node version runs dotagents: 24 or newer, the oldest LTS line the project supports.
export function nodeOk(version: string) {
  return Number(version.replace(/^v/, "").split(".")[0]) >= 24;
}

// Runs a command in a shell on the other side: from Windows, an interactive login bash in WSL (where
// nvm puts its Node); from WSL, PowerShell in C:. What doctor and the like need, not the switch.
export function runOnPeer(line: string) {
  return process.platform === "win32"
    ? spawnSync("wsl.exe", ["-e", "bash", "-lic", line], { encoding: "utf8", timeout: 60_000, windowsHide: true })
    : spawnSync("powershell.exe", ["-NoProfile", "-Command", line], { encoding: "utf8", timeout: 60_000, cwd: "/mnt/c" });
}

// The line that asks the other side for an agent's version, from the PATH's absolute folders only:
// a relative entry (".", "bin") would find a file of whatever folder it runs in. From Windows, WSL's
// bash looks through them with its own builtins, and runs the agent by its full path. From WSL it goes
// through cmd (/d: without its AutoRun): an agent npm installed on Windows has a codex.ps1 next to
// codex.cmd, and PowerShell, which prefers the .ps1, refuses it where scripts are blocked. cmd also
// looks in the current folder first unless NoDefaultCurrentDirectoryInExePath is set.
export const peerVersionLine = (command: string, platform: NodeJS.Platform = process.platform) =>
  platform === "win32"
    ? `IFS=:; for d in $PATH; do case $d in /*) [ -x "$d/${command}" ] && exec "$d/${command}" --version;; esac; done; exit 127`
    : `$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -match '^([a-zA-Z]:\\\\|\\\\\\\\)' }) -join ';'; $env:NoDefaultCurrentDirectoryInExePath = 1; cmd /d /c ${command} --version`;

// The environment for running an agent on this side: from the PATH's absolute folders only, never
// the current folder, which may be a repository with a claude.cmd or codex.cmd of its own (Node
// runs a shell command through cmd /d /s /c, without its AutoRun).
export function pathOnlyEnv(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const absolute = (dir: string) => (platform === "win32" ? /^([a-zA-Z]:[\\/]|\\\\)/.test(dir) : dir.startsWith("/"));
  const sep = platform === "win32" ? ";" : ":";
  return { ...env, [key]: (env[key] ?? "").split(sep).filter(absolute).join(sep), NoDefaultCurrentDirectoryInExePath: "1" };
}

// The version an agent's `<command> --version` printed ("2.1.327 (Claude Code)", "codex-cli
// 0.170.0"): the line in its own shape, past whatever the shell printed first (the other side's
// interactive bash may say which Node nvm uses), or null when the command isn't there or failed.
export function agentVersion(res: { status: number | null; stdout?: string | null; error?: Error }, shape: RegExp) {
  if (res.error || res.status !== 0) return null;
  return `${res.stdout ?? ""}`.replace(/\r/g, "").split("\n").map((l) => l.trim()).find((l) => shape.test(l)) ?? null;
}

// What the other side's `node --version; dotagents --version` says, as a check: passed, and what to do.
export function peerToolCheck(peer: string, res: { status: number | null; stdout?: string | null; stderr?: string | null; error?: Error }) {
  const out = `${res.stdout ?? ""}`.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const node = out.find((l) => /^v\d+\.\d+/.test(l));
  const setup = peer === "WSL" ? "in WSL: nvm install 24, then npm link in the dotagents clone there" : "on Windows: install Node 24 (nvm-windows), then npm link in the dotagents clone there";
  if (res.error || !node) return { passed: false, detail: `no Node answers on ${peer}; ${setup}` };
  if (!nodeOk(node)) return { passed: false, detail: `${peer} runs Node ${node}, and dotagents needs 24 or newer; ${setup}` };
  if (res.status !== 0 || out.length < 2) return { passed: false, detail: `dotagents doesn't run on ${peer}; ${setup}` };
  return { passed: true, detail: `Node ${node}, dotagents ${out[out.indexOf(node) + 1]}` };
}
