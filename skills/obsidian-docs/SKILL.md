---
name: obsidian-docs
description: Looks up the official Obsidian documentation (obsidian.md/help), the community directory (community.obsidian.md, plugins and themes) and the forum (forum.obsidian.md) to answer questions about Obsidian with sources. Use when the question involves built-in features (Bases, Canvas, Obsidian Markdown, properties, Sync, Publish, CLI, settings), "is there a plugin/theme that does X", comparing or evaluating plugins, known bugs, workarounds or feature requests.
compatibility: Requires Node 18+ and internet access. gh (GitHub CLI) and the Obsidian CLI are optional.
metadata:
  author: gabrieldulolmarques
  version: "1.1.0"
---

# Obsidian documentation and community lookup

Answer questions about Obsidian from verifiable sources, not from memory. Obsidian changes fast (the Bases kanban view, for example, arrived in 1.14), so always check.

## 1. Pick the source for the question

| Kind of question | Source |
|---|---|
| Built-in feature, syntax, setting | Official help |
| "Is there a plugin/theme that…", evaluating a plugin | Community directory |
| Bug, workaround, "has anyone done…", feature request | Forum |
| Building a plugin, API | docs.obsidian.md |

For mixed questions, start with the official help and fill in from the forum. URLs, formats and pitfalls for each source are in [references/sources.md](references/sources.md).

## 2. Search

**Official help:** open `https://obsidian.md/help/<section>/<page>` with WebFetch (e.g. `/help/bases/syntax`). If you don't know the path, search the repository that builds the site:
```bash
gh search code --repo obsidianmd/obsidian-help "<term>" --limit 10
```

**Plugins and themes:** the community.obsidian.md search doesn't work through fetch. Use the script, which filters the official list:
```bash
node scripts/search-plugins.mjs "<term or regex>"           # plugins
node scripts/search-plugins.mjs "<term>" --themes           # themes
```
Then open `community.obsidian.md/plugins/<id>` for the best candidates to see downloads, last update date, minimum version and platforms.

**Forum:**
```bash
node scripts/search-forum.mjs "<terms in English>"
```
Read 1 to 3 topics. Prefer the ones marked `[solved]` and answers from the team.

The `scripts/` paths are relative to this skill's folder.

## 3. Check the vault when it matters

If Obsidian is open, `obsidian version` and `obsidian plugins:enabled` show the installed version and the enabled plugins. Warn when a feature needs a newer version than the installed one.

## 4. Answer

- Answer in the user's language. Be direct and cite the URLs you used.
- Separate **official documentation** from **community reports**.
- When recommending a plugin, compare downloads and last update date. Warn when it has gone more than a year without updates, or when a built-in feature already covers it (e.g. Bases instead of Dataview or Kanban).
- If nothing confirms the answer, say so instead of filling in from memory.
