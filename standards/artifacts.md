# The `.artifacts/` folder standard

> **Type:** standard · **Scope:** any workspace with `AGENTS.md`, `.agents/` and `.artifacts/` at the root, applied by `agents init` from this repository · **Last verified:** 2026-10-13

`.artifacts/` holds the documentation that agents and people write about the project:
architecture, pending issues, research and session transcripts. Agent configuration does
not live here ([`.agents/` standard](agents.md)), and neither do code, secrets or build
output.

---

## Basis

GALSTER, M. et al. *Configuring agentic AI coding tools: an exploratory study*. AIware '26,
ACM, 2026. DOI [10.1145/3805760.3814887](https://doi.org/10.1145/3805760.3814887).

The paper defines a context file as the Markdown a tool loads in every session. It appears
in 90.6% of the 2,853 repositories studied, often as the only mechanism. The authors also
point out the risk of several layers of context files producing redundant or conflicting
instructions.

This standard answers by splitting the load:

- `AGENTS.md` is the only document loaded in every session. It stays small and only states
  the current state.
- Everything else lives in `.artifacts/` and is read **on demand**, like a skill's body and
  `references/` under the Agent Skills progressive loading: the agent looks at the map
  (`INDEX.md`) and opens the document when the task calls for it.
- Each fact lives in one place only.

None of the three tools (Claude Code, Codex, OpenCode) reads `.artifacts/` on its own. The
only way to a document is a link in `AGENTS.md` or `INDEX.md`. To the agent, a document
without a link does not exist.

The case behind the rule: the `AGENTS.md` of the `modulo-simulacao-bio-lab` workspace had
turned into a 21 KB changelog, 40% of it dated notes repeating the logs, and it was loaded
whole in every session.

---

## The five document types

| Type | Where | Name | When it enters the context | Rule |
|---|---|---|---|---|
| **Instruction** | `AGENTS.md`, at the root | fixed | every session | Only what the agent needs to *do*. Cap of ~8 KB (Codex truncates the total at 32 KiB). States the current state and links the record. **Never takes a changelog entry** |
| **Map** | `INDEX.md`, at the root | fixed | when the agent looks for a document | One line per document, with what it is for |
| **Living reference** | `.artifacts/<area>/` | `<slug>.md`, no date | when the task calls for it | Describes the current state. It is maintained and rewritten, and may contradict earlier versions |
| **Dated record** | `.artifacts/session-archives/` | `YYYY-MM-DD-<id>.md` | when someone looks for the history | Session transcript. **Immutable** once the session ends. It is a snapshot of that date: check it against the code before trusting it |
| **Source** | next to the reference that uses it | `<slug>.<ext>` | when a reference points to it | Raw or third-party material (PDF, JSON, request). Never rewritten |

---

## Layout

```
.artifacts/
├── README.md                       points to this standard in the dotagents repository
├── coding/                         always exists: code and project
│   ├── pending.md                  always exists: everything diagnosed and not fixed
│   └── <slug>.md
├── <area>/                         another area, when the subject doesn't fit in coding/
│   ├── <slug>.md
│   └── <sources>/                  e.g. papers/pdf/ and papers/abstract/
└── session-archives/               always exists
    ├── YYYY-MM-DD-<session-id>.md
    ├── YYYY-MM-DD-<origin>-<slug>.md
    └── YYYY-MM-DD-<...>/           session attachments
```

- **Fixed names:** `coding/`, `coding/pending.md` and `session-archives/`. That way, in any
  workspace, the agent knows where to look for what is broken and what already happened.
- **Other areas** take the domain's name, as one lowercase word. In the
  `modulo-simulacao-bio-lab` workspace, `poc/` holds the thesis.
- **File names:** kebab-case, no accents and no date outside `session-archives/`. A
  source may keep its publication year (`liu-2026-...pdf`); only a full date is not
  allowed.
- **Source with a summary:** the summary has the same base name as the source
  (`papers/pdf/x.pdf` → `papers/abstract/x.md`).
- **Transcripts:** a Claude Code session uses the session id and is produced by the
  `session-archive` skill. A session from another origin (claude.ai, Codex, OpenCode) uses
  `<origin>-<slug>`, as in `2026-10-12-claude-ai-agent-orchestration.md`. Attachments go in
  a folder with the same name as the `.md`, without the extension.

---

## Header

Every living reference opens with one line:

```
> **Type:** … · **Scope:** … · **Last verified:** YYYY-MM-DD
```

With it, the agent decides in 200 bytes whether the document still holds. A source
summary swaps the last two fields for ones that make sense for it, for example
`**Source:** … · **Read on:** …`.

---

## Where to write what

| What happened | Where it goes |
|---|---|
| The session ended | the transcript (`/session-archive`) |
| A new fact the agent needs to act | `AGENTS.md`, **rewriting** the old statement instead of stacking a new one |
| A problem found and not fixed | one line in `coding/pending.md` |
| The architecture or a code convention changed | the matching document in `coding/` |
| Something in another area changed | that area's document |
| A decision that still holds | where the agent needs it (`AGENTS.md` or the area's reference); the why stays in the transcript |
| A new document | one line in `INDEX.md` |
| A rule, skill, subagent or hook | not a document: it goes to `.agents/` |

---

## Checklist

`agents check <workspace>` runs the automatable items.

- [ ] `AGENTS.md` at most ~8 KB and without dated notes.
- [ ] Every living reference is linked from `INDEX.md`, directly or through its folder.
- [ ] Every living reference opens with the header line.
- [ ] No file name with a full date outside `session-archives/`.
- [ ] No transcript edited after its session. Corrections go to the living reference.
