import fs from "node:fs";
import path from "node:path";
import { runWithSpinner } from "../../core/common.ts";
import { installProfiles } from "../../core/profiles.ts";
import { checkWarn, displayPath, fancy, finish, header, line, report, section, style } from "../../core/output.ts";
import { loadWorkspaces } from "../../core/machine-state.ts";
import { listSkills, resolveSkills } from "../../core/skills.ts";
import { state } from "../../core/state.ts";
import { applyWorkspace } from "../../core/workspace.ts";
import type { Command } from "./shared.ts";

const { bold, magenta } = style;

export const update: Command = {
  name: "update",
  usage: "[--all]",
  summary: "git pull this repository and run install",
  more: [`with ${style.cyan("--all")}, also refresh every tracked workspace`, "and update its third-party skills"],
  group: "Machine",
  async run({ repo, args }) {
    header("update", args.all ? "all tracked workspaces" : "");
    section("Repository");
    if (args["no-pull"]) report("ok", repo, "--no-pull: git pull skipped");
    else if (state.dryRun) report("would update", repo, "git pull --ff-only");
    else {
      const lockBefore = readLock(repo);
      const binBefore = readBin(repo);
      const versionBefore = readVersion(repo);
      const pull = await runWithSpinner("Pulling the repository", "git", ["-C", repo, "pull", "--ff-only"]);
      report(pull.code === 0 ? "ok" : "failed", repo, pull.last);
      if (pull.code !== 0) return finish("Fix the repository (commit, stash or resolve) and run dotagents update again.");
      const note = versionNote(versionBefore, readVersion(repo));
      if (note) report("updated", path.join(repo, "CHANGELOG.md"), note);
      // New dependencies from the pull: install them now, or the next run can't start.
      if (readLock(repo) !== lockBefore) {
        const npm = await runWithSpinner("Installing dependencies", "npm install --no-audit --no-fund", [], { cwd: repo, shell: true });
        report(npm.code === 0 ? "updated" : "failed", path.join(repo, "node_modules"), npm.code === 0 ? "npm install" : npm.last);
      }
      // A new entry file (cli.mjs became cli.ts): the dotagents command still points at the old one
      // until npm link runs again.
      if (readBin(repo) !== binBefore) {
        const link = await runWithSpinner("Linking the dotagents command", "npm link --no-audit --no-fund", [], { cwd: repo, shell: true });
        report(link.code === 0 ? "updated" : "failed", repo, link.code === 0 ? "npm link: the command points at the new entry file" : link.last);
      }
    }

    installProfiles(repo);

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
  },
};

async function updateThirdParty(ws: string) {
  section("Third-party skills");
  const lock = path.join(ws, "skills-lock.json");
  if (state.dryRun) return report("would update", lock, "npx skills update -p -y");
  // A single command string with shell: true, so Windows finds npx.cmd. Nothing here comes from
  // user input.
  const res = await runWithSpinner("Updating third-party skills", "npx -y skills update -p -y", [], { cwd: ws, shell: true });
  report(res.code === 0 ? "ok" : "failed", lock, res.last);
}

// What a pull that changed the version says; null when it didn't, or can't tell.
export function versionNote(before: string, after: string) {
  return before && after && before !== after ? `version ${before} → ${after}: see CHANGELOG.md` : null;
}

function readVersion(repo: string): string {
  try {
    const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}

// The command's entry file, as package.json names it.
function readBin(repo: string) {
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).bin ?? null);
  } catch {
    return "";
  }
}

function readLock(repo: string) {
  try {
    return fs.readFileSync(path.join(repo, "package-lock.json"), "utf8");
  } catch {
    return "";
  }
}
