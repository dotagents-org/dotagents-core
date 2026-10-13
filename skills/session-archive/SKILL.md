---
name: session-archive
description: |
  Write a direct, readable transcript of the current (or a named past)
  Claude Code session to .artifacts/session-archives/<date>-<session-id>.md:
  every user message and assistant reply verbatim, plus one line per tool
  call. Use when asked to archive, log, save, or transcribe this session.
metadata:
  version: "2.0.0"
---

# Session Archive (Claude Code)

Generates one Markdown file per session:

```
.artifacts/session-archives/<date>-<session-id>.md
```

Contents, in chronological order:

- **User messages**, verbatim (with `<system-reminder>` blocks and meta
  lines such as local-command caveats stripped).
- **Assistant replies**, verbatim.
- **Tool calls**, one line each (`name` - description/command/path), marked
  **(error)** when the call failed. Tool results are omitted, except the
  user's answers to `AskUserQuestion`, listed under that call.
- **Header** with model, dates, duration, effort, turns, tool calls, tokens,
  and, when the transcript has it, cost.
- **Files changed** (whole session) at the end: files touched by the edit tools, plus files
  changed outside them (by the user or by shell commands). Changes made only
  through shell commands (`mv`, `rm`, new files) are not detected.
- Subagent internals (sidechains) are omitted; the spawning call shows up as
  a tool line.

## How to run it

1. Your session id is the UUID in your scratchpad directory path; it matches
   the transcript filename under `~/.claude/projects/<project-slug>/`.
2. Run from anywhere. On this machine `python` is the Microsoft Store stub,
   so use `uv`:

   ```bash
   uv run --no-project python .agents/skills/session-archive/scripts/archive_session.py --session-id <your-session-id>
   ```

   Without `--session-id`, the script picks the most recently modified
   transcript whose `cwd` is inside the project root. For a different
   session, pass its id or `--transcript /path/to/session.jsonl`.
3. Tell the user where the file landed.

Re-running overwrites the file, so it is safe to run mid-session and again at
the end.

## Caveats

- The transcript is unredacted: anything typed during the session, secrets
  included, ends up in the file. `.artifacts/` is untracked by this
  workspace's convention; if that changes, flag it before committing.
- If a Claude Code update changes the JSONL format and output looks wrong,
  check [references/claude-transcript-schema.md](references/claude-transcript-schema.md).
