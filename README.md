# dotagents

My coding agent configuration (Claude Code, Codex and OpenCode) in one place: global instructions and rules, skills, the `.agents/` and `.artifacts/` folder standards, and the `agents` command that applies all of it to a machine and to each workspace. Works on Windows, Linux and macOS.

## Layout

```
agents/
├── AGENTS.md                # global instructions, apply in any folder
├── env/                     # machine notes appended to AGENTS.md per platform (win32.md, linux.md…)
├── rules/                   # global rules (e.g. commit convention)
├── standards/
│   ├── agents.md            # the .agents/ folder standard for a workspace
│   └── artifacts.md         # the .artifacts/ folder standard for a workspace
├── skills/                  # my reusable skills (Agent Skills format)
├── templates/workspace/     # templates for AGENTS.md and INDEX.md
├── claude/settings.json     # ~/.claude/settings.json
├── opencode/opencode.json   # ~/.config/opencode/opencode.json
├── cli.mjs                  # the `agents` command
├── lib/                     # its modules (global, workspace, registry, common)
└── package.json
```

The command only needs Node 18.17+, with no dependencies.

## Setup (once per machine)

```bash
git clone git@github.com:gabrieldulolmarques/dotagents.git
cd dotagents
npm link          # makes the `agents` command point to this clone
agents install    # global instructions, rules and settings
```

`npm link` doesn't copy anything: the command runs from the clone, so every link it creates points to the clone, and editing the clone takes effect right away. Without `npm link`, use `node cli.mjs <command>` from the clone.

On Linux with Node from the system package manager, `npm link` may need `sudo`. To avoid it, point npm's global folder to your home first: `npm config set prefix ~/.local` (and have `~/.local/bin` on the PATH).

## Commands

| Command | What it does |
|---|---|
| `agents install` | applies the global configuration to this machine |
| `agents init [path] --skills a,b` | applies the standards to a workspace and links skills from this repository |
| `agents check [path]` | runs the standards checklist on a workspace, changing nothing |
| `agents update` | `git pull` in the clone, then `install` |
| `agents update --all` | also refreshes every workspace set up with `init` and runs `npx skills update` in the ones with third-party skills |
| `agents skills` | lists the skills in this repository |
| `agents workspaces` / `agents forget <path>` | lists the workspaces set up with `init` on this machine / removes one from the list |

Every command accepts `--dry-run`. Any file a command replaces is kept next to it as `.bak-<date>`, and running a command again only changes what is out of place.

## Two kinds of skills

