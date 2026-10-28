# Skills

Skills follow the [Agent Skills](https://agentskills.io/specification) format: a folder with a `SKILL.md` whose frontmatter has `name` and `description`, plus optional `scripts/`, `references/` and `assets/`. Claude Code reads them from `.claude/skills/`, which in a workspace is a link to `.agents/skills/`.

## Two kinds

| | Own skills | Third-party skills |
|---|---|---|
| Live in | `skills/` in this repository | the author's repository |
| Known through | the folder itself | `skills/third-party-skills.json` (`dotagents skills add`) |
| Put in a workspace by | `dotagents init --skills` | `dotagents init --skills`, which runs `npx skills add` |
| In the workspace | a link to the clone | a folder in `.agents/skills/`, recorded in `skills-lock.json` |
| Updated by | editing the clone (immediate) | `npx skills update`, or `dotagents update --all` |
| Edited by hand | yes, in the clone | no: the next update undoes it |

```
app-workspace/
├── skills-lock.json                      third-party only (npx skills)
├── .agents/skills/
│   ├── session-archive → <clone>/skills/session-archive
│   └── humanizer/                        installed by npx skills add
└── .claude/skills → .agents/skills
```

`skills-lock.json` sits at the workspace root because `npx skills` writes it where it runs, and `npx skills update` and `npx skills experimental_install` look for it there.

A third-party skill that isn't in the catalog can still be installed by hand with `npx skills add <source>`. Always run it from the workspace root; from inside `.agents/` it creates `.agents/.agents/`.

## Own skills

| Skill | What it does |
|---|---|
| [llm-wiki](../skills/llm-wiki/SKILL.md) | Maintains a Markdown wiki fed by sources (`raw/` → `wiki/`), with ingest, query and lint. |
| [map-source-files](../skills/map-source-files/SKILL.md) | Builds a File / Location / Responsibility table of a repository's source files. |
| [move-sessions](../skills/move-sessions/SKILL.md) | Makes past Claude Code conversations follow a project folder that moved, so Claude Code lists them again from the new folder. |
| [obsidian-docs](../skills/obsidian-docs/SKILL.md) | Answers questions about Obsidian from the official help, the plugin and theme directory, and the forum. |
| [session-archive](../skills/session-archive/SKILL.md) | Writes the transcript of a Claude Code session to `.artifacts/session-archives/`. |
| [to-cards](../skills/to-cards/SKILL.md) | Turns loose text (a message, an email, meeting notes) into task cards. |

`dotagents skills` lists them with the registered third-party ones.

## Writing a skill

1. Create `skills/<name>/SKILL.md`. The folder name and the `name` field must match, in kebab-case.
2. Write a `description` that says what the skill does and when to use it: it is the only part every session loads.
3. Keep `SKILL.md` under 500 lines. Details go to `references/`, code to `scripts/`.
4. Validate it, then commit:

   ```bash
   PYTHONUTF8=1 uvx --from "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref" skills-ref validate skills/<name>
   ```

The full rules are in [standards/agents.md](../standards/agents.md#skills). A skill only some projects need can also live directly in one workspace's `.agents/skills/`.

## Taking over a third-party skill

To change a third-party skill, make it yours:

1. Run `npx skills remove <name>` at the workspace root.
2. Copy the skill to `skills/<name>/` here, keeping its license.
3. Run `dotagents skills remove <name>`.
4. Run `dotagents init <workspace> --skills <name>`.

From then on it no longer gets the author's updates.
