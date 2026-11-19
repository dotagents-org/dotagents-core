# The start API

`dotagents start` serves a local API, which the [dotagents sidebar](https://github.com/dotagents-org/dotagents-sidebar) reads: the accounts' usage, state and slots, and a few actions. This page is its contract. The command itself is in [Commands](commands.md#dotagents-start); the code is `surfaces/web/server.ts` (the server) and `core/accounts/snapshot.ts` (`startAnswer`, the data).

## Reaching it

- It listens on `127.0.0.1` only, on port 7337 or the next free one (`--port 0` picks any). The port, the token and the pid are in `<state>/start.json` (mode 0600), which is removed when the server stops; one server per side of the machine.
- A request must be addressed to `127.0.0.1:<port>` or `localhost:<port>`; anything else answers 403, so a page elsewhere can't reach it through DNS rebinding.
- Every `/api/` request needs the token. The header is `x-dotagents-token: <token>`; a GET (the events stream, which `EventSource` can't give a header) may also take `?token=`. Actions take the header only, since a URL ends up in logs and history. Without it: 401.
- Only `/api/` exists. Anything else is 404. Answers carry `cache-control: no-store`.

## Reads

| Request | Answers |
|---|---|
| `GET /api/usage` | The data below, as JSON. |
| `GET /api/events` | A `text/event-stream` of the same data. It sends `retry: 3000`, then one `event: usage` with `data:` the JSON at once, then another whenever something other than `generatedAt` changes (checked every 2 seconds), and a `: keepalive` comment every 15 seconds. |

Every answer and every event starts with `"apiVersion"` (see [The version rule](#the-version-rule)). When the data can't be read (a state file being written, a bad one), the answer is `{ "apiVersion": 2, "error": "<why>" }` and the server keeps running; the next read tries again.

## The data (apiVersion 2)

```json
{
  "apiVersion": 2,
  "version": 1,
  "generatedAt": "2026-11-16T12:00:00.000Z",
  "profiles": [
    { "name": "turing", "provider": "claude", "plan": "team", "color": "#D77655", "default": true,
      "state": "ok", "fetchedAt": "2026-11-16T11:59:10.000Z", "source": "live", "avatar": "ok", "working": false,
      "activity": { "working": 0, "waiting": 0 },
      "windows": [{ "kind": "session", "pct": 72, "resetsAt": "2026-11-16T15:17:00.000Z", "reset": false, "elapsedPct": 34,
                    "projection": { "atResetPct": 210, "runsOutAt": "2026-11-16T12:40:00.000Z" } }] },
    { "name": "hopper", "provider": "chatgpt", "plan": "team", "color": "#7B61A8",
      "state": "no-data", "fetchedAt": null, "windows": [], "avatar": "asleep", "working": false }
  ],
  "sides": ["WSL", "Windows"],
  "peer": { "name": "Windows", "up": true },
  "slots": { "claude": { "WSL": "turing", "Windows": "turing" }, "chatgpt": { "WSL": "hopper" } },
  "current": { "claude": { "profile": "turing", "state": "ok" }, "chatgpt": { "profile": "hopper", "state": "asleep" } }
}
```

Top level:

| Field | Meaning |
|---|---|
| `apiVersion` | The format of this answer; `2`. |
| `version` | The format of the usage data, the same as `usage --json`'s `version` (`1`). |
| `generatedAt` | When it was read, ISO. |
| `profiles` | Every profile, Claude's first, then Codex's. Within each provider, the one in this side's slot first, then the one in the other side's slot, then the rest in the order of `profiles.json`. |
| `sides` | The sides of the machine, this one first; one entry when no other side was found by `install`. |
| `peer` | The other side: `{ "name", "up" }`. Absent without one. When it is not `up` it isn't read at all, and WSL is never started for it. |
| `slots` | The profile in each side's slot, per provider: `{ "claude": { "<side>": "<profile>" }, "chatgpt": { ... } }`. Both keys are always there; a side with no known profile in its slot, or the other side while it is down, is left out. |
| `current` | The current account per provider, below. |

A profile:

| Field | Meaning |
|---|---|
| `name`, `color` | The profile's name and its `#RRGGBB` color. |
| `provider` | `claude` or `chatgpt`. |
| `plan` | The plan, or `null` when unknown. Claude: `subscriptionType` in the credentials Claude Code keeps next to the tokens (the slot's `.credentials.json` when the profile's account is there, else its vault's); only that field is read, and it is `null` where the credentials aren't in a file (the macOS keychain). Codex: the plan the live usage recorded, else `chatgpt_plan_type` in the id_token of the saved login. |
| `seat` | Claude only, and only when Claude Code keeps it with the login: the seat type of a Team or Enterprise plan (`seatTier` in `.claude.json`, such as `team_standard`), from the same copy as `plan`. Absent otherwise; OpenAI tells none. |
| `default` | `true` on the profile whose shortcut opens the provider's standard Desktop app on Windows. Absent on other profiles. |
| `state` | `ok`, `stale` (older than 6 hours), `no-data` (a login is saved, nothing was read yet), `not-signed-in` (no saved login) or `other-account` (the cache is of an earlier sign-in; Claude only). |
| `fetchedAt` | When the numbers were read, ISO, or `null`. |
| `windows` | The usage windows, empty when there are no numbers (never 0% made up). Each: `kind` (`session`, `week` or `model-week`, with `model`), `pct`, `resetsAt` (ISO or `null`), `reset` (the reset time has passed), `elapsedPct` (how much of the window has gone by) and `projection` (`{ atResetPct, runsOutAt? }`, `{ from }` while the window is young, or `null`). Codex has `session` and `week` only. |
| `avatar` | The state for the avatar: the most urgent of `error`, `limit`, `waiting`, `warn`, `ok`, `asleep`. |
| `working` | A session works on the profile (its avatar hops). Only a Claude profile can have it `true`. |
| `source` | `cache` (Claude Code's) or `live` (asked of Anthropic, or of `codex app-server`); present with numbers. |
| `from` | The other side's name, when the numbers came from there (Claude or ChatGPT). |
| `activity` | `{ working, waiting }`: the profile's running sessions, for a Claude profile whose login Claude Code is using, both sides counted. |
| `error` | Why the last live ask failed; the numbers shown are older than it. |

Nothing in the answer carries a token, an account id or the ChatGPT user id.

`current` is `{ "claude": { "profile", "state" } }` and, only when there is at least one ChatGPT profile, `"chatgpt"` with the same shape. Each provider picks the profile in a slot with the most urgent avatar state. When the states tie, the profile in this side's slot wins. With no profile of the provider in a slot, `profile` is the brand `"dotagents"`, in the most urgent state among all of that provider's profiles (`asleep` with none).

## Actions

`POST /api/<action>`, the token in the header, `content-type: application/json`, a JSON body of at most 4096 bytes. A GET on an action answers 405. Each answers `{ "apiVersion": 2, "ok": <bool>, "detail": "<text>" }` with the status below; a refusal before the action (401 token, 400 not JSON, 413 too big, 415 not JSON content type) is plain text. Only one switch or refresh runs at a time; the others wait.

| Action | Body | Does | Answers |
|---|---|---|---|
| `switch` | `{ "profile": "<name>", "side"?: "<side>" }` | [`switch`](commands.md#dotagents-switch) to the profile, Claude or Codex alike (its provider picks the slot). Without `side`, on both sides; with this side's name, `--here`; with the other side's name, only there, by running `dotagents switch <name> --here` on it. | 200 `now <name>` (`<side>: <name>` for the other side), with `next` when a slot changed: what to do after it, the line the `switch` command ends with (Claude's open conversations go on after `continue`; Codex sessions already open keep the old account until restarted); 404 `no such profile` or `no such side`; 502 with what failed (on the other side, why that side couldn't), and `next` when this side's slot changed before the other side failed; 409 when the switch itself refuses (the slot holds an account no profile knows, say). |
| `desktop` | `{ "profile": "<name>" }` | Opens the profile's Desktop app (Windows): Claude Desktop for a Claude profile, the ChatGPT app for a ChatGPT one. | 200; 404 `no such profile`; 409 when it can't open. |
| `refresh` | `{}` | Runs a usage update for both providers, subject to the normal interval and error backoff. | 200; 502 with each failure as `<target>: <why>`. |

The other side's switch needs a dotagents there that knows the profile: a ChatGPT profile switched on a side whose dotagents is older, or without that profile, answers 502 with that side's own message.

## The version rule

`apiVersion` is the format of what the server says, apart from `version` of the usage data inside it. A client that doesn't know the version it gets refuses it instead of misreading it. The number goes up only with a change an older client would misread; adding a field doesn't. Version 2 added the ChatGPT profiles, `plan`, and `slots` and `current` per provider: a client of version 1 would take a ChatGPT profile for a Claude one.
