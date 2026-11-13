# Getting started

## Requirements

- **Node.js 22.18 or newer**, with npm.
- **git**, on the PATH.
- **npx**, which comes with npm, for third-party skills (`npx skills`).
- One npm dependency, installed by `npm install`: [@clack/prompts](https://github.com/bombshell-dev/clack), for the questions and the spinners.

No administrator rights are needed on Windows: folders are linked with junctions, and files are copied.

## Installation

Once per machine. WSL counts as a separate machine: it has its own home folder, its own Node and its own copies of the tools, so it needs its own clone and its own `dotagents install`.

```bash
git clone git@github.com:<you>/dotagents-core.git dotagents/dotagents-core
cd dotagents/dotagents-core
npm install            # the dependencies
npm link               # creates the `dotagents` command, pointing to this clone
dotagents install      # global instructions, rules and settings for this machine
```

`npm link` copies nothing. It links the package into npm's global folder and creates the `dotagents` command there (`dotagents`, `dotagents.cmd` and `dotagents.ps1` on Windows). Run it again if the clone moves, or after switching to another Node version with nvm, since each Node installation has its own global folder.

Without `npm link`, every command also works as `node cli.ts <command>` from the clone.

On Linux with Node from the system package manager, `npm link` may ask for `sudo`. To avoid it, point npm's global folder to your home first:

```bash
npm config set prefix ~/.local     # and have ~/.local/bin on the PATH
```

To remove the command: `npm unlink -g dotagents` in the clone.

## First workspace

```bash
# Start a project in the recommended layout
cd ~/projects
dotagents new git@github.com:me/app.git      # creates app-workspace/ with app/ inside, asks which skills to use

# Or apply the standards to a folder that already exists
# (on a git repository, init offers to move it into <name>-workspace/)
dotagents init ~/projects/notes --skills obsidian-docs,humanizer

# Check that a workspace still follows the standards
dotagents check ~/projects/app-workspace

# Bring everything up to date on this machine
dotagents update --all
```

Run Claude Code from the workspace root, where `AGENTS.md` and `.agents/` are.

Next: [Commands](commands.md) for every option, or [Workspaces](workspaces.md) for what a workspace holds.
