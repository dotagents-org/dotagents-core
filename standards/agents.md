# The `.agents/` folder standard

`.agents/` is the single source of the coding agents' configuration: Claude Code, Codex and
OpenCode. The `.claude/`, `.codex/` and `.opencode/` folders only **adapt** that content to
each tool's format. If something can be written once for all three, it lives here.
Project documentation does not live here: it follows the [`.artifacts/` standard](artifacts.md).

---

## Never in the projects' git

The agent configuration is personal: it never goes into a project's repository. That covers
`AGENTS.md`, `CLAUDE.md`, `skills-lock.json`, `opencode.json`, `.agents/`,
`.artifacts/`, `.claude/`, `.codex/`, `.opencode/`, and the folders of other agents (`.copilot/`,
`.cursor/`, `.gemini/`) at the workspace root.

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
  git repository in the current folder, such as Claude Code worktrees or `codex exec`, have to
  be used from inside a repository, or with `--skip-git-repo-check` in Codex.

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

1. **Shared core and adapters.** For people who use more than one tool, the authors
   recommend keeping `AGENTS.md` as the core and using each tool's own file as an adapter
   that points to it. This standard applies the same idea to the other mechanisms: the
   content lives in `.agents/`, and the tool folders only point to it.
2. **Only context files and skills exist in all five tools.** They are the two mechanisms
   this standard treats as portable without caveats.
3. **Rules and Commands lock the workflow into one tool.** Commands do not go in
   `.agents/`. The `.agents/rules/` folder holds something else, explained below.

The paper's snapshot is from February 2026 and has already aged: Codex skills, for example,
moved from `.codex/skills/` to `.agents/skills/`. The paths below were checked against the
official documentation on 2026-10-13 (skills for all three tools; OpenCode rules and
agents) and on 2026-09-30 (the rest).

---

## Where each mechanism lives

| Mechanism | Source | Claude Code | Codex | OpenCode |
|---|---|---|---|---|
| Context file | `AGENTS.md` at the root | reads it directly (v2.1.277+) while there is no `CLAUDE.md` | reads it directly | reads it directly; ignores `CLAUDE.md` when `AGENTS.md` exists |
| Skills | `.agents/skills/<name>/` | `.claude/skills` junction | reads it directly | reads it directly |
| Modular instructions | `.agents/rules/<topic>.md` | `.claude/rules` junction | only through the link in `AGENTS.md` | `instructions` in `opencode.json` |
| Subagents | `.agents/agents/<name>.md` | `.claude/agents` junction | `.codex/agents/<name>.toml`, written from the `.md` | `.opencode/agents` junction |
| Hooks | scripts in `.agents/hooks/` | registered in `.claude/settings.json` | registered in `hooks.json` or `[hooks]` | JS/TS plugin that calls the script |
| Settings | not in `.agents/` | `.claude/settings.json` | `.codex/config.toml` | `opencode.json` |
| MCP | not in `.agents/` | `.mcp.json` | `[mcp_servers]` in `config.toml` | `mcp` in `opencode.json` |
| Commands | don't use: make it a skill | the skill already is `/name` | deprecated in favor of skills | `.opencode/commands/` only as a shortcut to a skill |

Settings and MCP have no format shared across the tools, so they go straight into each
tool's file. Credentials never go into these files. An MCP server that only exists on one
machine goes in the tool's local scope, not in the project file.

---

## Layout

```
<workspace>/
├── AGENTS.md                    core (writing rules in the .artifacts/ standard)
├── opencode.json                only if you use OpenCode: instructions, mcp, permissions
├── .agents/
│   ├── rules/<topic>.md         only this project's rules
│   ├── skills/<name>            link to dotagents/skills/<name>, or a project skill
│   ├── agents/<name>.md         only once there is a first subagent
│   └── hooks/<script>           only once there is a first hook
├── .claude/
│   ├── rules  → .agents/rules   junction
│   ├── skills → .agents/skills  junction
│   ├── agents → .agents/agents  junction, when it exists
│   └── settings.json
├── .codex/                      only files in Codex's own format
├── .opencode/
│   └── agents → .agents/agents  junction, when it exists
├── .artifacts/                  INDEX.md, the map of the documents, and the rest (.artifacts/ standard)
└── <git-checkout>/
```

Don't create empty folders "for later". The paper found skills in 5.5% of repositories and
subagents in 4.6%. A mechanism nobody uses is only maintenance.

---

## `skills/`

- **Reusable skills live in the `dotagents` repository**, in `skills/<name>/`, and enter a
  workspace as a `.agents/skills/<name>` link: `dotagents init <workspace> --skills <name>`. Each
  workspace links only the ones it uses. Editing through the link edits the repository;
  commit there.
- A skill that only makes sense in one project lives directly in the workspace's
  `.agents/skills/<name>/`. If it becomes useful elsewhere, move it to the repository and
  replace it with a link.
- One folder per skill, named like its `name` field, in kebab-case.
- `SKILL.md` with `name` and `description` in the frontmatter, the two fields the Agent
  Skills standard requires. The `description` says **what the skill does and when to use
  it**. It is the only part loaded in every session; the body only comes in when the task
  calls for it.
