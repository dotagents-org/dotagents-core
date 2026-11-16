// `profile add`, `profile list` and `profile remove`: the Claude profiles of this machine.

import { verifyGlobal } from "../../core/global.ts";
import { configDirs, dropProfile, setUpProfile, verifyLogins, verifyProfiles } from "../../core/accounts/profiles.ts";
import { activeProfiles, providerFor, providers, verifyProviderConfigs } from "../../core/accounts/providers.ts";
import { loadProfiles } from "../../core/machine-state.ts";
import { fancy, finish, header, line, paint, tone } from "../../core/output.ts";
import type { Command } from "./shared.ts";

const { bold, muted } = tone;

export const profileAdd: Command = {
  name: "profile add",
  usage: "<name> [--default] [--provider codex]",
  summary: "add a profile, one claude.ai account or one ChatGPT account for Codex",
  more: ["--default: the one the normal Desktop app opens;", "--color #RRGGBB: its color in the listings;", "--provider codex: a ChatGPT account for Codex"],
  group: "Profiles",
  run({ repo, args, positional }) {
    const name = positional[0];
    if (!name) throw new Error("Usage: dotagents profile add <name> [--default] [--color #RRGGBB] [--provider codex]");
    header("profile add", name);
    setUpProfile(repo, { name, isDefault: args.default, color: args.color, provider: args.provider });
    const profile = loadProfiles().find((a) => a.name === name);
    const provider = profile && providerFor(profile);
    finish(profile && provider && !provider.account(profile) ? provider.addHint(name) : "");
  },
};

export const profileList: Command = {
  name: "profile list",
  usage: "",
  summary: "list the profiles and check them",
  group: "Profiles",
  run({ repo }) {
    const profiles = activeProfiles();
    if (!profiles.length) {
      const hint = "No profiles yet. Add one per claude.ai account, the first with: dotagents profile add <name> --default";
      return console.log(fancy ? muted(hint) : hint);
    }
    header("profile list", `${profiles.length} profile${profiles.length === 1 ? "" : "s"}`);
    const width = Math.max(...profiles.map((a) => a.name.length)) + 2;
    const inSlot = providers().map((p) => p.slotProfile()?.name);
    for (const a of profiles) {
      const who = providerFor(a).account(a);
      const email = who ? who.shown : "no saved login";
      const slot = inSlot.includes(a.name) ? "in the slot" : "";
      if (!fancy) {
        console.log(`${a.name.padEnd(width)}${a.default ? "default  " : "         "}${email}${slot ? `  ${slot}` : ""}`);
        continue;
      }
      line();
      line(`${bold(paint(a.color)(a.name.padEnd(width)))}${a.default ? muted("[default]  ") : "           "}${who ? email : muted(email)}${slot ? `  ${tone.ok(slot)}` : ""}`);
    }
    verifyProfiles();
    verifyGlobal(repo, configDirs());
    verifyProviderConfigs(repo);
    verifyLogins();
    finish();
  },
};

export const profileRemove: Command = {
  name: "profile remove",
  usage: "<name>",
  summary: "forget a profile; its saved login is kept",
  group: "Profiles",
  run({ positional }) {
    const name = positional[0];
    if (!name) throw new Error("Usage: dotagents profile remove <name>");
    header("profile remove", name);
    dropProfile(name);
    finish();
  },
};
