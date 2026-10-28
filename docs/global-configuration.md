# Global configuration

`dotagents install` writes:

| From | To | How |
|---|---|---|
| `global/instructions.md` + `global/env/<platform>.md` | `~/.claude/CLAUDE.md` | generated file |
| `rules/` | `~/.claude/rules` | folder link |
| `claude/settings.json` | `~/.claude/settings.json` | link on Linux and macOS, copy on Windows |

- **`global/instructions.md`** holds the global instructions: language, commit convention, how workspaces work. It has no machine paths. `{{AGENTS_REPO}}` becomes the clone's location, and the file for the current platform (`env/win32.md`, `env/linux.md`, `env/darwin.md`) is appended when it exists. That is where machine notes go, such as the shell, where projects live or which tools are installed.
- **`rules/`** holds rules for every project. Claude Code reads them through `~/.claude/rules`. Today there is one: [the commit convention](../rules/commit-conventions.md).
- **Settings:** Claude Code's settings file. When the app changes a setting, see [Limits](troubleshooting.md#limits).

A file already in place that dotagents didn't generate is kept next to the new one as `<file>.bak-<date>`.
