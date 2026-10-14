# The `.artifacts/` folder standard

> **Type:** standard · **Scope:** any workspace with `AGENTS.md`, `.agents/` and `.artifacts/` at the root, applied by `agents init` from this repository · **Last verified:** 2026-10-14

`.artifacts/` holds the documentation that agents and people write about the project:
architecture, research, decisions, session transcripts. Agent configuration does not live
here ([`.agents/` standard](agents.md)), and neither do code, secrets or build output.

**The structure is free.** It grows with the project's needs: folders and documents appear
when there is something to put in them, named after what they hold. The only fixed part,
for now, is `session-archives/`.

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

The case behind it: the `AGENTS.md` of the `modulo-simulacao-bio-lab` workspace had turned
into a 21 KB changelog, 40% of it dated notes repeating the logs, and it was loaded whole in
every session.

---

## Fixed: `session-archives/`

```
.artifacts/
├── README.md                       points to this standard in the dotagents repository
├── session-archives/               always exists
│   ├── YYYY-MM-DD-<session-id>.md
│   ├── YYYY-MM-DD-<origin>-<slug>.md
│   └── YYYY-MM-DD-<...>/           session attachments
└── …                               whatever the project needs
```

- One transcript per session. A Claude Code session uses the session id and is produced by
  the `session-archive` skill. A session from another origin (claude.ai, Codex, OpenCode)
  uses `<origin>-<slug>`, as in `2026-10-12-claude-ai-agent-orchestration.md`.
- Attachments go in a folder with the same name as the `.md`, without the extension.
- A transcript is a dated record: **immutable** once the session ends. It is a snapshot of
  that date, so check it against the code before trusting it. Corrections go to the
  document that describes the current state, not to the transcript.

---

## Guidelines for everything else

These keep the documents useful to the agents. They are advice, not checks.

- **A document without a link does not exist for the agent.** None of the three tools reads
  `.artifacts/` on its own: link each document from `INDEX.md` (the map, one line per
  document with what it is for) or from `AGENTS.md`.
- **`AGENTS.md` stays small** (~8 KB; Codex truncates the total at 32 KiB) and only states
  what the agent needs to *do*. A new fact rewrites the old statement instead of stacking a
  dated note; the history stays in the transcripts.
- **Each fact lives in one place.** A document that describes the current state is
  rewritten when the state changes.
- **Name things after what they hold**, in kebab-case. A one-line header helps the agent
  decide quickly whether a document still holds:
  `> **Type:** … · **Scope:** … · **Last verified:** YYYY-MM-DD`.
- A rule, skill, subagent or hook is not a document: it goes to `.agents/`.

---

## Checklist

`agents check <workspace>` runs the automatable items.

- [ ] `.artifacts/session-archives/` exists.
- [ ] `AGENTS.md` at most ~8 KB.
- [ ] No transcript edited after its session.
