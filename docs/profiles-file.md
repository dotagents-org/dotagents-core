# The profiles file

`profiles.json` lists the Claude profiles of a machine: one per claude.ai account the person holds. It is the contract between the parts of dotagents that share the profiles: `dotagents profile add/remove` writes it, and everything else (installing the configuration into each profile's config folder, pointing each profile's memory at a workspace, `switch`, `usage`, the panel) reads it. Another tool that reads or writes it follows this page.

## Where

`profiles.json` in the machine's state folder: `$DOTAGENTS_STATE_DIR`, or `$XDG_CONFIG_HOME/dotagents`, or `~/.config/dotagents`. No file means no profiles: only `~/.claude` is configured.

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
| `version` | number | The format, `1`. |
| `profiles` | array | The profiles, in the order they were added. |
| `name` | string | The profile's name: lowercase letters, digits and dashes. Unique. |
| `configDir` | string | Its Claude Code config folder, an absolute path. Today every profile uses `~/.claude`. |
| `color` | string | Its color, `#RRGGBB`. |
| `default` | boolean, optional | `true` on the profile the normal Claude Desktop app opens; at most one. Absent otherwise. |

## Rules

- A reader takes only the fields above and ignores any other.
- A file whose `version` is higher than the reader knows is not read: the reader stops and says to update. A file that isn't valid JSON, or has an entry without `name`, `configDir` or `color` as strings, stops it too. Neither is ever read as empty and overwritten.
- A writer writes the whole file, `version` first, with two-space indentation and a final newline.
- A change a version 1 reader would misread raises `version`.
