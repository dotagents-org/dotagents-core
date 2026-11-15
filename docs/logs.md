# Logs

What runs on its own writes what it did to a file, so an error on either side of the machine can be read later, by you or by an agent. Nothing is sent anywhere.

## Where

One folder per side, `<stateDir>/logs/`:

| Side | Folder |
|---|---|
| Linux, WSL, macOS | `~/.config/dotagents/logs/` (or `$DOTAGENTS_STATE_DIR/logs/`) |
| Windows | `%USERPROFILE%\.config\dotagents\logs\`, which WSL reads at `/mnt/c/Users/<you>/.config/dotagents/logs/` |

One file per process:

| File | Written by |
|---|---|
| `core.log` | `dotagents start` and the commands |
| `sidebar.log` | the dotagents-sidebar extension |
| `host.log` | the sidebar's host process, which keeps the sessions running across window reloads |

[`dotagents logs`](commands.md#dotagents-logs) shows where they are on both sides and the last 50 lines of each.

## Format

This is the contract: the core and the sidebar each write it with a small writer of their own.

```
2026-11-13T15:53:52.881Z error start read: Error: profiles.json is not valid JSON
  at read (file:///.../surfaces/web/server.ts:49:30)
```

- One event per line: the time in UTC (ISO 8601), the level (`info` or `error`), the source, a colon and the message.
- What follows the first line (a stack, a command's output) comes under it, each line indented by two spaces.
- An error is written with its stack. A process that runs on its own writes when it starts (pid, version, the Node that runs it) and when it stops. A call to the other side of the machine is written when it fails, with the command, its exit code and its output. A failure that repeats (the other side not answering every 15 s) is written once, until it changes or works again. Successful reads are not written.
- Past 1 MB a file becomes `<name>.log.1`, replacing the one before, and starts again: at most 2 MB per process.
- The files are readable only by you (`600`).

## Credentials

Every line is masked before it is written: `sk-ant-…` keys, `accessToken` and `refreshToken` values, the `x-dotagents-token` header and `Bearer` tokens become `[redacted]`. A test writes each of them and fails if one reaches the file. Writing a log never stops the program: a file that can't be written is skipped.
