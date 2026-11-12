# Commands

```
dotagents <command> [options]
```

| Command | What it does |
|---|---|
| [`install`](#dotagents-install) | Applies the global configuration to this machine, in every profile folder. |
| [`update [--all]`](#dotagents-update) | Pulls this repository and runs `install`; with `--all`, also refreshes every tracked workspace. |
| [`settings pull [--from <profile>]`](#dotagents-settings-pull) | Brings a settings change made in a profile (a Windows copy) into this repository. |
| [`profile add <name>`](#dotagents-profile-add) | Adds a Claude profile, one claude.ai account; on Windows, a Desktop app of its own. |
| [`profile list`](#dotagents-profile-list) | Lists the profiles and checks them. |
| [`profile remove <name>`](#dotagents-profile-remove) | Forgets a profile; its saved login is kept. |
| [`start [--port <n>]`](#dotagents-start) | Starts the dashboard's server on 127.0.0.1: the usage of every profile, live. |
| [`switch [<profile>] [--here] [--save <profile>]`](#dotagents-switch) | Puts a profile's login in `~/.claude`, on both sides of the machine. |
| [`login <profile> \| --all`](#dotagents-login) | Signs a profile in again on this side, keeping the new login in its vault. |
| [`usage [--short] [--json]`](#dotagents-usage) | Shows how much of each profile's plan is used (5-hour session, week), from Claude Code's cache. |
| [`new <git-url> [folder]`](#dotagents-new) | Creates a workspace folder (any name; `<name>-workspace` by default), clones the repository into it and applies the standards. |
| [`init [path]`](#dotagents-init) | Applies the standards to a folder and puts the chosen skills in it. |
| [`check [path]`](#dotagents-check) | Runs the standards checklist on a workspace, changing nothing. |
| [`workspaces`](#dotagents-workspaces) | Lists the workspaces tracked on this machine. |
| [`untrack <path>`](#dotagents-untrack) | Stops tracking a workspace. Its files are not touched. |
| [`sessions [path] [--all] [--json]`](#dotagents-sessions) | Lists Claude Code's sessions on both sides of the machine: title, account, size, where they would be archived. |
| [`sessions rm [ids…] [--all] [--yes] [--no-archive]`](#dotagents-sessions-rm) | Deletes sessions, archiving each first into its project's `.artifacts/session-archives/`; `--no-archive` skips the archive. |
| [`skills`](#dotagents-skills) | Lists the own skills and the registered third-party ones. |
| [`skills add <source>`](#dotagents-skills-add) | Registers third-party skills in the catalog. |
| [`skills remove <name>`](#dotagents-skills-remove) | Removes a third-party skill from the catalog. |

`dotagents --help` shows the same list, and `dotagents --version` the version.

## dotagents install

Writes the global configuration where Claude Code reads it, `~/.claude`, the one config folder every [profile](#dotagents-profile-add) uses, and on Windows each profile's Desktop app (and it removes the launcher of the tray panel, which an earlier version put in the Startup folder). A profile from before, with a folder of its own (`~/.claude-<name>`) and a launcher (`claude-<name>`), moves to `~/.claude`: its launcher is removed and its folder is left for you to delete. See [Global configuration](global-configuration.md) for exactly what goes where.

```bash
dotagents install --dry-run    # show what would change
dotagents install
```

Run it again after editing `config/global/` or `config/rules/`, and on Windows also after editing the settings in `config/claude/`. On Linux and macOS the settings and the rules are links, so their changes apply right away.

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

On Windows each profile has a copy of `config/claude/settings.json`, and `/config` writes to that copy. `install` remembers what it last copied, so it can tell a copy that only fell behind the repository (it updates it) from one changed in the profile (it keeps it and says so). `settings pull` copies the changed one into the repository; commit it, and the next `install` takes it to the other profiles. With several profiles changed in different ways it stops and asks for `--from`. On Linux and macOS the profiles link to the repository's file, so there is nothing to pull.

## dotagents profile add

```bash
dotagents profile add work --default     # the account the normal Desktop app opens
dotagents profile add personal           # a second account
dotagents profile add personal --color '#376B80'
```

A profile is one claude.ai account the person holds (ADR 0009 and ADR 0011 in the workspace's `.artifacts/decisions/`). Every profile uses the same config folder, `~/.claude`, on WSL and on Windows alike: the history, settings, skills and memory are shared, and [`switch`](#dotagents-switch) puts a profile's login in it. Two profiles can't hold the same account. Before 2.0.0 profiles were called accounts (`dotagents account add`, `accounts.json`); `install` moves `accounts.json` to `profiles.json`. For a profile, `profile add`:

- applies the configuration of `install` to `~/.claude`;
- records the profile in `profiles.json`, next to `workspaces.json`;
- on Windows, gives the profile a Claude Desktop app, so the accounts can be open at the same time: a launcher `claude-desktop-<name>.vbs` and the Start menu shortcut "Claude <Name>" ("Claude Personal", "Claude My Work"). For a profile other than the default one, it also creates the data folder `%APPDATA%\Claude-<name>`, and the shortcut starts a second app with `--user-data-dir`, which keeps its own sign-in and chats. Every app's launcher clears `CLAUDE_CONFIG_DIR`, so the Code tab uses `~/.claude`. The default profile's shortcut opens the normal app. The shortcut takes the profile's icon, `assets/claude-<name>.ico`, when the repository has one, and the app's otherwise. Each profile also gets its own taskbar button, with its icon and name: the shortcut carries an AppUserModelID of its own (`dotagents.claude.<name>`), and the launcher starts a small hidden watcher (`claude-taskbar.ps1`) that gives the instance's windows the same ID and ends when the instance closes. The same watcher gives the instance the profile's look: the window title ("Claude Personal", in Alt+Tab and the taskbar preview) and icon, and the notification-area icon with its tooltip. Claude puts its own title and tray icon back now and then, so the watcher sets them again (the tray icon every 10 seconds); the tray part relies on how Electron numbers its icons, not on a documented interface, so an app update may bring Claude's own icon back. After an app update, which reopens only the normal app, the button comes back the next time the profile opens through its shortcut. Without Claude Desktop installed, it only notes so.

Then save the profile's login, once on each side: sign in with `claude auth login`, which puts the account in `~/.claude`, and run `dotagents switch --save personal`. In the second Desktop app, sign in with **e-mail and code**: Google sign-in returns to the normal app. Links `claude://` also open the normal app, and an app update reopens only the normal one. Running it again changes nothing.

- Only one profile is the default: the one the normal Desktop app opens.
- `--color #RRGGBB` sets the profile's color in the listings. Without it, profiles get `#D77655` and `#376B80`, in the order they are added.

## dotagents profile list

Lists the profiles (color, default, the e-mail of the saved login, and which one is in the slot now) and checks them: each uses `~/.claude`, each has a saved login, and no two hold the same claude.ai account. It also warns when a variable such as `ANTHROPIC_API_KEY` is set in the shell, and checks the shared configuration: a settings copy (Windows) changed in a profile or behind the repository, a [`claude/global-config.json`](global-configuration.md) option changed in a profile, and changes to either file not committed yet. Last, it says until when each profile's saved login lasts, on each side of the machine (a login lasts a few weeks, and Claude Code renews it only up to that date): a week ahead it warns, and once a login has expired the item fails; either way it says to run [`login`](#dotagents-login) on that side. A date can't tell a login revoked on the server, so the item also fails when the live usage (`usage --refresh`, `start`) was refused by Anthropic for that same login, wherever a switch copied it (a new sign-in or a renewal brings another and clears it), and when a side's slot names an account in `.claude.json` but has no `.credentials.json` (a logout elsewhere deletes it). In WSL it also fails when `~/.claude` is a link to another folder: Windows reaches WSL's files through `\\wsl.localhost`, which doesn't follow a Linux link, so the Desktop's Code tab in WSL mode can't install its server there; the item says how to make it the folder. Exits with 1 when an item fails.

## dotagents profile remove

```bash
dotagents profile remove personal
```

Forgets the profile and, on Windows, deletes its Desktop launcher and Start menu shortcut. Its saved login (the vault) and the Desktop data folder, with the app's sign-in and chats, stay; delete them by hand if you want them gone.

## dotagents switch

```bash
dotagents switch                   # which profile ~/.claude holds now
dotagents switch personal          # put personal's login there, on WSL and on Windows
dotagents switch personal --here   # only on this side
dotagents switch --save work       # the login now in ~/.claude (after a /login) is work's
```

For one person who holds several Claude seats (ADR 0009 in the workspace's `.artifacts/decisions/`). Each side of the machine has one slot, `~/.claude` (its `.credentials.json`) with the `oauthAccount` block of `~/.claude.json`; the command line, the VS Code extension and the Desktop's Code tab in WSL mode read it, so they change together, and an open conversation goes on in the new account when you type "continue" in it.

Every account's login is kept in a vault, one per profile and side, in `~/.config/dotagents/vault/<profile>/`, readable only by you. A switch:

1. saves the login in the slot back to its profile's vault, since Claude Code may have renewed the token, and saves it again if a running session renews it while the switch runs;
2. writes the chosen profile's login into the slot, each file whole and in one step, leaving the rest of `~/.claude.json` as it is;
3. checks that the slot holds that account, and warns when Anthropic refused that login (as `profile list` reads it), even when it was already in the slot.

The switch and the renewals of `usage --refresh` take the same lock (`logins.lock` in the state folder), so neither copies a token the other is spending.

Then it runs the same switch on the other side of the machine (`--here` skips that), whose vault holds that side's own login: a refresh token copied to two slots would sign one of them out. An account in the slot that no profile knows is never overwritten: `--save <profile>` says whose it is. The switch is always manual.

## dotagents login

```bash
dotagents login personal   # sign personal in again on this side
dotagents login --all      # every profile whose login runs out within a week
```

A login lasts a few weeks, and no renewal extends it: `profile list` says when each one runs out. `login` signs a profile in again through this side's slot:

1. saves the login in the slot to its profile's vault and puts the chosen profile's in, as [`switch --here`](#dotagents-switch) does;
2. runs `claude auth login`, which opens the browser;
3. checks that the account signed in is the profile's, and stops without saving anything when it isn't;
4. keeps the new login in the profile's vault;
5. puts the account that was in the slot back, also when a step failed.

The login lock is held only around the slot changes, not while the browser waits for you. `--all` takes every profile on this side whose login runs out within a week, was refused by Anthropic, or isn't saved yet. Each side of the machine has its own login, so run it on the other side too.

## dotagents usage

```bash
dotagents usage            # every profile: the 5-hour window, the week, per-model weeks
dotagents usage --refresh  # ask Anthropic for fresh numbers first
dotagents usage --short    # one line per profile, for a status line
dotagents usage --json     # the data, for scripts
```

Shows, for each profile, the newer of two sources: the usage Claude Code keeps in the profile's state file (`cachedUsageUtilization` in `~/.claude.json`, or `<folder>/.claude.json`), and the usage dotagents last asked of Anthropic itself (`--refresh`, or `start` every minute), kept in `<state>/usage/<profile>.json`. Without `--refresh` it makes no network call. Without profiles, it shows the one in `~/.claude`.

```
 dotagents  usage

work  [default]  1 working  4m ago, live
  5h      ━━━━━━━━━━━━━━━━━━━━━━━ ────────   72%  resets 3h 17m
          at this pace, runs out 12:40
  7d      ━━━━━━━━━━━━━━━ ────────────────   48%  resets 4d 18h
          at this pace, runs out Fri 12:02
  Fable   ━━━━━━━━━━━━━━━━━━━ ────────────   59%  resets 4d 18h
          at this pace, runs out Fri 01:10

2 profiles; --refresh asks Anthropic for fresh numbers
```

The profile whose account is in this side's slot comes first, the others after in their order. Each profile shows its name, `[default]`, its running Claude Code sessions (`2 working, 1 waiting`, the ones busy and the ones waiting on you), how old its data is and, when it came from Anthropic rather than Claude Code's cache, `live`; then one line per window (`5h`, `7d`, and a model's own week): a bar, the percentage and when it resets. The percentage is green below 70%, yellow from 70% and red from 90%, and from 70% the reset takes that color too; the digits say it without color. Under each window with fresh data, a projection at the average rate since the window opened: `~79% at reset` (muted), or, when it would pass 100%, when it runs out, `at this pace, runs out Fri 12:02` (yellow). A window already at 100% has none: the bar and the reset say it. In a window's first 10% the rate means little, so it says when the projection starts (`projection from 14:30`); an unused or reset window has none. A window whose reset time has passed shows as reset, never with the old number.

`--short` prints one line per profile with the 5-hour and weekly windows, 8-cell bars, and the time to the reset from 70%:

```
work      5h ━━━━━━ ─  72% ↻ 3h17m   7d ━━━━ ───  48%
personal  5h ━━━━━━ ─  91% ↻ 58m     7d ━━ ─────  30%
```

`--json` prints the data in an envelope with a format version, so scripts can rely on it; fields are only ever added:

```json
{ "version": 1, "generatedAt": "2026-10-28T12:00:00.000Z", "profiles": [
  { "name": "work", "color": "#D77655", "default": true, "state": "ok", "fetchedAt": "2026-10-28T11:56:00.000Z",
    "source": "live", "activity": { "working": 1, "waiting": 0 },
    "windows": [{ "kind": "session", "pct": 72, "resetsAt": "2026-10-28T15:17:00.000Z", "reset": false, "elapsedPct": 34, "projection": { "atResetPct": 210, "runsOutAt": "2026-10-28T12:40:00.000Z" } }] }
] }
```

`state` is `ok`, `stale`, `no-data`, `not-signed-in` or `other-account`; `source` is `cache` (Claude Code's) or `live` (asked of Anthropic); `kind` is `session`, `week` or `model-week` (with `model`); `elapsedPct` is how much of the window has gone by, where the bar would be at a uniform pace; `projection` is `{ atResetPct, runsOutAt? }`, `{ from }` while the window is too young, or `null` (nothing used, reset, at 100% already, or stale data); `avatar` is the profile's state for its avatar, the most urgent of `error`, `limit`, `waiting`, `warn`, `ok` and `asleep`; `working` says a session works on it (its avatar hops), with any state but `error` and `limit`; `activity` counts the profile's running sessions, for a profile whose login Claude Code is using; `error` says why the last live ask failed; `from` names the other side of the machine when the numbers came from there.

For a status line, which isn't a terminal, keep the colors with `FORCE_COLOR=3 dotagents usage --short` (`2` where the terminal has no 24-bit color). Piped, `usage` prints one plain line per window instead: `<profile> <window> <pct> <reset, ISO> fetched <ISO>`, with `(live)` on numbers from Anthropic and `(stale)` on old data.

Claude Code writes its cache when it asks for the usage, which happens during sessions and on `/usage`. `--refresh` asks now, the way Claude Code does (ADR 0008): for each profile it reads the login where it lives (the slot `~/.claude` when the profile's account is there, else its vault, else its own folder) and calls Anthropic's OAuth usage endpoint with it. When the access token is about to expire, dotagents renews it first and writes the new one back to that same file, at once, under a lock shared with `switch`: a renewal spends the old refresh token, so a copy left behind would sign the profile out. A login Claude Code also uses (the slot, a profile's folder) is renewed only once it has expired, since Claude Code renews it earlier while a session runs; the vault's, a few minutes before. Each profile is asked at most once a minute, by any number of dotagents runs; an error or a 429 backs off, up to 15 minutes, and the profile keeps its last numbers with the error next to them. Tokens are never printed, logged or written anywhere else. The endpoint is undocumented: when it changes, the numbers fall back to Claude Code's cache.

On a Windows machine with WSL, `install` finds the other side (Windows from WSL, WSL from Windows) and records it in `machine.json`. `usage` then also reads that side's caches, read only: when the same account has newer numbers there, they win, and the profile says so (`4m ago on Windows`). Data older than 6 hours is marked stale and drawn muted. A profile that isn't signed in, has no data yet, or holds the cache of an earlier sign-in says so instead of showing a number.

## dotagents start

```bash
dotagents start              # on 127.0.0.1:7337, or the next free port
dotagents start --port 0     # any free port
```

Starts the dashboard's server: the panel, a page with the usage of every profile, live (the account in each side's slot, the projection, a switch for each account, on one side or both, and a button that opens its Desktop app), and the data it reads (`/api/usage`, the same as `usage --json`, and `/api/events`, which sends it again whenever it changes). While it runs, it asks Anthropic for each profile's usage every minute, as `usage --refresh` does, and prints a failure when it changes. It prints the address to open, with a token after `#`; the page keeps the token and the API answers nothing without it. It listens only on `127.0.0.1` and answers only requests addressed to itself (so a web page elsewhere can't reach it). From WSL, a Windows browser reaches it at the same address; `msedge --app=<address>` opens it in a window of its own. Ctrl+C stops it.

The other side of the machine is read only while it runs: on Windows, the server asks `wsl.exe` every 5 seconds whether the distro is running and never reads `\\wsl.localhost` when it isn't, so it doesn't start WSL. The data then carries `"peer": { "name": "WSL", "up": false }`. While the other side runs, its running Claude Code sessions count for the account in its slot (`working`, `waiting`); the server asks that side's `dotagents sessions --running` every 15 seconds, in the background, so a read never waits on it.

Its data adds `sides`, the sides of the machine (`["WSL", "Windows"]`, this one first), `slots`, the profile in each side's slot (`{ "WSL": "work", "Windows": "personal" }`), and `current`, the current account and its avatar state: the profile in a slot in the worst state, or the brand when no profile is in a slot.

Three actions, for the panel, are the only writes. Each takes a JSON body (`{ "profile": "<name>" }` for the first two), with the token in the `x-dotagents-token` header (never in the address); a GET there answers 405, an unknown profile 404:

| Action | Does |
|---|---|
| `POST /api/switch` | [`switch`](#dotagents-switch) to the profile, on both sides, or only on the side `"side"` names (`{ "profile": "work", "side": "Windows" }`). |
| `POST /api/desktop` | Opens the profile's Desktop app (Windows), as its Start menu shortcut does. |
| `POST /api/refresh` | Asks Anthropic for every profile's usage now, without waiting for the minute. |

While it runs it leaves its port, token and pid in `<state>/start.json`, readable only by you, and takes it away when it stops.

### The VS Code extension

`surfaces/vscode/`, plain JavaScript (ADR 0012), shows the same panel. It runs on the side of the window, in WSL for a WSL window, and talks to that side's `dotagents start`, found through `start.json`; with none running, it starts one in the background.

- **Status bar:** the current account and its usage (`personal 5h 79%  7d 38%`), on the warning background when it asks for attention (`warn`, `waiting`) and on the error one when it stopped (`error`, `limit`). The tooltip lists every account; a click lists them to switch, on both sides.
- **Side bar:** a dotagents view with the panel; a button in its title opens it in the browser.
- **Updates:** it isn't on the Marketplace, so once a day it looks for a newer GitHub release and offers to install it, show the notes or skip that version.

To build and install it from the repository:

```bash
cd surfaces/vscode
npm run package                              # copies the panel in and writes dotagents.vsix
code --install-extension dotagents.vsix --force
```


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
- **With `--skills a,b`,** it uses those names and asks nothing. Names can mix both kinds: `--skills to-cards,humanizer`. Either way, the chosen skills bring the ones they [call](skills.md#skills-that-call-other-skills), and those bring theirs (`--skills pixijs` installs its 25 `pixijs-*` skills too); `init` lists what came along.
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

Warnings (`!`) point out something worth knowing, such as a workspace whose root is itself a git repository, or a skill that [calls another](skills.md#skills-that-call-other-skills) missing from the workspace, without failing the check.

## dotagents workspaces

Lists the workspaces set up with `init` or `new` on this machine, with their skills, and marks the ones whose folder no longer exists. The list lives in `~/.config/dotagents/workspaces.json` (see [Environment variables](#environment-variables)).

## dotagents untrack

```bash
dotagents untrack <path>
```

Removes a workspace from the tracked list, so `update --all` skips it. Its files are not touched.

## dotagents sessions

```bash
dotagents sessions [path] [--all] [--json]
```

Lists the Claude Code sessions started in a folder (the current one by default) or, with `--all`, in every project, newest first. It reads every config folder of the machine: this side's `~/.claude` and, when `install` found the other side (WSL or Windows), that side's too, with its paths translated (`C:\x` is `/mnt/c/x` from WSL).

Each session shows when it was last active, its id, its title (the one Claude Code gave it, or the first message), and then:

- the side it ran on;
- the account: the profile whose claude.ai account ran it, from the `session-owner` records Claude Code writes, and `(shared)` when more than one account did, which happens when a session continues after a `switch`. Older transcripts don't record it: `account unknown`;
- its size;
- with `--all`, the folder it started in;
- where `sessions rm` would archive it: the nearest folder at or above where it started that has `.artifacts/session-archives/`, or `no .artifacts`;
- `running`: a session this side's Claude Code still runs (its `sessions/<pid>.json`, while the process lives), or one whose transcript changed in the last 10 minutes. The list doesn't ask the other side, which takes a few seconds, so there a session counts as running only by that time; `sessions rm` asks.

`dotagents sessions --running` prints only the ids of the sessions this side's Claude Code runs, one per line. It is how `sessions rm` asks the other side.

In a terminal the account is in its profile's color, as in every other view, and `running` and `no .artifacts` are in the warning color; the rest is muted.

Piped, one tab-separated line per session: id, side, last activity, bytes, `running` or `-`, archive folder or `-`, account ids joined with `+`, title. `--json` prints the list with each account's id and label, `shared`, `archiveRoot`, `running` and the transcript's path.

## dotagents sessions rm

```bash
dotagents sessions rm [ids…] [--all] [--yes] [--no-archive]
```

Deletes sessions. Without ids, it lists the ones started in this folder (`--all`: every project's) to pick from, leaving out the running ones: type to filter by title, folder, side or account, Tab marks a session, Enter goes on. Ids may be given instead, in full or by a unique start, such as the eight characters `sessions` shows.

Then it asks what should happen to them:

1. **Archive, then delete**, with how many go into which workspace and how many have no `.artifacts/session-archives/`; it isn't offered when none can be archived.
2. **Delete without archiving.**
3. **Cancel**, the default.

With the first, when some sessions started outside a workspace with `.artifacts/session-archives/`, it asks once more: **they can't be archived first; delete them anyway?** No keeps them.

Then, for each session, it writes the archive when asked to (the same file the `session-archive` skill writes, with the account line) and deletes:

- the transcript, `projects/<slug>/<id>.jsonl`;
- its folder beside it, with subagents and tool results;
- `file-history/<id>/` and `session-env/<id>/`;
- the project folder, when nothing else is left in it.

A session whose archive fails is kept unless you answer yes to deleting it anyway. A running session is never deleted. For the other side's sessions it asks that side's dotagents (`dotagents sessions --running`, through `powershell.exe` from WSL or `wsl.exe` from Windows), so a session left open and idle there is protected too. When that side can't say (no dotagents there, or an older one), it warns and falls back to the 10 minutes. `--yes` skips the questions, archiving what can be archived and deleting the sessions without an archive folder too, but never one whose archive failed; without a terminal, `sessions rm` needs `--yes`. `--no-archive` answers the first question with **Delete without archiving**. `--dry-run` shows the archives and deletions without making them.

## dotagents skills

Lists the own skills and the registered third-party ones, each with the full description its author wrote, for third-party ones where it comes from, and the skills it [calls](skills.md#skills-that-call-other-skills).

## dotagents skills add

```bash
dotagents skills add <source> [--skills a,b | --all] [--dry-run]
```

Registers third-party skills in `config/skills/third-party-skills.json`, so `init` and `new` offer them on every machine. The source can be `owner/repo` (GitHub), a git URL or a local path.

```bash
dotagents skills add blader/humanizer
dotagents skills add vercel-labs/agent-skills --skills web-design-guidelines,writing-guidelines
dotagents skills add mattpocock/skills --all
```

It makes a shallow clone of the source in a temporary folder, finds every `SKILL.md` in it and stores the name, the source, the description exactly as the author wrote them and, under `requires`, the skills it [calls](skills.md#skills-that-call-other-skills). When the source has several skills, pick some with `--skills`, all of them with `--all`, or choose from a list in a terminal.

A skill is skipped when its name matches one of the own skills, when it is already registered from another source, or when its name isn't valid. Running the command again updates the stored descriptions and calls. Commit `skills/third-party-skills.json` afterwards to have the change on the other machine.

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
| `--all` | `update`, `skills add`, `sessions`, `sessions rm` | Every tracked workspace, every skill of the source, or every project's sessions. |
| `--wrap` | `init` | Move a repository into `<name>-workspace/` before applying the standards. |
| `--default` | `profile add` | The profile in `~/.claude`. |
| `--color #RRGGBB` | `profile add` | The profile's color in the listings. |
| `--short` | `usage` | One line, for a prompt or a status line. |
| `--json` | `usage`, `sessions` | The data, for scripts. |
| `--running` | `sessions` | Only the ids of the sessions this side's Claude Code runs. |
| `--yes` | `init`, `new`, `skills add`, `sessions rm` | Never ask. |
| `--no-pull` | `update` | Skip `git pull`. |
| `--no-archive` | `sessions rm` | Delete without archiving. |
| `--from <profile>` | `settings pull` | The profile to take the settings from. |
| `--port <n>` | `start` | The port; `0` picks a free one. |
| `--here` | `switch` | Only this side of the machine. |
| `--save <profile>` | `switch` | Keep the login in `~/.claude` as that profile's. |
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
- `1`: at least one item was skipped or failed, a check item failed, or the command itself failed (a missing folder, a profile that doesn't exist).
- `2`: the command line is wrong: an unknown command or option, or an option without its value. It says which, in one line.

An argument that starts with `--` but isn't an option goes after `--`: `dotagents check -- --odd-folder`.

## Environment variables

| Variable | Effect |
|---|---|
| `NO_COLOR` | Turns colors off. `TERM=dumb` does too. |
| `DOTAGENTS_THEME` | `light` or `dark`: the background the colors are picked for. Without it, `COLORFGBG` when the terminal sets it, else dark. |
| `FORCE_COLOR` | Sets the colors, with or without a terminal, over `NO_COLOR`: `0` turns them off, `1` is 16 colors, `2` is 256, `3` is 24-bit. With a value other than `0`, piped output keeps the terminal look. |
| `CI` | Never asks questions. |
| `DOTAGENTS_STATE_DIR` | Folder of the machine's state: the tracked workspaces (`workspaces.json`) and the profiles (`profiles.json`). Default: `~/.config/dotagents`. |
| `XDG_CONFIG_HOME` | Base of `~/.config` (the default state folder). |
