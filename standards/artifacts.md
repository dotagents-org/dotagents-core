# The `.artifacts/` folder standard

> **Type:** standard · **Scope:** any workspace with `AGENTS.md`, `.agents/` and `.artifacts/` at the root, applied by `dotagents init` from this repository · **Last verified:** 2026-10-14

`.artifacts/` holds the documentation that agents and people write about the project:
architecture, research, decisions, session transcripts. Agent configuration does not live
here ([`.agents/` standard](agents.md)), and neither do code, secrets or build output.

**The structure is free.** It grows with the project's needs: folders and documents appear
when there is something to put in them, named after what they hold. The only fixed parts,
for now, are `INDEX.md`, `session-archives/` and `plans/`.

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
├── README.md                       points to this standard in the dotagents repository
├── INDEX.md                        always exists: the map of the documents
├── session-archives/               always exists: one transcript per session
│   ├── YYYY-MM-DD-<session-id>.md
│   ├── YYYY-MM-DD-<origin>-<slug>.md
│   └── YYYY-MM-DD-<...>/           session attachments
├── plans/                          always exists: plans written before implementing
│   └── <name>.md
└── …                               whatever the project needs
```

### `INDEX.md`

- The map of the documents: one line per document, with what it is for. `AGENTS.md` links
  to it, so it is how the agents find everything else (see the guidelines below).
- Its links are relative to `.artifacts/`: `[AGENTS.md](../AGENTS.md)`,
  `[plans/](plans/)`.
- Earlier versions of dotagents put it at the workspace root. `dotagents check` fails until
  it is moved here, with its links fixed.

### `session-archives/`

- One transcript per session. A Claude Code session uses the session id and is produced by
  the `session-archive` skill. A session from another origin (claude.ai, Codex, OpenCode)
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
- **Codex and OpenCode** don't save plans to files by themselves. When asked for a plan, the
  global `AGENTS.md` tells them to write it here, as `YYYY-MM-DD-<slug>.md`.
- A plan is a working document while it is being carried out, and a record once it is
  done or dropped. It is not rewritten afterwards: what changed during the work belongs in
  the transcript, and the current state in the documents that describe it.

---

## Guidelines for everything else

These keep the documents useful to the agents. They are advice, not checks.

- **A document without a link does not exist for the agent.** None of the three tools reads
  `.artifacts/` on its own: link each document from `.artifacts/INDEX.md` (the map, one line per
  document with what it is for) or from `AGENTS.md`.
- **`AGENTS.md` stays lean** and only states what the agent needs to *do*: every session
  loads all of it. Codex stops reading after 32 KiB in total, global and project
  `AGENTS.md` together (`project_doc_max_bytes`). A new fact rewrites the old statement instead of stacking a
  dated note; the history stays in the transcripts.
- **Each fact lives in one place.** A document that describes the current state is
  rewritten when the state changes.
- **Name things after what they hold**, in kebab-case. A one-line header helps the agent
  decide quickly whether a document still holds:
  `> **Type:** … · **Scope:** … · **Last verified:** YYYY-MM-DD`.
- A rule, skill, subagent or hook is not a document: it goes to `.agents/`.

---

## Checklist

`dotagents check <workspace>` runs the automatable items.

- [ ] `.artifacts/INDEX.md`, `.artifacts/session-archives/` and `.artifacts/plans/` exist,
      and there is no `INDEX.md` at the root.
- [ ] `.claude/settings.json` sets `plansDirectory` to `.artifacts/plans`.
- [ ] No transcript edited after its session.
