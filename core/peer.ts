// The other side of the machine: Windows seen from WSL, or WSL seen from Windows. install finds it
// once and records it in machine.json, so the usage can read that side's caches without asking
// Windows or WSL every time. Finding it runs a command on the other side, so it goes through an
// adapter: the tests pass a fake one.

import { spawnSync } from "node:child_process";
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
