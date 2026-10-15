# Global configuration

`dotagents install` writes:

| From | To | How |
|---|---|---|
| `global/instructions.md` + `global/env/<platform>.md` | `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md` | generated file |
| `rules/` | `~/.claude/rules` | folder link |
| `claude/settings.json` | `~/.claude/settings.json` | link on Linux and macOS, copy on Windows |
| `opencode/opencode.json` | `~/.config/opencode/opencode.json` | link on Linux and macOS, copy on Windows |

- **`global/instructions.md`** holds the global instructions: language, commit convention, how workspaces work. It has no machine paths. `{{AGENTS_REPO}}` becomes the clone's location, and the file for the current platform (`env/win32.md`, `env/linux.md`, `env/darwin.md`) is appended when it exists. That is where machine notes go, such as the shell, where projects live or which tools are installed.
- **`rules/`** holds rules for every project. Claude Code reads them through `~/.claude/rules`; Codex and OpenCode reach them through the path that `AGENTS.md` mentions. Today there is one: [the commit convention](../rules/commit-conventions.md).
- **Settings:** Claude Code's and OpenCode's settings files. When the app changes a setting, see [Limits](troubleshooting.md#limits).
- **Left out on purpose:** `~/.codex/config.toml`. The Codex app writes machine-specific things into it (runtime paths with hashes, pipe names, trusted projects), so versioning it would break Codex on another machine.

A file already in place that dotagents didn't generate is kept next to the new one as `<file>.bak-<date>`.
