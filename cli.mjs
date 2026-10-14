#!/usr/bin/env node
// `dotagents`: applies this repository's coding agent configuration. Works on Windows, Linux and
// macOS with Node 20.12+. Make it a command with `npm link` in the clone (it also installs the two
// dependencies, @clack/prompts and picocolors, used for the terminal output and the prompts).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import { displayPath, fancy, finish, header, interactive, line, parseArgs, rail, report, section, state, style } from "./lib/common.mjs";
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
    return [`  ${left}${pad}${desc}`, ...more.map((text) => `${" ".repeat(32)}${text}`)].join("\n");
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
${cmd("init", "[path] [--skills a,b]", "apply the standards and link skills", [
  "in a terminal, without --skills, asks which skills to link",
])}
${cmd("check", "[path]", "run the checklist, change nothing")}
${cmd("workspaces", "", "list the workspaces tracked on this machine")}
${cmd("untrack", "<path>", "stop tracking a workspace; its files are not touched")}

${title("Info")}
${cmd("skills", "", "list the skills in this repository")}

${title("Options")}
  ${cyan("--dry-run")}    show what would be done, change nothing
  ${cyan("--yes")}        (init) don't ask anything
  ${cyan("--no-pull")}    (update) skip git pull, only reapply
  ${cyan("--help")}       show this help
  ${cyan("--version")}    show the version

${title("Examples")}
  ${gray("$")} dotagents init
  ${gray("$")} dotagents init ~/projects/app --skills session-archive,to-cards
  ${gray("$")} dotagents check ~/projects/app
  ${gray("$")} dotagents update --all

