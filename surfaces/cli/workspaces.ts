// `workspaces` lists the tracked workspaces; `untrack` drops one from the list.

import fs from "node:fs";
import { brand, displayPath, fancy, line, tone } from "../../core/output.ts";
import { loadWorkspaces, untrackWorkspace, workspacesFile } from "../../core/machine-state.ts";
import { state } from "../../core/state.ts";
import { type Command, workspaceArg } from "./shared.ts";

const { bold, muted, ok, high } = tone;

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
      console.log(`${muted("No workspaces tracked yet.")} Set one up with: ${bold("dotagents init")}`);
      return;
    }
    console.log(`${brand()}  ${bold("workspaces")}  ${muted(`${all.length} tracked`)}`);
    for (const w of all) {
      const exists = fs.existsSync(w.path);
      line();
      line(`${exists ? bold(displayPath(w.path)) : `${high("✗")} ${bold(displayPath(w.path))}  ${high("folder not found")}`}`);
      line(`  ${muted("skills")}  ${w.skills.length ? w.skills.join(muted(", ")) : muted("none")}`);
    }
    line();
    console.log(`${muted(`List kept in ${displayPath(workspacesFile())}`)}\n`);
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
    if (state.dryRun) return console.log(`${muted("→")} Would stop tracking ${bold(shown)} ${muted("(its files would not be touched)")}`);
    if (untrackWorkspace(ws)) {
      console.log(`${ok("✓")} Stopped tracking ${bold(shown)}`);
      console.log(muted("  Its files were not touched; update --all will skip it."));
    } else {
      console.log(`${tone.warn("▲")} ${bold(shown)} was not being tracked`);
    }
  },
};
