# Workspaces

A workspace is a project folder that follows the `.agents/` and `.artifacts/` standards. The agents run from its root.

## Recommended layout: the workspace wraps the repositories

```
app-workspace/            not a git repository
├── AGENTS.md             project instructions, read by all three tools
├── .agents/              skills (and rules, subagents, hooks when there are any)
├── .claude/              links to .agents/, plus settings.json
├── .artifacts/           documentation written by agents and people
│   ├── INDEX.md          map of the project's documents
│   ├── session-archives/ session transcripts
│   └── plans/            plans written before implementing
├── app/                  git clone: only the project's own files
└── api/                  another repository of the same project, if any
```

The project's repositories never see the agent files, so there is nothing to ignore. Cloning again, switching branches or running `git clean -fdx` inside them doesn't touch `.artifacts/` or the transcripts. `AGENTS.md` lists the repositories, so the agents know where the code is and run git inside each one (`git -C app …`).

Two commands produce this layout: `dotagents new <git-url>` for a repository you don't have yet, and `dotagents init` on a repository already on disk, which offers to [wrap it](commands.md#wrapping-a-repository).

Some things need a git repository in the current folder: Claude Code worktrees, or `codex exec` (which accepts `--skip-git-repo-check`). Use them from inside one of the repositories.

## When the folder has to be the repository

Sometimes the root itself must be the repository: an Obsidian vault, for example, which the app and the sync expect in one place. When you answer no to [wrapping it](commands.md#wrapping-a-repository), `init` lists every agent file in the repository's `.git/info/exclude`. Git ignores them as it would with `.gitignore`, but the exclude file lives inside `.git/` and is never committed, so the project carries no trace of the configuration. `check` shows a warning that suggests the wrapping layout.

The excluded paths are `AGENTS.md`, `CLAUDE.md`, `INDEX.md`, `skills-lock.json`, `opencode.json`, `.agents/`, `.artifacts/`, `.claude/`, `.codex/`, `.opencode/`, `.copilot/`, `.cursor/` and `.gemini/`, all anchored to the workspace.

## What init creates

In this order:

| Step | What | Rule |
|---|---|---|
| Git | an entry in `.git/info/exclude` | only when the folder is inside a git repository |
| Root files | `AGENTS.md` | from `templates/workspace/`, only when missing; `AGENTS.md` gets the project name and the list of repositories in the folder |
| | `CLAUDE.md` | none: Claude Code reads `AGENTS.md` directly; the `@AGENTS.md` stub that earlier versions generated is removed, a `CLAUDE.md` of yours stays |
| `.agents/` | `README.md` | points to the standard in this repository; a hand-written one is kept as `README.md.bak-<date>` |
| | `skills/<name>` | a link per own skill; third-party ones installed with `npx skills add`. An older copy of an own skill gives way to the link: an identical copy is replaced, a changed one is kept in `.agents/backups/<name>.bak-<date>` first |
| | `skills-lock.json` | rebuilt, with a backup, when its entries lost the `"skills"` wrapper that `npx skills` expects |
| | `.claude/skills` | a link to `.agents/skills`, made before any installation |
| `.claude/` | `rules` | a link to `.agents/rules`, when that folder exists |
| | `settings.json` | adds `"plansDirectory": ".artifacts/plans"` and keeps the rest of the file; a different value already there is respected |
| `.artifacts/` | `README.md`, `session-archives/`, `plans/` | the two fixed folders; a hand-written `README.md` is kept as `README.md.bak-<date>` |
| | `INDEX.md` | the map of the documents, from `templates/workspace/`, only when missing. An `INDEX.md` that earlier versions put at the root moves here, with its relative links rewritten for the new folder and the links to it in `AGENTS.md` updated; when both exist, it is left for you to merge |

Files dotagents generates start with a marker line. A file without the marker is yours: dotagents leaves it alone, or, where it has to replace it, keeps a copy next to it as `<file>.bak-<date>`. Links are relative on Linux and macOS when they stay inside the workspace, so the workspace can move; Windows junctions are always absolute.

## What check verifies

| Area | Checks |
|---|---|
| Git | warns when the workspace is a repository or inside one; fails when an agent file is tracked, or when git would add one as new |
| Root files | `AGENTS.md` exists and mentions every repository in the folder; warns when a `CLAUDE.md` doesn't import `AGENTS.md` (an `@AGENTS.md` anywhere in its text), since Claude Code would then read only the `CLAUDE.md` |
| `.agents/` | no `.agents/.agents/`, `.agents/commands/` or `.codex/skills/`; every rule in `.agents/rules/` linked from `AGENTS.md` |
| Skills | `.claude/skills` is a link to `.agents/skills`; every skill folder has a `SKILL.md` whose `name` matches the folder and that is under 500 lines; own skills are links, not copies, and not also in the lock; every skill in `skills-lock.json` is installed |
| `.claude/` | `rules` is a link when it exists; `settings.json` sets `plansDirectory` |
| `.artifacts/` | `INDEX.md`, `session-archives/` and `plans/` exist; fails while an `INDEX.md` sits at the root, where earlier versions put it (`init` moves it) |

## The standards behind it

The two standards describe how a workspace is organized and why. dotagents applies the parts that can be automated.

- **[standards/agents.md](../standards/agents.md), the `.agents/` folder.** It is the single source of the agents' configuration, and the tools' folders only adapt it. It covers where each mechanism lives in each tool (context file, skills, rules, subagents, hooks, settings, MCP), why commands become skills, why `.agents/rules` is never linked to `.codex/rules`, how to link folders on Windows, and the rule that keeps everything out of the projects' git. It is based on Galster et al., *Configuring agentic AI coding tools: an exploratory study* (AIware '26).
- **[standards/artifacts.md](../standards/artifacts.md), the `.artifacts/` folder.** It holds the documentation agents and people write. Its structure is free and grows with the project. Only `INDEX.md`, `session-archives/` and `plans/` are fixed. It also keeps `AGENTS.md` small and lists every document in `.artifacts/INDEX.md`, because the tools don't read `.artifacts/` on their own: a document without a link doesn't exist for them.

When an agent writes a plan before implementing, it goes to `.artifacts/plans/`. Claude Code does it by itself through `plansDirectory`; Codex and OpenCode follow the instruction in the global `AGENTS.md`.
