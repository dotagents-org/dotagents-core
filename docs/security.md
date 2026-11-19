# Security

dotagents handles Claude and ChatGPT logins. Credentials go only to their provider (Anthropic or OpenAI); the local files are private and there is no telemetry.

## Where the logins are

| What | Where | Who writes it |
|---|---|---|
| The login Claude Code uses on this side | `~/.claude/.credentials.json` (on macOS, the keychain) | Claude Code; `dotagents switch` puts a profile's login there |
| Each profile's login, for the switch | `<state>/vault/<profile>/credentials.json` and `account.json` (`<state>` is `~/.config/dotagents`) | `dotagents switch --save`, and `switch` when Claude Code renewed a token |
| The login Codex uses on this side | `~/.codex/auth.json` (or `$CODEX_HOME`) | Codex; `dotagents switch` puts a ChatGPT profile's login there |
| Each ChatGPT profile's login | `<state>/vault/<profile>/auth.json` | `dotagents switch --save`, and `switch` when Codex renewed the token |
| The local API's address and token | `<state>/start.json` | `dotagents start`, taken away when it stops |

The vault keeps one copy per profile and per side: WSL's and Windows' are separate files, each written on its own side. To show the other side's accounts, one side reads the other's vault through the shared drive (`/mnt/c` from WSL, `\\wsl.localhost` from Windows); nothing goes over the network for that.

On Linux, WSL and macOS, the vault, `start.json`, the usage records and the logs are written with mode `600` (folders `700`), in one step, so another user on the machine can't read them and no reader ever sees half a file. On Windows these modes don't apply: the files are protected by your user profile's permissions, as everything else in `%USERPROFILE%` is.

## What goes over the network

| To | When | What |
|---|---|---|
| `api.anthropic.com/api/oauth/usage` | `dotagents start` (once a minute per profile, at most), `usage --refresh` | each profile's access token, to read its plan's usage |
| `platform.claude.com/v1/oauth/token` | when a profile's token is about to expire | its refresh token, to renew the login |
| Anthropic, through the `claude` command or your API key | `dotagents revision on` only (off by default) | the message you sent, to proofread it |
| OpenAI, through the official `codex app-server` | `dotagents start` (once a minute per profile, at most), `usage --refresh` | Codex uses the account login to read ChatGPT usage and renew it when needed |
| GitHub and npm | `update` (`git pull`), `skills add` (`npx skills`) | nothing of yours: they download code |

The two requests to Anthropic's OAuth endpoints say who makes them: `User-Agent: dotagents/<version>`, never another client's name.

Nothing else: no analytics, no crash reports, no update check of the tool itself.

## The local API

`dotagents start` serves the accounts to the dotagents sidebar. It listens only on `127.0.0.1`, answers only requests addressed to itself (so a web page can't reach it by DNS rebinding), and nothing without the random token in `start.json`, which a request carries in a header, never in the address. Three actions write (switch, open the Desktop, refresh); the rest only reads. See [`dotagents start`](commands.md#dotagents-start).

## The compile cache

The command keeps Node's compile cache in this user's own cache folder (`~/.cache/dotagents/compile-cache`, `%LOCALAPPDATA%\dotagents\compile-cache` on Windows), never in the temporary folder, Node's default: on Linux that one is shared, and another account could plant code there for dotagents to run. The folder is created for the user alone, and when it belongs to someone else or others can write to it, the command runs without the cache. A dry run leaves the cache off. See [Commands](commands.md).

## Logs

The logs (`<state>/logs/`) mask every token before writing: `sk-ant-…` keys, `accessToken` and `refreshToken` values, the API's token header and `Bearer` tokens. A test writes each of them and fails if one reaches a file. See [Logs](logs.md).

## Several accounts and the providers' terms

dotagents works with a single account. The configuration, the workspaces, the usage and the sidebar are the same with one profile, and adding a second one is your choice. It is meant for one person who pays for several seats in their own name, such as two seats on a team plan. It never shares a login between people, and the switch is always manual: dotagents never changes account by itself, and never because a usage window filled up.

Each seat stays under its provider's terms, and you are the one bound by them. Read them before adding a second account:

- **Anthropic:** the [Usage Policy](https://www.anthropic.com/legal/aup), the [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) for Team and Enterprise seats, and the [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) for Pro and Max.
- **OpenAI**, for Codex: the [Services Agreement](https://openai.com/policies/services-agreement/) for ChatGPT Business and Enterprise seats, the [Usage Policies](https://openai.com/policies/usage-policies/), and the [Terms of Use](https://openai.com/policies/terms-of-use/) for individual plans.

Both forbid sharing a login between people. OpenAI's Services Agreement also forbids circumventing usage limits or configuring the service to avoid them. If your provider says one person may not hold several seats for the same work, keep one account.

## What dotagents never does

- Switch accounts by itself: the switch is always yours.
- Share a login with another person or machine: each profile is a Claude or ChatGPT account you hold.
- Commit, push or add a remote to your workspace's history, or put agent files in your projects' repositories.