${dim("Repository:")} ${displayPath(repo)}
${dim("Third-party skills:")} npx skills add <owner/repo> ${dim("(at the workspace root)")}`;
}

const args = parseArgs(process.argv.slice(2), {
  booleans: ["all", "dry-run", "help", "no-pull", "version", "yes"],
  lists: ["skills"],
});
const [command, target] = args._;
state.dryRun = Boolean(args["dry-run"]);

if (args.version) {
  console.log(version);
} else if (args.help || !command) {
  console.log(help());
} else {
  run(command).catch((err) => {
    console.error(fancy ? `${red("✗")} ${bold("dotagents:")} ${err.message}` : `dotagents: ${err.message}`);
    process.exitCode = 1;
  });
}

// Accepts ~ for the home folder, so the short paths dotagents prints can be pasted back (the
// Windows shells don't expand ~ for external commands).
function expandHome(dir) {
  return dir === "~" || /^~[\\/]/.test(dir) ? path.join(os.homedir(), dir.slice(1)) : dir;
}

async function run(cmd) {
  const ws = path.resolve(expandHome(target ?? process.cwd()));
  switch (cmd) {
    case "install":
      header("install");
      installGlobal(repo);
      return finish();

    case "init":
      return init(ws);

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

// ── init ──────────────────────────────────────────────────────────────────────────────────────

async function init(ws) {
  let skills = args.skills;
  // In a terminal, without --skills or --yes, ask instead of guessing. The questions open the
  // rail themselves, so the header is printed only when there were none.
  const asked = interactive && !args.yes && skills === undefined;
  if (asked) ({ ws, skills } = await askInit(ws));
  assertWorkspace(repo, ws);
  if (!asked) header("init", ws);
  state.base = ws;
  skills ??= [];
  initWorkspace(repo, ws, skills);
  if (!state.dryRun) registerWorkspace(ws, skills);
  state.base = null; // the hint shows the workspace itself, not a path inside it
  return finish(`To check later: dotagents check "${displayPath(ws)}"`);
}

async function askInit(defaultWs) {
  const exit = (value) => {
    if (p.isCancel(value)) {
      p.cancel("Nothing was changed.");
      process.exit(0);
    }
    return value;
  };

  p.intro(`${style.bgMagenta(style.white(style.bold(" dotagents ")))} ${bold("init")}`);

  let ws = defaultWs;
  if (target === undefined) {
    const answer = exit(
      await p.text({
        message: "Which folder is the workspace?",
        placeholder: displayPath(defaultWs),
        defaultValue: defaultWs,
        validate: (value) => {
          const dir = path.resolve(expandHome(value || defaultWs));
          if (!fs.existsSync(dir)) return "That folder doesn't exist.";
        },
      })
    );
    ws = path.resolve(expandHome(answer || defaultWs));
  }

  const available = repoSkills(repo);
  const linked = linkedSkills(ws);
  const skills = exit(
    await p.multiselect({
      message: `Which skills should ${bold(displayPath(ws))} link?`,
      options: available.map((name) => ({
        value: name,
        label: name,
        hint: linked.includes(name) ? "already linked" : truncate(describe(name), 60),
      })),
      initialValues: linked,
      required: false,
    })
  );

  if (!state.dryRun) {
    const ok = exit(
      await p.confirm({
        message: `Apply the standards to ${bold(displayPath(ws))}${skills.length ? ` with ${skills.length} skill${skills.length === 1 ? "" : "s"}` : ""}?`,
      })
    );
    if (!ok) {
      p.cancel("Nothing was changed.");
      process.exit(0);
    }
  }
  return { ws, skills };
}

// Skills of this repository already linked in the workspace's .agents/skills/.
function linkedSkills(ws) {
  const dir = path.join(ws, ".agents", "skills");
  if (!fs.existsSync(dir)) return [];
  return repoSkills(repo).filter((name) => {
    try {
      return fs.lstatSync(path.join(dir, name)).isSymbolicLink();
    } catch {
      return false;
    }
  });
}

// ── update ────────────────────────────────────────────────────────────────────────────────────

async function update() {
  section("Repository");
  if (args["no-pull"]) report("ok", repo, "--no-pull: git pull skipped");
  else if (state.dryRun) report("would update", repo, "git pull --ff-only");
  else {
    const pull = await runWithSpinner("Pulling the repository", "git", ["-C", repo, "pull", "--ff-only"]);
    report(pull.code === 0 ? "ok" : "failed", repo, pull.last);
    if (pull.code !== 0) return finish("Fix the repository (commit, stash or resolve) and run dotagents update again.");
  }

  installGlobal(repo);

  if (args.all) {
    for (const w of loadWorkspaces()) {
      if (fancy) {
        line();
        console.log(`${magenta("◆")}  ${bold(displayPath(w.path))}`);
      }
      if (!fs.existsSync(w.path)) {
        report("skipped", w.path, "folder not found; stop tracking it with: dotagents untrack");
        continue;
      }
      state.base = w.path;
      initWorkspace(repo, w.path, w.skills);
      if (fs.existsSync(path.join(w.path, "skills-lock.json"))) await updateThirdParty(w.path);
      state.base = null;
    }
  }
  finish();
}

async function updateThirdParty(ws) {
  section("Third-party skills");
  const lock = path.join(ws, "skills-lock.json");
  if (state.dryRun) return report("would update", lock, "npx skills update -p -y");
  // A single command string with shell: true, so Windows finds npx.cmd. Nothing here comes from
  // user input.
  const res = await runWithSpinner("Updating third-party skills", "npx -y skills update -p -y", [], { cwd: ws, shell: true });
  report(res.code === 0 ? "ok" : "failed", lock, res.last);
}

// Runs a command without blocking, so the spinner keeps turning. Returns the exit code and the
// last line of output (without colors).
function runWithSpinner(message, command, commandArgs, options = {}) {
  const spin = fancy ? p.spinner({ indicator: "dots" }) : null;
  spin?.start(message);
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const done = (code) => {
      const last = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim().split(/\r?\n/).pop() ?? "";
      if (spin) code === 0 ? spin.stop(dim(message)) : spin.error(message);
      resolve({ code, last });
    };
    child.on("error", (err) => {
      output += err.message;
      done(1);
    });
    child.on("close", done);
  });
}

// ── listings ──────────────────────────────────────────────────────────────────────────────────

function listSkills() {
  const names = repoSkills(repo);
  if (!fancy) return names.forEach((name) => console.log(`${name.padEnd(20)} ${describe(name)}`));
  const width = Math.max(...names.map((n) => n.length)) + 2;
  const columns = Math.max(60, process.stdout.columns || 100);
  console.log(`${rail.start()}  ${bold(`${names.length} skills`)} ${dim(`in ${displayPath(path.join(repo, "skills"))}`)}`);
  line();
  for (const name of names) {
    const lines = wrap(describe(name), columns - width - 6);
    line(`${green(name.padEnd(width))}${dim(lines[0] ?? "")}`);
    for (const text of lines.slice(1)) line(`${" ".repeat(width)}${dim(text)}`);
  }
  line();
  console.log(`${rail.end()}  ${dim("Link into a workspace:")} dotagents init ${dim("<path>")} --skills ${dim("<name>")}\n`);
}

function listWorkspaces() {
  const all = loadWorkspaces();
  if (!fancy) {
    if (!all.length) console.log(`No workspaces yet. Set one up with: dotagents init <path>`);
    for (const w of all) console.log(`${w.path}${fs.existsSync(w.path) ? "" : "  (missing)"}\n  skills: ${w.skills.join(", ") || "-"}`);
    return console.log(`\nList kept in ${registryFile()}`);
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
  console.log(`${rail.end()}  ${dim(`List kept in ${displayPath(registryFile())}`)}\n`);
}

function wrap(text, width) {
  const lines = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// First sentence of a skill's description, read from its SKILL.md frontmatter.
function describe(name) {
  const text = fs.readFileSync(path.join(repo, "skills", name, "SKILL.md"), "utf8");
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const m = front.match(/^description:\s*(?:[|>]-?\s*\n((?:[ \t]+.*\n?)+)|(.+))/m);
  const desc = (m?.[1] ?? m?.[2] ?? "").replace(/\s+/g, " ").trim();
  return desc.split(/(?<=\.)\s/)[0];
}
