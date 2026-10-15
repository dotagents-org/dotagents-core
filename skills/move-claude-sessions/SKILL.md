---
name: move-claude-sessions
description: Moves Claude Code conversations (transcripts, session folders, memory) to another folder's project, so `claude --resume` finds them there. Use when a project folder was moved or renamed, a repository went into a workspace folder, or the user wants past conversations to follow a project to a new path.
compatibility: Claude Code only. Requires Node 18+.
metadata:
  author: gabrieldulolmarques
  version: "1.0.0"
---

# Move Claude Code sessions

Claude Code keeps each folder's conversations in `~/.claude/projects/<name>/`, where `<name>` is the folder's path with every character that isn't a letter or digit turned into `-` (`D:\work\app` → `D--work-app`). Each transcript (`<session-id>.jsonl`) also records the working directory of every message. When the folder moves, the conversations stay behind under the old name and `--resume` no longer lists them. The script [`scripts/move-sessions.mjs`](scripts/move-sessions.mjs) moves them and rewrites the recorded directory.

## Steps

1. **Pin the two folders.** `--from` is the folder the conversations were started in (it may no longer exist); `--to` is where they should belong now. When the old folder's *subfolders* now live somewhere else than `--to` (a clone moved inside a workspace: its root maps to the workspace, its subfolders to the clone inside it), pass that place as `--subdirs-to`. Done when you can name all three paths.

2. **Dry run.**

   ```bash
   node <this skill>/scripts/move-sessions.mjs --from "<old>" --to "<new>" [--subdirs-to "<dir>"] --dry-run
   ```

   Done when the output lists every transcript you expect, each with a non-zero count of rewritten entries, and the user agrees.

3. **Close every session of the old folder, including this one if it runs there.** An open session keeps writing to its transcript in the old project, and the script refuses to run while a transcript changed in the last 10 seconds. When the current session is one of those being moved, hand the command to the user to run after `/exit` (or after closing the IDE panel), and stop here.

4. **Run it** without `--dry-run`. Done when it prints the new project and removes the old one.

5. **Run it once more, after a minute.** Claude Code writes title, last prompt and cost records to the old project when a session closes, sometimes after the move. A second run merges those lines into the moved transcripts and removes the old folder again. Done when the second run reports nothing to move.

6. **Check.** From the new folder, `claude --resume` lists the conversations with their titles. Memory notes that mention the old path still say so: update them by hand.

## What it touches

| Moved | How |
|---|---|
| `<id>.jsonl` | `"cwd"` rewritten: the old root becomes `--to`, its subfolders go under `--subdirs-to`; every other path stays. The native spelling, the other drive-letter case and Git Bash's `/d/…` are all covered. |
| `<id>/` | moved as is (tool results kept on disk) |
| `memory/` | merged: the newer copy of each note wins |

A conversation already in the new project is merged line by line, never overwritten, so running the script again is safe. Settings Claude Code keeps per folder in `~/.claude.json` (trust, allowed tools) are not moved: the new folder may ask for trust again. The script honors `CLAUDE_CONFIG_DIR`.

## Gotchas

- In shell cleanups, write paths literally or as `"${VAR:?}"`: Claude Code's safety check blocks `rm "$VAR"/…`.
- The old project folder can reappear after the move (the late records of step 5). It holds only small files; the second run takes care of it.
