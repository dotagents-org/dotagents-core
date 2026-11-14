---
name: session-archive
description: Archive a Claude Code session to .artifacts/session-archives/<date>-<session-id>.md. Use when asked to archive, log, save or transcribe a session.
metadata:
  version: "7.0.0"
---

# Session Archive

Run the script and reply with the file path, nothing else. The session id is the UUID in your scratchpad directory path.

```bash
node .agents/skills/session-archive/scripts/archive-session.ts --session-id <session-id>
```

Re-running overwrites the file. The transcript is unredacted, secrets included. Options and the format of the output: the header of `scripts/archive-session.ts`.
