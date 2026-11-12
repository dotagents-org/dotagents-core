# Full rationale of the LLM Wiki pattern

Load this file only when you need to explain the pattern to the user in
depth, adapt it to an unusual domain, or settle an edge case that
`SKILL.md` doesn't cover directly.

## Why it isn't just RAG

Traditional RAG (upload files, retrieve chunks per query) accumulates
nothing: every question rediscovers the knowledge from scratch. A subtle
question that requires synthesizing five documents forces the system to
find and recombine the relevant fragments every time.

The wiki is different: it is a **persistent, cumulative artifact**. The
cross-references already exist. The contradictions have already been
flagged. The synthesis already reflects everything read so far. Each new
source enriches the wiki; nothing is re-derived.

## The three layers

- **raw/**: immutable sources. The source of truth; the skill never edits it.
- **wiki/**: markdown generated and maintained by the AI. Summaries,
  entity/concept pages, comparisons, synthesis. The AI fully owns this
  layer: the user reads, the AI writes.
- **schema (the workspace's AGENTS.md)**: how the wiki is structured,
  conventions, ingest/query/lint workflows for *this* specific domain. It
  co-evolves with the user over time.

## Why the schema stays outside the skill

The skill (`SKILL.md`) is the procedure: generic, reusable across any
wiki. The schema (the workspace's `AGENTS.md`) is the specialization: what
page types exist, taxonomy, citation convention for that specific domain.
Mixing the two makes the skill stop being portable: the next time the user
wants a wiki for a different domain, they would have to edit the skill
instead of just writing a new `AGENTS.md`.

## Example domains (to calibrate the schema with the user)

- **Personal**: goals, health, psychology, self-knowledge, filing journal
  entries, articles, podcast notes.
- **Research**: going deep on a topic over weeks or months, building an
  evolving thesis.
- **Reading a book**: one chapter at a time, pages for characters, themes,
  plot threads and how they connect.
- **Business/team**: an internal wiki fed by Slack threads, meeting
  transcripts, project documents, possibly with humans reviewing updates.
- **Competitive analysis, due diligence, trip planning, course notes, a
  deep hobby**: any accumulation of knowledge over time that benefits from
  being organized instead of scattered.

## Complementary tools (optional, outside the skill's scope)

- **Search at scale**: once the wiki passes ~100 sources / hundreds of
  pages, `index.md` alone starts to fall short. `qmd`
  (github.com/tobi/qmd) is one option: local hybrid BM25/vector search with
  LLM re-ranking, with a CLI and an MCP server.
- **Obsidian** as the wiki's IDE: graph view to see the shape of the
  knowledge (hubs, orphans), Web Clipper to bring articles in as markdown,
  Dataview for dynamic tables from YAML frontmatter if the pages have
  structured tags or dates.
- **Marp**: markdown slide decks, useful when a "Query" asks for a
  presentation instead of a page.
- The wiki is just a git repository of markdown: versioning, branches and
  collaboration come for free, with no extra tool.

## A note on images

AIs don't read markdown with inline images in a single pass. If the
user's schema involves locally downloaded images (e.g. clipped articles),
the right workflow is: read the text first, then view the referenced
images separately for extra context. Document this in the workspace's
`AGENTS.md` if it matters for the domain.
