# Claude Code transcript schema (empirically observed)

Source: `~/.claude/projects/<project-slug>/<session-id>.jsonl`, one JSON
object per line, chronological. `<project-slug>` is the session's absolute
`cwd` at start with each `/` replaced by `-` (leading slash included).
Observed against CLI version 2.1.272; re-check this file first if
`archive_session.py` starts silently producing empty fields after a CLI
upgrade.

## Top-level `type` values seen

`mode`, `permission-mode`, `ai-title`, `user`, `assistant`, `file-history-snapshot`,
`last-prompt`, `attachment`, `atis-latch`.

## Fields present on most lines

- `sessionId` / `session_id` — the session UUID (matches the filename).
- `cwd` — absolute working directory at the time of that line.
- `gitBranch`, `version` (CLI version), `entrypoint` (`cli`, `vscode`, ...),
  `userType`, `timestamp` (ISO 8601, UTC).
- `uuid` / `parentUuid` — this line's id and its parent, forming a tree
  (branches happen on context edits/rewinds).
- `isSidechain` — `true` for lines belonging to a spawned subagent's own
  nested conversation (see below), not the main thread.

## `type: "user"` — two different shapes

1. **Genuine human turn**: `message.content` is a plain string (or a list of
   `text`/image blocks) and the line has **no** `toolUseResult` key.
2. **Tool-result echo**: `message.content` is a list of `tool_result` blocks
   and the line **has** a `toolUseResult` key with the tool's structured
   output. Do not count these as human turns.

## `type: "assistant"`

- `message.model` — the exact model id (e.g. `claude-sonnet-5`).
- `effort` — the reasoning effort for that turn (`low`/`medium`/`high`/
  `xhigh`/`max`); `perTurnEffort` overrides it when a per-turn effort was
  set explicitly.
- `message.content` is a list of blocks: `text` (assistant prose) and
  `tool_use` (`name`, `input`, `id`). `message.usage` carries token counts
  (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, etc.).

## Subagents (Task tool)

A subagent spawn is a `tool_use` block with `name` in `("Task", "Agent")` and
`input.subagent_type` (e.g. `"Plan"`, `"general-purpose"`, `"Explore"`,
`"fork"`); when absent, the invocation defaulted to `general-purpose`. The
subagent's own turns are appended later in the **same file** with
`isSidechain: true` and a `parentUuid`/`sourceToolAssistantUUID` linking back
to the spawning tool call. `archive_session.py` skips sidechain lines; the
spawn only appears as a tool line in the parent's transcript.

## Other line types worth knowing about

- `ai-title` — `aiTitle` field holds a short auto-generated session title.
- `file-history-snapshot` — undo/redo checkpoints, not conversational content.
- `last-prompt` — bookkeeping for prompt resumption, not conversational content.
- `attachment` — a pasted/dropped file; check `attachment` payload if you need
  to enumerate what the user attached.

## Session id without a transcript match

If `--session-id` is passed but no `<id>.jsonl` exists yet under
`~/.claude/projects/*/`, the session may not have flushed to disk, or it was
run with a different `$HOME`/config dir — pass `--claude-home` explicitly.
