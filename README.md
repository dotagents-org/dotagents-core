# dotagents

My coding agent configuration (Claude Code, Codex and OpenCode) in one place: global instructions and rules, skills, the `.agents/` and `.artifacts/` folder standards, and the `dotagents` command that applies all of it to a machine and to each workspace. Works on Windows, Linux and macOS.

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
├── third-party-skills.json  # third-party skills I use, offered by init and new
├── templates/workspace/     # templates for AGENTS.md and INDEX.md
├── claude/settings.json     # ~/.claude/settings.json
├── opencode/opencode.json   # ~/.config/opencode/opencode.json
├── cli.mjs                  # the `dotagents` command
├── lib/                     # its modules (global, workspace, registry, common)
└── package.json
```

The command needs Node 20.12+ and two dependencies: [@clack/prompts](https://github.com/bombshell-dev/clack) for the terminal look and the questions, and picocolors for colors.

## Setup (once per machine)

```bash
git clone git@github.com:gabrieldulolmarques/dotagents.git
cd dotagents
npm install       # the two dependencies
npm link          # makes the `dotagents` command point to this clone
dotagents install    # global instructions, rules and settings
```

`npm link` doesn't copy anything: the command runs from the clone, so every link it creates points to the clone, and editing the clone takes effect right away. Without `npm link`, use `node cli.mjs <command>` from the clone. `dotagents update` runs `npm install` again when a pull changes the dependencies.

On Linux with Node from the system package manager, `npm link` may need `sudo`. To avoid it, point npm's global folder to your home first: `npm config set prefix ~/.local` (and have `~/.local/bin` on the PATH).

## Commands

| Command | What it does |
|---|---|
| `dotagents install` | applies the global configuration to this machine |
| `dotagents new <git-url> [folder]` | creates `<name>-workspace/`, clones the repository into it and applies the standards; agent files at the root, the repository in a subfolder (an existing workspace as folder adds one more repository) |
| `dotagents init [path] --skills a,b` | applies the standards to a workspace and links skills from this repository |
| `dotagents check [path]` | runs the standards checklist on a workspace, changing nothing |
| `dotagents update` | `git pull` in the clone, then `install` |
| `dotagents update --all` | also refreshes every workspace set up with `init` and runs `npx skills update` in the ones with third-party skills |
| `dotagents skills` | lists my skills and the registered third-party ones |
| `dotagents skills add <source> [--skills a,b]` or `--all` | registers third-party skills in `third-party-skills.json` (source: `owner/repo`, a git URL or a path) |
| `dotagents skills remove <name>` | unregisters a third-party skill (workspaces that installed it keep it) |
| `dotagents workspaces` | lists the workspaces set up with `init` on this machine |
| `dotagents untrack <path>` | stops tracking a workspace: removes it from that list, so `update --all` skips it. Its files are not touched |

Every command accepts `--dry-run`. Any file a command replaces is kept next to it as `.bak-<date>`, and running a command again only changes what is out of place. In a terminal, `init` without `--skills` asks for the folder (when none is given) and the skills, then confirms; `--yes` skips the questions, and they never appear in CI or when input is piped.

In a terminal, the output uses icons and colors (`+` created, `~` updated, `✓` ok, `!` skipped, `✗` failed) and short paths: relative to the workspace, or with `~` for the home folder. Paths can also be typed with `~`, even in PowerShell. When the output goes to a pipe or a file (CI, scripts), it switches to plain `<status> <path> (<detail>)` lines. `NO_COLOR` turns the colors off and `FORCE_COLOR` turns the terminal output on.

## Two kinds of skills

| | My skills | Third-party skills |
|---|---|---|
| Source | `skills/` in this repository | the author's repository |
| Registered in | — | `third-party-skills.json`, with `dotagents skills add <source>` |
| Tool | `dotagents init --skills` | `dotagents init --skills` too, which runs `npx skills add` ([skills.sh](https://skills.sh)) |
| In the workspace | link to the clone | folder copied into `.agents/skills/` + `skills-lock.json` |
| Update | edit the clone (immediate) or `dotagents update` on another machine | `npx skills update -p` (or `dotagents update --all`) |
| Edit by hand | yes, in the clone | no: the next update undoes it |

Both live in the workspace's `.agents/skills/`, which Codex and OpenCode read directly and Claude Code reads through the `.claude/skills` link:

```
workspace/
├── skills-lock.json                  ← npx skills: third-party only
├── .agents/skills/
│   ├── session-archive → <clone>/skills/session-archive    (dotagents init)
│   └── humanizer/                                           (npx skills add)
└── .claude/skills → .agents/skills                          (dotagents init)
```

## Workflows
**Register a third-party skill once** (it is then offered by `init` and `new` on every machine)
```bash
dotagents skills add blader/humanizer
dotagents skills add vercel-labs/agent-skills --skills web-design-guidelines,writing-guidelines
git commit -am "✨ feat(skills): register humanizer" && git push
```

**New workspace** (recommended layout: the workspace wraps the repositories, so they never see the agent files)
```bash
cd ~/projects
dotagents new git@github.com:me/app.git       # app-workspace/ with app/ inside; asks which skills to use,
                                              # yours and the registered third-party ones
