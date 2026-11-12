---
name: clean-artifacts
description: Cleans up a workspace's documentation folder (`.artifacts/`, or `docs/`), checking each document against the code, merging the ones that overlap, deleting the stale ones and proposing a folder structure that fits the workspace. Use when the user says there are too many .md files, no longer knows which documents are current, or asks to clean, consolidate, merge or reorganize the documentation.
---

# Clean up the documentation folder

Reduces the documentation to the fewest documents that still say everything true about the
project: each one describes the current state, and each fact lives in one place. Works in two
stages, with the user's approval between them.

The target is `.artifacts/`. If it does not exist, use `docs/` or the folder that `AGENTS.md`
or the README names as documentation. In a workspace that follows the dotagents standard, read
`standards/artifacts.md` in the dotagents repository first: the fixed folders come from it.

## Stage 1: inventory and proposal

Change nothing in this stage.

1. **List every document** in the folder with Glob. Leave out the folders in "Do not touch".
2. **Check each document** against the code and the git history: is it still true, is it
   repeated elsewhere, does anything link to it?
3. **Read the workspace's situation**, which decides the structure (next section): how many
   documents survive, which subjects they cover, how many repositories the workspace holds,
   whether there are third-party sources, where open work is tracked.
4. **Show the proposal** in this order:
   - One table: file | what it holds | fate (keep, merge into `<file>`, delete) | reason in
     one sentence.
   - The proposed tree, with one line saying why this structure fits this workspace, and the
     count before → after.
   - What you could not decide alone. Ask only what changes the result.
   - One line saying whether the folder is under version control. If it is not, say that the
     deletions cannot be undone.
5. **Wait for approval.**

## Choosing the structure

The structure follows what the workspace has, not a template. Pick the smallest one that
works, and propose a folder only when at least two documents go in it.

| Situation | Structure |
|---|---|
| Up to about 7 documents, one subject | Flat: every document beside `INDEX.md`, no subfolders |
| Two or more subjects with different readers (the code, a thesis or research, the product, operations) | One folder per subject, named after it: `coding/`, `research/`, `product/` |
| Several repositories in the workspace | One folder per repository only when their documents do not cross; what is shared stays in a subject folder |
| Third-party sources (papers, books, datasets, client requests) | `sources/` inside the subject that uses them, apart from the documents written about them |
| Open work scattered over several documents | One `tasks.md` (what is to be done) and, for code, one `open-issues.md` (what was found and not fixed) |
| Decisions that people still need to look up | A section in the document of the subject they belong to, not a folder of dated records |

Within a subject, the usual split is one document per question a reader arrives with: how it
is built (architecture), how to write it (standards), what is where (file map), what is broken
(open issues). Merge two documents when a reader would need both to answer one question.

Fixed parts of the dotagents standard, kept as they are: `INDEX.md`, `session-archives/`,
`plans/`, `memory/`.

## Stage 2: execution

After the approval, and only what was approved.

- **Merge by subject.** Rewrite the result as the current state: no stacked dated notes, no
  changelog, nothing repeated from another document (link to it).
- **History already reflected** in the code or in another document is deleted, not migrated.
- **Invent nothing.** If a merge needs a synthesis that no file had, mark the section as your
  synthesis for the user to review.
- **Names** of files and folders in English, kebab-case, no date in the name. The content
  stays in the language it is in.
- **Fix every link** to a file that was moved, merged or deleted, inside the folder and
  outside it: `AGENTS.md`, `CLAUDE.md`, the README, rules, memory notes.
- **Rewrite the index** (`INDEX.md`, created if missing): one line per document saying what
  it is for, plus the convention: English names, few documents, each fact in one place,
  documents describe the current state.

## Do not touch

- Session transcripts and logs, dated plans and the agent's memory notes: no rename, no edit
  (only a broken link inside a memory note is fixed).
- Third-party sources: they may change folder, but are not deleted, and are read only as far
  as needed to identify them.
- Source code and configuration outside the documentation folder, except to fix links.
- Git: no commit and no push.

## Check and report

1. Run a script over every `.md` in the workspace that confirms no relative link is broken,
   and show its output.
2. Report: count before → after, the final tree, what was deleted, what was merged into
   what, the syntheses you wrote, and what still waits for the user's decision.

## Notes

- Work alone. Hand the reading to subagents only when the folder has more than about 50
  documents, and tell the user the size before starting.
- When a document turns out to be wrong but still needed, fix it in the merge and say so in
  the report; do not carry the wrong statement over.
