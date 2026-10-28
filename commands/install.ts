import { installGlobal } from "../lib/global.ts";
import { finish, header } from "../lib/output.ts";
import type { Command } from "./shared.ts";

export const install: Command = {
  name: "install",
  usage: "",
  summary: "apply the global configuration to this machine",
  group: "Machine",
  run({ repo }) {
    header("install");
    installGlobal(repo);
    finish();
  },
};
