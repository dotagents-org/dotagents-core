import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import { runWithSpinner } from "../../core/common.ts";
import { brand, displayPath, finish, header, interactive, report, section, tone } from "../../core/output.ts";
import { state } from "../../core/state.ts";
import { assertWorkspace, listRepoInAgentsMd } from "../../core/workspace.ts";
import { initWorkspace } from "./init.ts";
import { type Command, expandHome } from "./shared.ts";

const { bold } = tone;

// Creates a workspace around a repository: <name>-workspace/ holds the agent files and
// <name>-workspace/<name>/ the clone, so the project repository never sees them. With an
// existing workspace as the folder, adds one more repository to it.
export const newWorkspace: Command = {
  name: "new",
  usage: "<git-url> [folder]",
  summary: "create a workspace folder and clone the repository into it",
  more: [
    "folder: any name; default <name>-workspace (asked in a terminal);",
    "agent files at the root, the repository in a subfolder,",
    "so it never sees them; an existing workspace as folder",
    "adds one more repository",
  ],
  group: "Workspace",
  async run(ctx) {
    const { repo, args } = ctx;
    const url = ctx.positional[0];
    if (!url) throw new Error("Usage: dotagents new <git-url> [folder]");
    const name = path.basename(url.replace(/[\\/]+$/, "")).replace(/\.git$/, "").split(":").pop();
    if (!name) throw new Error(`Can't tell the repository name from '${url}'`);

    // The workspace folder can have any name (acme-platform, thesis…); <name>-workspace is
    // only the default. In a terminal, without a folder argument, ask for it.
    let folder = ctx.positional[1];
    const asked = folder === undefined && interactive && !args.yes;
    if (asked) {
      p.intro(`${brand()}  ${bold("new")}`);
      const answer = await p.text({
        message: "Workspace folder name?",
        placeholder: `${name}-workspace`,
        defaultValue: `${name}-workspace`,
      });
      if (p.isCancel(answer)) {
        p.cancel("Nothing was changed.");
        process.exit(0);
      }
      folder = answer;
    }
    const ws = path.resolve(expandHome(folder ?? `${name}-workspace`));
    const clone = path.join(ws, name);
    assertWorkspace(repo, path.dirname(ws));
    if (fs.existsSync(clone)) throw new Error(`${displayPath(clone)} already exists`);
    if (fs.existsSync(ws) && fs.existsSync(path.join(ws, ".git"))) {
      throw new Error(`${displayPath(ws)} is itself a git repository; pick another folder for the workspace`);
    }

    if (!asked) header("new", ws);
    state.base = ws;
    section("Repository");
    if (state.dryRun) {
      if (!fs.existsSync(ws)) report("would create", ws, "workspace folder");
      report("would create", clone, `git clone ${url}`);
      state.base = null;
      return finish(`Then: dotagents init "${displayPath(ws)}"`);
    }
    fs.mkdirSync(ws, { recursive: true });
    const res = await runWithSpinner(`Cloning ${name}`, "git", ["clone", url, clone]);
    report(res.code === 0 ? "created" : "failed", clone, res.code === 0 ? url : res.last);
    if (res.code !== 0) return finish("The workspace folder was created; fix the URL or your access and run dotagents new again.");
    listRepoInAgentsMd(ws, name, url);
    state.base = null;
    return initWorkspace(ctx, ws, { opened: true });
  },
};
