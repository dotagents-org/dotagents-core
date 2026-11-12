# The `.agents/` folder standard

`.agents/` is the single source of the workspace's agent configuration, read by Claude Code.
The `.claude/` folder only **links** to it and holds the files in Claude Code's own format
(`settings.json`). `AGENTS.md` and `.agents/skills/` are open formats that Claude Code reads
directly or through a link, so the workspace stays readable by other tools without being
written for them.
Project documentation does not live here: it follows the [`.artifacts/` standard](artifacts.md).

---

## Never in the projects' git

The agent configuration is personal: it never goes into a project's repository. That covers
`AGENTS.md`, `CLAUDE.md`, `skills-lock.json`, `.agents/`, `.artifacts/`, `.claude/`, and
the files of other agents (`opencode.json`, `.codex/`, `.opencode/`, `.copilot/`, `.cursor/`,
`.gemini/`) at the workspace root.

**Recommended layout: the workspace wraps the repositories.** The agent files sit at a root
that is not a git repository, and each project repository is a folder inside it:

```
app-workspace/            not a repository: AGENTS.md, .agents/, .artifacts/…
├── app/                  git clone: only the project's own files
└── api/                  another repository of the same project, if any
```

- The workspace folder can have any name (`acme-platform`, `thesis`…).
  `<name>-workspace` is only the default.
- `dotagents new <git-url> [folder]` creates the workspace folder, clones the repository into
  it and runs `init`. For a repository already on disk, `dotagents init` on it offers to move
  it into `<name>-workspace/` (`--wrap` does it without asking). With an existing workspace as the folder, it adds one more repository
  and lists it under "Repositories" in `AGENTS.md`.
- The repositories never see the agent files, so there is nothing to ignore. Re-cloning,
  switching branches or `git clean -fdx` doesn't touch `.artifacts/` or the transcripts.
- `AGENTS.md` lists the repositories, so the agents know where the code is and run git inside
  them (`git -C <folder>`). `dotagents check` fails when a repository is missing from it.
- Run the agents at the workspace root (see "Where to run the agents"). Features that need a
  git repository in the current folder, such as Claude Code worktrees, have to be used from
  inside a repository.

**Fallback, when the root has to be the repository** (an Obsidian vault, for example, where
moving the folder would break the app and the sync):

- `dotagents init` lists those paths in the repository's `.git/info/exclude`. Git ignores them as it would with `.gitignore`, but the
  exclude file is local and never committed, so the project carries no trace of them, not
  even an ignore rule.
- Don't add them to the project's `.gitignore`: that file is committed.
- `dotagents check` fails when one of them is already tracked. Remove it from the index with
  `git rm -r --cached <path>` (the file stays on disk). dotagents never does it on its own.
- What is worth keeping lives in the dotagents repository (skills, rules, standards). The
  workspace's own `.agents/` and `.artifacts/` stay local.

---

## Basis

