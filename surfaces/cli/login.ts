// `login`: sign a profile in again on this side, when its login runs out (every few weeks).

import { finish, header } from "../../core/output.ts";
import { state } from "../../core/state.ts";
import { loginProfile } from "../../core/switch.ts";
import type { Command } from "./shared.ts";

export const login: Command = {
  name: "login",
  usage: "<profile> | --all",
  summary: "sign a profile in again on this side, then put the previous one back",
  more: ["runs claude auth login with the profile in the slot and keeps the new login in its vault;", "--all: every profile whose login runs out within a week;", "each side signs in on its own: run it on the other side too"],
  group: "Profiles",
  async run({ args, positional }) {
    header("login", args.all ? "--all" : (positional[0] ?? ""));
    await loginProfile({ name: positional[0], all: Boolean(args.all) });
    finish(state.counts.updated ? "On the other side of the machine, run dotagents login there too." : "");
  },
};
