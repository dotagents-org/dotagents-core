# Global instructions

These apply to Claude Code. The source is `global/instructions.md` in the dotagents repository, cloned at `{{AGENTS_REPO}}`. Edit it there and run `dotagents install` again, not in the copies.

## Communication

- Reply in Brazilian Portuguese.
- Code, commits and comments follow the language the project already uses.
- A trailing comment gets exactly one space before `#` or `//` (`code # comment`), never padding to align comments, even where PEP 8 asks for two. This holds in code, docs and command examples.

## Commits

`<emoji> <type>[scope]: <description>`, with gitmoji and Conventional Commits. The description is in English, lowercase, with no trailing period. One line only, no body, and **no `Co-Authored-By` trailer**, even when an agent makes the commit. The full rule, with the emoji legend, is in `{{AGENTS_REPO}}/rules/commit-conventions.md`.

## Workspaces

Projects with `AGENTS.md`, `.agents/` and `.artifacts/` at the root follow the standards in `{{AGENTS_REPO}}/standards/` (`agents.md` and `artifacts.md`). Reusable skills live in `{{AGENTS_REPO}}/skills/` and enter each workspace as a link. Edit them in the repository, not through the link's copy.

In those workspaces, when you write a plan before implementing something, save it in `.artifacts/plans/` as `YYYY-MM-DD-<slug>.md`. Plan mode already writes there, through `plansDirectory`.
