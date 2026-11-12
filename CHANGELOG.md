# Changelog

What changed for someone who updates a clone. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). `dotagents update` names the version change after a pull.

## Unreleased

### Added

- **`dotagents switch`:** for one person with several seats, puts a profile's login in `~/.claude` (and `~/.claude.json`'s `oauthAccount`), on both sides of the machine, saving the previous one in a vault per profile and side (`~/.config/dotagents/vault/`, readable only by you); `--here` for one side, `--save` to keep a fresh `/login`. Always manual.
- **When each login expires:** `profile list` says until when each profile's saved login lasts, on both sides, warns a week ahead and fails once it has expired, so it is renewed calmly.
- **Workspace memory:** `init` points every Claude profile's auto memory for a workspace at `.artifacts/memory/` (`autoMemoryDirectory` in `.claude/settings.local.json`) and copies in what each profile had learned there before; `check` verifies the folder, the index and the notes left behind.
- **`start` for the tray panel:** on Windows it reads WSL only while WSL runs, never waking it, and counts the running sessions of the other side; `POST /api/switch` and `POST /api/desktop` switch to a profile and open its Desktop app.
- **`dotagents login`:** signs a profile in again on this side when its login runs out (every few weeks), keeping the new login in its vault and putting the previous account back; `--all` for every login running out within a week. `profile list` points to it.
- **Usage projection:** `usage` shows under every window with fresh data how much it will have used at the reset at the current pace (`~79% at reset`), and when it runs out past 100%, in yellow; `usage --json` carries it as `projection`.
- **Skills that call other skills:** dotagents reads which skills a skill calls (the Skill tool with a quoted name, a link to `../name/SKILL.md`); `init` and `update --all` bring them along, and the ones they call (`--skills pixijs` installs its 25 `pixijs-*` skills), `skills` shows them, `skills add` stores them in the catalog as `requires`, and `check` warns about each one a workspace lacks.

- **`dotagents start`:** the dashboard's local server, on 127.0.0.1 with a token, and a first page with the usage of every profile, live (server-sent events); a Windows window reaches it in WSL at the same address.

### Fixed

- An unknown option (`check --bogus`) or command, or an option without its value, prints one line and exits with 2, instead of a stack trace or being ignored; `--` ends the options.

## 3.0.0 - 2026-10-29

### Breaking

- **No more full-screen view.** dotagents is a plain command line, for people and for agents; the visual side moves to a separate app, still to come. `dotagents` with no command prints the help, `usage --watch` stops with a message, and Ink and React are no longer dependencies.
- **`usage --json` prints an envelope:** `{ "version": 1, "generatedAt": …, "profiles": [ … ] }` instead of a bare list, so new fields never break a script again.
- **`usage --short` changed format** for status lines: one line per profile, `5h` and `7d` with 8-cell bars (`work  5h ━━━━━━ ─  72% ↻ 3h17m   7d …`).

### Added

- **`usage --refresh`:** asks Claude Code itself for each profile's usage (`claude -p "/usage"`), which refreshes the cache and renews the sign-in without spending quota or leaving a session; at most once every 3 minutes per profile.
- **WSL and Windows together:** `install` finds the other side of the machine and `usage` reads its caches too; the newer numbers of the same account win, and the profile says where they came from.
- **The same configuration in every profile.** On Windows, `install` no longer overwrites a settings copy that `/config` changed: it keeps it and says so, and `dotagents settings pull` brings the change into the repository. `claude/global-config.json` sets the `/config` options Claude Code keeps in `.claude.json` (`copyOnSelect`, `diffTool`…) in every profile. `profile list` warns about a profile that differs and about changes to these files not committed yet.
- **The dotagents brand:** the symbol (the face `..`), its states and the lockup in `assets/`; the README opens with them and a capture of `usage`, drawn by `npm run media` from the same lines the command prints.

### Changed

- **The look follows the new identity** (Vercel's Geist palette, no accent): colors per background (`DOTAGENTS_THEME=light|dark`, else `COLORFGBG`, else dark), a profile's name in a readable variant of its color, exact 256 and 16 color mapping.
- **Every command prints without the rail** (`┌ │ ◇ └`): the ` dotagents ` badge in reverse video and the command, bold section titles, one line per item, a summary without `·`. Warnings show `▲`, skipped items `–`. Command names in the help are bold, not cyan. The prompts drop their rail too.
- **`usage` has a new layout:** no rail or dots, `5h`/`7d` labels, a thin bar of constant width, the percentage in bold, levels at 70% and 90% (were 50% and 80%), durations like `3h 17m`.

### Fixed

- `FORCE_COLOR=0` turns colors off instead of on, and `TERM=dumb` turns them off too. `FORCE_COLOR=1`, `2` and `3` set how many colors the output uses.

## 2.0.0 - 2026-10-29

### Breaking

- **Node 22.18 or later.** The sources are TypeScript, run directly through Node's type stripping, with no build.
- **The command's entry file is `cli.ts`, no longer `cli.mjs`.** Run `npm link` again in the clone once; from now on `dotagents update` does it when the entry file changes.
- **Codex and OpenCode are gone.** `install` no longer writes their global configuration, and the standards, skills and docs cover Claude Code only. `move-sessions` lost its `--tools` option.
- **Accounts are now profiles.** `dotagents account add/list/remove` became `dotagents profile add/list/remove`, and `accounts.json` became `profiles.json`; `install` and `update` move the file. A profile is the local folder; the account is the Claude sign-in it holds.
- **The machine state is checked when read.** A `workspaces.json` or `profiles.json` that isn't valid, or that a newer dotagents wrote, stops the command instead of being read as empty and overwritten.

### Added

- **Profiles:** several Claude sign-ins on one machine, each with its config folder, the same configuration and a `claude-<name>` launcher (`profile add`, `profile list`, `profile remove`). `profile list` fails when two profiles hold the same account.
- **`dotagents usage`:** how much of each profile's plan is used (5-hour session, week, per-model weeks), from Claude Code's own cache, with no network. `--short` for one line, `--json` for scripts, `--watch` for the live view.
- **The full-screen view:** `dotagents` with no command, in a terminal, opens Usage, Profiles, Workspaces and Skills screens, with install and apply actions after a preview.
- **Claude Desktop per profile on Windows:** a Start menu shortcut "Claude <Name>" with the profile's icon, a second app with its own data folder, its own taskbar button, and the profile's window title, window icon and tray icon.
- **`update` runs `npm link` again** when a pull changes the command's entry file.

### Changed

- Subagents run on Sonnet by default (`CLAUDE_CODE_SUBAGENT_MODEL` in the shared settings).
- The terminal output goes through one renderer, and each command lives in its own file.

## 1.0.0 - 2026-10-16

The configuration for Claude Code, Codex and OpenCode, the `.agents/` and `.artifacts/` standards, the skills and the `dotagents` command (`install`, `update`, `new`, `init`, `check`, `workspaces`, `untrack`, `skills`).