dotagents new git@github.com:me/api.git app-workspace   # one more repository in the same workspace
cd app-workspace
dotagents init . --skills humanizer           # add a skill later, without questions
dotagents check                               # run the agents from here too
```

A third-party skill that isn't registered can still be installed by hand with `npx skills add <source>`, always from the workspace root.

```
app-workspace/        AGENTS.md, CLAUDE.md, .agents/, .artifacts/ (never committed anywhere)
├── app/              git clone, untouched
└── api/
```

For a folder that already exists, `dotagents init <path>` (asks the skills in a terminal) or `dotagents init <path> --skills a,b`. When that folder is itself a git repository, the agent files are kept out of it through `.git/info/exclude`, and `check` suggests the wrapping layout.

**Edit one of my skills**
```bash
# edit <clone>/skills/<name>/  → already live in every workspace on this machine
git commit -am "✨ feat(<name>): ..." && git push
dotagents update                        # on the other machine
```

**Update everything on this machine**
```bash
dotagents update --all
```

**New machine**
```bash
git clone git@github.com:gabrieldulolmarques/dotagents.git && cd dotagents && npm install && npm link && dotagents install
dotagents init <workspace> --skills ...         # links don't travel with the files
cd <workspace> && npx skills experimental_install   # restore third-party skills from the lock
```

**Adopt a third-party skill as mine** (to change it): `npx skills remove <name>` in the workspace, copy it to `skills/<name>/` here keeping its license, then `dotagents init <workspace> --skills <name>`. From then on it no longer gets the author's updates.

## What `install` and `init` touch

`dotagents install`:

| What | Where to | How |
|---|---|---|
| `AGENTS.md` + `env/<platform>.md` | `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md` | generated file |
| `rules/` | `~/.claude/rules` | folder link |
| `claude/settings.json` | `~/.claude/settings.json` | file link (copy on Windows) |
| `opencode/opencode.json` | `~/.config/opencode/opencode.json` | file link (copy on Windows) |

`AGENTS.md` has no machine paths: `{{AGENTS_REPO}}` becomes the clone's location, and the file for the current platform in `env/` is appended when it exists. Run `dotagents install` again after editing `AGENTS.md` or `env/`, and on Windows also after editing the settings.

`dotagents init` creates only what is missing and never overwrites your content:

- when the workspace is inside a git repository, an entry in its `.git/info/exclude` that keeps every agent file out of git. The exclude file is local and never committed, so the project gets no trace of the configuration, not even a `.gitignore` rule;
- `AGENTS.md` and `INDEX.md` from the templates;
- `CLAUDE.md` with `@AGENTS.md`;
- `.agents/README.md` and `.artifacts/README.md` pointing to `standards/`;
- one `.agents/skills/<name>` link per skill;
- `.claude/skills` and `.claude/rules` as links to `.agents/` (relative on Linux and macOS);
- `.claude/settings.json` with `"plansDirectory": ".artifacts/plans"`, so Claude Code saves its plans in the workspace (only that key is added; the rest of the file is kept);
- `.artifacts/session-archives/` and `.artifacts/plans/`, the two fixed folders.

It also records the workspace and its skills in `~/.config/dotagents/workspaces.json`, for `dotagents update --all`.

`dotagents check` covers the standards' checklists and the skills:

- `AGENTS.md` size and `CLAUDE.md` first line;
- real links, not copied folders;
- no agent file tracked by the project's git, and none visible to it as new;
- the two fixed folders and the `plansDirectory` setting;
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
- **Test scripts:** on Linux, Windows and macOS, runs `npm link` and every command, checks that a second run changes nothing, that a new workspace passes `dotagents check`, and that third-party skills from `npx skills` coexist with the linked ones.

## Limits

- **Windows:** file symlinks require administrator rights or Developer Mode, so files are copied and folders become junctions. Junctions store absolute paths: if this repository or a workspace moves, run `dotagents init` again.
- **Settings change from inside the apps.** On Windows, a setting changed in Claude Code or OpenCode makes the machine's copy differ from the repository's, and the next install backs it up before overwriting. To keep the change, copy the file back here and commit. On Linux and macOS the apps write through the link, so check `git diff`.
- **`~/.codex/config.toml` is left out.** The Codex app writes machine-specific things into it: runtime paths with hashes, pipe names and trusted projects.
- **`npx skills experimental_install`** is how the skills CLI (1.7) restores from the lock; the name may change in later versions.
