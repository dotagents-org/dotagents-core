// `doctor`: whether dotagents can do its job on this machine, and what to do when it can't, in words
// for someone who doesn't know the tool: Node, the other side of the machine, the logins.

import { checkItem, finish, header, section } from "../../core/output.ts";
import { inWsl, nodeOk, peerToolCheck, runOnPeer } from "../../core/peer.ts";
import { sideName, sidePeer } from "../../core/machine-state.ts";
import { verifyLogins } from "../../core/accounts/profiles.ts";
import type { Command } from "./shared.ts";

export const doctor: Command = {
  name: "doctor",
  usage: "",
  summary: "check that dotagents can work here, and say what to do when it can't",
  more: ["Node on both sides, whether each side sees the other, the logins"],
  group: "Machine",
  run() {
    header("doctor", sideName());
    section("Node");
    checkItem(nodeOk(process.version), `Node ${process.version} runs dotagents (22.18 or newer)`, "install a newer Node (nvm install 24), then npm link again in the dotagents clone");

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

    verifyLogins();
    finish();
  },
};