GALSTER, M. et al. *Configuring agentic AI coding tools: an exploratory study*. AIware '26,
ACM, 2026. DOI [10.1145/3805760.3814887](https://doi.org/10.1145/3805760.3814887).

The paper maps 8 configuration mechanisms across 5 tools and measures how often they are
adopted in 2,853 repositories. Three findings become rules here:

1. **Shared core and adapters.** The authors recommend keeping `AGENTS.md` as the core and
   using each tool's own file as an adapter that points to it. dotagents supports only Claude
   Code, but keeps the core in the open formats (`AGENTS.md`, `.agents/skills/`) and makes
   `.claude/` a set of links to it.
2. **Context files and skills are the portable mechanisms.** They exist in all five tools
   studied, so they are the two this standard relies on most.
3. **Commands lock the workflow into one tool.** Commands do not go in `.agents/`: a skill
   is already a `/name` command in Claude Code.

The paths below were checked against Claude Code's documentation on 2026-10-13.

---

## Where each mechanism lives

Claude Code's own map of what it reads, and from where, is
[Explore the .claude directory](https://code.claude.com/docs/en/claude-directory.md). Read it
before adding a mechanism or changing this layout: it lists every file in `.claude/` and
`~/.claude/`, its scope, and whether it goes into git. Two facts from it shape this standard:
Claude Code reads nothing under `.agents/`, so each folder here reaches it through a `.claude/`
link; and a `.claude/rules/` link that points outside the workspace needs an approval and then
loads only the rules without `paths`.

| Mechanism | Source | How Claude Code reads it |
|---|---|---|
| Context file | `AGENTS.md` at the root | directly (v2.1.277+) while there is no `CLAUDE.md` |
| Skills | `.agents/skills/<name>/` | `.claude/skills` junction |
| Modular instructions | `.agents/rules/<topic>.md` | `.claude/rules` junction |
| Subagents | `.agents/agents/<name>.md` | `.claude/agents` junction |
| Hooks | scripts in `.agents/hooks/` | registered in `.claude/settings.json` |
| Settings | not in `.agents/` | `.claude/settings.json` |
| MCP | not in `.agents/` | `.mcp.json` |
| Commands | don't use: make it a skill | the skill already is `/name` |

Settings and MCP are in Claude Code's own format, so they go straight into its files. Credentials never go into these files. An MCP server that only exists on one
machine goes in the tool's local scope, not in the project file.

---

## Layout

```
<workspace>/
├── AGENTS.md                    core (writing rules in the .artifacts/ standard)
├── .agents/
│   ├── rules/<topic>.md         only this project's rules
│   ├── skills/<name>            link to dotagents/config/skills/<name>, or a project skill
│   ├── agents/<name>.md         only once there is a first subagent
│   └── hooks/<script>           only once there is a first hook
├── .claude/
│   ├── rules  → .agents/rules   junction
│   ├── skills → .agents/skills  junction
│   ├── agents → .agents/agents  junction, when it exists
│   └── settings.json
├── .artifacts/                  INDEX.md, the map of the documents, and the rest (.artifacts/ standard)
└── <git-checkout>/
```

Don't create empty folders "for later". The paper found skills in 5.5% of repositories and
subagents in 4.6%. A mechanism nobody uses is only maintenance.

---

## `skills/`

- **Reusable skills live in the `dotagents` repository**, in `config/skills/<name>/`, and enter a
  workspace as a `.agents/skills/<name>` link: `dotagents init <workspace> --skills <name>`. Each
  workspace links only the ones it uses. Editing through the link edits the repository;
  commit there.
- A skill that only makes sense in one project lives directly in the workspace's
  `.agents/skills/<name>/`. If it becomes useful elsewhere, move it to the repository and
  replace it with a link.
- One folder per skill, named like its `name` field, in kebab-case.
- A skill that calls another (`call the Skill tool with "<name>"`, or a link to
  `../<name>/SKILL.md`) expects it in the same workspace: `dotagents init` brings it along, and
  `dotagents check` warns when it isn't there.
- `SKILL.md` with `name` and `description` in the frontmatter, the two fields the Agent
  Skills standard requires. The `description` says **what the skill does and when to use
  it**. It is the only part loaded in every session; the body only comes in when the task
  calls for it.
- `SKILL.md` under 500 lines, as the specification recommends. Details go to
  `references/`, executable code to `scripts/` and templates to `assets/`. The paper found
  85.5% of skills with none of these resources, text only. A skill that repeats a
  procedure made of commands should ship the script.
- Every skill's `description` is loaded in every session. So: short descriptions, and
  similar items grouped into one skill with one reference per item, instead of one skill
  per item.
- A skill's script has its run command stated in `SKILL.md`. Don't count on `python` or
  `node` being on the PATH.
- Third-party skills are installed with `npx skills add <owner/repo>` from the workspace
  root, never from inside `.agents/`, or the installer creates `.agents/.agents/`. They are
  copied into `.agents/skills/`, recorded in `skills-lock.json` and never edited by hand:
  the next update undoes the edit. `npx skills update -p` updates them, and
  `npx skills experimental_install` restores them from the lock (after a fresh clone, for
  example).
- A third-party skill never has the same name as a skill from the `dotagents` repository, and
  a skill from the repository is never installed with `npx skills` (that would make a copy
  instead of a link). `dotagents check` catches both.
- `skills/` holds only skill folders, no loose files.

---

## `rules/`

`.agents/rules/` follows Claude Code's meaning (`.claude/rules/`): Markdown instructions,
split by topic, that extend the context file.

- **A rule that applies everywhere does not go here.** It lives in the `dotagents`
  repository's `config/rules/` and is global: `dotagents install` links `~/.claude/rules` to it. Example: the commit convention.
  `.agents/rules/` only holds what is specific to this project.
- One topic per file, in kebab-case.
- Claude Code loads every file in this folder in every session, the same way it loads
  `AGENTS.md`. The `paths` frontmatter limits a rule to certain files. Otherwise, only what applies to any task in the project goes here. What applies to one
  kind of task becomes a skill.
- Every file here is linked from `AGENTS.md`, so the map of the project's instructions stays
  in one place.
- Nothing that isn't a rule goes here, not even a README: everything in this folder goes
  into the context.

---

## `agents/`

- Only create it when there is a real case: work that needs an isolated context and
  returns a summary, such as a long search.
- One `<name>.md` file per subagent, in Claude Code's format: `name` (equal to the file
  name), `description` and the body, which is the prompt. `.claude/agents` links to the
  folder.

---

## `hooks/`

An instruction asks; a hook guarantees. Anything that must always happen, like running the
tests after an edit, becomes a hook.

- The script lives here; the registration goes in `.claude/settings.json` (see the table).

---

## Commands

There is no `.agents/commands/`. Claude Code merged commands into skills
(`.claude/skills/x/` becomes `/x`), so a command is written as a skill.

---

## The `.claude/` folder

- It holds only junctions to `.agents/` and files in Claude Code's own format.
- **Windows:** use a junction: `cmd /c mklink /J <link> <absolute-target>`. A symbolic link
  requires Developer Mode. Git Bash's `ln -s` **copies the folder** and exits with code 0,
  so never use it for these links. To remove a junction, use `cmd /c rmdir <link>`;
  `rm -rf` or `Remove-Item -Recurse` can delete the target's contents. A junction stores
  the absolute path: if the workspace moves, recreate the junctions.
- **Linux and macOS:** `ln -s` with a relative path.

---

## Where to run the agents

At the **workspace root**, where `AGENTS.md`, `.agents/` and the junctions are.

Inside a git checkout, Claude Code looks for skills only up to that repository's root and
doesn't see the workspace's `.agents/`. Running from inside a repository requires links in each repository, which this
standard does not define yet.

---

## Limits

- Nothing in a workspace's `.agents/` or `.artifacts/` is versioned or reaches whoever clones
  one of the repositories, by choice (see "Never in the projects' git"). The paper only
  studied configuration versioned inside the repository, the opposite choice.
- Claude Code changes fast. When you update it, check the mechanism table again and update
  the date in "Basis" saying when the paths were checked.

---

## Checklist

`dotagents check <workspace>` runs the automatable items.

- [ ] Every skill folder has a `SKILL.md` whose `name` matches the folder, with a
      `description` and under 500 lines.
- [ ] Every file in `rules/` is linked from `AGENTS.md`.
- [ ] `.claude/rules` and `.claude/skills` are junctions, not copies: `cmd /c dir /AL .claude`
      lists both as `<JUNCTION>`.
- [ ] `.agents/commands/` and `.agents/.agents/` don't exist.
- [ ] No `CLAUDE.md`, or one that imports `@AGENTS.md` (otherwise Claude Code reads only the `CLAUDE.md`).
- [ ] No agent file is tracked by the project's git, and git doesn't see new ones.
