# dotagents documentation

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Requirements, installation on each system (WSL included), the first workspace. |
| [Commands](commands.md) | Every command and option, the output, exit codes and environment variables. |
| [Workspaces](workspaces.md) | The workspace layout, wrapping a repository, what `init` creates and what `check` verifies, the standards behind them. |
| [Skills](skills.md) | Own and third-party skills, skills that call other skills, writing one, taking over a third-party one. |
| [Global configuration](global-configuration.md) | What `install` writes on the machine, and from where. |
| [Recipes](recipes.md) | Common tasks, start to finish. |
| [Architecture and development](architecture.md) | Repository layout, modules, tests, CI, how to add a rule. |
| [Troubleshooting and limits](troubleshooting.md) | Failing checks and how to fix them, known limits. |
| [Use case: an Obsidian vault](use-cases/obsidian-vault.md) | A notes vault as a workspace: setup, the AGENTS.md, what a cloud drive or git sync carries, pitfalls. |

The standards themselves live in [standards/](../standards/): [`.agents/`](../standards/agents.md) and [`.artifacts/`](../standards/artifacts.md).
