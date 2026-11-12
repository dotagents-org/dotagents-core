# Obsidian sources: URLs, formats and pitfalls

## Official help: obsidian.md/help

- Pages live at `https://obsidian.md/help/<section>/<page>`. Examples: `/help/bases/syntax`, `/help/bases/views/kanban`, `/help/cli`.
- `help.obsidian.md/...` redirects (301) to `obsidian.md/help/...`. WebFetch doesn't follow cross-domain redirects, so use the new URL directly.
- The site is built from the `obsidianmd/obsidian-help` repository. The `en/` folder is the source of truth; the other languages are translations.
  - List a folder: `gh api repos/obsidianmd/obsidian-help/contents/en/Bases --jq '.[].name'`
  - Read a file: `https://raw.githubusercontent.com/obsidianmd/obsidian-help/HEAD/en/<path>.md`
- What each version added: `https://obsidian.md/changelog/`.

## Community directory: community.obsidian.md

- Plugin: `https://community.obsidian.md/plugins/<id>`. Theme: `https://community.obsidian.md/themes/<slug>`.
- The page shows downloads, current version, creation and last update dates, minimum Obsidian version, platforms, license, readme and a "Health" score.
- The search (`/search?type=plugin`) is rendered in the browser and comes back empty through fetch. Use `scripts/search-plugins.mjs`, which reads:
  - `https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json`, with the fields `id`, `name`, `author`, `description` and `repo`;
  - `.../community-css-themes.json`, with the fields `name`, `author`, `repo` and `screenshot`.
- The list has no downloads or dates. That data is on the plugin page.

## Forum: forum.obsidian.md (Discourse)

- Search: `https://forum.obsidian.md/search.json?q=<terms>`. Returns `topics[]` with `id`, `slug`, `title`, `has_accepted_answer` and `last_posted_at`.
- Topic: `https://forum.obsidian.md/t/<slug>/<id>`. The posts as JSON are at `https://forum.obsidian.md/t/<id>.json`.
- Useful categories: "Help", "Bug reports" and "Feature requests" (check whether the request is still open).
- The forum is almost entirely in English, so search with English terms.

## Developer documentation

- `https://docs.obsidian.md`: plugin API, manifest, publishing guides. Only relevant to questions about building plugins or themes.

## Obsidian CLI (local app)

- Needs the app running. Examples: `obsidian version`, `obsidian plugins:enabled`, `obsidian base:query path=<file.base>` and `obsidian help <command>`.
- On Windows, the `Obsidian.com` executable sits next to `Obsidian.exe`, and the CLI is turned on in Settings → General → Command line interface.
