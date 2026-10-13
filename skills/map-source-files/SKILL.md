---
name: map-source-files
description: Maps every source file in a repository (or folder) into a static Markdown table of File / Location / Responsibility, reading each file to infer what it actually does. Use when the user asks for a "repository map", "file inventory", "responsibility table" or similar.
---

# Map source files into a responsibility table

Builds a complete inventory of a repository's source files (or of a given subfolder), with
one row per file and three columns: **File**, **Location** (folder/module) and
**Responsibility** (what the file does, inferred by reading its content, not just its name
or path).

## When to use

- The user asks for a map, inventory or table of all files in a repo, module or folder.
- Useful before a large refactor, to have a snapshot of the current state.

## Arguments

The user should give (ask if missing):
1. **Target repository/folder**, e.g. `modulo-simulacao-bio-lab/Assets/scripts`, or the
   whole repo.
2. **Extension filter**, if any (default: the project's source extensions, such as `.cs`
   for Unity; match the target repo's real stack, don't assume `.cs` elsewhere).
3. **Where to save the Markdown**. Default, following the `.artifacts/` standard:
   `.artifacts/coding/source-map-<folder-slug>.md` at the workspace root, never inside the
   code repository. No date in the name: the date goes in the header line.

## Steps

1. **List the files** with Glob (not Bash `find`), one pattern per relevant extension,
   excluding generated or vendored folders: `Library/`, `Temp/`, `obj/`, `bin/`,
   `node_modules/`, `.git/`, third-party packages inside `Packages/` (Unity), `Logs/`,
   `Build/`.
   - For a large repo, run one Glob per extension instead of a single `**/*` pattern to
     keep the list manageable.

2. **Group by folder** (Location = the directory's path relative to the target repo's
   root). This becomes the "Location" column and the order and sections of the final
   table.

3. **Read each file and infer its responsibility.** This step is what sets this skill
   apart from a plain `ls`: don't infer the responsibility from the file name alone.
   - Read the actual content (Read) of each file.
   - Write the responsibility as one short, concrete sentence: what the class/module does,
     not a paraphrase of the file name (e.g. "Opens and closes the microtube and notifies
     the view through an Observer event", not "Microtube controller").
   - If the repo is large (dozens or hundreds of files), hand the reading off in batches to
     subagents (`Agent`, type `Explore` or `general-purpose`) in parallel, one subagent per
     subfolder/module, each returning its table rows in this format, so the main
     conversation doesn't run out of context reading everything serially.
   - For clearly trivial or generated files (e.g. `*.designer.cs`, `AssemblyInfo.cs`,
     Unity `.meta` files) you may record "generated file/boilerplate, not analyzed in
     detail" without reading the whole content, but don't skip them silently: list them
     anyway.

4. **Build the final Markdown** with one table per folder section (or a single table
   sorted by Location, if the total is small, up to ~40 rows). Format of each table:

   ```markdown
   ## `<Folder/location>`

   | File | Responsibility |
   |---|---|
   | `FileName.cs` | Short, concrete sentence about what the file does. |
   ```

   At the top of the document, include:
   - The header line from the `.artifacts/` standard:
     `> **Type:** living reference · **Scope:** source files of <target> · **Last verified:** YYYY-MM-DD`.
   - A title with the mapped repo/folder.
   - A one-line summary: total files, total folders.
   - A table of contents with links to each folder section (Markdown anchors), useful in
     large repos.

5. **Save** with Write at the path agreed in the arguments step. Don't overwrite an
   existing map without checking first (Read): if it exists and the request is an update,
   merge the real changes instead of regenerating from scratch, and tell the user what
   changed. Add a line for the map in `INDEX.md` when it is new.

6. At the end, tell the user: the path of the generated file, how many files were mapped,
   and any files that couldn't be read (binaries, huge files, etc.), for transparency.

## Notes

- This skill is read-only on the code: never edit or move files in the mapped repo.
- Read file by file even when the name looks self-explanatory: the stated goal of this
  skill is the real responsibility, not a paraphrase of file or folder names.
- If the target repo already has architecture documentation (in `.artifacts/coding/`, for
  example), you may use it as context to name responsibilities consistently with the
  established terms, but always confirm against the file's actual content.
