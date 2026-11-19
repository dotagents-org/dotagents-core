import fs from "node:fs";
import path from "node:path";
import { runWithSpinner } from "../../../core/common.ts";
import { brand, displayPath, finish, header, interactive, report, section, tone } from "../../../core/output/output.ts";
import { state } from "../../../core/state.ts";
import { assertWorkspace, isWorkspaceRepo, listRepoInAgentsMd } from "../../../core/workspace/workspace.ts";
import { initWorkspace } from "./init.ts";
import { type Command, type Context, expandHome } from "../shared.ts";
import { loadPrompts } from "../prompts.ts";

const { bold } = tone;

// A git source as `git clone` takes it: a URL (scheme:// or user@host:path), a path ending in
// .git, or a local repository other than a workspace's own. Anything else is the workspace folder.
function isGitSource(arg: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(arg) || /^[^\\/\s]+@[^:\s]+:/.test(arg) || /\.git[\\/]*$/.test(arg) || (fs.existsSync(path.join(arg, ".git")) && !isWorkspaceRepo(arg));
}

// A new workspace folder ends in -workspace (thesis becomes thesis-workspace); an existing
// folder keeps its name, so a repository can join a workspace named otherwise.
function workspacePath(folder: string) {
  const ws = path.resolve(expandHome(folder));
  return fs.existsSync(ws) || path.basename(ws).endsWith("-workspace") ? ws : `${ws}-workspace`;
}

// Creates a workspace around a repository: <name>-workspace/ holds the agent files and
// <name>-workspace/<name>/ the clone, so the project repository never sees them. With an
// existing workspace as the folder, adds one more repository to it. Without a repository,
// starts an empty workspace.
export const newWorkspace: Command = {
  name: "new",
  usage: "[git-url] [folder]",
  summary: "create a workspace folder, cloning the repository into it",
  more: [
    "folder: default <name>-workspace (asked in a terminal); a new",
    "one gets -workspace at the end when it lacks it;",
    "agent files at the root, the repository in a subfolder,",
    "so it never sees them; an existing workspace as folder",
    "adds one more repository; a folder alone starts an empty workspace",
  ],
  group: "Workspace",
  async run(ctx) {
    const { repo, args } = ctx;
    const first = ctx.positional[0];
    if (first !== undefined && !isGitSource(first)) {
      if (ctx.positional.length > 1) throw new Error("Usage: dotagents new [git-url] [folder]");
      return startEmpty(ctx, first, false);
    }
    const url = first;
    if (!url) {
      if (!interactive || args.yes) throw new Error("Usage: dotagents new [git-url] [folder]");
      const p = await loadPrompts();
      p.intro(`${brand()}  ${bold("new")}`);
      const answer = await p.text({
        message: "Workspace folder name?",
        validate: (v) => (v?.trim() ? undefined : "The workspace needs a name"),
      });
      if (p.isCancel(answer)) {
        p.cancel("Nothing was changed.");
        process.exit(0);
      }
      return startEmpty(ctx, answer.trim(), true);
    }
    const name = path.basename(url.replace(/[\\/]+$/, "")).replace(/\.git$/, "").split(":").pop();
    if (!name) throw new Error(`Can't tell the repository name from '${url}'`);

    // <name>-workspace by default; a new folder given or answered gets -workspace at the end.
    // In a terminal, without a folder argument, ask for it.
    let folder = ctx.positional[1];
    const asked = folder === undefined && interactive && !args.yes;
    if (asked) {
      const p = await loadPrompts();
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
    const ws = workspacePath(folder ?? name);
    const clone = path.join(ws, name);
    assertWorkspace(repo, path.dirname(ws));
    if (fs.existsSync(clone)) throw new Error(`${displayPath(clone)} already exists`);
    // A project's repository can't hold the workspace; the workspace's own repository is where it goes
    if (fs.existsSync(ws) && fs.existsSync(path.join(ws, ".git")) && !isWorkspaceRepo(ws)) {
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

// A workspace with no repository yet: the folder, then init. An existing folder is init's job.
async function startEmpty(ctx: Context, folder: string, asked: boolean) {
  const ws = workspacePath(folder);
  assertWorkspace(ctx.repo, path.dirname(ws));
  if (fs.existsSync(ws)) throw new Error(`${displayPath(ws)} already exists; to use it as a workspace: dotagents init "${displayPath(ws)}"`);
  if (!asked) header("new", ws);
  section("Workspace");
  if (state.dryRun) {
    report("would create", ws, "workspace folder");
    return finish(`Then: dotagents init "${displayPath(ws)}"`);
  }
  fs.mkdirSync(ws, { recursive: true });
  report("created", ws, "workspace folder");
  return initWorkspace(ctx, ws, { opened: true });
}
