# Getting started

## Requirements

- **Node.js 22.18 or newer**, with npm.
- **git**, on the PATH.
- **npx**, which comes with npm, for third-party skills (`npx skills`).
- One npm dependency, installed by `npm install`: [@clack/prompts](https://github.com/bombshell-dev/clack), for the questions and the spinners.

No administrator rights are needed on Windows: folders are linked with junctions, and files are copied.

## Installation

First, your configuration: copy [`templates/config/`](../templates/config/) into a repository of your own named `dotagents-config` and make it yours, starting with `global/instructions.md` ([Global configuration](global-configuration.md)).

Then, once per machine, clone both into a `dotagents/` folder. WSL counts as a separate machine: it has its own home folder, its own Node and its own copies of the tools, so it needs its own clones and its own `dotagents install`.

```bash
git clone git@github.com:<you>/dotagents-config.git dotagents/dotagents-config
git clone git@github.com:dotagents-org/dotagents-core.git dotagents/dotagents-core
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

## Several Claude accounts

One profile per claude.ai account. Sign in once per account, and save each login in its profile's vault:

```bash
dotagents profile add work            # one profile per account
claude auth login                     # sign in with that account
dotagents switch --save work          # keeps the login in work's vault, once on each side
dotagents switch personal             # later: puts another account in ~/.claude, on both sides
dotagents usage --refresh             # every account's usage, asked of Anthropic
```

On Windows with WSL, each side has its own slot; `switch` changes both, `--here` only this one. Details in [Commands](commands.md#dotagents-profile-add).

## In VS Code (strongly recommended)

dotagents works on its own, from the terminal, and nothing in it needs VS Code. Still, if you use VS Code, install the [dotagents sidebar](https://github.com/dotagents-org/dotagents-sidebar): it is where dotagents is most useful day to day. Claude Code runs in the secondary sidebar, in sessions that survive a window reload, and your accounts sit beside it: every account's usage and state at a glance, the current one in the status bar, and the switch a click away. It reads `dotagents start` on its own, starting it when needed.

Install its `.vsix` from the [latest release](https://github.com/dotagents-org/dotagents-sidebar/releases/latest) (in a WSL window, while connected), reload the window, and open **dotagents: Sidebar** in the secondary sidebar.

Next: [Commands](commands.md) for every option, [Workspaces](workspaces.md) for what a workspace holds, or the [dotagents sidebar's docs](https://github.com/dotagents-org/dotagents-sidebar/tree/main/docs) for VS Code.
