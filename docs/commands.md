# Commands

```
dotagents <command> [options]
```

| Command | What it does |
|---|---|
| [`install`](#dotagents-install) | Applies the global configuration to this machine, in every profile folder. |
| [`update [--all]`](#dotagents-update) | Pulls this repository and runs `install`; with `--all`, also refreshes every tracked workspace. |
| [`settings pull [--from <profile>]`](#dotagents-settings-pull) | Brings a change from the local Claude Code settings copy into the configuration repository. |
| [`doctor`](#dotagents-doctor) | Checks Node.js, the connection to the other side and the profiles' logins. |
| [`logs [--side <side>]`](#dotagents-logs) | Shows the latest entries from the core, sidebar and host logs. |
| [`profile add <name>`](#dotagents-profile-add) | Adds one Claude or ChatGPT account, with its own Desktop launcher on Windows. |
| [`profile list`](#dotagents-profile-list) | Lists the profiles and checks them. |
| [`profile remove <name>`](#dotagents-profile-remove) | Forgets a profile; its saved login is kept. |
| [`start [--port <n>]`](#dotagents-start) | Starts the accounts' local API on 127.0.0.1, live, which the dotagents sidebar reads. |
| [`switch [<profile>] [--here] [--save <profile>]`](#dotagents-switch) | Puts a profile's login in its agent's slot, on both sides of the machine. |
| [`login <profile> \| --all`](#dotagents-login) | Signs a profile in again on this side, keeping the new login in its vault. |
| [`usage [--refresh] [--short] [--json] [--spend]`](#dotagents-usage) | Shows Claude and ChatGPT usage. `--spend` estimates what 1% costs from local transcripts, Claude's and Codex's. |
| [`new [git-url] [folder]`](#dotagents-new) | Creates a workspace folder (any name; `<name>-workspace` by default), clones the repository into it and applies the standards; with a folder alone, starts an empty workspace. |
| [`init [path]`](#dotagents-init) | Applies the standards to a folder and puts the chosen skills in it. |
| [`check [path]`](#dotagents-check) | Runs the standards checklist on a workspace, changing nothing. |
| [`workspaces`](#dotagents-workspaces) | Lists the workspaces tracked on this machine. |
| [`untrack <path>`](#dotagents-untrack) | Stops tracking a workspace. Its files are not touched. |
| [`sessions [path] [--all] [--agent claude|codex] [--json]`](#dotagents-sessions) | Lists Claude Code's and Codex's sessions on both sides of the machine: title, account, size. |
| [`sessions rm [ids…] [--all] [--agent claude|codex] [--yes]`](#dotagents-sessions-rm) | Deletes Claude Code's and Codex's sessions after one confirmation; a running one only when you say so in a terminal. |
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

Where Codex is installed (a `codex` command on the PATH, or a `~/.codex` folder), it also writes `~/.codex/AGENTS.md`, the instructions with the rules at the end (Codex has no rules folder); the other side of the machine writes its own when `install` runs there. Without Codex nothing is created. `config.toml` is never touched.

Run it again after editing the global instructions or `claude/settings.json`. Claude Code's rules are linked. The rules in Codex's generated `AGENTS.md` are updated when `install` runs again.

## dotagents update

```bash
dotagents update               # git pull --ff-only in the clone, then install
dotagents update --all         # also refresh every tracked workspace
dotagents update --no-pull     # skip the pull and only reapply
```

- When the pull changes `package-lock.json`, it runs `npm install` before going on, so the next run can start. When it changes the command's entry file (`bin` in `package.json`), it runs `npm link` too, so `dotagents` keeps working. When it changes the version, it says so (`version <old> → <new>`) and points to [`CHANGELOG.md`](../CHANGELOG.md), which lists what changed and what to do.
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

On every system `/config` writes to the local copy of `config/claude/settings.json`. `install` updates a copy that fell behind the repository and preserves local edits. `settings pull` brings those edits back into the configuration repository, excluding machine-specific keys such as `model` and `effortLevel`. Use `--from` to select an older profile's copy when several differ.

## dotagents doctor

```bash
dotagents doctor
```

Checks that dotagents can work on this machine and says what to do, in plain words, when it can't: whether this side's Node is new enough (24 or newer); in WSL and on Windows, whether this side sees the other one and whether dotagents runs there, with a Node new enough (the system Node of a WSL distro often isn't); whether Claude Code and Codex are installed on each side, with their versions (one that is missing is a warning with how to install it, since dotagents works without it); and every profile's login on both sides, Claude's and ChatGPT's, with how long it lasts (or, for ChatGPT, when it was last renewed) and how to sign in again. It only reads. Exit code 1 when a check fails.

## dotagents logs

```bash
dotagents logs                # both sides of the machine
dotagents logs --side windows # only one side: wsl or windows
```

Shows where the logs are on each side (`<state>/logs/`, the other side's through its home) and the last 50 lines of `core.log`, `sidebar.log` and `host.log`, or that there is none of one yet. It only reads. The files, their format and how credentials are kept out of them are in [Logs](logs.md).

## dotagents profile add

```bash
dotagents profile add work --default     # the account the normal Desktop app opens
dotagents profile add hopper --provider chatgpt --default   # the ChatGPT account the normal ChatGPT app opens
dotagents profile add personal           # a second account
dotagents profile add personal --color '#376B80'
```

A profile represents one account the person holds. On each side, Claude profiles share `~/.claude` and ChatGPT profiles share `~/.codex` or `$CODEX_HOME`. [`switch`](#dotagents-switch) puts a profile's login in its provider's slot. Two profiles of the same provider can't hold the same account. Earlier versions called profiles accounts (`dotagents account add`, `accounts.json`); `install` moves `accounts.json` to `profiles.json`. For a Claude profile, `profile add`:

- applies the configuration of `install` to `~/.claude`;
- records the profile in `profiles.json`, next to `workspaces.json` (its format is [The profiles file](profiles-file.md));
- on Windows, gives the profile a Claude Desktop app, so the accounts can be open at the same time: a launcher `claude-desktop-<name>.vbs` and the Start menu shortcut "Claude <Name>" ("Claude Personal", "Claude My Work"). For a profile other than the default one, it also creates the data folder `%APPDATA%\Claude-<name>`, and the shortcut starts a second app with `--user-data-dir`, which keeps its own sign-in and chats. Every app's launcher clears `CLAUDE_CONFIG_DIR`, so the Code tab uses `~/.claude`. The default profile's shortcut opens the normal app. The shortcut takes the profile's icon, `assets/claude-<name>.ico`, when the repository has one, and the app's otherwise. Each profile also gets its own taskbar button, with its icon and name: the shortcut carries an AppUserModelID of its own (`dotagents.claude.<name>`), and the launcher starts a small hidden watcher (`claude-taskbar.ps1`) that gives the instance's windows the same ID and ends when the instance closes. The same watcher gives the instance the profile's look: the window title ("Claude Personal", in Alt+Tab and the taskbar preview) and icon, and the notification-area icon with its tooltip. Claude puts its own title and tray icon back now and then, so the watcher sets them again (the tray icon every 10 seconds); the tray part relies on how Electron numbers its icons, not on a documented interface, so an app update may bring Claude's own icon back. After an app update, which reopens only the normal app, the button comes back the next time the profile opens through its shortcut. Without Claude Desktop installed, it only notes so.

Then sign the profile in, once on each side: [`dotagents login personal`](#dotagents-login), or sign in with `claude auth login`, which puts the account in `~/.claude`, and run `dotagents switch --save personal`. In the second Desktop app, sign in with **e-mail and code**: Google sign-in returns to the normal app. Links `claude://` also open the normal app, and an app update reopens only the normal one. Running it again changes nothing.

- One profile of each provider is the default: the one the normal Desktop app opens (Claude Desktop for Claude, the ChatGPT app for ChatGPT).
- `--provider chatgpt` makes it a ChatGPT account for Codex (ADR 0007), on `~/.codex` (or `CODEX_HOME`), with no Claude configuration (its record in `profiles.json` is version 2, see [The profiles file](profiles-file.md)). Sign it in once on each side with [`dotagents login <name>`](#dotagents-login). On Windows it gets a ChatGPT app of its own, as a Claude profile gets Claude Desktop: a launcher `chatgpt-desktop-<name>.vbs` and the Start menu shortcut "ChatGPT <Name>". The ChatGPT app runs Codex inside it, which reads its login from `CODEX_HOME`: the default profile's shortcut opens the normal app, on `~/.codex`, the slot, so it shows whichever ChatGPT account `switch` put there; any other profile's starts a second app with `--user-data-dir=%APPDATA%\ChatGPT-<name>` and `CODEX_HOME` set to `codex-home` inside that folder, where you sign in once, apart from the slot and the vault. The icon is `assets/chatgpt-<name>.ico` when the repository has one. It gets its own taskbar button and look as a Claude profile does: the shortcut's AppUserModelID is `dotagents.chatgpt.<name>`, and the same watcher (`claude-taskbar.ps1`, started with `-Exe ChatGPT.exe`) gives the instance's windows that ID, the title "ChatGPT <Name>" and the icon. The notification-area icon stays the ChatGPT app's: the app registers it by a GUID, one for the executable, so every instance shares a single tray icon and there is none per profile to change.
- `--color #RRGGBB` sets the profile's color in the listings and its avatar. Without it, profiles get `#D77655`, `#376B80`, `#7A5C9E`, `#B5607F`, `#6B7F4A` and `#5B6478`, in the order they are added. The avatar's shape comes from the profile's name, always the same.

## dotagents profile list

Lists the profiles (color, default, the e-mail of the saved login, its plan as the product names it, and which one is in the slot now), under a Claude and a ChatGPT heading when there are both, the one in the slot first in each, as `usage` orders them, and checks them: each uses `~/.claude` (a ChatGPT one `~/.codex`), each has a saved login, and no two hold the same account of their provider. It also warns when a variable such as `ANTHROPIC_API_KEY` is set in the shell, and checks the shared configuration: a settings copy (Windows) changed in a profile or behind the repository, a [`claude/global-config.json`](global-configuration.md) option changed in a profile, and changes to either file not committed yet. Where Codex is installed it also checks its configuration on this side: `~/.codex/AGENTS.md` generated and up to date, and a warning when an `AGENTS.override.md` with text makes Codex ignore `AGENTS.md`. Last, it says until when each profile's saved login lasts, on each side of the machine (a login lasts a few weeks, and Claude Code renews it only up to that date): a week ahead it warns, and once a login has expired the item fails; either way it says to run [`login`](#dotagents-login) on that side. A date can't tell a login revoked on the server, so the item also fails when the live usage (`usage --refresh`, `start`) was refused by Anthropic for that same login, wherever a switch copied it (a new sign-in or a renewal brings another and clears it), and when a side's slot names an account in `.claude.json` but has no `.credentials.json` (a logout elsewhere deletes it). In WSL it also fails when `~/.claude` is a link to another folder: Windows reaches WSL's files through `\\wsl.localhost`, which doesn't follow a Linux link, so the Desktop's Code tab in WSL mode can't install its server there; the item says how to make it the folder. The ChatGPT profiles' logins are in the same list, on each side: OpenAI gives no end date for a login, so a good one says when it was last renewed, and the item fails when the live usage was refused by OpenAI for the login (the slot's `auth.json` for the profile in it, else its vault's; a new sign-in or a renewal clears it). For the ChatGPT profiles on this side it also fails when `~/.codex/auth.json` is a link or has more than one name (dotagents writes only a plain file there); and it warns when `cli_auth_credentials_store` is set to anything but `"file"` at the top of `config.toml` (the switch swaps `auth.json`, and Codex would not read it; dotagents never edits that file), when `OPENAI_API_KEY` or `CODEX_API_KEY` is set (Codex signs in with that key over the slot's login), and when the slot now holds another ChatGPT user than the one the last `switch` or `login` put there (a Codex left open may have written its old login back; the item names both profiles and says to switch again, or `switch --save` when the new login is wanted; the record is `codex-slot.json` in the state folder, a profile name and a user id, never a token). Exits with 1 when an item fails.

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

For one person who holds several Claude seats (ADR 0004 in the workspace's `.artifacts/decisions/`). Each side of the machine has one slot, `~/.claude` (its `.credentials.json`) with the `oauthAccount` block of `~/.claude.json`; the command line, the VS Code extension and the Desktop's Code tab in WSL mode read it, so they change together, and an open conversation goes on in the new account when you type "continue" in it.

Every account's login is kept in a vault, one per profile and side, in `~/.config/dotagents/vault/<profile>/`, readable only by you. A switch:

1. saves the login in the slot back to its profile's vault, since Claude Code may have renewed the token, and saves it again if a running session renews it while the switch runs;
2. writes the chosen profile's login into the slot, each file whole and in one step, leaving the rest of `~/.claude.json` as it is;
3. checks that the slot holds that account, and warns when Anthropic refused that login (as `profile list` reads it), even when it was already in the slot.

The switch and the renewals of `usage --refresh` take the same lock (`logins.lock` in the state folder), so neither copies a token the other is spending.

Then it runs the same switch on the other side of the machine (`--here` skips that), whose vault holds that side's own login: a refresh token copied to two slots would sign one of them out. It passes the account selected under this side's login lock (`--expect <account id>`), and the other side refuses when its profile of that name holds another account, so give the profiles of one account the same name on both sides. An account in the slot that no profile knows is never overwritten: `--save <profile>` says whose it is. The switch is always manual.

### ChatGPT profiles

The same command switches a [ChatGPT profile](#dotagents-profile-add) (ADR 0007): the slot is `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`), which the Codex command line, its VS Code extension and its desktop app read, and the vault keeps `vault/<profile>/auth.json`. A Codex switch never touches `~/.claude`, and a Claude one never touches `~/.codex`. The account is told by the ChatGPT user in the login, not the workspace: two seats of one Business workspace share its id. A switch:

1. saves the slot's login back to its profile's vault only when it is provably the newer copy, the same sign-in renewed at least as late; another sign-in of that account, or an account no profile knows, stops it, and `--save <profile>` says whose it is;
2. copies the chosen login into `auth.json` byte for byte, mode `600`, holding Codex's own commit lock (`auth.json.lock`: `flock` on Linux and WSL, `LockFileEx` on Windows; gives up after 5 s if Codex holds it), and refuses a link there;
3. checks the slot holds that account, then restarts Codex's app-server daemon when it runs (`codex app-server daemon restart`), since a running one keeps the old login. It records which profile it put in the slot (`profile list` uses it to catch a Codex that wrote its old login back), and warns, still switching, when OpenAI refused that login (as `profile list` reads it), even when it was already in the slot.

Codex sessions already open (the terminal, the extension, the desktop app) stay on the old account until restarted. `login --all` takes Claude's logins that run out within a week and, since OpenAI gives no end date, ChatGPT's refused or not saved; the live usage of the ChatGPT profiles is described under [`usage`](#dotagents-usage).

## dotagents login

```bash
dotagents login personal   # sign personal in again on this side
dotagents login --all      # every profile whose login runs out, was refused or isn't saved
```

A login lasts a few weeks, and no renewal extends it: `profile list` says when each one runs out. `login` signs a profile in again through this side's slot:

1. saves the login in the slot to its profile's vault and puts the chosen profile's in, as [`switch --here`](#dotagents-switch) does;
2. runs `claude auth login`, which opens the browser;
3. checks that the account signed in is the profile's, and stops without saving anything when it isn't;
4. keeps the new login in the profile's vault;
5. puts the account that was in the slot back, also when a step failed.

The login lock is held only around the slot changes, not while the browser waits for you. `--all` takes every Claude profile on this side whose login runs out within a week, was refused by Anthropic, or isn't saved yet, then every ChatGPT profile whose login was refused by OpenAI or isn't saved yet (OpenAI tells no end date, so a good one is never taken). Each side of the machine has its own login, so run it on the other side too.


### ChatGPT profiles

`dotagents login <name>` for a ChatGPT profile runs `codex login` in a temporary folder of its own (`CODEX_HOME`, readable only by you, with `cli_auth_credentials_store = "file"`), never in `~/.codex`: a sign-in there revokes the login before it, which may be another profile's saved one. Then it checks the account signed in is the profile's (a profile's first sign-in takes any account no other profile holds), keeps the new login in the profile's vault, and, when that account is in the slot, puts it there too and restarts Codex's daemon, as [`switch`](#chatgpt-profiles) does. The folder is deleted at the end, also after a failure. `--all` takes the ChatGPT profiles whose login OpenAI refused or that has none saved yet, after Claude's; if one provider's sign-in fails, the other's goes on, and the failure is told at the end with a non-zero exit.
## dotagents usage

```bash
dotagents usage            # every profile: the 5-hour window, the week, per-model weeks
dotagents usage --refresh # ask Anthropic and OpenAI for fresh numbers first
dotagents usage --short    # one line per profile, for a status line
dotagents usage --json     # the data, for scripts
dotagents usage --spend    # what 1% of each window costs, and where the spend went
```

For Claude, shows the newer of Claude Code's cache (`cachedUsageUtilization` in `~/.claude.json`, or `<folder>/.claude.json`) and the last reading from Anthropic. For ChatGPT, shows the last reading from the Codex app-server. Live readings are kept in `<state>/usage/<profile>.json`. Without `--refresh` it makes no network call. If the other side's profile file is unreadable or incompatible, the CLI tells you why it skips that side's Codex data. The default Codex folder is used only when no ChatGPT profile configures a folder. Without profiles, it shows the Claude login in `~/.claude`.

```
 dotagents  usage

work  [default]  Team Standard  1 working  4m ago, live
  5h      ━━━━━━━━━━━━━━━━━━━━━━━ ────────   72%  resets 3h 17m
          at this pace, runs out 12:40
  7d      ━━━━━━━━━━━━━━━ ────────────────   48%  resets 4d 18h
          at this pace, runs out Fri 12:02
  Fable   ━━━━━━━━━━━━━━━━━━━ ────────────   59%  resets 4d 18h
          at this pace, runs out Fri 01:10

2 profiles; --refresh asks Anthropic for fresh numbers
```

Within Claude and within ChatGPT, the profile whose account is in this side's slot comes first, then the one in the other side's slot, the others after in their order. Each profile shows its name, `[default]`, its plan as the product names it (`Team Standard` for a Claude Team seat, with the seat Claude keeps in the login; `Business` for ChatGPT Business, which the API still calls `team`; OpenAI tells no seat), its running Claude Code sessions (`2 working, 1 waiting`, the ones busy and the ones waiting on you), how old its data is and, when it came from Anthropic rather than Claude Code's cache, `live`; then one line per window (`5h`, `7d`, and a model's own week): a bar, the percentage and when it resets. The percentage is green below 70%, yellow from 70% and red from 90%, and from 70% the reset takes that color too; the digits say it without color. Under each window with fresh data, a projection at the average rate since the window opened: `~79% at reset` (muted), or, when it would pass 100%, when it runs out, `at this pace, runs out Fri 12:02` (yellow). A window already at 100% has none: the bar and the reset say it. In a window's first 10% the rate means little, so it says when the projection starts (`projection from 14:30`); an unused or reset window has none. A window whose reset time has passed shows as reset, never with the old number.

`--short` prints one line per profile with the 5-hour and weekly windows, 8-cell bars, and the time to the reset from 70%:

```
work      5h ━━━━━━ ─  72% ↻ 3h17m   7d ━━━━ ───  48%
personal  5h ━━━━━━ ─  91% ↻ 58m     7d ━━ ─────  30%
```

`--json` prints the data in an envelope with a format version, so scripts can rely on it; fields are only added within a version, and `version` goes up with a change a script could misread (2: a ChatGPT profile's `provider` is `chatgpt`, where it was `codex`):

```json
{ "version": 2, "generatedAt": "2026-10-28T12:00:00.000Z", "profiles": [
  { "name": "work", "color": "#D77655", "default": true, "state": "ok", "fetchedAt": "2026-10-28T11:56:00.000Z",
    "source": "live", "activity": { "working": 1, "waiting": 0 },
    "windows": [{ "kind": "session", "pct": 72, "resetsAt": "2026-10-28T15:17:00.000Z", "reset": false, "elapsedPct": 34, "projection": { "atResetPct": 210, "runsOutAt": "2026-10-28T12:40:00.000Z" } }] }
] }
```

`state` is `ok`, `stale`, `no-data`, `not-signed-in` or `other-account`; `source` is `cache` (Claude Code's) or `live` (asked of Anthropic, or of OpenAI through codex app-server); when a ChatGPT profile exists, every profile carries its `provider` (`claude` or `chatgpt`), and every profile its `plan` (or `null`), and a Claude profile its `seat` when Claude Code keeps one with the login (`team_standard`); the plain output, one line per window for scripts, leaves the plan out; `kind` is `session`, `week` or `model-week` (with `model`); `elapsedPct` is how much of the window has gone by, where the bar would be at a uniform pace; `projection` is `{ atResetPct, runsOutAt? }`, `{ from }` while the window is too young, or `null` (nothing used, reset, at 100% already, or stale data); `avatar` is the profile's state for its avatar, the most urgent of `error`, `limit`, `waiting`, `warn`, `ok` and `asleep`; `working` says a session works on it (its avatar hops), with any state but `error` and `limit`; `activity` counts the profile's running sessions, for a profile whose login Claude Code is using; `error` says why the last live ask failed; `from` names the other side of the machine when the numbers came from there.

For a status line, which isn't a terminal, keep the colors with `FORCE_COLOR=3 dotagents usage --short` (`2` where the terminal has no 24-bit color). Piped, `usage` prints one plain line per window instead: `<profile> <window> <pct> <reset, ISO> fetched <ISO>`, with `(live)` on numbers from Anthropic and `(stale)` on old data.

Claude Code writes its cache when it asks for the usage, which happens during sessions and on `/usage`. `--refresh` asks now, the way Claude Code does (ADR 0003): for each profile it reads the login where it lives (the slot `~/.claude` when the profile's account is there, else its vault, else its own folder) and calls Anthropic's OAuth usage endpoint with it. When the access token is about to expire, dotagents renews it first and writes the new one back to that same file, at once, under a lock shared with `switch`: a renewal spends the old refresh token, so a copy left behind would sign the profile out. A login Claude Code also uses (the slot, a profile's folder) is renewed only once it has expired, since Claude Code renews it earlier while a session runs; the vault's, a few minutes before. Each profile is asked at most once a minute, by any number of dotagents runs; an error or a 429 backs off, up to 15 minutes, and the profile keeps its last numbers with the error next to them. Tokens are never printed, logged or written anywhere else. The endpoint is undocumented: when it changes, the numbers fall back to Claude Code's cache.

The ChatGPT profiles are listed after the Claude ones, under a `ChatGPT` header line (and the Claude ones under `Claude`) when both exist. Their usage is asked of the official `codex app-server` over stdio, never of chatgpt.com: dotagents sends `initialize`, the `initialized` notification and `account/rateLimits/read`, and Codex makes the call with its own login, so no token, client id or User-Agent of dotagents' goes on the wire. The 300-minute window is the 5-hour session and the 10080-minute one the week; any other shape is refused with a reason, and a window that was never read is unknown, never 0%. The profile in the side's slot is asked in the real `CODEX_HOME`, as it is; any other is asked in a temporary `CODEX_HOME` (mode 0700, `cli_auth_credentials_store = "file"`) with a copy of its vault `auth.json`, one at a time under the same lock as `switch`. If Codex renewed that copy and it is still the same ChatGPT user, the renewed login goes back to the vault, even when the call failed, since the refresh token is single-use; the temporary folder is then deleted. `start` asks about each profile once a minute, as for Claude, with the same backoff on errors (`usage --refresh` asks all of them now, except one that is backing off), and a call that hangs is killed after 20 seconds. Each profile's answer is kept in `<state>/usage/<profile>.json`: `provider: "chatgpt"`, `fetchedAtMs`, `user` (the ChatGPT user the numbers are about), `plan`, `windows` (`kind`, `pct`, `resetsAt` in ms or null), and the last attempt's `askedAtMs`, `failures`, `retryAtMs` and `error`. When OpenAI refuses the login (a 401, `refresh_token_reused`, an invalidated or expired token, no authentication), the error says to run `dotagents login <profile>` and `refused` holds the mark of that login (a short hash of its refresh token: the slot's `auth.json` for the slot's profile, the vault's for the others); a good answer clears both.

As for Claude, when the other side of the machine read the same ChatGPT account later, its numbers are shown, with `(from <side>)`: that side's records are matched by the ChatGPT user, whatever its profile is called there. Which ChatGPT profile is in the other side's slot is read from the folder that side's ChatGPT profiles use (its `CODEX_HOME` when they were added), else its `~/.codex`. `usage` reads the other side whenever it is known, as for Claude; `start` only while that side is up.

On a Windows machine with WSL, `install` finds the other side (Windows from WSL, WSL from Windows) and records it in `machine.json`. For Claude and ChatGPT profiles alike, `usage` can use a newer reading for the same account from that side and shows where it came from (`4m ago on Windows`). Data older than 6 hours is marked stale and drawn muted. A profile that isn't signed in, has no data yet, or holds the cache of an earlier sign-in says so instead of showing a number.

### What 1% costs

`usage --spend` estimates the cost of each window's %, per profile, Claude's and ChatGPT's. Every live reading that changes a window's % (`start`, every minute, or `--refresh`) adds a line to `<state>/usage/<profile>.history.jsonl`, so it asks Anthropic and OpenAI nothing more. The spend is the tokens of every assistant message in Claude Code's transcripts on both sides of the machine (`~/.claude/projects/`, subagents included), each one under the account its session ran as, at the API's prices. Between two readings of the same window where the % rose, the spend over the % gives `1% ≈ US$ X ≈ N tokens`; a rise with no spend here (claude.ai, the Desktop outside Code, another machine) is counted as unexplained, and the line says how much of the rise that was. Under it, the current 5-hour and weekly windows' spend, by model and by folder. A ChatGPT profile gets the same, from the tokens of each response in Codex's rollouts (`token_usage_record`, `~/.codex/sessions/` on both sides, subagents included), under the ChatGPT user that started the conversation; OpenAI's prices aren't kept here, so its lines say tokens, not dollars (`1% ≈ N tokens`). `--json` gives the same data, as `version` 2: each window's `totalUsd` (`null` without a price) and `totalTokens`, and its `models` and `workspaces` as `[name, dollars, tokens]`. Older readings without an account still count for profiles with no known account change. After a profile takes a different login, only readings tagged with the current account count.

The dollar is the API's price, a unit to compare with: a subscription isn't charged per token. The % comes in whole numbers, so the relation is rough until days of readings pile up.

## dotagents start

```bash
dotagents start              # on 127.0.0.1:7337, or the next free port
dotagents start --port 0     # any free port
dotagents start --dry-run    # preview without starting the API or writing state
```

Starts the accounts' local API, which the [dotagents sidebar](https://github.com/dotagents-org/dotagents-sidebar) reads to show every account (its accounts tab and the status bar) and to switch; the sidebar starts one in the background when none answers. It serves no pages: only `/api/usage` (the same data as `usage --json`, with what follows) and `/api/events`, which sends it again whenever it changes, and the actions below. While it runs, it asks Anthropic and OpenAI for each profile's usage every minute, as `usage --refresh` does, and prints a failure when it changes. It listens only on `127.0.0.1`, answers only requests addressed to itself (so a web page elsewhere can't reach it) and nothing without the token it leaves in `start.json`. Ctrl+C stops it.

Started by hand it lives as long as its terminal. To run it on its own, the way the sidebar starts it: on Linux and macOS, `nohup dotagents start >/dev/null 2>&1 &`; on Windows, `Start-Process -WindowStyle Hidden -FilePath dotagents.cmd -ArgumentList start` in PowerShell, so no console window holds it.

The other side of the machine is read only while it runs: on Windows, the server asks `wsl.exe` every 5 seconds whether the distro is running and never reads `\\wsl.localhost` when it isn't, so it doesn't start WSL. The data then carries `"peer": { "name": "WSL", "up": false }`. While the other side runs, its running Claude Code sessions count for the account in its slot (`working`, `waiting`); the server asks that side's `dotagents sessions --running` every 15 seconds, in the background, so a read never waits on it.

See the [API contract](start-api.md) for `sides`, `slots`, `current` and the full profile fields. The `desktop` action opens the profile's launcher on Windows for both providers.

Three actions, for the sidebar's accounts tab, are the only writes. Each takes a JSON body (`{ "profile": "<name>" }` for the first two), with the token in the `x-dotagents-token` header (never in the address); a GET there answers 405, an unknown profile 404:

| Action | Does |
|---|---|
| `POST /api/switch` | [`switch`](#dotagents-switch) to the profile, on both sides, or only on the side `"side"` names (`{ "profile": "work", "side": "Windows" }`). |
| `POST /api/desktop` | Opens the profile's Desktop app (Windows), as its Start menu shortcut does. |
| `POST /api/refresh` | Starts a refresh for both providers, subject to the normal interval and error backoff. |

While it runs it leaves its port, token and pid in `<state>/start.json`, readable only by you, and takes it away when it stops. A second `start`, while the server in `start.json` answers, says so and leaves it running: one server per side of the machine. A `start.json` whose server doesn't answer (left behind by a WSL shutdown, say) doesn't count.

The full contract (the endpoints, the token, the events, every field and the actions' answers) is in [The start API](start-api.md).

Every answer of the API and every event carries `"apiVersion": 3`, the format of what the server says, apart from the `version` of the usage data inside it. A client that doesn't know the version it gets refuses it, instead of misreading it; the number goes up only with a change an older client would misread. Version 2 added the ChatGPT profiles and the slots per provider: a client of version 1 would take a ChatGPT profile for a Claude one. Version 3 named that provider `chatgpt`, not `codex`. When the data can't be read (a state file being written, a bad one), the answer is `{ "apiVersion": 3, "error": "<why>" }` and the server keeps running.

### In VS Code

The accounts in VS Code are part of the [dotagents sidebar](https://github.com/dotagents-org/dotagents-sidebar): its first tab is every account (usage, state, the switch on both sides, the Desktop app), and the status bar shows the current account as the statusLine does. It reads this API, on the side of the window (in WSL for a WSL window). Earlier this came from a separate extension, `dotagents-accounts`, and `start` also served the panel as a page in the browser; both are gone.

## dotagents new

```bash
dotagents new [git-url] [folder] [--skills a,b] [--yes] [--dry-run]
```

Creates a workspace around a repository, in the [recommended layout](workspaces.md#recommended-layout-the-workspace-wraps-the-repositories):

```bash
dotagents new git@github.com:me/app.git                 # app-workspace/app/
dotagents new git@github.com:me/api.git app-workspace   # adds api/ to the same workspace
```

1. Creates the workspace folder: pass it as `[folder]`, or answer the question in a terminal. Without one, it is `<name>-workspace/`, with `<name>` taken from the URL. A new folder gets `-workspace` at the end when its name lacks it (`acme` becomes `acme-workspace/`); an existing one keeps its name, so a repository can join a workspace named otherwise.
2. Clones the repository into `<folder>/<name>/`.
3. If the workspace already had an `AGENTS.md` with a `## Repositories` section, adds the new repository to that list. Only that section is touched.
4. Runs `init` on the workspace, with the same questions and options.

It refuses to clone over an existing folder, and refuses to use a folder that is itself a git repository as the workspace. The URL can be anything `git clone` accepts, a local path included.

Without a repository, it starts an empty workspace, for a project that has no repository yet:

```bash
dotagents new thesis   # thesis-workspace/, with the standards and no repository inside
dotagents new          # in a terminal, asks for the folder name
```

It creates the folder, with `-workspace` at the end as above, and runs `init` on it, with the same questions and options. The folder must not exist yet; for one that does, run `init`. An argument counts as the repository when it looks like one: a URL (`https://…`, `git@host:…`), a path ending in `.git`, or a local repository (not a workspace's own); anything else is the folder.

## dotagents init

```bash
dotagents init [path] [--skills a,b] [--wrap] [--yes] [--dry-run]
```

Applies the standards to a folder (the current one when no path is given) and puts the chosen skills in it. It creates only what is missing and never overwrites your own files. See [What init creates](workspaces.md#what-init-creates).

- **In a terminal, without `--skills`,** it asks:
  1. which folder, when none was given;
  2. when the folder is itself a git repository, whether to move it into `<name>-workspace/` (see [Wrapping a repository](#wrapping-a-repository)); in the recommended layout, the root becomes the workspace's own git repository, with a `.gitignore` that lets only the agent files in (nothing is committed; see [Workspaces](workspaces.md));
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
dotagents sessions [path] [--all] [--agent claude|codex] [--json]
```

Lists the Claude Code and Codex sessions started in a folder (the current one by default) or, with `--all`, in every project, newest first; `--agent` shows only one agent's. It reads every config folder of the machine: this side's `~/.claude` and Codex's (`CODEX_HOME`, else `~/.codex`) and, when `install` found the other side (WSL or Windows), that side's too (its Codex folder is the one its ChatGPT profiles use, else its `~/.codex`), with its paths translated (`C:\x` is `/mnt/c/x` from WSL). If the other side's profile file is unreadable or incompatible, the CLI reports the reason and skips its Codex folder. A Codex conversation is its rollout, `sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`; a subagent's rollout belongs to its parent's conversation and isn't listed.

Each session shows when it was last active, its id, its title (the one the agent gave it, Codex's from its `session_index.jsonl`, or the first message), and then:

- its agent, Claude Code or Codex;
- the side it ran on;
- the account: the profile whose Claude account ran it, from the `session-owner` records Claude Code writes, and `(shared)` when more than one account did, which happens when a session continues after a `switch`. Older transcripts don't record it: `account unknown`. A Codex conversation names the ChatGPT user that started it, shown as the profile whose saved login is that user;
- its size;
- with `--all`, the folder it started in;
- `running`: a session this side's Claude Code still runs (its `sessions/<pid>.json`, while the process lives), or one whose transcript changed in the last 10 minutes. On Linux and WSL, a Codex rollout held open according to `/proc` also counts as running. The list doesn't ask the other side, which takes a few seconds, so there a session counts as running only by that time; `sessions rm` asks.

`dotagents sessions --running` prints only the ids of the sessions this side's Claude Code runs, one per line. It is how `sessions rm` asks the other side.

In a terminal the account is in its profile's color, as in every other view, and `running` is in the warning color; the rest is muted.

Piped, one tab-separated line per session: id, agent (`claude` or `codex`), side, last activity, bytes, `running` or `-`, account ids joined with `+`, title. `--json` prints the list with each session's `agent`, each account's id and label, `shared`, `running` and the transcript's path.

## dotagents sessions rm

```bash
dotagents sessions rm [ids…] [--all] [--agent claude|codex] [--yes]
```

Deletes sessions, Claude Code's and Codex's, and nothing else: it writes no archive (the [`archive`](../skills/archive/SKILL.md) skill does that, from inside a session). Without ids, it lists the ones started in this folder (`--all`: every project's) to pick from, the running ones marked `running`: type to filter by title, folder, side or account, Tab marks a session, Enter goes on. Ids may be given instead, in full or by a unique start, such as the eight characters `sessions` shows.

Then it asks once, **Delete N sessions? It can't be brought back**, No by default, and deletes each:

- **Claude Code**: the transcript, `projects/<slug>/<id>.jsonl`; its folder beside it, with subagents and tool results; `file-history/<id>/` and `session-env/<id>/`; and the project folder, when nothing else is left in it.
- **Codex**: through Codex itself, `codex delete --force <id>`, on the side it ran on (on the other side, through PowerShell or WSL's bash, in the `CODEX_HOME` that side's ChatGPT profiles use, else its `~/.codex`), which also deletes the conversation's subagents' rollouts and Codex's own records of it, and every rollout of a conversation that was reverted.

A running session is deleted only when you confirm it in a terminal: **N sessions are still running. Delete them anyway?** No keeps them. For Claude Code, one you confirm has its process closed first (asked to stop, and killed after 5 seconds), so it doesn't write the transcript again; one running on the other side of the machine can't be closed from here: only its files go, and it writes them again until you close it there. For the other side's Claude Code sessions it asks that side's dotagents (`dotagents sessions --running`, through `powershell.exe` from WSL or `wsl.exe` from Windows), so a session left open and idle there counts as running too; when that side can't say (no dotagents there, or an older one), it warns and falls back to the 10 minutes.

A Codex conversation can't be ended by dotagents, so it is never deleted while it is open: on Linux and WSL, where `/proc` tells, its rollout held open by a process, or the conversation the command itself runs in (`CODEX_THREAD_ID`), is kept, and any rollout written in the last 10 minutes counts as running. When the process probe is incomplete or unavailable (including the other side of the machine and Windows) it can't say whether Codex still has it open, so it is asked about like a running one, and Codex's own `codex delete` may reach a conversation a running Codex owns: close Codex on it first. Right before deletion, dotagents rechecks the original side and folder and scans the rollout inventory again. It keeps the conversation when a rollout was added or changed, when it cannot confirm the original destination, or when the inventory is incomplete. A rollout whose first record exceeds 32 MiB leaves the inventory incomplete. A rollout already known to be open blocks deletion even when the process probe is incomplete and you confirm.

`--yes` skips the questions and never deletes a running session, nor a Codex one it can't see; without a terminal, `sessions rm` needs `--yes`. `--dry-run` shows what would be deleted without deleting.

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
| `--default` | `profile add` | Opens the provider's standard Desktop app on Windows. One default profile per provider. |
| `--color #RRGGBB` | `profile add` | The profile's color in the listings. |
| `--short` | `usage` | One line, for a prompt or a status line. |
| `--json` | `usage`, `sessions` | The data, for scripts. |
| `--spend` | `usage` | What 1% of each window costs, and where the spend went. |
| `--running` | `sessions` | Only the ids of the sessions this side's Claude Code runs. |
| `--yes` | `init`, `new`, `skills add`, `sessions rm` | Never ask. |
| `--no-pull` | `update` | Skip `git pull`. |
| `--from <profile>` | `settings pull` | The profile to take the settings from. |
| `--port <n>` | `start` | The port; `0` picks a free one. |
| `--here` | `switch` | Only this side of the machine. |
| `--expect <id>` | `switch` | Only when the profile holds that account (its id); what the other side's switch is run with. |
| `--side <side>` | `logs` | Only that side: `wsl` or `windows`. |
| `--save <profile>` | `switch` | Save the login in the provider's slot to that profile's vault. |
| `--help`, `--version` | | |

Paths can be written with `~` for the home folder, also in PowerShell and cmd, which don't expand it themselves. The short paths dotagents prints can be pasted back.

## Output

In a terminal, every command draws one vertical line from `┌` to `└`, with a section per step and a summary at the end:

```
┌   dotagents  init  ~/projects/app-workspace
│
◇  .agents/
│  + created      .agents/skills/to-cards  → ~/dotagents/dotagents-config/skills/to-cards
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
