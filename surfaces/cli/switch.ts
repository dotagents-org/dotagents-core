// `switch`: which account the side's slot (~/.claude) holds, and changing it (ADR 0009).

import { loadProfiles } from "../../core/machine-state.ts";
import { brand, fancy, finish, header, line, paint, tone } from "../../core/output.ts";
import { slotProfile, switchProfile, vaultDir } from "../../core/switch.ts";
import type { Command } from "./shared.ts";
import fs from "node:fs";
import { state } from "../../core/state.ts";

export const switchCommand: Command = {
  name: "switch",
  usage: "[<profile>] [--here] [--save <profile>]",
  summary: "put a profile's login in ~/.claude, on both sides",
  more: ["no profile: show which one is there;", "--here: only this side;", "--save <profile>: keep the login now there as that profile's"],
  group: "Profiles",
  async run({ args, positional }) {
    const name = positional[0];
    if (!name && !args.save) {
      const current = slotProfile();
      const profiles = loadProfiles();
      if (!fancy) {
        for (const p of profiles) console.log(`${p.name}${p.name === current?.name ? "  (in the slot)" : ""}${fs.existsSync(vaultDir(p.name)) ? "" : "  (no saved login)"}`);
        return;
      }
      console.log(`${brand()}  ${tone.bold("switch")}\n`);
      for (const p of profiles) {
        const here = p.name === current?.name;
        const saved = fs.existsSync(vaultDir(p.name));
        line(`${here ? tone.ok("●") : " "} ${tone.bold(paint(p.color)(p.name))}${here ? tone.muted("  in the slot") : ""}${saved ? "" : tone.muted("  no saved login yet")}`);
      }
      if (!current) line(tone.warn("\nThe slot holds an account no profile knows: dotagents switch --save <profile>"));
      return line();
    }
    header("switch", name ?? `--save ${args.save}`);
    await switchProfile({ name, save: args.save, here: args.here });
    finish(name && state.counts.updated ? "Conversations open in VS Code and the terminal go on in the new account; type continue in them." : "");
  },
};
