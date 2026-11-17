# The profiles file

`profiles.json` lists the profiles of a machine: one per account the person holds, a Claude account or, from version 2, a ChatGPT one for Codex. It is the contract between the parts of dotagents that share the profiles: `dotagents profile add/remove` writes it, and everything else (installing the configuration into each profile's config folder, pointing each profile's memory at a workspace, `switch`, `usage`, `start`) reads it. Another tool that reads or writes it follows this page.

## Where

`profiles.json` in the machine's state folder: `$DOTAGENTS_STATE_DIR`, or `$XDG_CONFIG_HOME/dotagents`, or `~/.config/dotagents`. `install` can configure both agents without a profiles file.

## Format

```json
{
  "version": 1,
  "profiles": [
    { "name": "work", "configDir": "/home/me/.claude", "color": "#D77655", "default": true },
    { "name": "personal", "configDir": "/home/me/.claude", "color": "#376B80" }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `version` | number | The format: `1`, or `2` when a profile has a `provider` other than `claude`. |
| `profiles` | array | The profiles, in the order they were added. |
| `name` | string | The profile's name: lowercase letters, digits and dashes. Unique. |
| `configDir` | string | The agent's config folder, an absolute path. Claude profiles use `~/.claude`; ChatGPT profiles use `$CODEX_HOME` or `~/.codex`. |
| `color` | string | Its color, `#RRGGBB`. |
| `default` | boolean, optional | `true` on the profile the normal Desktop app of its provider opens (Claude Desktop, or the ChatGPT app); at most one per provider. Absent otherwise. |
| `provider` | string, optional | Whose account it holds and which agent's login slot it switches: `claude` (a Claude account, for Claude Code) or `codex` (a ChatGPT account, for Codex). Absent means `claude`, and a writer leaves it out for a Claude profile. |

## Rules

- A reader takes only the fields above and ignores any other.
- A file whose `version` is higher than the reader knows is not read: the reader stops and says to update. A file that isn't valid JSON, or has an entry without `name`, `configDir` or `color` as strings, stops it too. Neither is ever read as empty and overwritten.
- A writer writes the whole file, `version` first, with two-space indentation and a final newline.
- A change a version 1 reader would misread raises `version`. A ChatGPT profile is one: a version 1 reader would take it for a Claude one. So a writer writes `2` only when the file holds a ChatGPT profile, and `1` otherwise, which every reader still reads.
- A reader that works only on Claude Code's files (the configuration, the memory, the Claude logins and usage) skips the profiles whose `provider` isn't `claude`.
