---
name: session-archive
description: |
  Write a direct, readable transcript of the current (or a named past)
  Claude Code session to
  .artifacts/session-archives/<date>-<session-id>.md: every user message,
  proofread (spelling, punctuation, grammar) with the same meaning, every assistant
  reply verbatim, and one line per tool call. Use when asked to archive, log,
  save, or transcribe a session.
metadata:
  version: "6.0.0"
---

# Session Archive

Generates one Markdown file per session:

```
.artifacts/session-archives/<date>-<session-id>.md
```

The script reads Claude Code's local transcript:
`~/.claude/projects/<project-slug>/<session-id>.jsonl`.

Contents, in chronological order:

- **User messages**, proofread (spelling, punctuation, grammar), with the same
  meaning: by dotagents' prompt revision when it is on (`dotagents revision
  on` revises each message as it is sent, and the transcript keeps that
  version), else by you in step 3; verbatim when they need no change. Injected context is
  stripped: `<system-reminder>` blocks and local-command lines. The header
  says how many were revised.
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
3. Revise the user messages that are not revised yet. With dotagents' prompt
   revision on, there are usually none, and `--prompts` prints `[]`: skip to
   step 4. List them:

   ```bash
   node .agents/skills/session-archive/scripts/archive-session.ts --session-id <session-id> --prompts
   ```

   It prints `[{ "id", "text" }]`. Write a JSON object of `id` to revised
   text, only for the messages that change, to a file in your scratchpad, and
   apply it:

   ```bash
   node .agents/skills/session-archive/scripts/archive-session.ts --session-id <session-id> --revise <file>
   ```

   The revisions are saved next to the archive
   (`<date>-<session-id>.revisions.json`), so later runs, and the archive
   `dotagents sessions rm` writes, keep them, and `--prompts` lists only new
   messages.
4. Tell the user where the file landed.

Re-running overwrites the file, so it is safe to run mid-session and again at
the end; run steps 3 and 4 again for the messages since.

## Revising a user message

Follow [references/revision-rules.md](references/revision-rules.md): correct,
don't rewrite. Fix spelling, accents, punctuation, capitalization, small
grammar errors and chat abbreviations, by the rules of the message's own
language; never rephrase, reorder, add, remove or guess. dotagents' prompt
revision hook uses the same file. The rules follow the
[proof](https://skills.sh/ahgraber/skills/proof) skill,
[fix-grammar](https://claudskills.com/skills/fix-grammar/SKILL.md) (MIT) and
Anthropic's [Grammar genie](https://platform.claude.com/docs/en/resources/prompt-library/grammar-genie)
prompt.

## Caveats

- The transcript is unredacted: anything typed during the session, secrets
  included, ends up in the file. `.artifacts/` is untracked by this
  workspace's convention; if that changes, flag it before committing.
- Claude Code does not document its transcript format, so an update can break
  the parser. If the output looks wrong, check
  [references/claude-transcript-schema.md](references/claude-transcript-schema.md).
