# The `.artifacts/` folder standard

`.artifacts/` holds the documentation that agents and people write about the project:
architecture, research, decisions, session transcripts. Agent configuration does not live
here ([`.agents/` standard](agents.md)), and neither do code, secrets or build output.

**The structure is free.** It grows with the project's needs: folders and documents appear
when there is something to put in them, named after what they hold. The only fixed parts,
for now, are `INDEX.md`, `session-archives/`, `plans/` and `memory/`.

---

## Basis

GALSTER, M. et al. *Configuring agentic AI coding tools: an exploratory study*. AIware '26,
ACM, 2026. DOI [10.1145/3805760.3814887](https://doi.org/10.1145/3805760.3814887).

The paper defines a context file as the Markdown a tool loads in every session. It appears
in 90.6% of the 2,853 repositories studied, often as the only mechanism. The authors also
point out the risk of several layers of context files producing redundant or conflicting
instructions.

The answer here is to split the load: `AGENTS.md` is the only document loaded in every
session, and everything else lives in `.artifacts/` and is read **on demand**, like a
skill's body and `references/` under the Agent Skills progressive loading.

The failure this prevents: an `AGENTS.md` that grows into a changelog, with dated notes that
repeat the logs, loaded whole in every session.

---

## Fixed folders

```
.artifacts/
├── INDEX.md                        always exists: the map of the documents
├── session-archives/               always exists: one transcript per session
│   ├── YYYY-MM-DD-<session-id>.md
│   ├── YYYY-MM-DD-<origin>-<slug>.md
│   └── YYYY-MM-DD-<...>/           session attachments
├── plans/                          always exists: plans written before implementing
│   ├── PLAN.md                     the living plan, under a fixed name
│   ├── <name>.md                   plans in progress
│   └── done/                       plans done, replaced or dropped
├── memory/                         always exists: Claude Code's auto memory of the workspace
│   ├── MEMORY.md                   the index Claude Code loads at the start of a session
│   └── <note>.md
└── …                               whatever the project needs
```

### `INDEX.md`

- The map of the documents: one line per document, with what it is for. `AGENTS.md` links
  to it, so it is how the agents find everything else (see the guidelines below).
- Its links are relative to `.artifacts/`: `[AGENTS.md](../AGENTS.md)`,
  `[plans/](plans/)`.

### `session-archives/`

- One transcript per session. A Claude Code session uses the session id and is produced by
  the `session-archive` skill. A session from another origin (claude.ai, Claude Desktop)
  uses `<origin>-<slug>`, as in `2026-10-12-claude-ai-agent-orchestration.md`.
- Attachments go in a folder with the same name as the `.md`, without the extension.
- A transcript is a dated record: **immutable** once the session ends. It is a snapshot of
  that date, so check it against the code before trusting it. Corrections go to the
  document that describes the current state, not to the transcript.

### `plans/`

- Plans written before implementing something: the plan mode output, or a plan the user
  asks for.
- **Claude Code** writes its plan-mode plans here on its own: `dotagents init` sets
  `"plansDirectory": ".artifacts/plans"` in the workspace's `.claude/settings.json`. The
  file names are the ones Claude Code generates.
- A plan written outside plan mode (asked for in the conversation) also goes here, as
  `YYYY-MM-DD-<slug>.md`: the global instructions say so.
- `PLAN.md` is the living plan: what the product is, the decisions in force, the state, and
  the workstreams in order. Its fixed name is how an agent finds the current plan without
  reading dates. When a new one replaces it, the old one moves to `done/` with its date in the
  name.
- A workstream that grows gets a plan of its own next to it, linked both ways. The pending
  tasks stay as checklist items (in the plan or in a task list such as `TASKS.md`), never one
  file per task: the detail of a task comes from plan mode when it is carried out.
- A plan is a working document while it is being carried out, and a record once it is
  done, replaced or dropped: then it moves to `done/`, with its state in its header. It is
  not rewritten afterwards: what changed during the work belongs in the transcript, and the
  current state in the documents that describe it. So `plans/` shows only what is in
  progress, and the index points to `done/` in one line.

### `memory/`

- Claude Code's auto memory of the workspace, shared by every Claude profile on the machine:
  `dotagents init` sets `"autoMemoryDirectory"` in the workspace's
  `.claude/settings.local.json` to this folder (`~/...` under the home folder, else an absolute
  path, since Claude Code ignores a relative one).
- Claude Code writes it: `MEMORY.md` is the index, one line per note linking its file, and
  each note is a file with a frontmatter (`name`, `description`, a `type` of `user`,
  `feedback`, `project` or `reference`). Personal notes are shared too.
- Only the first 200 lines or 25 KB of `MEMORY.md` are loaded; the notes are read when needed.
- `init` copies in the memory each profile kept for the workspace before (in
  `<profile>/projects/<project>/memory/`), never deleting it there; a note that differs is
  kept as the workspace has it, and init says so.
- A session started inside one of the workspace's repositories doesn't read the workspace's
  settings, and a session resumed from before the change keeps writing to the profile's
  folder. `check` lists the notes left there; `init` brings them in.
- It isn't a link: Claude Code asks before every write through one.

---

## Guidelines for everything else

These keep the documents useful to the agents. They are advice, not checks.

- **A document without a link does not exist for the agent.** Claude Code doesn't read
  `.artifacts/` on its own: link each document from `.artifacts/INDEX.md` (the map, one line per
  document with what it is for) or from `AGENTS.md`.
- **`AGENTS.md` stays lean** and only states what the agent needs to *do*: every session
  loads all of it, global and project instructions together. A new fact rewrites the old statement instead of stacking a
  dated note; the history stays in the transcripts.
- **Each fact lives in one place.** A document that describes the current state is
  rewritten when the state changes.
- **Name things after what they hold**, in kebab-case.
- A rule, skill, subagent or hook is not a document: it goes to `.agents/`.

---

## Checklist

`dotagents check <workspace>` runs the automatable items.

- [ ] `.artifacts/INDEX.md`, `.artifacts/session-archives/` and `.artifacts/plans/` exist,
      and there is no `INDEX.md` at the root.
- [ ] `.claude/settings.json` sets `plansDirectory` to `.artifacts/plans`.
- [ ] `.claude/settings.local.json` sets `autoMemoryDirectory` to `.artifacts/memory`, a real
      folder; its `MEMORY.md` fits in 200 lines and 25 KB and links every note; no profile keeps
      notes of the workspace that aren't there; `blockReadsOutsideWorkingDirectories` is off.
- [ ] No transcript edited after its session.
