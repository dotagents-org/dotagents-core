import { applyPeer } from "../../core/peer.ts";
import { installProfiles } from "../../core/profiles.ts";
import { finish, header } from "../../core/output.ts";
import type { Command } from "./shared.ts";

export const install: Command = {
  name: "install",
  usage: "",
  summary: "apply the global configuration to this machine",
  more: ["to ~/.claude and to every profile folder"],
  group: "Machine",
  run({ repo }) {
    header("install");
    installProfiles(repo);
    applyPeer();
    finish();
  },
};
