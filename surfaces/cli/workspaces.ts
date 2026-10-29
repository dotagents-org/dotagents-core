// `workspaces` lists the tracked workspaces; `untrack` drops one from the list.

import fs from "node:fs";
import { displayPath, fancy, line, rail, style } from "../../core/output.ts";
import { loadWorkspaces, untrackWorkspace, workspacesFile } from "../../core/machine-state.ts";
import { state } from "../../core/state.ts";
import { type Command, workspaceArg } from "./shared.ts";

const { bold, dim, cyan, green, red, yellow } = style;

export const workspaces: Command = {
  name: "workspaces",
  usage: "",
  summary: "list the workspaces tracked on this machine",
  group: "Workspace",
  run({ positional }) {
    if (positional.length) throw new Error(`'workspaces' takes no arguments. To stop tracking a workspace: dotagents untrack <path>`);
    const all = loadWorkspaces();
    if (!fancy) {
      if (!all.length) console.log(`No workspaces yet. Set one up with: dotagents init <path>`);
      for (const w of all) console.log(`${w.path}${fs.existsSync(w.path) ? "" : "  (missing)"}\n  skills: ${w.skills.join(", ") || "-"}`);
      return console.log(`\nList kept in ${workspacesFile()}`);
    }
    if (!all.length) {
      console.log(`${rail.start()}  ${dim("No workspaces tracked yet.")}`);
      console.log(`${rail.end()}  Set one up with: ${cyan("dotagents init")}\n`);
      return;
    }
    console.log(`${rail.start()}  ${bold(`${all.length} tracked workspace${all.length === 1 ? "" : "s"}`)}`);
    for (const w of all) {
      const exists = fs.existsSync(w.path);
      line();
      line(`${exists ? green("●") : red("✗")} ${bold(displayPath(w.path))}${exists ? "" : `  ${red("folder not found")}`}`);
      line(`  ${dim("skills:")} ${w.skills.length ? w.skills.map((s) => cyan(s)).join(dim(", ")) : dim("none")}`);
    }
    line();
    console.log(`${rail.end()}  ${dim(`List kept in ${displayPath(workspacesFile())}`)}\n`);
  },
};

export const untrack: Command = {
  name: "untrack",
  usage: "<path>",
  summary: "stop tracking a workspace; its files are not touched",
  group: "Workspace",
  run(ctx) {
    if (!ctx.positional[0]) throw new Error("Usage: dotagents untrack <path>");
    const ws = workspaceArg(ctx);
    const shown = displayPath(ws);
    if (state.dryRun) return console.log(`${cyan("○")} Would stop tracking ${bold(shown)} ${dim("(its files would not be touched)")}`);
    if (untrackWorkspace(ws)) {
      console.log(`${green("✓")} Stopped tracking ${bold(shown)}`);
      console.log(dim("  Its files were not touched; update --all will skip it."));
    } else {
      console.log(`${yellow("!")} ${bold(shown)} was not being tracked`);
    }
  },
};
