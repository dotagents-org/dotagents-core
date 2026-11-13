---
name: session-archive
description: |
  Write a direct, readable transcript of the current (or a named past)
  Claude Code session to
  .artifacts/session-archives/<date>-<session-id>.md: every user message and
  assistant reply verbatim, plus one line per tool call. Use when asked to
  archive, log, save, or transcribe a session.
metadata:
  version: "5.0.0"
---

# Session Archive

Generates one Markdown file per session:

```
.artifacts/session-archives/<date>-<session-id>.md
```

The script reads Claude Code's local transcript:
`~/.claude/projects/<project-slug>/<session-id>.jsonl`.

Contents, in chronological order:

- **User messages**, verbatim. Injected context is stripped:
  `<system-reminder>` blocks and local-command lines.
- **Assistant replies**, verbatim.
- **Tool calls**, one line each (`name` - description/command/path), marked
  **(error)** when the call failed. Tool results are omitted, except the
  user's answers to `AskUserQuestion`, listed under that call.
- **Header** with agent, account, model, dates, duration, effort, turns, tool
  calls, tokens, and, when the transcript has it, cost.
- **Account**: the claude.ai account that ran the session, named after its
  dotagents profile when there is one (`turing (me@example.com)`). A session
  that went on after the login changed lists the others too (`also used by
  ...`). Transcripts from older Claude Code versions don't record it:
  `unknown`.
- **Files changed** (whole session) at the end: files touched by the edit
  tools (Edit/Write), plus files changed outside them. Changes made only
  through shell commands (`mv`, `rm`, `sed`, new files) are not detected.
- Subagent internals (sidechains) are omitted; the spawning call shows up as
  a tool line.

## How to run it

1. Find the session id: the UUID in your scratchpad directory path; it
   matches the transcript filename.
2. Run the script with Node 22.18 or newer, which runs TypeScript directly.
   It needs no packages.

   ```bash
   node .agents/skills/session-archive/scripts/archive-session.ts --session-id <session-id>
   ```

   Without `--session-id`, the script picks the most recently modified
   session whose working directory is inside the project root. To force a
   file, pass `--transcript /path/to/session.jsonl`. The transcripts are read
   from `CLAUDE_CONFIG_DIR` when it is set, else `~/.claude`; `--claude-home`
   overrides both.
3. Tell the user where the file landed.

Re-running overwrites the file, so it is safe to run mid-session and again at
the end.

`dotagents sessions rm` imports this script's parser and writes the same file
before it deletes a session, so a change to the script's exports has to keep
dotagents working (`npm test` in the dotagents repository covers both).

## Caveats

- The transcript is unredacted: anything typed during the session, secrets
  included, ends up in the file. `.artifacts/` is untracked by this
  workspace's convention; if that changes, flag it before committing.
- Claude Code does not document its transcript format, so an update can break
  the parser. If the output looks wrong, check
  [references/claude-transcript-schema.md](references/claude-transcript-schema.md).
