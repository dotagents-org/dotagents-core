# agents

My coding agent configuration (Claude Code, Codex and OpenCode) in one place: global instructions and rules, skills, the `.agents/` and `.artifacts/` folder standards, and the scripts that apply all of it to a machine and to each workspace. Works on Windows, Linux and macOS.

## Layout

```
agents/
├── AGENTS.md                # global instructions, apply in any folder
├── env/                     # machine notes appended to AGENTS.md per platform (win32.md, linux.md…)
├── rules/                   # global rules (e.g. commit convention)
├── standards/
│   ├── agents.md            # the .agents/ folder standard for a workspace
│   └── artifacts.md         # the .artifacts/ folder standard for a workspace
├── skills/                  # reusable skills (Agent Skills format)
├── templates/workspace/     # templates for AGENTS.md, INDEX.md and pending.md
├── claude/settings.json     # ~/.claude/settings.json
├── opencode/opencode.json   # ~/.config/opencode/opencode.json
├── install.mjs              # applies the global part to this machine
├── init-workspace.mjs       # applies the standards to a workspace, or checks it (--check)
└── lib/common.mjs           # helpers used by both scripts
```

The scripts only need Node 18+, with no dependencies.

## Global: `install.mjs`

```bash
git clone git@github.com:gabrieldulolmarques/agents.git
cd agents
node install.mjs --dry-run   # shows what it would do, changes nothing
node install.mjs
```

| What | Where to | How |
|---|---|---|
| `AGENTS.md` + `env/<platform>.md` | `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md` | generated file |
| `rules/` | `~/.claude/rules` | folder link |
| `claude/settings.json` | `~/.claude/settings.json` | file link (copy on Windows) |
| `opencode/opencode.json` | `~/.config/opencode/opencode.json` | file link (copy on Windows) |

- **`AGENTS.md` has no machine paths.** `{{AGENTS_REPO}}` becomes the location of the clone, and the file for the current platform in `env/` (`win32.md`, `linux.md`, `darwin.md`) is appended, when it exists. Codex and OpenCode read the rules through the absolute paths that result.
- **Run `install.mjs` again after editing** `AGENTS.md` or `env/`, and on Windows also after editing the settings. On Linux and macOS, the settings and the rules are links, so changes apply right away.
- Any file the script replaces is kept next to it as `.bak-<date>`. Run it as often as you like: what is already right stays as is.

Skills are not global: each workspace links only the ones it uses.

## Per workspace: `init-workspace.mjs`

```bash
# apply the standards and link two skills
node init-workspace.mjs ~/projects/notes --skills obsidian-docs,llm-wiki --dry-run
node init-workspace.mjs ~/projects/notes --skills obsidian-docs,llm-wiki

# check whether a workspace follows the standards, changing nothing
node init-workspace.mjs ~/projects/notes --check
```

It creates only what is missing and never overwrites your content:

- `AGENTS.md`, `INDEX.md` and `.artifacts/coding/pending.md` from the templates, only if they don't exist yet;
- `CLAUDE.md` with `@AGENTS.md`;
- `.agents/README.md` and `.artifacts/README.md` pointing to the standards in `standards/`;
- `.agents/skills/<name>` as a link to `skills/<name>` in this repository;
- `.claude/skills` and `.claude/rules` as links to `.agents/` (relative on Linux and macOS).

`--check` runs the two standards' checklist:

- `AGENTS.md` size and `CLAUDE.md` first line;
- real links (not copied folders);
- each skill's `name` matching its folder;
- rules linked from `AGENTS.md`;
- forbidden folders;
- full dates in file names.

## Skills

| Skill | What it does |
|---|---|
| [obsidian-docs](skills/obsidian-docs/SKILL.md) | Answers questions about Obsidian from the official help, the plugin and theme directory, and the forum. |
| [session-archive](skills/session-archive/SKILL.md) | Writes the Claude Code session transcript to `.artifacts/session-archives/`. |
| [map-source-files](skills/map-source-files/SKILL.md) | Builds a File / Location / Responsibility table of a repository's source files. |
| [to-cards](skills/to-cards/SKILL.md) | Turns loose text (message, email, meeting notes) into task cards. |
| [llm-wiki](skills/llm-wiki/SKILL.md) | Maintains a Markdown wiki fed by sources (`raw/` → `wiki/`), with ingest, query and lint. Not used in any workspace yet. |

The skills follow the [Agent Skills specification](https://agentskills.io/specification), and the writing rules are in [standards/agents.md](standards/agents.md#skills). You can also install a single skill elsewhere with the [skills.sh](https://skills.sh) CLI:

```bash
npx skills add git@github.com:gabrieldulolmarques/agents.git -s obsidian-docs
```

Third-party skills (e.g. `npx skills add blader/humanizer`) don't go here, so they keep getting the author's updates through `npx skills update`.

## CI

- **Validate skills:** runs [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) on every push that touches `skills/`. Locally:
  ```bash
  PYTHONUTF8=1 uvx --from "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref" skills-ref validate skills/<name>
  ```
- **Test scripts:** runs `install.mjs` and `init-workspace.mjs` on Linux, Windows and macOS, and checks that a second run changes nothing and that the new workspace passes `--check`.

## Limits

- **Windows:** file symlinks require administrator rights or Developer Mode, so files are copied and folders become junctions. Junctions store absolute paths: if this repository or a workspace moves, run the scripts again.
- **Settings change from inside the apps.** On Windows, a setting changed in Claude Code or OpenCode makes the machine's copy differ from the repository's, and the next install backs it up before overwriting. To keep the change, copy the file back here and commit. On Linux and macOS the apps write through the link, so check `git diff`.
- **`~/.codex/config.toml` is left out.** The Codex app writes machine-specific things into it: runtime paths with hashes, pipe names and trusted projects.
