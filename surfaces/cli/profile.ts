// `profile add`, `profile list` and `profile remove`: the Claude profiles of this machine.

import path from "node:path";
import { verifyGlobal } from "../../core/global.ts";
import { configDirs, dropProfile, launcherDir, launcherFile, setUpProfile, showFolder, verifyProfiles } from "../../core/profiles.ts";
import { signedIn } from "../../core/claude-code.ts";
import { loadProfiles } from "../../core/machine-state.ts";
import { displayPath, fancy, finish, header, line, paint, tone } from "../../core/output.ts";
import type { Command } from "./shared.ts";

const { bold, muted } = tone;

const onPath = (dir: string) => (process.env.PATH ?? "").split(path.delimiter).some((p) => path.resolve(p) === path.resolve(dir));

export const profileAdd: Command = {
  name: "profile add",
  usage: "<name> [--default]",
  summary: "add a Claude profile: its folder, the configuration, claude-<name>",
  more: ["--default: the profile in ~/.claude, used by plain claude;", "--color #RRGGBB: its color in the listings"],
  group: "Profiles",
  run({ repo, args, positional }) {
    const name = positional[0];
    if (!name) throw new Error("Usage: dotagents profile add <name> [--default] [--color #RRGGBB]");
    header("profile add", name);
    setUpProfile(repo, { name, isDefault: args.default, color: args.color });
    const profile = loadProfiles().find((a) => a.name === name);
    const hints = [];
    if (profile && !signedIn(profile.configDir)) hints.push(`Sign in with: claude-${name} auth login`);
    if (!onPath(launcherDir())) hints.push(`Add ${displayPath(launcherDir())} to your PATH to run claude-${name}`);
    finish(hints.join("\n"));
  },
};

export const profileList: Command = {
  name: "profile list",
  usage: "",
  summary: "list the profiles and check them",
  group: "Profiles",
  run({ repo }) {
    const profiles = loadProfiles();
    if (!profiles.length) {
      const hint = "No profiles yet. Add the one in ~/.claude with: dotagents profile add <name> --default";
      return console.log(fancy ? muted(hint) : hint);
    }
    header("profile list", `${profiles.length} profile${profiles.length === 1 ? "" : "s"}`);
    const width = Math.max(...profiles.map((a) => a.name.length)) + 2;
    for (const a of profiles) {
      const who = signedIn(a.configDir);
      const email = who ? who.email : "not signed in";
      if (!fancy) {
        console.log(`${a.name.padEnd(width)}${a.default ? "default  " : "         "}${a.configDir}  ${email}`);
        continue;
      }
      const color = paint(a.color);
      line();
      line(`${bold(color(a.name.padEnd(width)))}${a.default ? muted("[default]  ") : "           "}${who ? email : muted(email)}`);
      line(`  ${muted(`${showFolder(a.configDir)}  ${path.basename(launcherFile(a.name))}`)}`);
    }
    verifyProfiles();
    verifyGlobal(repo, configDirs());
    finish();
  },
};

export const profileRemove: Command = {
  name: "profile remove",
  usage: "<name>",
  summary: "forget a profile and its launcher; its folder is kept",
  group: "Profiles",
  run({ positional }) {
    const name = positional[0];
    if (!name) throw new Error("Usage: dotagents profile remove <name>");
    header("profile remove", name);
    dropProfile(name);
    finish();
  },
};
