# Commands

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
| [`skills`](#dotagents-skills) | Lists the own skills and the registered third-party ones. |
| [`skills add <source>`](#dotagents-skills-add) | Registers third-party skills in the catalog. |
| [`skills remove <name>`](#dotagents-skills-remove) | Removes a third-party skill from the catalog. |

`dotagents --help` shows the same list, and `dotagents --version` the version.

## dotagents install

Writes the global configuration where Claude Code reads it. See [Global configuration](global-configuration.md) for exactly what goes where.

```bash
dotagents install --dry-run    # show what would change
dotagents install
```

Run it again after editing `global/` or `rules/`, and on Windows also after editing the settings in `claude/`. On Linux and macOS the settings and the rules are links, so their changes apply right away.

## dotagents update

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

## dotagents new

```bash
dotagents new <git-url> [folder] [--skills a,b] [--yes] [--dry-run]
```

Creates a workspace around a repository, in the [recommended layout](workspaces.md#recommended-layout-the-workspace-wraps-the-repositories):

```bash
dotagents new git@github.com:me/app.git                 # app-workspace/app/
dotagents new git@github.com:me/api.git app-workspace   # adds api/ to the same workspace
```

1. Creates the workspace folder. Its name is free (`acme-platform`, `thesis`…): pass it as `[folder]`, or answer the question in a terminal. Without one, it is `<name>-workspace/`, with `<name>` taken from the URL.
2. Clones the repository into `<folder>/<name>/`.
3. If the workspace already had an `AGENTS.md` with a `## Repositories` section, adds the new repository to that list. Only that section is touched.
4. Runs `init` on the workspace, with the same questions and options.

It refuses to clone over an existing folder, and refuses to use a folder that is itself a git repository as the workspace. The URL can be anything `git clone` accepts, a local path included.

## dotagents init

```bash
dotagents init [path] [--skills a,b] [--wrap] [--yes] [--dry-run]
```

Applies the standards to a folder (the current one when no path is given) and puts the chosen skills in it. It creates only what is missing and never overwrites your own files. See [What init creates](workspaces.md#what-init-creates).

- **In a terminal, without `--skills`,** it asks:
  1. which folder, when none was given;
  2. when the folder is itself a git repository, whether to move it into `<name>-workspace/` (see [Wrapping a repository](#wrapping-a-repository));
  3. which skills, from a list of yours and the registered third-party ones, with the ones already in the workspace selected;
  4. for confirmation before changing anything.

  `Ctrl+C` leaves without changes.
- **With `--skills a,b`,** it uses those names and asks nothing. Names can mix both kinds: `--skills to-cards,humanizer`.
- **With `--wrap`,** it moves the repository into `<name>-workspace/` without asking.
- **With `--yes`, in CI, or when input is piped,** it never asks, and a repository stays where it is unless `--wrap` is given.

Running it again on a workspace is safe: what is already right stays as it is, and new skills are added to the ones already there.

`init` also records the workspace and its skills in the [tracked list](#dotagents-workspaces), for `update --all`.

### Wrapping a repository

Run on a folder that is itself a git repository, `init` offers the [recommended layout](workspaces.md#recommended-layout-the-workspace-wraps-the-repositories) instead of keeping the agent files inside it:

1. It creates `<name>-workspace/` next to the repository and moves the repository into it, as `<name>-workspace/<name>/`.
2. Agent files that an earlier `init` left at the repository root move up to the workspace, and their block leaves `.git/info/exclude`. Agent files the project commits stay in the repository.
3. It lists the repository under "Repositories" in `AGENTS.md`, applies the standards to the workspace, and moves the entry in the tracked list to the new path.
4. In a terminal, it offers to open the workspace in VS Code.

Afterwards, the terminal that ran `init` is still in the old folder: `cd` into the workspace. The agents list past sessions by folder, so the old ones stay under the old path until the `move-sessions` skill brings them along. Answer no for a folder that has to stay where it is, such as an Obsidian vault (see [When the folder has to be the repository](workspaces.md#when-the-folder-has-to-be-the-repository)).

## dotagents check

```bash
dotagents check [path]
```

Runs the checklist on a workspace and changes nothing. It exits with code 1 when something fails, so it also works in scripts. See [What check verifies](workspaces.md#what-check-verifies).

Warnings (`!`) point out something worth knowing, such as a workspace whose root is itself a git repository, without failing the check.

## dotagents workspaces

Lists the workspaces set up with `init` or `new` on this machine, with their skills, and marks the ones whose folder no longer exists. The list lives in `~/.config/dotagents/workspaces.json` (see [Environment variables](#environment-variables)).

## dotagents untrack

```bash
dotagents untrack <path>
```

Removes a workspace from the tracked list, so `update --all` skips it. Its files are not touched.

## dotagents skills

Lists the own skills and the registered third-party ones, each with the full description its author wrote and, for third-party ones, where it comes from.

## dotagents skills add

```bash
dotagents skills add <source> [--skills a,b | --all] [--dry-run]
```

Registers third-party skills in `skills/third-party-skills.json`, so `init` and `new` offer them on every machine. The source can be `owner/repo` (GitHub), a git URL or a local path.

```bash
dotagents skills add blader/humanizer
dotagents skills add vercel-labs/agent-skills --skills web-design-guidelines,writing-guidelines
dotagents skills add mattpocock/skills --all
```

It makes a shallow clone of the source in a temporary folder, finds every `SKILL.md` in it and stores the name, the source and the description exactly as the author wrote them. When the source has several skills, pick some with `--skills`, all of them with `--all`, or choose from a list in a terminal.

A skill is skipped when its name matches one of the own skills, when it is already registered from another source, or when its name isn't valid. Running the command again updates the stored descriptions. Commit `skills/third-party-skills.json` afterwards to have the change on the other machine.

## dotagents skills remove

```bash
dotagents skills remove <name>
```

Removes a skill from the catalog. Workspaces that already installed it keep it; to remove it from one of them, run `npx skills remove <name>` at its root.

## Options

| Option | Commands | Effect |
|---|---|---|
| `--dry-run` | all that change something | Shows what would be done and changes nothing. |
| `--skills a,b` | `init`, `new`, `skills add` | Skills to use, or to register. |
| `--all` | `update`, `skills add` | Every tracked workspace, or every skill of the source. |
| `--wrap` | `init` | Move a repository into `<name>-workspace/` before applying the standards. |
| `--yes` | `init`, `new`, `skills add` | Never ask. |
| `--no-pull` | `update` | Skip `git pull`. |
| `--help`, `--version` | | |

Paths can be written with `~` for the home folder, also in PowerShell and cmd, which don't expand it themselves. The short paths dotagents prints can be pasted back.

## Output

In a terminal, every command draws one vertical line from `┌` to `└`, with a section per step and a summary at the end:

```
┌   dotagents  init  ~/projects/app-workspace
│
◇  .agents/
│  + created      .agents/skills/to-cards  → ~/dotagents/skills/to-cards
│
◇  .artifacts/
│  + created      .artifacts/plans
│
└  ✓ 9 created · 2 already ok
```

| Mark | Meaning |
|---|---|
| `+ created`, `~ updated`, `→ moved` | changed now |
| `✓ ok` | already right |
| `! skipped` | left alone on purpose, with the reason (counts as a problem) |
| `✗ failed` | went wrong, with the reason |
| `+` / `~` / `→` in cyan | would change (dry run) |

When the output goes to a pipe or a file (CI, scripts), the same information comes as plain lines that are easy to grep: `<status> <full path> (<detail>)`.

## Exit codes

- `0`: everything ok, or only warnings.
- `1`: at least one item was skipped or failed, a check item failed, or the command itself failed (bad arguments, missing folder).

## Environment variables

| Variable | Effect |
|---|---|
| `NO_COLOR` | Turns colors off. |
| `FORCE_COLOR` | Forces the terminal output even when it isn't a terminal. |
| `CI` | Never asks questions. |
| `DOTAGENTS_STATE_DIR` | Folder of the tracked list (`workspaces.json`). Default: `~/.config/dotagents`. |
| `XDG_CONFIG_HOME` | Base of `~/.config` (the default state folder). |
