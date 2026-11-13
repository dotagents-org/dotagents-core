# Global instructions

These apply to Claude Code on this machine. The source is `global/instructions.md` in your dotagents configuration, at `{{AGENTS_CONFIG}}`. Edit it there and run `dotagents install` again, not in the copies.

## Workspaces

Projects with `AGENTS.md`, `.agents/` and `.artifacts/` at the root follow the standards in `{{AGENTS_REPO}}/standards/` (`agents.md` and `artifacts.md`). Skills enter each workspace as links: the ones dotagents brings, from `{{AGENTS_REPO}}/skills/`, and yours, from `{{AGENTS_CONFIG}}/skills/`. Edit them where they live, not through the link.
