# Changelog

What changed for someone who updates a clone. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). `dotagents update` names the version change after a pull.

## Unreleased

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