- `SKILL.md` under 500 lines, as the specification recommends. Details go to
  `references/`, executable code to `scripts/` and templates to `assets/`. The paper found
  85.5% of skills with none of these resources, text only. A skill that repeats a
  procedure made of commands should ship the script.
- Codex caps the initial skill list at 2% of the context or 8,000 characters. So: short
  descriptions, and similar items grouped into one skill with one reference per item,
  instead of one skill per item.
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

The name is misleading. In the paper, *Rules* is the Cursor and Codex mechanism, and in
Codex `.codex/rules/` holds **command execution** rules (`prefix_rule`), not text.
`.agents/rules/` follows Claude Code's meaning (`.claude/rules/`): Markdown instructions,
split by topic, that extend the context file.

- **A rule that applies everywhere does not go here.** It lives in the `dotagents`
  repository's `rules/` and is global: `dotagents install` links `~/.claude/rules` to it, and the
  global `AGENTS.md` links it for Codex and OpenCode. Example: the commit convention.
  `.agents/rules/` only holds what is specific to this project.
- One topic per file, in kebab-case.
- Claude Code loads every file in this folder in every session, the same way it loads
  `AGENTS.md`. The `paths` frontmatter limits a rule to certain files, but only in Claude
  Code. So only what applies to any task in the project goes here. What applies to one
  kind of task becomes a skill.
- Every file here is linked from `AGENTS.md`. Codex does not read this folder, and the link
  is its only way to the rule.
- In OpenCode: `"instructions": [".agents/rules/*.md"]` in `opencode.json`.
- Nothing that isn't a rule goes here, not even a README: everything in this folder goes
  into the context.
- Never link `.agents/rules` to `.codex/rules`.

---

## `agents/`

- Only create it when there is a real case: work that needs an isolated context and
  returns a summary, such as a long search.
- One `<name>.md` file per subagent. The core shared by both tools is `name` (equal to the
  file name, which is where OpenCode takes the name from), `description` (required in
  both) and the body, which is the prompt.
- The other fields are not compatible. The model is an alias in Claude Code and
  `provider/model` in OpenCode; Claude Code uses `tools` and OpenCode uses `permission`.
  Without `mode`, OpenCode also offers the subagent as a primary agent (`mode: all`). No
  subagent under this standard has been tested in both tools yet: check the first one in
  both before using it as a template.
- Codex uses TOML in `.codex/agents/`. There is no generator: the `.toml` is written from
  the `.md` and kept in sync with it.

---

## `hooks/`

An instruction asks; a hook guarantees. Anything that must always happen, like running the
tests after an edit, becomes a hook.

- The script lives here; the registration goes in each tool's file (see the table).
- The hook input format differs from tool to tool. The script receives what it needs as
  arguments, and each tool's registration bridges the gap.

---

## Commands

There is no `.agents/commands/`. The paper shows that commands lock the workflow into one
tool. Claude Code merged commands into skills (`.claude/skills/x/` becomes `/x`), and Codex
deprecated custom prompts in favor of skills. If OpenCode needs a slash shortcut,
`.opencode/commands/<name>.md` only says to use the skill.

---

## Tool folders

- They hold only junctions to `.agents/` and files in the tool's own format.
- **Windows:** use a junction: `cmd /c mklink /J <link> <absolute-target>`. A symbolic link
  requires Developer Mode. Git Bash's `ln -s` **copies the folder** and exits with code 0,
  so never use it for these links. To remove a junction, use `cmd /c rmdir <link>`;
  `rm -rf` or `Remove-Item -Recurse` can delete the target's contents. A junction stores
  the absolute path: if the workspace moves, recreate the junctions.
- **Linux and macOS:** `ln -s` with a relative path.
- **OpenCode sees skills twice**, because it reads both `.claude/skills` and
  `.agents/skills`. According to its documentation, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`
  turns off reading `.claude/skills`.

---

## Where to run the agents

At the **workspace root**, where `AGENTS.md`, `.agents/` and the junctions are.

Inside a git checkout, all three tools look for skills only up to that repository's root,
and Codex reads `AGENTS.md` starting from it. None of them sees the workspace's
`.agents/`. Running from inside a repository requires links in each repository, which this
standard does not define yet.

---

## Limits

- Nothing in a workspace's `.agents/` or `.artifacts/` is versioned or reaches whoever clones
  one of the repositories, by choice (see "Never in the projects' git"). The paper only
  studied configuration versioned inside the repository, the opposite choice.
- The tools change fast. When you update one of them, check the mechanism table again and
  update the dates in "Basis" saying when the paths were checked.

---

## Checklist

`dotagents check <workspace>` runs the automatable items.

- [ ] Every skill folder has a `SKILL.md` whose `name` matches the folder, with a
      `description` and under 500 lines.
- [ ] Every file in `rules/` is linked from `AGENTS.md`.
- [ ] `.claude/rules` and `.claude/skills` are junctions, not copies: `cmd /c dir /AL .claude`
      lists both as `<JUNCTION>`.
- [ ] `.agents/commands/`, `.agents/.agents/` and `.codex/skills/` don't exist.
- [ ] `.codex/rules/` has nothing that came from `.agents/rules/`.
- [ ] No `CLAUDE.md`, or one that imports `@AGENTS.md` (otherwise Claude Code reads only the `CLAUDE.md`).
- [ ] No agent file is tracked by the project's git, and git doesn't see new ones.
