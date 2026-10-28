# Architecture and development

## Repository layout

```
dotagents/
├── global/
│   ├── instructions.md        global instructions ({{AGENTS_REPO}} is filled in by install)
│   └── env/                   machine notes appended per platform (win32.md, linux.md, darwin.md)
├── rules/                     global rules
├── claude/settings.json       → ~/.claude/settings.json
├── skills/                    own skills
│   └── third-party-skills.json  catalog of third-party skills
├── standards/                 the .agents/ and .artifacts/ standards
├── templates/workspace/       AGENTS.md and INDEX.md for new workspaces
├── assets/                    the account icons: claude-<name>.svg, the source, and the .ico the Start menu shortcuts use
├── docs/                      this documentation
├── cli.ts                     the dotagents command: reads the arguments, picks the command, prints the help
├── commands/                  one file per command: its help, its questions, its run
├── lib/                       the modules (see below)
├── tui/                       the full-screen view: app.ts (frame, tabs, keys) and one file per screen
├── test/                      unit tests (node:test)
├── .github/workflows/         CI: skill validation and command tests on three systems
└── package.json
```

## Modules

The command is TypeScript run directly by Node (type stripping, no build step) with four dependencies: `@clack/prompts` and `picocolors` for the commands, `ink` and `react` for the full-screen view. `cli.ts` reads the arguments and hands them to one of the commands in `commands/`, which asks the questions and calls the modules. Everything that decides what a workspace or a machine should look like lives in `lib/`, in a few modules with small interfaces:

```mermaid
flowchart LR
    cli["cli.ts + commands/<br/>arguments, questions"]
    ws["workspace.ts<br/>the standard: apply + verify"]
    sk["skills.ts<br/>own + third-party skills"]
    tp["thirdparty.ts<br/>catalog, npx installer"]
    git["git.ts<br/>.git/info/exclude"]
    gl["global.ts<br/>machine level"]
    cc["claude-code.ts<br/>Claude Code paths"]
    reg["machine-state.ts<br/>tracked workspaces"]
    common["common.ts<br/>file actions"]
    out["output.ts<br/>events, renderers"]

    cli --> ws & sk & gl & reg & tp
    ws --> sk & git
    sk --> tp
    gl & ws & sk --> cc
    ws & sk & git & gl & tp --> common
    cli & ws & sk & git & gl & common --> out
```

| Module | Interface | Behind it |
|---|---|---|
| `lib/workspace.ts` | `applyWorkspace(repo, ws, skills)`, `verifyWorkspace(repo, ws)`, `wrapRepository(dir)`, `listRepoInAgentsMd`, `assertWorkspace`, `childRepos`, `workspaceName` | The standard as one ordered list of items, each with how to apply it and how to verify it, side by side. `init`, `new` and `update --all` apply the list; `check` verifies it. |
| `lib/skills.ts` | `listSkills(repo)`, `resolveSkills(repo, names)`, `skillsIn(repo, ws)`, `applySkills(ws, skills, { installer })`, `verifySkills(repo, ws)` | Own skills and third-party ones as one list (`name`, `kind`, `source`, `description`). Linking, installing (and in which order), and the skill checks. |
| `lib/thirdparty.ts` | `loadCatalog`, `saveCatalog`, `discoverSkills`, `parseSkill`, `npxInstaller` | The catalog file, reading `SKILL.md`, and the installer adapter that runs `npx skills add`. |
| `lib/git.ts` | `ensureExcluded`, `removeExcluded`, `gitRepoOf`, `isRepoRoot`, `trackedAgentFiles`, `untrackedAgentFiles` | Keeping agent files out of a project's git through `.git/info/exclude`. |
| `lib/global.ts` | `installGlobal(repo, configDir?)`, `renderInstructions(repo)` | The machine level: instructions, rules and settings, applied to one Claude Code config folder (`~/.claude` by default). |
| `lib/claude-code.ts` | `defaultConfigDir`, `userFiles(configDir)`, `projectFiles(ws)` | Where Claude Code reads its configuration, at the user level and in a workspace. No other module spells these paths out. |
| `lib/accounts.ts` | `setUpAccount`, `dropAccount`, `installAccounts`, `verifyAccounts`, `launcherFile` | The Claude accounts of the machine: a config folder each, the configuration applied to it, and a `claude-<name>` launcher. |
| `lib/desktop.ts` | `applyDesktop`, `removeDesktop`, `verifyDesktop`, `powershellShortcuts` | A second Claude Desktop app per account on Windows: data folder, `.vbs` launcher and Start menu shortcut. Shortcuts go through an adapter: PowerShell for real, a fake one in the tests. |
| `lib/usage.ts` | `accountUsage(account, now)`, `normalize(cache, now)`, `pace(window, now)`, `bar(pct)` | The usage of an account, read from Claude Code's cache and normalized into windows (session, week, per-model week), with the pace and the states (not signed in, no data, stale). Takes "now" as an argument, so the tests fix it. |
| `lib/machine-state.ts` | `loadWorkspaces`, `registerWorkspace`, `untrackWorkspace`, `loadAccounts`, `saveAccount`, `removeAccount`, `stateDir` | What dotagents remembers about this machine, outside the repository. Every file has a format version and is checked when read: a broken file, or one from a newer dotagents, stops the command instead of being overwritten. |
| `lib/common.ts` | file actions (`ensureDirLink`, `ensureFile`, `writeGenerated`, `ensureJsonKey`…), `runWithSpinner`, `parseArgs` | Junctions on Windows and symlinks elsewhere, backups, dry run. |
| `lib/output.ts` | `report`, `checkItem`, `checkWarn`, `section`, `header`, `finish`, `setRenderer`, `displayPath` | Every result becomes an event for the current renderer: the rail in a terminal, plain lines when piped, a list in the tests. The modules never print. |
| `lib/state.ts` | `state`, `resetState` | The run: `--dry-run`, the counters behind the summary and the exit code, and the folder paths are shown relative to. |

