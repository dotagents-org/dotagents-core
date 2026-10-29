# Commands

```
dotagents <command> [options]
```

| Command | What it does |
|---|---|
| [`install`](#dotagents-install) | Applies the global configuration to this machine, in every profile folder. |
| [`update [--all]`](#dotagents-update) | Pulls this repository and runs `install`; with `--all`, also refreshes every tracked workspace. |
| [`settings pull [--from <profile>]`](#dotagents-settings-pull) | Brings a settings change made in a profile (a Windows copy) into this repository. |
| [`profile add <name>`](#dotagents-profile-add) | Adds a Claude profile: its config folder, the configuration and a `claude-<name>` launcher. |
| [`profile list`](#dotagents-profile-list) | Lists the profiles and checks them. |
| [`profile remove <name>`](#dotagents-profile-remove) | Forgets a profile and its launcher; its folder is kept. |
| [`usage [--short] [--json]`](#dotagents-usage) | Shows how much of each profile's plan is used (5-hour session, week), from Claude Code's cache. |
| [`new <git-url> [folder]`](#dotagents-new) | Creates a workspace folder (any name; `<name>-workspace` by default), clones the repository into it and applies the standards. |
| [`init [path]`](#dotagents-init) | Applies the standards to a folder and puts the chosen skills in it. |
| [`check [path]`](#dotagents-check) | Runs the standards checklist on a workspace, changing nothing. |
| [`workspaces`](#dotagents-workspaces) | Lists the workspaces tracked on this machine. |
| [`untrack <path>`](#dotagents-untrack) | Stops tracking a workspace. Its files are not touched. |
| [`skills`](#dotagents-skills) | Lists the own skills and the registered third-party ones. |
| [`skills add <source>`](#dotagents-skills-add) | Registers third-party skills in the catalog. |
| [`skills remove <name>`](#dotagents-skills-remove) | Removes a third-party skill from the catalog. |

`dotagents --help` shows the same list, and `dotagents --version` the version.

## The full-screen view

In a terminal, `dotagents` with no command opens a full-screen view with one tab per screen: **Usage** (live, the same as `dotagents usage`), **Profiles** (the same as `profile list`, with its checklist), **Workspaces** (↑↓ picks one, and its `check` shows below) and **Skills**. `dotagents usage --watch` opens it on the usage screen.

| Key | Does |
|---|---|
| `Tab`, `→` / `Shift+Tab`, `←` | next / previous screen |
| `1`–`4` | go to a screen |
| `↑` `↓` | pick an item (Workspaces) |
| `r` | read everything again |
| `i` | (Profiles) install the configuration to every profile, like `dotagents install` |
| `a` | (Workspaces) apply the standards again to the picked workspace, with its skills, like `update --all` does to each one |
| `y` / `n` | apply / cancel the action shown in the preview |
| `q`, `Esc` | quit |

An action always shows a preview first, the same as `--dry-run`: `y` applies it, `n` cancels it, and when nothing would change it says so and asks nothing. Outside a terminal (a pipe, CI), `dotagents` with no command prints the help, and `usage --watch` stops with an error.

## dotagents install

Writes the global configuration where Claude Code reads it: in `~/.claude`, and in the folder of every profile added with [`profile add`](#dotagents-profile-add), whose launchers it also rewrites. See [Global configuration](global-configuration.md) for exactly what goes where.

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

- When the pull changes `package-lock.json`, it runs `npm install` before going on, so the next run can start. When it changes the command's entry file (`bin` in `package.json`), it runs `npm link` too, so `dotagents` keeps working. When it changes the version, it says so (`version 1.0.0 → 2.0.0`) and points to [`CHANGELOG.md`](../CHANGELOG.md), which lists what changed and what to do.
- If the pull fails (local changes, diverged history), it stops and asks you to fix the repository first.
- With `--all`, for each tracked workspace it:
  - applies the standards again, which puts back any skill that is missing (useful on a new machine or after cloning a workspace again);
  - runs `npx skills update` when the workspace has third-party skills;
  - warns about skills that were removed from this repository or the catalog, without failing. To drop them from the workspace's record, `untrack` it and run `init` again.

## dotagents settings pull

```bash
dotagents settings pull                  # the one profile whose settings changed
dotagents settings pull --from personal  # when several changed in different ways
```

On Windows each profile has a copy of `claude/settings.json`, and `/config` writes to that copy. `install` remembers what it last copied, so it can tell a copy that only fell behind the repository (it updates it) from one changed in the profile (it keeps it and says so). `settings pull` copies the changed one into the repository; commit it, and the next `install` takes it to the other profiles. With several profiles changed in different ways it stops and asks for `--from`. On Linux and macOS the profiles link to the repository's file, so there is nothing to pull.

## dotagents profile add

```bash
dotagents profile add work --default     # the profile in ~/.claude, the one plain claude uses
dotagents profile add personal           # a second profile, in ~/.claude-personal
dotagents profile add personal --color '#376B80'
```

A profile is a Claude Code config folder with its own sign-in, picked through `CLAUDE_CONFIG_DIR`; the sign-in is a Claude account, and two profiles can't share one. Before 2.0.0 profiles were called accounts (`dotagents account add`, `accounts.json`); `install` moves `accounts.json` to `profiles.json`. For a profile, `profile add`:

- creates its folder: `~/.claude` for the default profile, `~/.claude-<name>` for the others;
- applies the same configuration as `install` to it;
- writes a launcher, `~/.local/bin/claude-<name>` (`claude-<name>.cmd` on Windows), that clears the variables that would sign in over the folder (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`…), points `CLAUDE_CONFIG_DIR` at the folder and runs `claude`. The default profile's launcher clears `CLAUDE_CONFIG_DIR` instead, so Claude Code uses `~/.claude`;
- records the profile in `profiles.json`, next to `workspaces.json`;
- on Windows, gives the profile a Claude Desktop app: a launcher `claude-desktop-<name>.vbs` and the Start menu shortcut "Claude <Name>" ("Claude Personal", "Claude My Work"). For a profile other than the default one, it also creates the data folder `%APPDATA%\Claude-<name>`, and the shortcut starts a second app with `--user-data-dir` (its own sign-in and chats) and the profile's `CLAUDE_CONFIG_DIR` (so the Code tab uses the profile's folder). The default profile's shortcut opens the normal app. The shortcut takes the profile's icon, `assets/claude-<name>.ico`, when the repository has one, and the app's otherwise. Each profile also gets its own taskbar button, with its icon and name: the shortcut carries an AppUserModelID of its own (`dotagents.claude.<name>`), and the launcher starts a small hidden watcher (`claude-taskbar.ps1`) that gives the instance's windows the same ID and ends when the instance closes. The same watcher gives the instance the profile's look: the window title ("Claude Personal", in Alt+Tab and the taskbar preview) and icon, and the notification-area icon with its tooltip. Claude puts its own title and tray icon back now and then, so the watcher sets them again (the tray icon every 10 seconds); the tray part relies on how Electron numbers its icons, not on a documented interface, so an app update may bring Claude's own icon back. After an app update, which reopens only the normal app, the button comes back the next time the profile opens through its shortcut. Without Claude Desktop installed, it only notes so.

Then sign in once with the launcher: `claude-personal auth login`. In the second Desktop app, sign in with **e-mail and code**: Google sign-in returns to the normal app. Links `claude://` also open the normal app, and an app update reopens only the normal one. Running it again changes nothing; a launcher you wrote by hand with the same name is kept as a backup.

- Only one profile is the default, and it can't be changed with `profile add`: it owns `~/.claude`.
- `--color #RRGGBB` sets the profile's color in the listings. Without it, profiles get `#D77655` and `#376B80`, in the order they are added.
- `~/.local/bin` has to be on the `PATH`; `profile add` says so when it isn't.

## dotagents profile list

Lists the profiles (color, default, signed-in e-mail, folder, launcher) and checks them: each folder and launcher exists, each profile is signed in, and no two folders are signed in to the same claude.ai account. It also warns when a variable such as `ANTHROPIC_API_KEY` is set in the shell, and checks the shared configuration: a settings copy (Windows) changed in a profile or behind the repository, a [`claude/global-config.json`](global-configuration.md) option changed in a profile, and changes to either file not committed yet. Exits with 1 when an item fails.

## dotagents profile remove

```bash
dotagents profile remove personal
```

Forgets the profile and deletes its launchers and, on Windows, its Start menu shortcut. The folders (the profile's and the Desktop data folder), with the sign-in and the history, stay; delete them by hand if you want them gone.

## dotagents usage

```bash
dotagents usage            # every profile: session (5h), week, per-model weeks
dotagents usage --short    # one line: work 28%·22% │ personal 0%·0%
dotagents usage --json     # the data, for scripts
dotagents usage --watch    # the full-screen view on the usage screen, updated live
```

Reads the usage Claude Code keeps in each profile's state file (`cachedUsageUtilization` in `~/.claude.json`, or `<folder>/.claude.json`). It makes no network call and needs no token. Without profiles, it shows the one in `~/.claude`.

For each window it shows a bar (green below 50%, yellow up to 79%, red from 80%), the percentage and when it resets. Once enough of the window has passed, a note says when it runs out at the current pace, or how much is left at the reset. A window whose reset time has passed shows as reset, never with the old number.

The cache is only as fresh as the last time Claude Code asked for the usage: `/usage` in a profile refreshes it. Each profile says how old its data is, and data older than 6 hours is marked stale. A profile that isn't signed in, has no data yet, or holds the cache of an earlier sign-in says so instead of showing a number.

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
| `--default` | `profile add` | The profile in `~/.claude`. |
| `--color #RRGGBB` | `profile add` | The profile's color in the listings. |
| `--short` | `usage` | One line, for a prompt or a status line. |
| `--json` | `usage` | The data, for scripts. |
| `--watch` | `usage` | The full-screen view, updated live. |
| `--yes` | `init`, `new`, `skills add` | Never ask. |
| `--no-pull` | `update` | Skip `git pull`. |
| `--from <profile>` | `settings pull` | The profile to take the settings from. |
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
| `NO_COLOR` | Turns colors off. `TERM=dumb` does too. |
| `DOTAGENTS_THEME` | `light` or `dark`: the background the colors are picked for. Without it, `COLORFGBG` when the terminal sets it, else dark. |
| `FORCE_COLOR` | Sets the colors, with or without a terminal, over `NO_COLOR`: `0` turns them off, `1` is 16 colors, `2` is 256, `3` is 24-bit. With a value other than `0`, piped output keeps the terminal look. |
| `CI` | Never asks questions. |
| `DOTAGENTS_STATE_DIR` | Folder of the machine's state: the tracked workspaces (`workspaces.json`) and the profiles (`profiles.json`). Default: `~/.config/dotagents`. |
| `XDG_CONFIG_HOME` | Base of `~/.config` (the default state folder). |
