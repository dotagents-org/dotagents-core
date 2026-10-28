import { installAccounts } from "../lib/accounts.ts";
import { finish, header } from "../lib/output.ts";
import type { Command } from "./shared.ts";

export const install: Command = {
  name: "install",
  usage: "",
  summary: "apply the global configuration to this machine",
  more: ["to ~/.claude and to every account folder"],
  group: "Machine",
  run({ repo }) {
    header("install");
    installAccounts(repo);
    finish();
  },
};
