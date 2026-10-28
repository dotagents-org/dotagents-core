---
name: move-sessions
description: Makes past Claude Code conversations follow a project folder that moved, so Claude Code lists them again from the new folder. Use when a project folder was moved or renamed, a repository went into a workspace folder, or the user wants old sessions to show up under a new path.
compatibility: Claude Code. Node 18+.
metadata:
  version: "3.0.0"
---

# Move sessions

Claude Code remembers which folder a conversation belongs to, and lists only the conversations of the folder it is opened in. When the folder moves, the conversations stay attached to the old path. The script [`scripts/move-sessions.mjs`](scripts/move-sessions.mjs) reattaches them.

Conversations live in `~/.claude/projects/<path with non-alphanumerics turned into ->/<id>.jsonl`. The script moves transcripts, session folders and memory to the new folder's project, and rewrites `cwd` in the transcripts.

Only `cwd` fields are rewritten, parsed as JSON: message text that mentions the old path stays as it was. Every spelling of the old path is covered (both drive-letter cases, forward slashes, Git Bash's `/c/…`, Windows' `\\?\` prefix), and each keeps its style.

## Steps

1. **Pin the folders.** `--from` is the folder the conversations were started in (it may no longer exist); `--to` is where they belong now. When the old folder's *subfolders* now live somewhere else than `--to` (a repository moved into a workspace: its root maps to the workspace, its subfolders to the repository inside it), pass that place as `--subdirs-to`. **Across systems** (Windows to WSL, or another machine), run the script on the destination and pass the source's Claude Code folder as `--from-claude-dir` (`/mnt/c/Users/<you>/.claude` from WSL); `--from` can then stay a Windows path (`D:\work\app`), and every spelling of it becomes the destination path. Done when you can name all the paths.

2. **Dry run.**

   ```bash
   node <this skill>/scripts/move-sessions.mjs --from "<old>" --to "<new>" [--subdirs-to "<dir>"] [--from-claude-dir "<dir>"] --dry-run
   ```

   Done when the output lists the conversations you expect with a non-zero count of rewritten paths, and the user agrees.

3. **Close Claude Code.** An open session keeps writing to the old place, and the script refuses to touch a transcript changed in the last 10 seconds. When the current session is one of those being moved, hand the command to the user to run after closing it, and stop here.

4. **Run it** without `--dry-run`. Done when it reports its changes and no error.

5. **Run it once more, after a minute.** Claude Code writes title, last prompt and cost records to the old project when a session closes, sometimes after the move. A second run merges those lines into the moved transcripts. Done when the second run has nothing left to move.

6. **Check** from the new folder: `claude --resume` shows the conversations.

## Gotchas

- Per-folder settings are not moved: trust and allowed tools (`~/.claude.json`). Claude Code may ask for trust again in the new folder.
- Notes that mention the old path in plain text (memory files, instructions) keep saying it: update them by hand.
- The data location can be overridden with `CLAUDE_CONFIG_DIR`, which is also how the script is tested against temporary folders.
- In shell cleanups, write paths literally or as `"${VAR:?}"`: Claude Code's safety check blocks `rm "$VAR"/…`.
