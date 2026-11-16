// `switch`: which account each slot holds (~/.claude for Claude, ~/.codex/auth.json for Codex), and
// changing it (ADR 0009, ADR 0007).

import { codexSlotProfile } from "../../core/codex.ts";
import { loadProfiles, providerOf } from "../../core/machine-state.ts";
import { brand, fancy, finish, header, line, paint, tone } from "../../core/output.ts";
import { slotProfile, switchProfile, vaultDir } from "../../core/switch.ts";
import type { Command } from "./shared.ts";
import fs from "node:fs";
import { state } from "../../core/state.ts";

export const switchCommand: Command = {
  name: "switch",
  usage: "[<profile>] [--here] [--save <profile>]",
  summary: "put a profile's login in its slot, on both sides",
  more: ["no profile: show which one is there;", "--here: only this side;", "--save <profile>: keep the login now there as that profile's"],
  group: "Profiles",
  async run({ args, positional }) {
    const name = positional[0];
    if (!name && !args.save) {
      const inSlot = [slotProfile()?.name, codexSlotProfile()?.name];
      const profiles = loadProfiles();
      const codexToo = profiles.some((p) => providerOf(p) === "codex");
      const kind = (p: (typeof profiles)[number]) => (codexToo ? `  ${providerOf(p)}` : "");
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
      if (!inSlot[0] && profiles.some((p) => providerOf(p) === "claude")) line(tone.warn("\nThe slot holds an account no profile knows: dotagents switch --save <profile>"));
      return line();
    }
    header("switch", name ?? `--save ${args.save}`);
    await switchProfile({ name, save: args.save, here: args.here });
    const codex = loadProfiles().find((p) => p.name === name && providerOf(p) === "codex");
    const done = codex ? "Codex sessions already open stay on the old account until you restart them." : "Conversations open in VS Code and the terminal go on in the new account; type continue in them.";
    finish(name && state.counts.updated ? done : "");
  },
};
