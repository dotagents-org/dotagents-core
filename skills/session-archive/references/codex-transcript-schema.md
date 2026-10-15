# Codex transcript schema (as observed)

OpenAI documents that Codex keeps chats locally and can resume them by id
(`codex resume`), but not the file layout or JSONL format. Everything below
was observed on this machine in October 2026 (Codex VS Code extension and
TUI); treat it as unstable and check it again if the archive looks wrong.

## Location

```
$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<local-timestamp>-<session-id>.jsonl
```

`$CODEX_HOME` defaults to `~/.codex`. Each thread is its own file: subagents
spawned with `spawn_agent` get separate rollout files whose `session_meta`
has `thread_source: "subagent"` and a `parent_thread_id`. The script skips
them when picking the newest session.

## Records

Every line is `{"timestamp", "type", "payload"}`.

| `type` / `payload.type` | Used for |
|---|---|
| `session_meta` (first line) | `id`, `cwd`, `thread_source`; its presence marks the file as Codex |
| `turn_context` | `model`, `effort` |
| `event_msg` / `thread_settings_applied` | `thread_settings.model` |
| `event_msg` / `user_message` | The text the user typed. The IDE extension prepends `# Context from my IDE setup:` with open tabs; the script keeps what follows `## My request:` |
| `response_item` / `message`, role `user` | Older logs have no `user_message` event; the typed text is here, mixed with injected context (`# AGENTS.md instructions`, `<environment_context>`, `<skill>`, ...), which the script drops |
| `response_item` / `message`, role `assistant` | Replies (`output_text`), both progress notes and final answers |
| `response_item` / `function_call` | Tools with JSON `arguments` (`spawn_agent`, `wait_agent`, ...) |
| `response_item` / `custom_tool_call` | Tools with free-form `input`; `exec` holds JavaScript that calls `tools.exec_command({cmd: "..."})` or `tools.apply_patch("*** Begin Patch ...")` |
| `response_item` / `*_call_output` | Matched by `call_id`; an `exec` output that does not start with `Script completed` marks the call as an error |
| `event_msg` / `web_search_end` | Web searches (`query`) |
| `event_msg` / `token_count` | `info.total_token_usage` (cumulative) |

Reasoning items are encrypted (`encrypted_content`) and are not archived;
so are messages exchanged between subagents.
