#!/usr/bin/env node
// `dotagents`: applies this repository's Claude Code configuration. Works on Windows, Linux and
// macOS with Node 22.18+, which runs this TypeScript file directly (type stripping, no build).
// Make it a command with `npm install && npm link` in the clone (the two dependencies,
// @clack/prompts and picocolors, draw the terminal output and the prompts).

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import { parseArgs, runWithSpinner } from "./lib/common.ts";
import { checkWarn, displayPath, fancy, finish, header, interactive, line, rail, report, section, style } from "./lib/output.ts";
import { state } from "./lib/state.ts";
import { installGlobal } from "./lib/global.ts";
import { loadWorkspaces, registerWorkspace, registryFile, untrackWorkspace } from "./lib/registry.ts";
import { listSkills, resolveSkills, skillsIn } from "./lib/skills.ts";
import { SAFE_NAME, SAFE_SOURCE, catalogFile, discoverSkills, loadCatalog, saveCatalog } from "./lib/thirdparty.ts";
import { gitRepoOf, isRepoRoot } from "./lib/git.ts";
import { applyWorkspace, assertWorkspace, listRepoInAgentsMd, verifyWorkspace, wrapRepository } from "./lib/workspace.ts";

const repo = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
const { bold, dim, cyan, green, red, yellow, magenta, gray } = style;

function help() {
  const cmd = (name: string, args: string, desc: string, more: string[] = []) => {
    const left = `${cyan(name)}${args ? ` ${dim(args)}` : ""}`;
    const width = name.length + (args ? args.length + 1 : 0);
    const pad = " ".repeat(Math.max(2, 30 - width));
    return [`  ${left}${pad}${desc}`, ...more.map((text) => `${" ".repeat(32)}${text}`)].join("\n");
  };
  const title = (t: string) => bold(t.toUpperCase());
  return `${bold(magenta("dotagents"))} ${dim(version)}  Claude Code configuration

${title("Usage")}
  dotagents ${dim("<command> [options]")}

${title("Machine")}
${cmd("install", "", "apply the global configuration to this machine")}
${cmd("update", "[--all]", "git pull this repository and run install", [
  `with ${cyan("--all")}, also refresh every tracked workspace`,
  "and update its third-party skills",
])}

${title("Workspace")}
${cmd("new", "<git-url> [folder]", "create a workspace folder and clone the repository into it", [
  "folder: any name; default <name>-workspace (asked in a terminal);",
  "agent files at the root, the repository in a subfolder,",
  "so it never sees them; an existing workspace as folder",
  "adds one more repository",
])}
${cmd("init", "[path] [--skills a,b]", "apply the standards and link skills", [
  "in a terminal, without --skills, asks which skills to link;",
  "on a git repository, offers to move it into <name>-workspace/",
  "(--wrap does it without asking)",
])}
${cmd("check", "[path]", "run the checklist, change nothing")}
${cmd("workspaces", "", "list the workspaces tracked on this machine")}
${cmd("untrack", "<path>", "stop tracking a workspace; its files are not touched")}

${title("Skills")}
${cmd("skills", "", "list your skills and the registered third-party ones")}
${cmd("skills add", "<source>", "register third-party skills (owner/repo, git URL or path)", [
  "--skills a,b picks some when the source has several,",
  "--all takes every skill in the source;",
  "init and new offer them; installed with npx skills add",
])}
${cmd("skills remove", "<name>", "unregister a third-party skill")}

${title("Options")}
  ${cyan("--dry-run")}    show what would be done, change nothing
  ${cyan("--yes")}        (init) don't ask anything
  ${cyan("--wrap")}       (init) move a repository into <name>-workspace/ first
  ${cyan("--no-pull")}    (update) skip git pull, only reapply
  ${cyan("--help")}       show this help
  ${cyan("--version")}    show the version

${title("Examples")}
  ${gray("$")} dotagents new git@github.com:me/app.git
  ${gray("$")} dotagents init
  ${gray("$")} dotagents init ~/projects/app --skills session-archive,to-cards
  ${gray("$")} dotagents check ~/projects/app
  ${gray("$")} dotagents update --all

${dim("Repository:")} ${displayPath(repo)}
${dim("Third-party skills:")} npx skills add <owner/repo> ${dim("(at the workspace root)")}`;
}

type CliArgs = {
  _: string[];
  all?: boolean;
  "dry-run"?: boolean;
  help?: boolean;
  "no-pull"?: boolean;
  version?: boolean;
  wrap?: boolean;
  yes?: boolean;
  skills?: string[];
};

