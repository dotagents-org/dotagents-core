# Commit convention

Applies to every repository. A project rule that contradicts this one lives in that
project's `.agents/rules/` and says what changes.

Based on [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

```
<emoji> <type>[optional scope]: <description>
```

- **Emoji required** (gitmoji), before the `<type>`. It is not optional decoration: the
  rule came from the history of the `modulo-web-backend` and `modulo-web-frontend`
  repositories (another workspace), where every commit follows this format.
- `<type>` and `[scope]` follow regular Conventional Commits (`fix`, `feat`, `refactor`,
  `docs`, `chore`, `ci`, `style`, `perf`, `test`, `build`...). Scope in parentheses when it
  helps (`fix(auth): ...`).
- `nit` is an extension of this rule (not part of official Conventional Commits) for
  cosmetic, non-critical fixes, always with the 🩹 emoji.
- **Description in English**, lowercase, no trailing period.
- **One line only**: no body, no bullet list.
- **No co-author trailer** (`Co-Authored-By: ...`), even when an agent made the commit. The
  commit's author is always the user (local `git` config), never the agent.
- Breaking change: `!` after the type/scope, before the colon (`feat(api)!: ...`), or a
  `BREAKING CHANGE: ...` footer. Since this convention has no body or footer, prefer the
  `!` whenever possible.
- One commit per logically independent change. Don't bundle schema changes with code
  changes in two unrelated modules just because they happened in the same session: split
  by topic, even if that means rebuilding a file in stages (schema.prisma, for example).

## Emoji legend

(Collected from `git log`; not a closed list. Keep the emoji that already identifies a kind
of change when there is a precedent. Based on the official
[gitmoji.dev](https://gitmoji.dev) standard.)

| Emoji | Use |
|---|---|
| ✨ | `feat`: new feature |
| 🐛 | `fix`: bug fix |
| 🩹 | `nit`: non-critical, cosmetic, low-impact fix; paying close attention to small details |
| ♻️ | `refactor`: refactoring without changing external behavior |
| 🗃️ | `feat(database)` / schema change |
| 📝 | `docs` |
| 🚨 | `chore(lint)`: fix a lint or compiler warning |
| ⚰️ | `chore`: remove dead code |
| 🧹 | `chore`: general cleanup (when it isn't specifically lint or dead code) |
| 🔧 | `chore`: configuration |
| 👷 | `ci` |
| 💚 | `ci`: fix the CI build |
| 🐳 | Docker/Dockerfile change |
| 🔒 | security / vulnerability fix |
| 🔐 | secrets (env, credentials) |
| 🛂 | permissions / authorization |
| 🎨 | `style`: formatting, no logic change |
| ✏️ | `fix`: typo |
| 🔥 | remove code or files (general use, beyond ⚰️) |
| 🚚 | move/rename files or routes |
| ⚡️ | `perf`: performance improvement |
| ✅ | `test`: add or fix tests |
| 🚑️ | critical hotfix |
| 🔖 | release/version tag |
| 🚧 | work in progress |
| 💥 | breaking change (alternative to `!`; prefer `!`) |
| ⬆️ | dependency upgrade |
| ⬇️ | dependency downgrade |

## Real examples from that history

```
🐛 fix(units): return null instead of throwing when a unit is not found
♻️ refactor: standardize file naming to kebab-case across modules
🗃️ feat(database): migrate schema and dev stack from MongoDB to PostgreSQL
🧹 chore(lint): clear remaining @typescript-eslint/no-unused-vars warnings
```

## Examples with the newer emojis

```
🩹 nit(ui): tighten spacing on button label
🚨 chore(lint): fix eslint warning on unused import
⚰️ chore: remove dead legacy auth middleware
✏️ fix(readme): correct typo in setup instructions
```
