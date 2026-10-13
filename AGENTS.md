# Instruções globais

Valem para todos os agentes de código (Claude Code, Codex, OpenCode). A fonte é o `AGENTS.md` do repositório `gabrieldulolmarques/agents`. Edite lá, não nas cópias.

## Comunicação

- Responda em português do Brasil.
- Código, commits e comentários seguem o idioma que o projeto já usa.

## Commits

`<emoji> <type>[scope]: <description>`, com gitmoji e Conventional Commits. A descrição é em inglês, minúscula e sem ponto final. Uma linha só, sem corpo e **sem trailer `Co-Authored-By`**, mesmo quando o commit é feito por um agente. A regra completa, com a legenda de emojis, está em `D:/myWorkspace/agents/rules/commit-conventions.md`.

## Workspaces

Projetos com `AGENTS.md`, `.agents/` e `.artifacts/` na raiz seguem os padrões em `D:/myWorkspace/agents/standards/` (`agents.md` e `artifacts.md`). Skills reutilizáveis moram em `D:/myWorkspace/agents/skills/` e entram em cada workspace como junção. Edite no repositório, não pela cópia.

## Ambiente

- Windows 11. O shell padrão é o PowerShell 5.1, e o Git Bash também está disponível.
- Os projetos ficam em `D:\myWorkspace`.
- Node 24, uv e gh (GitHub CLI) estão instalados. O Python não está no PATH: rode com `uv run` ou `uvx`.
- Links de arquivo exigem administrador nesta máquina. Para links de pasta, use junção (`New-Item -ItemType Junction`).
