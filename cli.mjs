#!/usr/bin/env node
// `dotagents`: applies this repository's coding agent configuration. Works on Windows, Linux and
// macOS with Node 18.17+ and no dependencies. Make it a command with `npm link` in the clone.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finish, parseArgs, report, section, state } from "./lib/common.mjs";
import { installGlobal } from "./lib/global.mjs";
import { removeWorkspace, loadWorkspaces, registerWorkspace, registryFile } from "./lib/registry.mjs";
import { assertWorkspace, checkWorkspace, initWorkspace, repoSkills } from "./lib/workspace.mjs";

const repo = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;

const HELP = `dotagents ${version}: coding agent configuration for Claude Code, Codex and OpenCode

Usage: dotagents <command> [options]

Commands:
  install                      apply the global configuration to this machine
  init [path] [--skills a,b]   apply the standards to a workspace and link skills from this
                               repository (default path: current folder)
  check [path]                 run the standards checklist on a workspace, change nothing
  update [--all]               git pull this repository and run install; with --all, also
                               refresh every workspace set up with init and update their
                               third-party skills (npx skills update)
  skills                       list the skills in this repository
  workspaces                   list the workspaces set up with init on this machine
  workspaces rm <path>         remove a workspace from that list (files are not touched)

Options:
  --dry-run   show what would be done, change nothing
  --no-pull   (update) skip git pull, only reapply
  --help      show this help
  --version   show the version

Repository: ${repo}
Third-party skills: npx skills add <owner/repo> (run at the workspace root)`;

const args = parseArgs(process.argv.slice(2), { booleans: ["all", "dry-run", "help", "no-pull", "version"], lists: ["skills"] });
const [command, target] = args._;
state.dryRun = Boolean(args["dry-run"]);

if (args.version) {
  console.log(version);
} else if (args.help || !command) {
  console.log(HELP);
} else {
  try {
    run(command);
  } catch (err) {
    console.error(`dotagents: ${err.message}`);
    process.exitCode = 1;
  }
}

function run(cmd) {
  const ws = path.resolve(target ?? process.cwd());
  switch (cmd) {
    case "install":
      installGlobal(repo);
      return finish();

    case "init": {
      assertWorkspace(repo, ws);
      const skills = args.skills ?? [];
      initWorkspace(repo, ws, skills);
      registerWorkspace(ws, skills);
      return finish(`To check later: dotagents check "${ws}"`);
    }

    case "check":
      assertWorkspace(repo, ws);
      checkWorkspace(repo, ws);
      return finish(state.problems ? "" : "Everything follows the standards.");

    case "update":
      return update();

    case "skills":
      for (const name of repoSkills(repo)) console.log(`${name.padEnd(20)} ${describe(name)}`);
      return;

    case "workspaces": {
      if (target === "rm") {
        const toRemove = args._[2];
        if (!toRemove) throw new Error("Usage: dotagents workspaces rm <path>");
        const resolved = path.resolve(toRemove);
        if (state.dryRun) return console.log(`Would remove ${resolved} from the list`);
        console.log(removeWorkspace(resolved) ? `Removed ${resolved} from the list` : `${resolved} was not in the list`);
        return;
      }
      if (target) throw new Error(`Unknown subcommand 'workspaces ${target}'. Use: dotagents workspaces [rm <path>]`);
      const all = loadWorkspaces();
      if (!all.length) console.log(`No workspaces yet. Set one up with: dotagents init <path>`);
      for (const w of all) {
        const missing = fs.existsSync(w.path) ? "" : "  (missing)";
        console.log(`${w.path}${missing}\n  skills: ${w.skills.join(", ") || "-"}`);
      }
      console.log(`\nList kept in ${registryFile()}`);
      return;
    }

    default:
      throw new Error(`Unknown command '${cmd}'. Run: dotagents --help`);
  }
}

function update() {
  section("Repository");
  if (args["no-pull"]) report("ok", repo, "--no-pull: git pull skipped");
  else if (state.dryRun) report("would update", repo, "git pull --ff-only");
  else {
    const pull = spawnSync("git", ["-C", repo, "pull", "--ff-only"], { encoding: "utf8" });
    const out = `${pull.stdout ?? ""}${pull.stderr ?? ""}`.trim().split("\n").pop();
    report(pull.status === 0 ? "ok" : "failed", repo, out);
    if (pull.status !== 0) return finish("Fix the repository (commit, stash or resolve) and run dotagents update again.");
  }

  installGlobal(repo);

  if (args.all) {
    for (const w of loadWorkspaces()) {
      if (!fs.existsSync(w.path)) {
        section(`Workspace ${w.path}`);
        report("skipped", w.path, "folder not found; remove it with: dotagents workspaces rm");
        continue;
      }
      initWorkspace(repo, w.path, w.skills);
      if (fs.existsSync(path.join(w.path, "skills-lock.json"))) updateThirdParty(w.path);
    }
  }
  finish();
}

function updateThirdParty(ws) {
  section(`Third-party skills in ${ws}`);
  if (state.dryRun) return report("would update", path.join(ws, "skills-lock.json"), "npx skills update -p -y");
  // A single command string with shell: true, so Windows finds npx.cmd. Nothing here comes from
  // user input.
  const res = spawnSync("npx -y skills update -p -y", { cwd: ws, encoding: "utf8", shell: true });
  const last = `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").pop();
  report(res.status === 0 ? "ok" : "failed", path.join(ws, "skills-lock.json"), last);
}

// First sentence of a skill's description, read from its SKILL.md frontmatter.
function describe(name) {
  const text = fs.readFileSync(path.join(repo, "skills", name, "SKILL.md"), "utf8");
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const m = front.match(/^description:\s*(?:[|>]-?\s*\n((?:[ \t]+.*\n?)+)|(.+))/m);
  const desc = (m?.[1] ?? m?.[2] ?? "").replace(/\s+/g, " ").trim();
  return desc.split(/(?<=\.)\s/)[0];
}
