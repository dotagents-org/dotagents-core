# dotagents

My configuration for coding agents (Claude Code, Codex and OpenCode), kept in one repository and applied by one command, `dotagents`. It covers two levels:

- **The machine:** global instructions, rules and settings, written where each tool looks for them.
- **Each workspace:** a project folder gets the `.agents/` and `.artifacts/` standards, the skills it needs and the links each tool expects, without a single agent file ending up in the project's git history.

It runs on Windows, Linux (WSL included) and macOS.

## Contents

- [Why this exists](#why-this-exists)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Output, options and environment variables](#output-options-and-environment-variables)
- [Workspaces](#workspaces)
- [Skills](#skills)
- [Global configuration](#global-configuration)
- [Standards](#standards)
- [Recipes](#recipes)
- [Repository layout](#repository-layout)
- [Architecture](#architecture)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)

## Why this exists

Each coding agent reads its configuration from its own place: Claude Code from `.claude/` and `CLAUDE.md`, Codex from `.codex/` and `AGENTS.md`, OpenCode from `.opencode/`, `opencode.json` and `AGENTS.md`. Using the three of them across several projects quickly leads to copies that drift apart: the same skill in three folders, instructions edited in one tool and forgotten in the others, a different setup on each machine.

dotagents keeps one source for all of it and generates or links what each tool expects. Two rules shape the design:

1. **One source.** Instructions, rules and skills are written once, in this repository. The tools' folders only receive links or generated files.
2. **The projects stay clean.** Agent configuration is personal, so it never goes into a project's repository, not even as a `.gitignore` rule. The recommended layout puts the agent files in a folder that wraps the project's repositories instead of inside them.

## How it works

```
                 gabrieldulolmarques/dotagents  (GitHub)
                          │  git clone + npm link
                          ▼
   <clone>/  ─────────────────────── the `dotagents` command ──────────────────────┐
   ├── global/              global instructions (instructions.md, env/)           │
   ├── rules/               global rules                                          │
   ├── claude/, opencode/   settings                                              │
   ├── skills/              my skills                                             │
   ├── third-party-skills.json   catalog of skills by other authors              │
   └── standards/, templates/    the workspace standards                         │
                                                                                  │
        ┌─────────────────────────────────────────────────────┬──────────────────┘
        ▼ dotagents install (machine)                         ▼ dotagents new / init (workspace)
  ~/.claude/CLAUDE.md, rules, settings.json            app-workspace/
  ~/.codex/AGENTS.md                                   ├── AGENTS.md, INDEX.md
  ~/.config/opencode/AGENTS.md, opencode.json          ├── .agents/skills/<skill>  → <clone>/skills/<skill>
                                                       ├── .claude/skills → .agents/skills
                                                       ├── .artifacts/session-archives/, plans/
                                                       └── app/   ← the project's git clone, untouched
```

The command runs from the clone (that is what `npm link` sets up), so every link it creates points back to the clone. Editing a skill or a rule in the clone takes effect at once in every workspace of that machine. The other machine catches up with `git pull`, or `dotagents update`.

## Requirements

- **Node.js 20.12 or newer**, with npm.
- **git**, on the PATH.
- **npx**, which comes with npm, for third-party skills (`npx skills`).
- Two npm dependencies, installed by `npm install`: [@clack/prompts](https://github.com/bombshell-dev/clack) for the terminal look, the questions and the spinners, and [picocolors](https://github.com/alexeyraspopov/picocolors) for colors.

No administrator rights are needed on Windows: folders are linked with junctions, and files are copied.

## Installation

Once per machine. WSL counts as a separate machine: it has its own home folder, its own Node and its own copies of the tools, so it needs its own clone and its own `dotagents install`.

```bash
git clone git@github.com:gabrieldulolmarques/dotagents.git
cd dotagents
npm install            # the two dependencies
npm link               # creates the `dotagents` command, pointing to this clone
dotagents install      # global instructions, rules and settings for this machine
```

`npm link` copies nothing. It links the package into npm's global folder and creates the `dotagents` command there (`dotagents`, `dotagents.cmd` and `dotagents.ps1` on Windows). Run it again if the clone moves, or after switching to another Node version with nvm, since each Node installation has its own global folder.

Without `npm link`, every command also works as `node cli.mjs <command>` from the clone.

On Linux with Node from the system package manager, `npm link` may ask for `sudo`. To avoid it, point npm's global folder to your home first:

```bash
npm config set prefix ~/.local     # and have ~/.local/bin on the PATH
```

To remove the command: `npm unlink -g dotagents` in the clone.

## Quick start

```bash
# Start a project in the recommended layout
cd ~/projects
dotagents new git@github.com:me/app.git      # creates app-workspace/ with app/ inside, asks which skills to use

# Or apply the standards to a folder that already exists
dotagents init ~/projects/notes --skills obsidian-docs,humanizer

# Check that a workspace still follows the standards
dotagents check ~/projects/app-workspace

# Bring everything up to date on this machine
dotagents update --all
```

Run the agents (Claude Code, Codex, OpenCode) from the workspace root, where `AGENTS.md` and `.agents/` are.

## Commands

```
dotagents <command> [options]
```

| Command | What it does |
|---|---|
| [`install`](#dotagents-install) | Applies the global configuration to this machine. |
| [`update [--all]`](#dotagents-update) | Pulls this repository and runs `install`; with `--all`, also refreshes every tracked workspace. |
| [`new <git-url> [folder]`](#dotagents-new) | Creates a workspace folder (any name; `<name>-workspace` by default), clones the repository into it and applies the standards. |
| [`init [path]`](#dotagents-init) | Applies the standards to a folder and puts the chosen skills in it. |
| [`check [path]`](#dotagents-check) | Runs the standards checklist on a workspace, changing nothing. |
| [`workspaces`](#dotagents-workspaces) | Lists the workspaces tracked on this machine. |
| [`untrack <path>`](#dotagents-untrack) | Stops tracking a workspace. Its files are not touched. |
| [`skills`](#dotagents-skills) | Lists my skills and the registered third-party ones. |
| [`skills add <source>`](#dotagents-skills-add) | Registers third-party skills in the catalog. |
| [`skills remove <name>`](#dotagents-skills-remove) | Removes a third-party skill from the catalog. |

`dotagents --help` shows the same list, and `dotagents --version` the version.

### dotagents install

Writes the global configuration where each tool reads it. See [Global configuration](#global-configuration) for exactly what goes where.

```bash
dotagents install --dry-run    # show what would change
dotagents install
```

Run it again after editing `global/` or `rules/`, and on Windows also after editing the settings in `claude/` or `opencode/`. On Linux and macOS the settings and the rules are links, so their changes apply right away.

### dotagents update

```bash
dotagents update               # git pull --ff-only in the clone, then install
dotagents update --all         # also refresh every tracked workspace
dotagents update --no-pull     # skip the pull and only reapply
```

- When the pull changes `package-lock.json`, it runs `npm install` before going on, so the next run can start.
- If the pull fails (local changes, diverged history), it stops and asks you to fix the repository first.
- With `--all`, for each tracked workspace it:
  - applies the standards again, which puts back any skill that is missing (useful on a new machine or after cloning a workspace again);
  - runs `npx skills update` when the workspace has third-party skills;
  - warns about skills that were removed from this repository or the catalog, without failing. To drop them from the workspace's record, `untrack` it and run `init` again.

### dotagents new

```bash
dotagents new <git-url> [folder] [--skills a,b] [--yes] [--dry-run]
```

Creates a workspace around a repository, in the [recommended layout](#recommended-layout-the-workspace-wraps-the-repositories):

```bash
dotagents new git@github.com:me/app.git                 # app-workspace/app/
dotagents new git@github.com:me/api.git app-workspace   # adds api/ to the same workspace
```

1. Creates the workspace folder. Its name is free (`my-project`, `my-org-workspace`…): pass it as `[folder]`, or answer the question in a terminal. Without one, it is `<name>-workspace/`, with `<name>` taken from the URL.
2. Clones the repository into `<folder>/<name>/`.
3. If the workspace already had an `AGENTS.md` with a `## Repositories` section, adds the new repository to that list. Only that section is touched.
4. Runs `init` on the workspace, with the same questions and options.

It refuses to clone over an existing folder, and refuses to use a folder that is itself a git repository as the workspace. The URL can be anything `git clone` accepts, a local path included.

### dotagents init

```bash
dotagents init [path] [--skills a,b] [--yes] [--dry-run]
```

Applies the standards to a folder (the current one when no path is given) and puts the chosen skills in it. It creates only what is missing and never overwrites your own files. See [What init creates](#what-init-creates).

- **In a terminal, without `--skills`,** it asks:
  1. which folder, when none was given;
  2. which skills, from a list of yours and the registered third-party ones, with the ones already in the workspace selected;
  3. for confirmation before changing anything.

  `Ctrl+C` leaves without changes.
- **With `--skills a,b`,** it uses those names and asks nothing. Names can mix both kinds: `--skills to-cards,humanizer`.
- **With `--yes`, in CI, or when input is piped,** it never asks.

Running it again on a workspace is safe: what is already right stays as it is, and new skills are added to the ones already there.

`init` also records the workspace and its skills in the [tracked list](#dotagents-workspaces), for `update --all`.

### dotagents check

```bash
dotagents check [path]
```

Runs the checklist on a workspace and changes nothing. It exits with code 1 when something fails, so it also works in scripts. See [What check verifies](#what-check-verifies).

Warnings (`!`) point out something worth knowing, such as a workspace whose root is itself a git repository, without failing the check.

### dotagents workspaces

Lists the workspaces set up with `init` or `new` on this machine, with their skills, and marks the ones whose folder no longer exists. The list lives in `~/.config/dotagents/workspaces.json` (see [Environment variables](#environment-variables)).

### dotagents untrack

```bash
dotagents untrack <path>
```

Removes a workspace from the tracked list, so `update --all` skips it. Its files are not touched.

### dotagents skills

Lists my skills and the registered third-party ones, each with the full description its author wrote and, for third-party ones, where it comes from.

### dotagents skills add

```bash
dotagents skills add <source> [--skills a,b | --all] [--dry-run]
```

Registers third-party skills in `third-party-skills.json`, so `init` and `new` offer them on every machine. The source can be `owner/repo` (GitHub), a git URL or a local path.

```bash
dotagents skills add blader/humanizer
dotagents skills add vercel-labs/agent-skills --skills web-design-guidelines,writing-guidelines
dotagents skills add mattpocock/skills --all
```

It makes a shallow clone of the source in a temporary folder, finds every `SKILL.md` in it and stores the name, the source and the description exactly as the author wrote them. When the source has several skills, pick some with `--skills`, all of them with `--all`, or choose from a list in a terminal.

A skill is skipped when its name matches one of my skills, when it is already registered from another source, or when its name isn't valid. Running the command again updates the stored descriptions. Commit `third-party-skills.json` afterwards to have the change on the other machine.

### dotagents skills remove

```bash
dotagents skills remove <name>
```

Removes a skill from the catalog. Workspaces that already installed it keep it; to remove it from one of them, run `npx skills remove <name>` at its root.

## Output, options and environment variables

### Options

| Option | Commands | Effect |
|---|---|---|
| `--dry-run` | all that change something | Shows what would be done and changes nothing. |
| `--skills a,b` | `init`, `new`, `skills add` | Skills to use, or to register. |
| `--all` | `update`, `skills add` | Every tracked workspace, or every skill of the source. |
| `--yes` | `init`, `new`, `skills add` | Never ask. |
| `--no-pull` | `update` | Skip `git pull`. |
| `--help`, `--version` | | |

Paths can be written with `~` for the home folder, also in PowerShell and cmd, which don't expand it themselves. The short paths dotagents prints can be pasted back.

### Output

In a terminal, every command draws one vertical line from `┌` to `└`, with a section per step and a summary at the end:

```
┌   dotagents  init  ~/projects/app-workspace
│
◇  .agents/
│  + created      .agents/skills/to-cards  → D:/myWorkspace/dotagents/skills/to-cards
│
◇  .artifacts/
│  + created      .artifacts/plans
│
└  ✓ 9 created · 2 already ok
```

| Mark | Meaning |
|---|---|
| `+ created`, `~ updated` | changed now |
| `✓ ok` | already right |
| `! skipped` | left alone on purpose, with the reason (counts as a problem) |
| `✗ failed` | went wrong, with the reason |
| `+` / `~` in cyan | would change (dry run) |

When the output goes to a pipe or a file (CI, scripts), the same information comes as plain lines that are easy to grep: `<status> <full path> (<detail>)`.

### Exit codes

- `0`: everything ok, or only warnings.
- `1`: at least one item was skipped or failed, a check item failed, or the command itself failed (bad arguments, missing folder).

### Environment variables

| Variable | Effect |
|---|---|
| `NO_COLOR` | Turns colors off. |
| `FORCE_COLOR` | Forces the terminal output even when it isn't a terminal. |
| `CI` | Never asks questions. |
| `DOTAGENTS_STATE_DIR` | Folder of the tracked list (`workspaces.json`). Default: `~/.config/dotagents`. |
| `XDG_CONFIG_HOME` | Base of `~/.config` (OpenCode's folder and the default state folder). |

## Workspaces

A workspace is a project folder that follows the `.agents/` and `.artifacts/` standards. The agents run from its root.

### Recommended layout: the workspace wraps the repositories

```
app-workspace/            not a git repository
├── AGENTS.md             project instructions, read by all three tools
├── INDEX.md              map of the project's documents
├── .agents/              skills (and rules, subagents, hooks when there are any)
├── .claude/              links to .agents/, plus settings.json
├── .artifacts/           documentation written by agents and people
│   ├── session-archives/ session transcripts
│   └── plans/            plans written before implementing
├── app/                  git clone: only the project's own files
└── api/                  another repository of the same project, if any
```

The project's repositories never see the agent files, so there is nothing to ignore. Cloning again, switching branches or running `git clean -fdx` inside them doesn't touch `.artifacts/` or the transcripts. `AGENTS.md` lists the repositories, so the agents know where the code is and run git inside each one (`git -C app …`).

Some things need a git repository in the current folder: Claude Code worktrees, or `codex exec` (which accepts `--skip-git-repo-check`). Use them from inside one of the repositories.

### When the folder has to be the repository

Sometimes the root itself must be the repository: an Obsidian vault, for example, which the app and the sync expect in one place. `init` then lists every agent file in the repository's `.git/info/exclude`. Git ignores them as it would with `.gitignore`, but the exclude file lives inside `.git/` and is never committed, so the project carries no trace of the configuration. `check` shows a warning that suggests the wrapping layout.

The excluded paths are `AGENTS.md`, `CLAUDE.md`, `INDEX.md`, `skills-lock.json`, `opencode.json`, `.agents/`, `.artifacts/`, `.claude/`, `.codex/`, `.opencode/`, `.copilot/`, `.cursor/` and `.gemini/`, all anchored to the workspace.

### What init creates

In this order:

| Step | What | Rule |
|---|---|---|
| Git | an entry in `.git/info/exclude` | only when the folder is inside a git repository |
| Root files | `AGENTS.md`, `INDEX.md` | from `templates/workspace/`, only when missing; `AGENTS.md` gets the project name and the list of repositories in the folder |
| | `CLAUDE.md` | none: Claude Code reads `AGENTS.md` directly; the `@AGENTS.md` stub that earlier versions generated is removed, a `CLAUDE.md` of yours stays |
| `.agents/` | `README.md` | points to the standard in this repository |
| | `skills/<name>` | a link per own skill; third-party ones installed with `npx skills add` |
| | `.claude/skills` | a link to `.agents/skills`, made before any installation |
| `.claude/` | `rules` | a link to `.agents/rules`, when that folder exists |
| | `settings.json` | adds `"plansDirectory": ".artifacts/plans"` and keeps the rest of the file; a different value already there is respected |
| `.artifacts/` | `README.md`, `session-archives/`, `plans/` | the two fixed folders |

Files dotagents generates start with a marker line. A file without the marker is yours: dotagents leaves it alone, or, where it has to replace it, keeps a copy next to it as `<file>.bak-<date>`. Links are relative on Linux and macOS when they stay inside the workspace, so the workspace can move; Windows junctions are always absolute.

### What check verifies

| Area | Checks |
|---|---|
| Git | warns when the workspace is a repository or inside one; fails when an agent file is tracked, or when git would add one as new |
| Root files | `AGENTS.md` exists, is at most ~8 KB and mentions every repository in the folder; warns when a `CLAUDE.md` doesn't import `AGENTS.md`, since Claude Code would then read only the `CLAUDE.md` |
| `.agents/` | no `.agents/.agents/`, `.agents/commands/` or `.codex/skills/`; every rule in `.agents/rules/` linked from `AGENTS.md` |
| Skills | `.claude/skills` is a link to `.agents/skills`; every skill folder has a `SKILL.md` whose `name` matches the folder and that is under 500 lines; my skills are links, not copies, and not also in the lock; every skill in `skills-lock.json` is installed |
| `.claude/` | `rules` is a link when it exists; `settings.json` sets `plansDirectory` |
| `.artifacts/` | `session-archives/` and `plans/` exist |

## Skills

Skills follow the [Agent Skills](https://agentskills.io/specification) format: a folder with a `SKILL.md` whose frontmatter has `name` and `description`, plus optional `scripts/`, `references/` and `assets/`. Claude Code reads them from `.claude/skills/`, Codex and OpenCode from `.agents/skills/`. In a workspace both point to the same folder.

### Two kinds

| | My skills | Third-party skills |
|---|---|---|
| Live in | `skills/` in this repository | the author's repository |
| Known through | the folder itself | `third-party-skills.json` (`dotagents skills add`) |
| Put in a workspace by | `dotagents init --skills` | `dotagents init --skills`, which runs `npx skills add` |
| In the workspace | a link to the clone | a folder in `.agents/skills/`, recorded in `skills-lock.json` |
| Updated by | editing the clone (immediate) | `npx skills update`, or `dotagents update --all` |
| Edited by hand | yes, in the clone | no: the next update undoes it |

```
app-workspace/
├── skills-lock.json                      third-party only (npx skills)
├── .agents/skills/
│   ├── session-archive → <clone>/skills/session-archive
│   └── humanizer/                        installed by npx skills add
└── .claude/skills → .agents/skills
```

A third-party skill that isn't in the catalog can still be installed by hand with `npx skills add <source>`. Always run it from the workspace root; from inside `.agents/` it creates `.agents/.agents/`.

### My skills

| Skill | What it does |
|---|---|
| [llm-wiki](skills/llm-wiki/SKILL.md) | Maintains a Markdown wiki fed by sources (`raw/` → `wiki/`), with ingest, query and lint. |
| [map-source-files](skills/map-source-files/SKILL.md) | Builds a File / Location / Responsibility table of a repository's source files. |
| [obsidian-docs](skills/obsidian-docs/SKILL.md) | Answers questions about Obsidian from the official help, the plugin and theme directory, and the forum. |
| [session-archive](skills/session-archive/SKILL.md) | Writes the session transcript to `.artifacts/session-archives/`. |
| [to-cards](skills/to-cards/SKILL.md) | Turns loose text (a message, an email, meeting notes) into task cards. |

`dotagents skills` lists them with the registered third-party ones.

### Writing a skill

1. Create `skills/<name>/SKILL.md`. The folder name and the `name` field must match, in kebab-case.
2. Write a `description` that says what the skill does and when to use it: it is the only part every session loads.
3. Keep `SKILL.md` under 500 lines. Details go to `references/`, code to `scripts/`.
4. Validate it, then commit:

   ```bash
   PYTHONUTF8=1 uvx --from "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref" skills-ref validate skills/<name>
   ```

The full rules are in [standards/agents.md](standards/agents.md#skills). A skill only some projects need can also live directly in one workspace's `.agents/skills/`.

### Taking over a third-party skill

To change a third-party skill, make it yours:

1. Run `npx skills remove <name>` at the workspace root.
2. Copy the skill to `skills/<name>/` here, keeping its license.
3. Run `dotagents skills remove <name>`.
4. Run `dotagents init <workspace> --skills <name>`.

From then on it no longer gets the author's updates.

## Global configuration

`dotagents install` writes:

| From | To | How |
|---|---|---|
| `global/instructions.md` + `global/env/<platform>.md` | `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md` | generated file |
| `rules/` | `~/.claude/rules` | folder link |
| `claude/settings.json` | `~/.claude/settings.json` | link on Linux and macOS, copy on Windows |
| `opencode/opencode.json` | `~/.config/opencode/opencode.json` | link on Linux and macOS, copy on Windows |

- **`global/instructions.md`** holds the global instructions: language, commit convention, how workspaces work. It has no machine paths. `{{AGENTS_REPO}}` becomes the clone's location, and the file for the current platform (`env/win32.md`, `env/linux.md`, `env/darwin.md`) is appended when it exists. That is where machine notes go, such as the shell, where projects live or which tools are installed.
- **`rules/`** holds rules for every project. Claude Code reads them through `~/.claude/rules`; Codex and OpenCode reach them through the path that `AGENTS.md` mentions. Today there is one: [the commit convention](rules/commit-conventions.md).
- **Settings:** Claude Code's and OpenCode's settings files. When the app changes a setting, see [Limits](#limits).
- **Left out on purpose:** `~/.codex/config.toml`. The Codex app writes machine-specific things into it (runtime paths with hashes, pipe names, trusted projects), so versioning it would break Codex on another machine.

A file already in place that dotagents didn't generate is kept next to the new one as `<file>.bak-<date>`.

## Standards

The two standards describe how a workspace is organized and why. dotagents applies the parts that can be automated.

- **[standards/agents.md](standards/agents.md), the `.agents/` folder.** It is the single source of the agents' configuration, and the tools' folders only adapt it. It covers where each mechanism lives in each tool (context file, skills, rules, subagents, hooks, settings, MCP), why commands become skills, why `.agents/rules` is never linked to `.codex/rules`, how to link folders on Windows, and the rule that keeps everything out of the projects' git. It is based on Galster et al., *Configuring agentic AI coding tools: an exploratory study* (AIware '26).
- **[standards/artifacts.md](standards/artifacts.md), the `.artifacts/` folder.** It holds the documentation agents and people write. Its structure is free and grows with the project. Only `session-archives/` and `plans/` are fixed. It also keeps `AGENTS.md` small and lists every document in `INDEX.md`, because the tools don't read `.artifacts/` on their own: a document without a link doesn't exist for them.

When an agent writes a plan before implementing, it goes to `.artifacts/plans/`. Claude Code does it by itself through `plansDirectory`; Codex and OpenCode follow the instruction in the global `AGENTS.md`.

## Recipes

**New project**

```bash
cd ~/projects
dotagents new git@github.com:me/app.git
cd app-workspace
# start Claude Code, Codex or OpenCode here
```

**One more repository in the same project**

```bash
dotagents new git@github.com:me/api.git ~/projects/app-workspace
```

**Add a skill to an existing workspace**

```bash
dotagents init ~/projects/app-workspace --skills humanizer
```

**Register a third-party skill and share it with the other machine**

```bash
dotagents skills add blader/humanizer
git commit -am "✨ feat(skills): register humanizer" && git push
# on the other machine:
dotagents update
```

**Edit one of my skills**

```bash
# edit <clone>/skills/<name>/  → already live in every workspace on this machine
git commit -am "✨ feat(<name>): ..." && git push
dotagents update          # on the other machine
```

**New machine**

```bash
git clone git@github.com:gabrieldulolmarques/dotagents.git
cd dotagents && npm install && npm link && dotagents install
# for each workspace copied or cloned to this machine (links don't travel with the files):
dotagents init <workspace>
cd <workspace> && npx skills experimental_install   # third-party skills, from the lock
```

**Everything up to date**

```bash
dotagents update --all
```

## Repository layout

```
dotagents/
├── global/
│   ├── instructions.md        global instructions ({{AGENTS_REPO}} is filled in by install)
│   └── env/                   machine notes appended per platform (win32.md, linux.md, darwin.md)
├── rules/                     global rules
├── claude/settings.json       → ~/.claude/settings.json
├── opencode/opencode.json     → ~/.config/opencode/opencode.json
├── skills/                    my skills
├── third-party-skills.json    catalog of third-party skills
├── standards/                 the .agents/ and .artifacts/ standards
├── templates/workspace/       AGENTS.md and INDEX.md for new workspaces
├── cli.mjs                    the dotagents command: arguments, questions, output
├── lib/                       the modules (see Architecture)
├── test/                      unit tests (node:test)
├── .github/workflows/         CI: skill validation and command tests on three systems
└── package.json
```

## Architecture

The command is plain Node (ES modules) with two dependencies. `cli.mjs` reads the arguments, asks the questions and prints. Everything that decides what a workspace or a machine should look like lives in `lib/`, in a few modules with small interfaces:

| Module | Interface | Behind it |
|---|---|---|
| `lib/workspace.mjs` | `applyWorkspace(repo, ws, skills)`, `verifyWorkspace(repo, ws)`, `assertWorkspace`, `childRepos`, `workspaceName` | The standard as one ordered list of items, each with how to apply it and how to verify it, side by side. `init`, `new` and `update --all` apply the list; `check` verifies it. |
| `lib/skills.mjs` | `listSkills(repo)`, `resolveSkills(repo, names)`, `skillsIn(repo, ws)`, `applySkills(ws, skills, { installer })`, `verifySkills(repo, ws)` | My skills and the third-party ones as one list (`name`, `kind`, `source`, `description`). Linking, installing (and in which order), and the skill checks. |
| `lib/thirdparty.mjs` | `loadCatalog`, `saveCatalog`, `discoverSkills`, `parseSkill`, `npxInstaller` | The catalog file, reading `SKILL.md`, and the installer adapter that runs `npx skills add`. |
| `lib/git.mjs` | `ensureExcluded`, `gitRepoOf`, `isRepoRoot`, `trackedAgentFiles`, `untrackedAgentFiles` | Keeping agent files out of a project's git through `.git/info/exclude`. |
| `lib/global.mjs` | `installGlobal(repo)`, `renderInstructions(repo)` | The machine level: instructions, rules and settings. |
| `lib/registry.mjs` | `loadWorkspaces`, `registerWorkspace`, `untrackWorkspace` | The tracked workspaces of this machine. |
| `lib/common.mjs` | file actions (`ensureDirLink`, `ensureFile`, `writeGenerated`, `ensureJsonKey`…), output (`report`, `checkItem`, `section`, `finish`…), `runWithSpinner`, `parseArgs` | Junctions on Windows and symlinks elsewhere, backups, dry run, the terminal and plain output. |

Two decisions shape the modules:

- **A rule of the standard is written once.** Adding one means adding an item to the list in `lib/workspace.mjs`, with its `apply` and its `verify` next to each other.
- **Third-party installation is an adapter.** `applySkills` receives an `installer`: `npxInstaller` by default, a fake one in the tests. The order that matters (link `.claude/skills` first, install after) stays inside the skills module.

Every action is idempotent: it looks at what is there, does nothing when it is already right, and reports `ok`. That is what makes `--dry-run`, repeated runs and `update --all` safe.

## Development

```bash
npm install
npm test                 # unit tests (node:test)
node cli.mjs --help      # run without npm link
```

**Unit tests** (`test/`) go through the modules' interfaces on real temporary folders: applying and verifying a workspace, idempotency, dry run, links versus copies, third-party skills through a fake installer (no network), and git exclusion inside a real repository. They run in a couple of seconds.

**CI** runs on every push that touches the code:

- **Validate skills:** runs [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) on every skill in `skills/`.
- **Test scripts:** on Linux, Windows and macOS, it:
  - runs `npm test` and links the command;
  - runs every command end to end, including real `npx skills` installations and `new` with local repositories;
  - checks that a second run changes nothing.

**Commits** follow [the commit convention](rules/commit-conventions.md): gitmoji plus Conventional Commits, one line in English, no co-author trailer.

**Adding a rule to the workspace standard:**

1. Add an item to `STANDARD` in `lib/workspace.mjs` with `apply` and `verify`.
2. Add a test in `test/workspace.test.mjs`.
3. Describe the rule in `standards/` and in [What init creates](#what-init-creates) and [What check verifies](#what-check-verifies).

## Troubleshooting

**`dotagents: command not found`.** `npm link` wasn't run, or it ran under another Node version. Run `npm install && npm link` in the clone again.

**`Cannot find package '@clack/prompts'`.** The dependencies are missing. Run `npm install` in the clone.

**`.claude/skills` is "a copied folder, not a link".** Something created a real `.claude/skills` folder, for example `npx skills add` run before `init`. Move its contents to `.agents/skills/`, delete the folder and run `dotagents init` again.

**"skills-lock.json: X is installed" fails.** The lock lists a third-party skill whose folder is gone. Run `npx skills experimental_install` at the workspace root.

**"is a link to the dotagents repository" fails.** One of my skills is a copy instead of a link. Delete the copy and run `dotagents init <workspace> --skills <name>`.

**"no agent file is tracked by git" fails.** An agent file was committed to the project. Remove it from the index (the file stays on disk) and commit:

```bash
git rm -r --cached AGENTS.md .claude
```

**`update --all` warns about skills no longer known.** A skill was removed from `skills/` or from the catalog. To drop it from the workspace's record, run `dotagents untrack <workspace>` and `dotagents init <workspace>` again.

**A link points to an old location.** The clone or the workspace moved. Run `npm link` in the clone, then `dotagents install` and `dotagents init <workspace>`.

**A `.bak-<date>` file appeared.** dotagents replaced a file it didn't generate and kept the old one next to it. Compare them and delete the backup when you're done.

## Limits

- **Windows links.** File symlinks need administrator rights or Developer Mode, so files are copied and folders become junctions. Junctions store absolute paths: after moving the clone or a workspace, run the commands again.
- **Settings changed inside the apps.** On Windows the settings are copies, so a setting changed in Claude Code or OpenCode makes the machine's file differ from the repository's. The next `install` keeps it as a backup and writes the repository's version. To keep the change, copy the file back here and commit. On Linux and macOS the apps write through the link, so the change shows up in `git diff`.
- **Run the agents from the workspace root.** Inside one of the repositories, the tools look for skills and `AGENTS.md` only up to that repository's root, and don't see the workspace's `.agents/`.
- **`npx skills experimental_install`** is how the skills CLI 1.7 restores from the lock. The name may change in later versions.
- **Hooks, subagents and MCP servers** are described by the `.agents/` standard, but dotagents doesn't generate them for each tool yet.

## License

Private repository, all rights reserved (`UNLICENSED`). Third-party skills keep their own licenses.
