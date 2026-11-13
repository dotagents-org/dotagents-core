# An example configuration

A starting point for your own dotagents configuration. Copy this folder into a repository of your own, named `dotagents-config` and cloned next to `dotagents-core` (or anywhere, with `DOTAGENTS_CONFIG`), and make it yours. The tests and the CI run against it.

| Folder | What it is |
|---|---|
| `global/` | The global instructions, with `{{AGENTS_CONFIG}}` (this folder) and `{{AGENTS_REPO}}` (the dotagents-core clone); `env/<platform>.md` (`linux`, `win32`, `darwin`) is appended when present. |
| `rules/` | The rules `~/.claude/rules` links to. |
| `claude/` | Claude Code's `settings.json`, and the keys of `~/.claude.json` to keep in sync (`global-config.json`). |
| `skills/` | Your own skills, one folder each with a `SKILL.md`, and the third-party catalog (`third-party-skills.json`, filled by `dotagents skills add`). |
| `assets/` | Optional: each profile's Claude Desktop icon, `claude-<profile>.ico`. |
