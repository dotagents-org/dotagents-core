// `profile add`, `profile list` and `profile remove`: the Claude and ChatGPT profiles of this machine.

import { verifyGlobal } from "../../../core/machine/global.ts";
import { configDirs, dropProfile, setUpProfile, verifyLogins, verifyProfiles } from "../../../core/accounts/profiles.ts";
import { listedProfiles, providerFor, providers, verifyProviderConfigs } from "../../../core/accounts/providers.ts";
import { loadProfiles } from "../../../core/machine/machine-state.ts";
import { fancy, finish, header, line, paint, tone } from "../../../core/output/output.ts";
import { plural, type Command } from "../shared.ts";

const { bold, muted } = tone;

export const profileAdd: Command = {
  name: "profile add",
  usage: "<name> [--default] [--provider codex]",
  summary: "add a profile, one Claude account, or one ChatGPT account with --provider codex",
  more: ["--default: the one the normal Desktop app opens (Claude Desktop, or the ChatGPT app), one per provider;", "--color #RRGGBB: its color in the listings;", "--provider codex: a ChatGPT account for Codex"],
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
    const profiles = listedProfiles();
    if (!profiles.length) {
      const hint = "No profiles yet. Add one per Claude account, the first with: dotagents profile add <name> --default, and one per ChatGPT account with: dotagents profile add <name> --provider codex";
      return console.log(fancy ? muted(hint) : hint);
    }
    header("profile list", `${plural(profiles.length, "profile")}`);
    const width = Math.max(...profiles.map((a) => a.name.length)) + 2;
    const inSlot = providers().map((p) => p.slotProfile()?.name);
    // With both providers in the list, one heading per group, as in usage.
    const grouped = new Set(profiles.map((a) => providerFor(a))).size > 1;
    let group: string | null = null;
    for (const a of profiles) {
      const who = providerFor(a).account(a);
      const email = who ? who.shown : "no saved login";
      const slot = inSlot.includes(a.name) ? "in the slot" : "";
      const plan = who ? providerFor(a).labels.plan(who.plan, who.seat) : null;
      if (!fancy) {
        console.log(`${a.name.padEnd(width)}${a.default ? "default  " : "         "}${email}${plan ? `  ${plan}` : ""}${slot ? `  ${slot}` : ""}`);
        continue;
      }
      if (grouped && group !== providerFor(a).labels.account) {
        group = providerFor(a).labels.account;
        line();
        line(muted(group));
      }
      line();
      line(`${bold(paint(a.color)(a.name.padEnd(width)))}${a.default ? muted("[default]  ") : "           "}${who ? email : muted(email)}${plan ? `  ${muted(plan)}` : ""}${slot ? `  ${tone.ok(slot)}` : ""}`);
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
