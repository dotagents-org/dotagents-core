// `doctor`: whether dotagents can do its job on this machine, and what to do when it can't, in words
// for someone who doesn't know the tool: Node, the other side of the machine, the logins.

import { spawnSync } from "node:child_process";
import { checkItem, checkWarn, finish, header, section } from "../../../core/output/output.ts";
import { agentVersion, inWsl, nodeOk, peerToolCheck, peerVersionLine, runOnPeer } from "../../../core/machine/peer.ts";
import { providers } from "../../../core/accounts/providers.ts";
import { sideName, sidePeer } from "../../../core/machine/machine-state.ts";
import { verifyLogins } from "../../../core/accounts/profiles.ts";
import type { Command } from "../shared.ts";

export const doctor: Command = {
  name: "doctor",
  usage: "",
  summary: "check that dotagents can work here, and say what to do when it can't",
  more: ["Node on both sides, whether each side sees the other, Claude Code and Codex on each side, the logins"],
  group: "Machine",
  run() {
    header("doctor", sideName());
    section("Node");
    checkItem(nodeOk(process.version), `Node ${process.version} runs dotagents (24 or newer)`, "install a newer Node (nvm install 24), then npm link again in the dotagents clone");

    // Only WSL and Windows have another side
    if (inWsl() || process.platform === "win32") {
      section("The other side");
      const peer = sidePeer();
      const lost = inWsl()
        ? "WSL doesn't see Windows: check that /mnt/c is mounted and that cmd.exe runs from WSL, then run dotagents install"
        : "Windows doesn't see WSL: start the distro (open a WSL terminal), then run dotagents install";
      checkItem(Boolean(peer), peer ? `${sideName()} sees ${peer.name} at ${peer.home}` : "this side sees the other one", lost);
      if (peer) {
        const check = peerToolCheck(peer.name, runOnPeer("node --version; dotagents --version"));
        checkItem(check.passed, `dotagents runs on ${peer.name}${check.passed ? `: ${check.detail}` : ""}`, check.passed ? "" : check.detail);
      }
    }

    // The agents, on each side: one that is missing is a warning, since dotagents works without it
    section("Agents");
    const peer = inWsl() || process.platform === "win32" ? sidePeer() : null;
    for (const provider of providers()) {
      const { command, version: shape, install } = provider.cli;
      // On Windows an npm-installed agent is a .cmd, which only a shell runs
      const sides = [{ name: sideName(), res: spawnSync(command, ["--version"], { encoding: "utf8", timeout: 30_000, windowsHide: true, shell: process.platform === "win32" }) }];
      if (peer) sides.push({ name: peer.name, res: runOnPeer(peerVersionLine(command)) });
      for (const side of sides) {
        const version = agentVersion(side.res, shape);
        if (version) checkItem(true, `${provider.labels.tool} on ${side.name}: ${version}`);
        else checkWarn(`${provider.labels.tool} isn't on ${side.name}`, install);
      }
    }

    verifyLogins();
    finish();
  },
};
