import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import { gitRepoOf, isRepoRoot } from "../lib/git.ts";
import { displayPath, fancy, finish, header, interactive, line, style } from "../lib/output.ts";
import { registerWorkspace, untrackWorkspace } from "../lib/registry.ts";
import { listSkills, resolveSkills, skillsIn } from "../lib/skills.ts";
import { state } from "../lib/state.ts";
import { applyWorkspace, assertWorkspace, wrapRepository } from "../lib/workspace.ts";
import { type Command, type Context, expandHome, fitHint, workspaceArg } from "./shared.ts";

const { bold, dim } = style;

export const init: Command = {
  name: "init",
  usage: "[path] [--skills a,b]",
  summary: "apply the standards and link skills",
  more: [
    "in a terminal, without --skills, asks which skills to link;",
    "on a git repository, offers to move it into <name>-workspace/",
    "(--wrap does it without asking)",
  ],
  group: "Workspace",
  run: (ctx) => initWorkspace(ctx, workspaceArg(ctx)),
};

// opened: a command (new) already printed its header, so neither the questions nor init open
// the rail again.
export async function initWorkspace(ctx: Context, ws: string, { opened = false } = {}) {
  const { repo, args } = ctx;
  let skills = args.skills;
  // A repository to move into <name>-workspace/ first: asked in a terminal, --wrap otherwise.
  let wrapFrom = args.wrap ? ws : null;
  // In a terminal, without --skills or --yes, ask instead of guessing. The questions open the
  // rail themselves, so the header is printed only when there were none.
  const asked = interactive && !args.yes && skills === undefined;
  if (asked) ({ ws, skills, wrapFrom } = await askInit(ctx, ws, { opened }));
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
  if (wrapFrom) await afterWrap(ctx, ws);
  return finish(`To check later: dotagents check "${displayPath(ws)}"`);
}

// The repository moved: the shell that ran init still sits in the old folder, and the agents
// list past sessions by folder. In a terminal, offers to open the workspace in VS Code.
async function afterWrap(ctx: Context, ws: string) {
  const say = (text: string) => (fancy ? line(dim(text)) : console.log(text));
  if (fancy) line();
  say(`Your terminal is still in the old folder: cd "${displayPath(ws)}"`);
  say("Past agent sessions are listed under the old path: the move-sessions skill brings them along.");
  const code = spawnSync("code", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
  if (!interactive || ctx.args.yes || !code) return;
  const open = await p.confirm({ message: `Open ${bold(displayPath(ws))} in VS Code?` });
  if (open === true) spawn("code", [ws], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
}

async function askInit(ctx: Context, defaultWs: string, { opened = false } = {}) {
  const { repo } = ctx;
  const exit = <T,>(value: T): Exclude<T, symbol> => {
    if (p.isCancel(value)) {
      p.cancel(opened ? "The repository was cloned; nothing else was changed. Run dotagents init later." : "Nothing was changed.");
      process.exit(0);
    }
    return value as Exclude<T, symbol>;
  };

  if (!opened) p.intro(`${style.bgMagenta(style.white(style.bold(" dotagents ")))} ${bold("init")}`);

  let ws = defaultWs;
  if (ctx.positional[0] === undefined && !opened) {
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