const args = parseArgs<CliArgs>(process.argv.slice(2), {
  booleans: ["all", "dry-run", "help", "no-pull", "version", "wrap", "yes"],
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
function expandHome(dir: string) {
  return dir === "~" || /^~[\\/]/.test(dir) ? path.join(os.homedir(), dir.slice(1)) : dir;
}

async function run(cmd: string) {
  const ws = path.resolve(expandHome(target ?? process.cwd()));
  switch (cmd) {
    case "install":
      header("install");
      installGlobal(repo);
      return finish();

    case "init":
      return init(ws);

    case "new":
      return newWorkspace();

    case "check":
      assertWorkspace(repo, ws);
      header("check", ws);
      state.base = ws;
      verifyWorkspace(repo, ws);
      return finish(state.problems ? "" : "Everything follows the standards.");

    case "update":
      header("update", args.all ? "all tracked workspaces" : "");
      return update();

    case "skills":
      if (target === "add") return registerThirdParty(args._[2]);
      if (target === "remove") return unregisterThirdParty(args._[2]);
      if (target) throw new Error(`Unknown subcommand 'skills ${target}'. Use: dotagents skills [add <source> | remove <name>]`);
      return printSkills();

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

// ── new ───────────────────────────────────────────────────────────────────────────────────────

// Creates a workspace around a repository: <name>-workspace/ holds the agent files and
// <name>-workspace/<name>/ the clone, so the project repository never sees them. With an
// existing workspace as the folder, adds one more repository to it.
async function newWorkspace() {
  const url = target;
  if (!url) throw new Error("Usage: dotagents new <git-url> [folder]");
  const name = path.basename(url.replace(/[\\/]+$/, "")).replace(/\.git$/, "").split(":").pop();
  if (!name) throw new Error(`Can't tell the repository name from '${url}'`);

  // The workspace folder can have any name (acme-platform, thesis…); <name>-workspace is
  // only the default. In a terminal, without a folder argument, ask for it.
  let folder = args._[2];
  const asked = folder === undefined && interactive && !args.yes;
  if (asked) {
    p.intro(`${style.bgMagenta(style.white(style.bold(" dotagents ")))} ${bold("new")}`);
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
  return init(ws, { opened: true });
}

// ── init ──────────────────────────────────────────────────────────────────────────────────────

// opened: a command (new) already printed its header, so neither the questions nor init open
// the rail again.
async function init(ws: string, { opened = false } = {}) {
  let skills = args.skills;
  // A repository to move into <name>-workspace/ first: asked in a terminal, --wrap otherwise.
  let wrapFrom = args.wrap ? ws : null;
  // In a terminal, without --skills or --yes, ask instead of guessing. The questions open the
  // rail themselves, so the header is printed only when there were none.
  const asked = interactive && !args.yes && skills === undefined;
  if (asked) ({ ws, skills, wrapFrom } = await askInit(ws, { opened }));
  else if (wrapFrom) ws = `${wrapFrom}-workspace`;
  if (!asked && !opened) header("init", ws);
  if (wrapFrom) {
    assertWorkspace(repo, wrapFrom);
    wrapRepository(wrapFrom, ws);
    if (state.dryRun) return finish(`Then the standards are applied to "${displayPath(ws)}"`);
    untrackWorkspace(wrapFrom);
  }
  assertWorkspace(repo, ws);
  state.base = ws;
  skills ??= [];
  await applyWorkspace(repo, ws, resolveSkills(repo, skills));
  if (!state.dryRun) registerWorkspace(ws, skills);
  state.base = null; // the hints show the workspace itself, not a path inside it
  if (wrapFrom) await afterWrap(wrapFrom, ws);
  return finish(`To check later: dotagents check "${displayPath(ws)}"`);
}

// The repository moved: the shell that ran init still sits in the old folder, and the agents
// list past sessions by folder. In a terminal, offers to open the workspace in VS Code.
async function afterWrap(from: string, ws: string) {
  const say = (text: string) => (fancy ? line(dim(text)) : console.log(text));
  if (fancy) line();
  say(`Your terminal is still in the old folder: cd "${displayPath(ws)}"`);
  say("Past agent sessions are listed under the old path: the move-sessions skill brings them along.");
  const code = spawnSync("code", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
  if (!interactive || args.yes || !code) return;
  const open = await p.confirm({ message: `Open ${bold(displayPath(ws))} in VS Code?` });
  if (open === true) spawn("code", [ws], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
}

async function askInit(defaultWs: string, { opened = false } = {}) {
  const exit = <T,>(value: T): Exclude<T, symbol> => {
    if (p.isCancel(value)) {
      p.cancel(opened ? "The repository was cloned; nothing else was changed. Run dotagents init later." : "Nothing was changed.");
      process.exit(0);
    }
    return value as Exclude<T, symbol>;
  };

  if (!opened) p.intro(`${style.bgMagenta(style.white(style.bold(" dotagents ")))} ${bold("init")}`);

  let ws = defaultWs;
  if (target === undefined && !opened) {
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

  // A folder that is itself a repository: the recommended layout keeps the agent files outside
  // it, in <name>-workspace/. A folder that has to stay as it is (an Obsidian vault, for
  // example) answers no and keeps them inside, hidden from git by .git/info/exclude.
  let wrapFrom = null;
  const inside = opened ? null : gitRepoOf(ws);
  if (inside && isRepoRoot(ws, inside.top)) {
    p.log.message(dim(`No keeps the agent files inside the repository, hidden from git by .git/info/exclude: for a folder that has to stay as it is, like an Obsidian vault.`));
    const wrap = exit(
      await p.confirm({
        message: `${bold(displayPath(ws))} is a git repository. Move it into ${bold(`${path.basename(ws)}-workspace/`)}, with the agent files outside it?`,
      })
    );
    if (wrap) wrapFrom = ws;
  }

  // Skills already in place, read before the move.
  const present = skillsIn(repo, ws);
  if (wrapFrom) ws = `${wrapFrom}-workspace`;
  const skills = exit(
    await p.multiselect({
      message: `Which skills should ${bold(displayPath(ws))} use?`,
      options: listSkills(repo).map((s) => {
        const label = s.kind === "own" ? s.name : `${s.name} ${dim(`· ${s.source}`)}`;
        const here = s.kind === "own" ? "already linked" : "already installed";
        return { value: s.name, label, hint: present.includes(s.name) ? here : fitHint(s.description, label) };
      }),
      initialValues: present,
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
      p.cancel(opened ? "The repository was cloned; nothing else was changed. Run dotagents init later." : "Nothing was changed.");
      process.exit(0);
    }
  }
  return { ws, skills, wrapFrom };
}

// ── third-party catalog ───────────────────────────────────────────────────────────────────────

async function registerThirdParty(source: string | undefined) {
  if (!source) throw new Error("Usage: dotagents skills add <source> [--skills a,b]   (source: owner/repo, a git URL or a path)");
  if (!SAFE_SOURCE.test(source)) throw new Error(`'${source}' has characters that aren't allowed in a source`);
  header("skills add", source);
  section("Source");
  const found = await discoverSkills(source);
  if (!found.length) throw new Error(`No SKILL.md found in ${source}`);

  let chosen = found;
  if (args.all) {
    chosen = found;
  } else if (args.skills) {
    const wanted = args.skills;
    const missing = wanted.filter((n) => !found.some((s) => s.name === n));
    if (missing.length) throw new Error(`${source} has no skill named ${missing.join(", ")}. It has: ${found.map((s) => s.name).join(", ")}`);
    chosen = found.filter((s) => wanted.includes(s.name));
  } else if (found.length > 1) {
    if (!interactive || args.yes) {
      throw new Error(`${source} has ${found.length} skills (${found.map((s) => s.name).join(", ")}). Pick with --skills a,b, or take them all with --all`);
    }
    const picked = await p.multiselect({
      message: `Which skills from ${bold(source)} should be registered?`,
      options: found.map((s) => ({ value: s.name, label: s.name, hint: fitHint(s.description, s.name) })),
      required: true,
    });
    if (p.isCancel(picked)) {
      p.cancel("Nothing was registered.");
      process.exit(0);
    }
    chosen = found.filter((s) => picked.includes(s.name));
  }

  const catalog = loadCatalog(repo);
  const own = listSkills(repo).filter((s) => s.kind === "own").map((s) => s.name);
  const file = catalogFile(repo);
  section("Catalog");
  for (const skill of chosen) {
    if (!SAFE_NAME.test(skill.name)) {
      report("skipped", file, `${skill.name}: not a valid skill name`);
      continue;
    }
    if (own.includes(skill.name)) {
      report("skipped", file, `${skill.name}: same name as one of your skills in skills/`);
      continue;
    }
    const existing = catalog.find((s) => s.name === skill.name);
    if (existing && existing.source === source && existing.description === skill.description) {
      report("ok", file, `${skill.name} from ${source}`);
      continue;
    }
    if (existing && existing.source !== source) {
      report("skipped", file, `${skill.name} is already registered from ${existing.source}; remove it first`);
      continue;
    }
    report(state.dryRun ? (existing ? "would update" : "would create") : existing ? "updated" : "created", file, `${skill.name} from ${source}`);
    if (!state.dryRun) {
      const entry = { name: skill.name, source, description: skill.description };
      if (existing) Object.assign(existing, entry);
      else catalog.push(entry);
    }
  }
  if (!state.dryRun) saveCatalog(repo, catalog);
  return finish("Commit skills/third-party-skills.json to have them on your other machines. Use one: dotagents init <path> --skills <name>");
}

function unregisterThirdParty(name: string | undefined) {
  if (!name) throw new Error("Usage: dotagents skills remove <name>");
  const catalog = loadCatalog(repo);
  const file = catalogFile(repo);
  header("skills remove", name);
  section("Catalog");
  if (!catalog.some((s) => s.name === name)) {
    report("skipped", file, `${name} is not registered`);
    return finish();
  }
  report(state.dryRun ? "would update" : "updated", file, `removed ${name} (workspaces that installed it keep it)`);
  if (!state.dryRun) saveCatalog(repo, catalog.filter((s) => s.name !== name));
  return finish();
}

// ── update ────────────────────────────────────────────────────────────────────────────────────

async function update() {
  section("Repository");
  if (args["no-pull"]) report("ok", repo, "--no-pull: git pull skipped");
  else if (state.dryRun) report("would update", repo, "git pull --ff-only");
  else {
    const lockBefore = readLock();
    const pull = await runWithSpinner("Pulling the repository", "git", ["-C", repo, "pull", "--ff-only"]);
    report(pull.code === 0 ? "ok" : "failed", repo, pull.last);
    if (pull.code !== 0) return finish("Fix the repository (commit, stash or resolve) and run dotagents update again.");
    // New dependencies from the pull: install them now, or the next run can't start.
    if (readLock() !== lockBefore) {
      const npm = await runWithSpinner("Installing dependencies", "npm install --no-audit --no-fund", [], { cwd: repo, shell: true });
      report(npm.code === 0 ? "updated" : "failed", path.join(repo, "node_modules"), npm.code === 0 ? "npm install" : npm.last);
    }
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
      // Missing skills are linked or installed again (a new machine, a fresh clone); third-party
      // ones are then brought up to date by npx skills update.
      const known = listSkills(repo).map((s) => s.name);
      const gone = w.skills.filter((name) => !known.includes(name));
      if (gone.length) checkWarn(`skipped skills no longer in this repository or the catalog: ${gone.join(", ")}`, `to drop them for good: dotagents untrack, then dotagents init again`);
      await applyWorkspace(repo, w.path, resolveSkills(repo, w.skills.filter((name) => known.includes(name))));
      if (fs.existsSync(path.join(w.path, "skills-lock.json"))) await updateThirdParty(w.path);
      state.base = null;
    }
  }
  finish();
}

async function updateThirdParty(ws: string) {
  section("Third-party skills");
  const lock = path.join(ws, "skills-lock.json");
  if (state.dryRun) return report("would update", lock, "npx skills update -p -y");
  // A single command string with shell: true, so Windows finds npx.cmd. Nothing here comes from
  // user input.
  const res = await runWithSpinner("Updating third-party skills", "npx -y skills update -p -y", [], { cwd: ws, shell: true });
  report(res.code === 0 ? "ok" : "failed", lock, res.last);
}

function readLock() {
  try {
    return fs.readFileSync(path.join(repo, "package-lock.json"), "utf8");
  } catch {
    return "";
  }
}

// ── listings ──────────────────────────────────────────────────────────────────────────────────

function printSkills() {
  const all = listSkills(repo);
  const own = all.filter((s) => s.kind === "own");
  const thirdParty = all.filter((s) => s.kind === "third-party");
  if (!fancy) {
    own.forEach((s) => console.log(`${s.name.padEnd(20)} ${s.description}`));
    thirdParty.forEach((s) => console.log(`${s.name.padEnd(20)} ${s.description}  (third-party: ${s.source})`));
    return;
  }
  const width = Math.max(...all.map((s) => s.name.length)) + 2;
  const columns = Math.max(60, process.stdout.columns || 100);
  const row = (name: string, text: string, color: (text: string) => string) => {
    const lines = wrap(text, columns - width - 6);
    line(`${color(name.padEnd(width))}${dim(lines[0] ?? "")}`);
    for (const rest of lines.slice(1)) line(`${" ".repeat(width)}${dim(rest)}`);
  };
  console.log(`${rail.start()}  ${bold(`${own.length} skills`)} ${dim(`in ${displayPath(path.join(repo, "skills"))}`)}`);
  line();
  for (const s of own) row(s.name, s.description, green);
  line();
  console.log(`${style.cyan("◇")}  ${bold(`${thirdParty.length} third-party`)} ${dim("registered in skills/third-party-skills.json, installed with npx skills")}`);
  if (!thirdParty.length) line(dim("None yet. Register one with: dotagents skills add <owner/repo>"));
  for (const s of thirdParty) {
    row(s.name, s.description, cyan);
    line(`${" ".repeat(width)}${gray(`from ${s.source}`)}`);
  }
  line();
  console.log(`${rail.end()}  ${dim("Use in a workspace:")} dotagents init ${dim("<path>")} --skills ${dim("<name>")}
`);
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

function wrap(text: string, width: number) {
  const lines: string[] = [];
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

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// A prompt hint is one line: the author's full description, cut only where the terminal ends.
const fitHint = (text: string, label: string) => truncate(text, Math.max(30, (process.stdout.columns || 100) - label.length - 14));
