#!/usr/bin/env node
// `dotagents`: applies this repository's coding agent configuration. Works on Windows, Linux and
// macOS with Node 18.17+ and no dependencies. Make it a command with `npm link` in the clone.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { displayPath, fancy, finish, header, parseArgs, report, section, state, style } from "./lib/common.mjs";
import { installGlobal } from "./lib/global.mjs";
import { loadWorkspaces, registerWorkspace, registryFile, untrackWorkspace } from "./lib/registry.mjs";
import { assertWorkspace, checkWorkspace, initWorkspace, repoSkills } from "./lib/workspace.mjs";

const repo = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
const { bold, dim, cyan, green, red, yellow, magenta, gray } = style;

function help() {
  const cmd = (name, args, desc, more = []) => {
    const left = `${cyan(name)}${args ? ` ${dim(args)}` : ""}`;
    const width = name.length + (args ? args.length + 1 : 0);
    const pad = " ".repeat(Math.max(2, 30 - width));
    return [`  ${left}${pad}${desc}`, ...more.map((line) => `${" ".repeat(32)}${line}`)].join("\n");
  };
  const title = (t) => bold(t.toUpperCase());
  return `${bold(magenta("dotagents"))} ${dim(version)}  coding agent configuration for Claude Code, Codex and OpenCode

${title("Usage")}
  dotagents ${dim("<command> [options]")}

${title("Machine")}
${cmd("install", "", "apply the global configuration to this machine")}
${cmd("update", "[--all]", "git pull this repository and run install", [
  `with ${cyan("--all")}, also refresh every tracked workspace`,
  "and update its third-party skills",
])}

${title("Workspace")}
${cmd("init", "[path] [--skills a,b]", "apply the standards and link skills", ["(default path: current folder)"])}
${cmd("check", "[path]", "run the checklist, change nothing")}
${cmd("workspaces", "", "list the workspaces tracked on this machine")}
${cmd("untrack", "<path>", "stop tracking a workspace; its files are not touched")}

${title("Info")}
${cmd("skills", "", "list the skills in this repository")}

${title("Options")}
  ${cyan("--dry-run")}    show what would be done, change nothing
  ${cyan("--no-pull")}    (update) skip git pull, only reapply
  ${cyan("--help")}       show this help
  ${cyan("--version")}    show the version

${title("Examples")}
  ${gray("$")} dotagents init ~/projects/app --skills session-archive,to-cards
  ${gray("$")} dotagents check ~/projects/app
  ${gray("$")} dotagents update --all

${dim("Repository:")} ${displayPath(repo)}
${dim("Third-party skills:")} npx skills add <owner/repo> ${dim("(at the workspace root)")}`;
}

const args = parseArgs(process.argv.slice(2), { booleans: ["all", "dry-run", "help", "no-pull", "version"], lists: ["skills"] });
const [command, target] = args._;
state.dryRun = Boolean(args["dry-run"]);

if (args.version) {
  console.log(version);
} else if (args.help || !command) {
  console.log(help());
} else {
  try {
    run(command);
  } catch (err) {
    console.error(fancy ? `${red("✗")} ${bold("dotagents:")} ${err.message}` : `dotagents: ${err.message}`);
    process.exitCode = 1;
  }
}

// Accepts ~ for the home folder, so the short paths dotagents prints can be pasted back (the
// Windows shells don't expand ~ for external commands).
function expandHome(p) {
  return p === "~" || /^~[\\/]/.test(p) ? path.join(os.homedir(), p.slice(1)) : p;
}

