// `switch`: which account each slot holds (~/.claude for Claude, ~/.codex/auth.json for Codex), and
// changing it (ADR 0004, ADR 0007).

import { providerFor, providers, activeProfiles } from "../../../core/accounts/providers.ts";
import { brand, fancy, finish, header, line, paint, tone } from "../../../core/output/output.ts";
import { switchProfile } from "../../../core/accounts/switch.ts";
import { vaultDir } from "../../../core/accounts/vault.ts";
import type { Command } from "../shared.ts";
import fs from "node:fs";
import { state } from "../../../core/state.ts";

export const switchCommand: Command = {
  name: "switch",
  usage: "[<profile>] [--here] [--save <profile>]",
  summary: "put a profile's login in its slot, on both sides",
  more: ["no profile: show which one is there;", "--here: only this side;", "--save <profile>: keep the login now there as that profile's"],
  group: "Profiles",
  async run({ args, positional }) {
    const name = positional[0];
    if (!name && !args.save) {
      const inSlot = providers().map((p) => p.slotProfile()?.name);
      const profiles = activeProfiles();
      // Which provider a profile is of is said only when some are not the first provider's.
      const mixed = profiles.some((p) => providerFor(p) !== providers()[0]);
      const kind = (p: (typeof profiles)[number]) => (mixed ? `  ${providerFor(p).labels.account}` : "");
      if (!fancy) {
        for (const p of profiles) console.log(`${p.name}${kind(p)}${inSlot.includes(p.name) ? "  (in the slot)" : ""}${fs.existsSync(vaultDir(p.name)) ? "" : "  (no saved login)"}`);
        return;
      }
      console.log(`${brand()}  ${tone.bold("switch")}\n`);
      for (const p of profiles) {
        const here = inSlot.includes(p.name);
        const saved = fs.existsSync(vaultDir(p.name));
        line(`${here ? tone.ok("●") : " "} ${tone.bold(paint(p.color)(p.name))}${tone.muted(kind(p))}${here ? tone.muted("  in the slot") : ""}${saved ? "" : tone.muted("  no saved login yet")}`);
      }
      for (const provider of providers()) {
        if (provider.unknownSlotHint && !provider.slotProfile() && profiles.some((p) => providerFor(p) === provider)) line(tone.warn(`\n${provider.unknownSlotHint}`));
      }
      return line();
    }
    header("switch", name ?? `--save ${args.save}`);
    await switchProfile({ name, save: args.save, here: args.here });
    const profile = activeProfiles().find((p) => p.name === name);
    const done = (profile ? providerFor(profile) : providers()[0]).switched;
    finish(name && state.counts.updated ? done : "");
  },
};
