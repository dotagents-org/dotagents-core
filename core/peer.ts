// The other side of the machine: Windows seen from WSL, or WSL seen from Windows. install finds it
// once and records it in machine.json, so the usage can read that side's caches without asking
// Windows or WSL every time. Finding it runs a command on the other side, so it goes through an
// adapter: the tests pass a fake one.

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import { type Peer, loadMachine, machineFile, saveMachine } from "./machine-state.ts";
import { report, section } from "./output.ts";
import { state } from "./state.ts";

export type PeerFinder = () => Peer | null;

const run = (command: string, args: string[], cwd?: string) => {
  const res = spawnSync(command, args, { encoding: "utf8", timeout: 15_000, cwd, windowsHide: true });
  return res.status === 0 ? res.stdout.replace(/\r/g, "").trim() : "";
};

const inWsl = () => {
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