function run(cmd) {
  const ws = path.resolve(expandHome(target ?? process.cwd()));
  switch (cmd) {
    case "install":
      header("install");
      installGlobal(repo);
      return finish();

    case "init": {
      assertWorkspace(repo, ws);
      header("init", ws);
      state.base = ws;
      const skills = args.skills ?? [];
      initWorkspace(repo, ws, skills);
      registerWorkspace(ws, skills);
      state.base = null; // the hint shows the workspace itself, not a path inside it
      return finish(`To check later: dotagents check "${displayPath(ws)}"`);
    }

    case "check":
      assertWorkspace(repo, ws);
      header("check", ws);
      state.base = ws;
      checkWorkspace(repo, ws);
      return finish(state.problems ? "" : "Everything follows the standards.");

    case "update":
      header("update", args.all ? "all tracked workspaces" : "");
      return update();

    case "skills":
      return listSkills();

    case "workspaces":
      if (target) throw new Error(`'workspaces' takes no arguments. To stop tracking a workspace: dotagents untrack <path>`);
      return listWorkspaces();

    case "untrack": {
      if (!target) throw new Error("Usage: dotagents untrack <path>");
      const shown = displayPath(ws);
      if (state.dryRun) return console.log(`${cyan("○")} Would stop tracking ${bold(shown)} ${dim("(its files would not be touched)")}`);
      if (untrackWorkspace(ws)) {
        console.log(`${green("✓")} Stopped tracking ${bold(shown)}`);
        console.log(dim("  Its files were not touched; update --all will skip it."));
      } else {
        console.log(`${yellow("!")} ${bold(shown)} was not being tracked`);
      }
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
      if (fancy) console.log(`\n${bold(magenta("◆"))} ${bold(displayPath(w.path))}`);
      if (!fs.existsSync(w.path)) {
        report("skipped", w.path, "folder not found; stop tracking it with: dotagents untrack");
        continue;
      }
      state.base = w.path;
      initWorkspace(repo, w.path, w.skills);
      if (fs.existsSync(path.join(w.path, "skills-lock.json"))) updateThirdParty(w.path);
      state.base = null;
    }
  }
  finish();
}

function updateThirdParty(ws) {
  section("Third-party skills");
  const lock = path.join(ws, "skills-lock.json");
  if (state.dryRun) return report("would update", lock, "npx skills update -p -y");
  // A single command string with shell: true, so Windows finds npx.cmd. Nothing here comes from
  // user input.
  const res = spawnSync("npx -y skills update -p -y", { cwd: ws, encoding: "utf8", shell: true });
  const last = `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").pop();
  report(res.status === 0 ? "ok" : "failed", lock, last);
}

function listSkills() {
  const names = repoSkills(repo);
  if (!fancy) return names.forEach((name) => console.log(`${name.padEnd(20)} ${describe(name)}`));
  const width = Math.max(...names.map((n) => n.length)) + 2;
  const columns = Math.max(60, process.stdout.columns || 100);
  console.log(`${bold(`${names.length} skills`)} ${dim(`in ${displayPath(path.join(repo, "skills"))}`)}\n`);
  for (const name of names) {
    const lines = wrap(describe(name), columns - width - 4);
    console.log(`  ${green(name.padEnd(width))}${dim(lines[0] ?? "")}`);
    for (const line of lines.slice(1)) console.log(`  ${" ".repeat(width)}${dim(line)}`);
  }
  console.log(`\n${dim("Link one into a workspace:")} dotagents init <path> --skills <name>`);
}

function listWorkspaces() {
  const all = loadWorkspaces();
  if (!fancy) {
    if (!all.length) console.log(`No workspaces yet. Set one up with: dotagents init <path>`);
    for (const w of all) console.log(`${w.path}${fs.existsSync(w.path) ? "" : "  (missing)"}\n  skills: ${w.skills.join(", ") || "-"}`);
    return console.log(`\nList kept in ${registryFile()}`);
  }
  if (!all.length) {
    console.log(`${dim("No workspaces tracked yet.")} Set one up with: ${cyan("dotagents init <path>")}`);
  } else {
    console.log(`${bold(`${all.length} tracked workspace${all.length === 1 ? "" : "s"}`)}\n`);
    for (const w of all) {
      const exists = fs.existsSync(w.path);
      const mark = exists ? green("●") : red("✗");
      console.log(`  ${mark} ${bold(displayPath(w.path))}${exists ? "" : `  ${red("folder not found")}`}`);
      console.log(`    ${dim("skills:")} ${w.skills.length ? w.skills.map((s) => cyan(s)).join(dim(", ")) : dim("none")}`);
    }
  }
  console.log(`\n${dim(`List kept in ${displayPath(registryFile())}`)}`);
}

function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

// First sentence of a skill's description, read from its SKILL.md frontmatter.
function describe(name) {
  const text = fs.readFileSync(path.join(repo, "skills", name, "SKILL.md"), "utf8");
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const m = front.match(/^description:\s*(?:[|>]-?\s*\n((?:[ \t]+.*\n?)+)|(.+))/m);
  const desc = (m?.[1] ?? m?.[2] ?? "").replace(/\s+/g, " ").trim();
  return desc.split(/(?<=\.)\s/)[0];
}
