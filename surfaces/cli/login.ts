// `login`: sign a profile in again on this side, when its login runs out (every few weeks).

import { finish, header } from "../../core/output.ts";
import { state } from "../../core/state.ts";
import { loginProfile } from "../../core/accounts/login.ts";
import type { Command } from "./shared.ts";

export const login: Command = {
  name: "login",
  usage: "<profile> | --all",
  summary: "sign a profile in again on this side and keep the new login in its vault",
  more: ["a Claude profile: claude auth login in the slot, then the previous one put back;", "a ChatGPT profile: codex login in a folder of its own, never ~/.codex;", "--all: every Claude profile whose login runs out within a week;", "each side signs in on its own: run it on the other side too"],
  group: "Profiles",
  async run({ args, positional }) {
    header("login", args.all ? "--all" : (positional[0] ?? ""));
    await loginProfile({ name: positional[0], all: Boolean(args.all) });
    finish(state.counts.updated ? "On the other side of the machine, run dotagents login there too." : "");
  },
};
