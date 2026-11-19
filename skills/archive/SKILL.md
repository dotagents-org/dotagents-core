---
name: archive
description: Archive a Claude Code or Codex session to .artifacts/sessions/<date>-<session-id>.md. Use when asked to archive, log, save or transcribe a session.
metadata:
  version: "8.1.0"
---

# Archive

Run the script, then reply with the file's path and nothing else: relative to the workspace root (`.artifacts/sessions/<file>.md`), as plain text on a line of its own, with no backticks, quotes or label, so the terminal turns it into a link.

In Claude Code, the session id is the UUID in your scratchpad directory path:

```bash
node .agents/skills/archive/scripts/archive-session.ts --session-id <session-id>
```

In Codex, the conversation's id is in `$CODEX_THREAD_ID`:

```bash
node .agents/skills/archive/scripts/archive-session.ts --agent codex --session-id "$CODEX_THREAD_ID"
```

Re-running overwrites the file. The transcript is unredacted, secrets included. Options and the format of the output: the header of `scripts/archive-session.ts`.
