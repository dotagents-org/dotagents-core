# Security

dotagents touches your Claude logins, so this page says where they are, who can read them and what leaves the machine. In short: nothing is sent anywhere except to Anthropic, there is no telemetry, and the logins stay in files only you can read.

## Where the logins are

| What | Where | Who writes it |
|---|---|---|
| The login Claude Code uses on this side | `~/.claude/.credentials.json` (on macOS, the keychain) | Claude Code; `dotagents switch` puts a profile's login there |
| Each profile's login, for the switch | `<state>/vault/<profile>/credentials.json` and `account.json` (`<state>` is `~/.config/dotagents`) | `dotagents switch --save`, and `switch` when Claude Code renewed a token |
| The login Codex uses on this side | `~/.codex/auth.json` (or `$CODEX_HOME`) | Codex; `dotagents switch` puts a Codex profile's login there |
| Each Codex profile's login | `<state>/vault/<profile>/auth.json` | `dotagents switch --save`, and `switch` when Codex renewed the token |
| The local API's address and token | `<state>/start.json` | `dotagents start`, taken away when it stops |

The vault keeps one copy per profile and per side: WSL's and Windows' are separate files, each written on its own side. To show the other side's accounts, one side reads the other's vault through the shared drive (`/mnt/c` from WSL, `\\wsl.localhost` from Windows); nothing goes over the network for that.

On Linux, WSL and macOS, the vault, `start.json`, the usage records and the logs are written with mode `600` (folders `700`), in one step, so another user on the machine can't read them and no reader ever sees half a file. On Windows these modes don't apply: the files are protected by your user profile's permissions, as everything else in `%USERPROFILE%` is.

## What goes over the network

| To | When | What |
|---|---|---|
| `api.anthropic.com/api/oauth/usage` | `dotagents start` (once a minute per profile, at most), `usage --refresh` | each profile's access token, to read its plan's usage |
| `platform.claude.com/v1/oauth/token` | when a profile's token is about to expire | its refresh token, to renew the login |
| Anthropic, through the `claude` command or your API key | `dotagents revision on` only (off by default) | the message you sent, to proofread it |
| GitHub and npm | `update` (`git pull`), `skills add` (`npx skills`) | nothing of yours: they download code |

The two requests to Anthropic's OAuth endpoints say who makes them: `User-Agent: dotagents/<version>`, never another client's name.

Nothing else: no analytics, no crash reports, no update check of the tool itself.

## The local API

`dotagents start` serves the accounts to the dotagents sidebar. It listens only on `127.0.0.1`, answers only requests addressed to itself (so a web page can't reach it by DNS rebinding), and nothing without the random token in `start.json`, which a request carries in a header, never in the address. Three actions write (switch, open the Desktop, refresh); the rest only reads. See [`dotagents start`](commands.md#dotagents-start).

## Logs

The logs (`<state>/logs/`) mask every token before writing: `sk-ant-…` keys, `accessToken` and `refreshToken` values, the API's token header and `Bearer` tokens. A test writes each of them and fails if one reaches a file. See [Logs](logs.md).

## What dotagents never does

- Switch accounts by itself: the switch is always yours.
- Share a login with another person or machine: each profile is a claude.ai account you hold.
- Commit, push or add a remote to your workspace's history, or put agent files in your projects' repositories.
