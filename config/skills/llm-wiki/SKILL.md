---
name: llm-wiki
description: >
  Maintain a persistent, interlinked markdown knowledge base (a "wiki") that
  compounds over time instead of being rebuilt from scratch on every query.
  Use when the user asks to ingest a source (article, paper, transcript,
  book chapter) into a wiki, query an existing wiki, or health-check
  ("lint") one. Also use when the user describes wanting to build a
  personal/research/team knowledge base from accumulating sources.
---

## When this applies

This skill only activates inside a **wiki workspace** — a directory
containing `raw/` (immutable sources) and `wiki/` (markdown pages you
maintain). If no such workspace exists yet and the user wants one, run
**Setup** first.

## Setup (first time only)

1. Confirm the domain with the user in one line if it isn't obvious
   (personal knowledge, a research topic, a book, a team/business wiki).
2. Create:
   ```
   <workspace>/
     raw/            # immutable sources — never edit these
     wiki/
       index.md      # catalog of every page, see "index.md format" below
       log.md         # append-only timeline, see "log.md format" below
   ```
3. Write a workspace-local `AGENTS.md` (or append to the existing one)
   describing *this wiki's* specific schema: what page types exist
   (entities? concepts? sources?), naming conventions, and any output
   formats the user wants (slides, charts, comparison tables). This skill
   defines the generic procedure; the workspace's `AGENTS.md` defines the
   domain-specific schema. Don't skip this — a wiki without a stated
   schema drifts into inconsistent pages after a few ingests.
4. Do not invent a schema for the user. Ask what kinds of pages make sense
   for their domain if it isn't obvious (e.g. "characters/themes/plot
   threads" for a book, "entities/concepts" for research).

## Operation: Ingest

Triggered when the user drops a new source in `raw/` (or asks you to add
one) and wants it processed.

1. Read the full source.
2. Discuss key takeaways with the user before writing anything, unless
   they've asked for unsupervised batch ingestion — filing without
   confirmation is the wrong default for a single source.
3. Write or update:
   - A **summary page** for this source in `wiki/`.
   - **Entity/concept pages** it touches — create new ones or update
     existing ones. A single source can reasonably touch 10-15 pages;
     don't stop after one or two if the source is dense.
   - Cross-references between the new/updated pages and related existing
     ones — this is the part a plain RAG system never does, and it's the
     point of maintaining a wiki instead of just indexing files.
   - **Where new data contradicts an existing claim**, note the
     contradiction explicitly on the page rather than silently
     overwriting the old claim. State both, with sources, and flag it in
     `log.md`.
4. Update `wiki/index.md` — add or update the entry for every page you
   touched.
5. Append an entry to `wiki/log.md` (format below).
6. Never edit files under `raw/` — they are the source of truth. If a
   source needs correcting, that's a note on a wiki page, not an edit to
   the raw file.

## Operation: Query

Triggered when the user asks a question against the wiki.

1. Read `wiki/index.md` first to find candidate pages — at moderate scale
   (roughly up to a few hundred pages) this is enough; don't reach for
   embedding search unless the workspace's `AGENTS.md` says a search tool
   is configured (see "Optional: search tooling").
2. Read the relevant pages fully before answering — don't answer from the
   index summaries alone.
3. Synthesize an answer with citations to the specific wiki pages (and,
   through them, the underlying sources).
4. Pick the output form the question calls for — a markdown page, a
   comparison table, a chart, a slide outline — whatever the workspace's
   `AGENTS.md` says the user prefers, defaulting to a plain markdown
   answer if nothing is specified.
5. **If the answer is worth keeping** — a synthesis, a comparison, a
   connection the user didn't already have a page for — offer to file it
   back into the wiki as a new page, linked from `index.md`. This is what
   makes queries compound the wiki instead of disappearing into chat
   history. Don't file every answer automatically; offer, and file if the
   user agrees.

## Operation: Lint

Triggered periodically or when the user asks for a health check.

Look for, and report back before fixing anything:
- Contradictions between pages that were never reconciled.
- Stale claims a newer source has superseded but the page wasn't updated.
- Orphan pages with no inbound links from `index.md` or other pages.
- Concepts mentioned repeatedly across pages but lacking their own page.
- Missing cross-references between pages that clearly relate.
- Gaps a targeted web search or a specific new source could fill.

Propose fixes; don't silently rewrite pages during a lint pass without
the user's go-ahead, especially for resolving contradictions — that's a
judgment call that belongs to the user.

## index.md format

Content-oriented catalog, organized by category (entities, concepts,
sources, etc). One line per page:
```
- [Page Title](path/to/page.md) — one-line summary. (2026-01-15, 3 sources)
```
Update this on every ingest. When answering a query, read this first.

## log.md format

Append-only, chronological. Each entry starts with a consistent prefix so
the log stays parseable with plain text tools:
```
## [2026-01-15] ingest | Article Title
## [2026-01-16] query | question asked, pages touched
## [2026-01-20] lint | 2 contradictions found, 1 orphan page
```
`grep "^## \[" wiki/log.md | tail -5` gives the last 5 entries — useful
for you to re-orient at the start of a session without reading the whole
wiki.

## Optional: search tooling

At small-to-moderate scale, `index.md` plus reading pages directly is
enough — don't add search infrastructure the user didn't ask for. If the
workspace's `AGENTS.md` references a configured search tool (for example
a local hybrid BM25/vector search MCP server), use it instead of manually
scanning `index.md`; otherwise stick to the index.

## What NOT to do

- Don't skip the discuss-before-filing step for a single-source ingest
  unless the user explicitly asked for unsupervised batch mode.
- Don't overwrite a contradicted claim — state both and flag it.
- Don't let a query's answer disappear into chat if it's genuinely worth
  keeping — offer to file it.
- Don't invent a page-type schema; that belongs in the workspace's
  `AGENTS.md`, decided with the user.
- Don't edit anything under `raw/`.

See `references/ingest-query-lint.md` for the full worked rationale behind
this pattern if you need to explain it to the user or adapt it to an
unusual domain.
