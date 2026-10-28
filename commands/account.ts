// `account add`, `account list` and `account remove`: the Claude accounts of this machine.

import path from "node:path";
import { dropAccount, launcherDir, launcherFile, setUpAccount, verifyAccounts } from "../lib/accounts.ts";
import { signedIn } from "../lib/claude-code.ts";
import { loadAccounts } from "../lib/machine-state.ts";
import { displayPath, fancy, finish, header, line, paint, rail, style } from "../lib/output.ts";
import type { Command } from "./shared.ts";

const { bold, dim, cyan } = style;

const onPath = (dir: string) => (process.env.PATH ?? "").split(path.delimiter).some((p) => path.resolve(p) === path.resolve(dir));

export const accountAdd: Command = {
  name: "account add",
  usage: "<name> [--default]",
  summary: "add a Claude account: its folder, the configuration, claude-<name>",
  more: ["--default: the account in ~/.claude, used by plain claude;", "--color #RRGGBB: its color in the listings"],
  group: "Accounts",
  run({ repo, args, positional }) {
    const name = positional[0];
    if (!name) throw new Error("Usage: dotagents account add <name> [--default] [--color #RRGGBB]");
    header("account add", name);
    setUpAccount(repo, { name, isDefault: args.default, color: args.color });
    const account = loadAccounts().find((a) => a.name === name);
    const hints = [];
    if (account && !signedIn(account.configDir)) hints.push(`Sign in with: claude-${name} auth login`);
    if (!onPath(launcherDir())) hints.push(`Add ${displayPath(launcherDir())} to your PATH to run claude-${name}`);
    finish(hints.join("\n"));
  },
};

export const accountList: Command = {
  name: "account list",
  usage: "",
  summary: "list the accounts and check them",
  group: "Accounts",
  run() {
    const accounts = loadAccounts();
    if (!accounts.length) {
      const hint = "No accounts yet. Add the one in ~/.claude with: dotagents account add <name> --default";
      return console.log(fancy ? `${rail.start()}  ${dim(hint)}\n${rail.end()}\n` : hint);
    }
    header("account list", `${accounts.length} account${accounts.length === 1 ? "" : "s"}`);
    const width = Math.max(...accounts.map((a) => a.name.length)) + 2;
    for (const a of accounts) {
      const who = signedIn(a.configDir);
      const email = who ? who.email : "not signed in";
      if (!fancy) {
        console.log(`${a.name.padEnd(width)}${a.default ? "default  " : "         "}${a.configDir}  ${email}`);
        continue;
      }
      const color = paint(a.color);
      line();
      line(`${color("●")} ${bold(color(a.name.padEnd(width)))}${a.default ? cyan("default  ") : "         "}${who ? email : dim(email)}`);
      line(`  ${dim(`${displayPath(a.configDir)} · ${path.basename(launcherFile(a.name))}`)}`);
    }
    verifyAccounts();
    finish();
  },
};

export const accountRemove: Command = {
  name: "account remove",
  usage: "<name>",
  summary: "forget an account and its launcher; its folder is kept",
  group: "Accounts",
  run({ positional }) {
    const name = positional[0];
    if (!name) throw new Error("Usage: dotagents account remove <name>");
    header("account remove", name);
    dropAccount(name);
    finish();
  },
};
