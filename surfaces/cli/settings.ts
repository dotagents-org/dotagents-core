// `settings pull`: a settings change made in a profile goes back to the repository.

import { pullSettings } from "../../core/global.ts";
import { loadProfiles } from "../../core/machine-state.ts";
import { finish, header } from "../../core/output.ts";
import { configDirs } from "../../core/profiles.ts";
import { state } from "../../core/state.ts";
import type { Command } from "./shared.ts";

export const settingsPull: Command = {
  name: "settings pull",
  usage: "[--from <profile>]",
  summary: "bring a settings change made in a profile into this repository",
  more: ["for copies (Windows) that /config wrote to;", "--from: the profile to take it from"],
  group: "Machine",
  run({ repo, args }) {
    header("settings pull", args.from ?? "");
    let from: string | undefined;
    if (args.from) {
      const profile = loadProfiles().find((p) => p.name === args.from);
      if (!profile) throw new Error(`There is no profile named ${args.from}`);
      from = profile.configDir;
    }
    pullSettings(repo, configDirs(), { from });
    finish(state.counts.updated ? "Commit claude/settings.json, then run dotagents install to take it to the other profiles." : "");
  },
};