| | My skills | Third-party skills |
|---|---|---|
| Source | `skills/` in this repository | the author's repository |
| Tool | `agents init --skills` | `npx skills add` ([skills.sh](https://skills.sh)) |
| In the workspace | link to the clone | folder copied into `.agents/skills/` + `skills-lock.json` |
| Update | edit the clone (immediate) or `agents update` on another machine | `npx skills update -p` (or `agents update --all`) |
| Edit by hand | yes, in the clone | no: the next update undoes it |

Both live in the workspace's `.agents/skills/`, which Codex and OpenCode read directly and Claude Code reads through the `.claude/skills` link:

```
workspace/
├── skills-lock.json                  ← npx skills: third-party only
├── .agents/skills/
│   ├── session-archive → <clone>/skills/session-archive    (agents init)
│   └── humanizer/                                           (npx skills add)
└── .claude/skills → .agents/skills                          (agents init)
```

## Workflows

**New workspace**
```bash
agents init ~/projects/app --skills session-archive,map-source-files
cd ~/projects/app
npx skills add blader/humanizer      # always from the workspace root
agents check ~/projects/app
```

**Edit one of my skills**
```bash
# edit <clone>/skills/<name>/  → already live in every workspace on this machine
git commit -am "✨ feat(<name>): ..." && git push
agents update                        # on the other machine
```

**Update everything on this machine**
```bash
agents update --all
```

**New machine**
```bash
git clone git@github.com:gabrieldulolmarques/dotagents.git && cd dotagents && npm link && agents install
agents init <workspace> --skills ...         # links don't travel with the files
cd <workspace> && npx skills experimental_install   # restore third-party skills from the lock
```

**Adopt a third-party skill as mine** (to change it): `npx skills remove <name>` in the workspace, copy it to `skills/<name>/` here keeping its license, then `agents init <workspace> --skills <name>`. From then on it no longer gets the author's updates.

## What `install` and `init` touch

`agents install`:

| What | Where to | How |
|---|---|---|
| `AGENTS.md` + `env/<platform>.md` | `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md` | generated file |
| `rules/` | `~/.claude/rules` | folder link |
| `claude/settings.json` | `~/.claude/settings.json` | file link (copy on Windows) |
| `opencode/opencode.json` | `~/.config/opencode/opencode.json` | file link (copy on Windows) |

`AGENTS.md` has no machine paths: `{{AGENTS_REPO}}` becomes the clone's location, and the file for the current platform in `env/` is appended when it exists. Run `agents install` again after editing `AGENTS.md` or `env/`, and on Windows also after editing the settings.

`agents init` creates only what is missing and never overwrites your content:

- `AGENTS.md` and `INDEX.md` from the templates;
- `CLAUDE.md` with `@AGENTS.md`;
- `.agents/README.md` and `.artifacts/README.md` pointing to `standards/`;
- one `.agents/skills/<name>` link per skill;
- `.claude/skills` and `.claude/rules` as links to `.agents/` (relative on Linux and macOS).

It also records the workspace and its skills in `~/.config/agents/workspaces.json`, for `agents update --all`.

`agents check` covers the standards' checklists and the skills:

- `AGENTS.md` size and `CLAUDE.md` first line;
- real links, not copied folders;
- each skill's `name` matching its folder;
- my skills linked, not copied, and not also in the lock;
- every skill in `skills-lock.json` installed;
- rules linked from `AGENTS.md`;
- forbidden folders;

## My skills

| Skill | What it does |
|---|---|
| [obsidian-docs](skills/obsidian-docs/SKILL.md) | Answers questions about Obsidian from the official help, the plugin and theme directory, and the forum. |
| [session-archive](skills/session-archive/SKILL.md) | Writes the Claude Code session transcript to `.artifacts/session-archives/`. |
| [map-source-files](skills/map-source-files/SKILL.md) | Builds a File / Location / Responsibility table of a repository's source files. |
| [to-cards](skills/to-cards/SKILL.md) | Turns loose text (message, email, meeting notes) into task cards. |
| [llm-wiki](skills/llm-wiki/SKILL.md) | Maintains a Markdown wiki fed by sources (`raw/` → `wiki/`), with ingest, query and lint. |

They follow the [Agent Skills specification](https://agentskills.io/specification), and the writing rules are in [standards/agents.md](standards/agents.md#skills).

## CI

- **Validate skills:** runs [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) on every push that touches `skills/`. Locally:
  ```bash
  PYTHONUTF8=1 uvx --from "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref" skills-ref validate skills/<name>
  ```
- **Test scripts:** on Linux, Windows and macOS, runs `npm link` and every command, checks that a second run changes nothing, that a new workspace passes `agents check`, and that third-party skills from `npx skills` coexist with the linked ones.

## Limits

- **Windows:** file symlinks require administrator rights or Developer Mode, so files are copied and folders become junctions. Junctions store absolute paths: if this repository or a workspace moves, run `agents init` again.
- **Settings change from inside the apps.** On Windows, a setting changed in Claude Code or OpenCode makes the machine's copy differ from the repository's, and the next install backs it up before overwriting. To keep the change, copy the file back here and commit. On Linux and macOS the apps write through the link, so check `git diff`.
- **`~/.codex/config.toml` is left out.** The Codex app writes machine-specific things into it: runtime paths with hashes, pipe names and trusted projects.
- **`npx skills experimental_install`** is how the skills CLI (1.7) restores from the lock; the name may change in later versions.
