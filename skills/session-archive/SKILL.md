---
name: session-archive
description: |
  Write a direct, readable transcript of the current (or a named past)
  Claude Code or Codex session to
  .artifacts/session-archives/<date>-<session-id>.md: every user message and
  assistant reply verbatim, plus one line per tool call. Use when asked to
  archive, log, save, or transcribe a session.
metadata:
  version: "3.0.0"
---

# Session Archive (Claude Code and Codex)

Generates one Markdown file per session:

```
.artifacts/session-archives/<date>-<session-id>.md
```

The script reads the agent's local transcript and detects its format:

| Agent | Transcript |
|---|---|
| Claude Code | `~/.claude/projects/<project-slug>/<session-id>.jsonl` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl` (or under `$CODEX_HOME`) |

Contents, in chronological order:

- **User messages**, verbatim. Injected context is stripped:
  `<system-reminder>` blocks and local-command lines in Claude Code; AGENTS.md,
  environment, skill text and the IDE's open-tabs preamble in Codex.
- **Assistant replies**, verbatim.
- **Tool calls**, one line each (`name` - description/command/path), marked
  **(error)** when the call failed. Tool results are omitted, except the
  user's answers to Claude Code's `AskUserQuestion`, listed under that call.
- **Header** with agent, model, dates, duration, effort, turns, tool calls,
  tokens, and, when the transcript has it, cost.
- **Files changed** (whole session) at the end: files touched by the edit
  tools (Claude Code's Edit/Write, Codex's `apply_patch`), plus, for Claude
  Code, files changed outside them. Changes made only through shell commands
  (`mv`, `rm`, `sed`, new files) are not detected.
- Subagent internals are omitted (Claude Code sidechains, Codex subagent
  threads); the spawning call shows up as a tool line.

## How to run it

1. Find the session id:
   - **Claude Code:** the UUID in your scratchpad directory path; it matches
     the transcript filename.
   - **Codex:** the id that `codex resume` shows, or the UUID at the end of
     the rollout filename.
2. Run from anywhere, with `uv` (it brings its own Python; on Windows a bare
   `python` may be the Microsoft Store stub):

   ```bash
   uv run --no-project python .agents/skills/session-archive/scripts/archive_session.py --session-id <session-id>
   ```

   Without `--session-id`, the script picks the most recently modified
   top-level session (Claude Code or Codex) whose working directory is inside
   the project root. To force a file, pass `--transcript /path/to/session.jsonl`.
3. Tell the user where the file landed.

Re-running overwrites the file, so it is safe to run mid-session and again at
the end.

## Caveats

- The transcript is unredacted: anything typed during the session, secrets
  included, ends up in the file. `.artifacts/` is untracked by this
  workspace's convention; if that changes, flag it before committing.
- Neither agent documents its transcript format, so an update can break the
  parser. If the output looks wrong, check
  [references/claude-transcript-schema.md](references/claude-transcript-schema.md)
  or [references/codex-transcript-schema.md](references/codex-transcript-schema.md).
- Codex encrypts its reasoning and the messages between subagents; they
  cannot be archived.