Three decisions shape the modules:

- **A rule of the standard is written once.** Adding one means adding an item to the list in `lib/workspace.ts`, with its `apply` and its `verify` next to each other.
- **Output is an event stream.** A module reports what happened (`report`, `checkItem`…) and never formats it; the renderer decides how it looks. A new output (`--json`, a full-screen view) is one more renderer, not a change in the modules.
- **Third-party installation is an adapter.** `applySkills` receives an `installer`: `npxInstaller` by default, a fake one in the tests. The order that matters (link `.claude/skills` first, install after) stays inside the skills module.

Every action is idempotent: it looks at what is there, does nothing when it is already right, and reports `ok`. That is what makes `--dry-run`, repeated runs and `update --all` safe.

## Development

```bash
npm install
npm test                 # type check (tsc, strict) + unit tests (node:test)
node cli.ts --help      # run without npm link
```

**Unit tests** (`test/`) go through the modules' interfaces on real temporary folders: applying and verifying a workspace, idempotency, dry run, links versus copies, wrapping a repository, third-party skills through a fake installer (no network), git exclusion inside a real repository, the global install with a temporary home folder, and the `move-sessions` script against a temporary Claude Code data folder. They run in a couple of seconds.

**CI** runs on every push that touches the code:

- **Validate skills:** runs [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) on every skill in `skills/`.
- **Test scripts:** on Linux, Windows and macOS, it:
  - runs `npm test` and links the command;
  - runs every command end to end, including real `npx skills` installations and `new` with local repositories;
  - checks that a second run changes nothing.

**Commits** follow [the commit convention](../rules/commit-conventions.md): gitmoji plus Conventional Commits, one line in English, no co-author trailer.

**The full-screen view (`tui/`)** is a second way to show what `lib/` knows, next to the commands. Each screen is a file in `tui/screens/` that reads from `lib/` and renders with Ink, without JSX (`createElement`), because Node runs `.ts` but doesn't turn JSX into code. What a module reports through events (a checklist, an install) reaches a screen through `capture()`, which keeps the events instead of printing them. The view is loaded only when used, so the commands don't load React.

**Actions on a screen** go through `useAction` (`tui/action.ts`): it runs the module once as a preview (`captureAsync` with `dryRun: true`), shows what would change, and runs it for real on `y`. The terminal spinner stays off inside the view, since it would draw over it.

**Adding a screen:** write `tui/screens/<name>.ts` exporting a `Screen` (id, title, `Component`), add it to `SCREENS` in `tui/app.ts` (the order is the tabs' order and the number keys'), and cover it in `test/tui.test.ts`.

**Changing an account icon:** edit `assets/claude-<name>.svg`, then rebuild the `.ico` (16 to 256 px) and run `dotagents install` on Windows:

```bash
uvx --from cairosvg==2.7.1 cairosvg assets/claude-<name>.svg -o /tmp/icon.png -W 256 -H 256
uv run --no-project --with pillow==12.0.0 python -c "from PIL import Image; Image.open('/tmp/icon.png').save('assets/claude-<name>.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])"
```

**Adding a command:** write `commands/<name>.ts` exporting a `Command` (name, usage, summary, group, `run`), add it to `COMMANDS` in `cli.ts` (the order is the help's order), and describe it in [Commands](commands.md) and in the table of the README.

**Adding a rule to the workspace standard:**

1. Add an item to `STANDARD` in `lib/workspace.ts` with `apply` and `verify`.
2. Add a test in `test/workspace.test.ts`.
3. Describe the rule in `standards/` and in [What init creates](workspaces.md#what-init-creates) and [What check verifies](workspaces.md#what-check-verifies).

**After changing a command,** update [commands.md](commands.md), and the summary table in the [README](../README.md#commands-at-a-glance) when the command list changes.
