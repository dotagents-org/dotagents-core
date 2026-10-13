# agents

Minha configuração de agentes de código (Claude Code, Codex e OpenCode) num lugar só: instruções e regras globais, skills, os padrões das pastas `.agents/` e `.artifacts/` e os scripts que aplicam tudo isso na máquina e em cada workspace.

## Estrutura

```
agents/
├── AGENTS.md                # instruções globais, valem em qualquer pasta
├── rules/                   # regras globais (ex.: convenção de commits)
├── standards/
│   ├── agents.md            # padrão da pasta .agents/ de um workspace
│   └── artifacts.md         # padrão da pasta .artifacts/ de um workspace
├── skills/                  # skills reutilizáveis (formato Agent Skills)
├── templates/workspace/     # modelos de AGENTS.md, INDEX.md e pendencias.md
├── claude/settings.json     # ~/.claude/settings.json
├── opencode/opencode.json   # ~/.config/opencode/opencode.json
├── install.ps1              # aplica a parte global na máquina
├── init-workspace.ps1       # aplica os padrões a um workspace, ou confere (-Check)
└── lib/common.ps1           # funções usadas pelos dois scripts
```

## Global: `install.ps1`

```powershell
git clone git@github.com:gabrieldulolmarques/agents.git D:\myWorkspace\agents
D:\myWorkspace\agents\install.ps1 -WhatIf   # mostra o que vai fazer, sem mudar nada
D:\myWorkspace\agents\install.ps1
```

| O quê | Para onde | Como | Depois de editar |
|---|---|---|---|
| `AGENTS.md` (Claude Code) | `~/.claude/CLAUDE.md` | import `@.../AGENTS.md` | vale na hora |
| `AGENTS.md` (Codex) | `~/.codex/AGENTS.md` | cópia | rodar `install.ps1` |
| `AGENTS.md` (OpenCode) | `~/.config/opencode/AGENTS.md` | cópia | rodar `install.ps1` |
| `rules/` (Claude Code) | `~/.claude/rules` | junção | vale na hora |
| `rules/` (Codex e OpenCode) | link no `AGENTS.md` | caminho absoluto | vale na hora |
| `claude/settings.json` | `~/.claude/settings.json` | cópia | rodar `install.ps1` |
| `opencode/opencode.json` | `~/.config/opencode/opencode.json` | cópia | rodar `install.ps1` |

As skills não são globais: cada workspace liga só as que usa.

## Por workspace: `init-workspace.ps1`

```powershell
# aplica os padrões e liga duas skills
D:\myWorkspace\agents\init-workspace.ps1 -Path D:\myWorkspace\Obsidian -Skills obsidian-docs, session-archive -WhatIf
D:\myWorkspace\agents\init-workspace.ps1 -Path D:\myWorkspace\Obsidian -Skills obsidian-docs, session-archive

# confere se o workspace segue os padrões, sem mudar nada
D:\myWorkspace\agents\init-workspace.ps1 -Path D:\myWorkspace\Obsidian -Check
```

O script cria só o que falta e nunca sobrescreve conteúdo seu:

- `AGENTS.md`, `INDEX.md` e `.artifacts/coding/pendencias.md` a partir dos modelos, só se ainda não existirem;
- `CLAUDE.md` com `@AGENTS.md`;
- `.agents/README.md` e `.artifacts/README.md` apontando para os padrões em `standards/`;
- `.agents/skills/<nome>` como junção para `skills/<nome>` deste repositório;
- `.claude/skills` e `.claude/rules` como junções para `.agents/`.

O `-Check` roda a conferência dos dois padrões:

- tamanho do `AGENTS.md` e primeira linha do `CLAUDE.md`;
- junções de verdade (e não pastas copiadas);
- `name` de cada skill igual ao nome da pasta;
- regras com link no `AGENTS.md`;
- pastas proibidas;
- datas em nomes de arquivo.

## Skills

| Skill | O que faz |
|---|---|
| [obsidian-docs](skills/obsidian-docs/SKILL.md) | Responde dúvidas sobre o Obsidian consultando a ajuda oficial, o diretório de plugins e temas e o fórum. |
| [session-archive](skills/session-archive/SKILL.md) | Grava a transcrição da sessão do Claude Code em `.artifacts/session-archives/`. |
| [map-source-files](skills/map-source-files/SKILL.md) | Gera uma tabela Arquivo / Local / Responsabilidade dos arquivos-fonte de um repositório. |
| [to-cards](skills/to-cards/SKILL.md) | Transforma texto solto (mensagem, e-mail, ata) em cards de tarefa. |

As skills seguem a [especificação Agent Skills](https://agentskills.io/specification), e as regras de escrita estão em [standards/agents.md](standards/agents.md#skills). Também dá para instalar uma skill avulsa em outro lugar com o CLI do [skills.sh](https://skills.sh):

```bash
npx skills add git@github.com:gabrieldulolmarques/agents.git -s obsidian-docs
```

Skills de terceiros (ex.: `npx skills add blader/humanizer`) não entram aqui, para continuarem recebendo as atualizações do autor com `npx skills update`.

O GitHub Actions valida as skills com o [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) a cada push que mexe em `skills/`. Para rodar localmente:

```bash
PYTHONUTF8=1 uvx --from "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref" skills-ref validate skills/<nome>
```

## Limites

- **Links de arquivo** no Windows exigem administrador ou Modo de Desenvolvedor. Por isso as pastas são junções e os arquivos são cópias ou imports.
- **Junções guardam caminho absoluto.** Se este repositório ou um workspace mudar de lugar, rode os scripts de novo.
- **Os settings mudam pelo próprio app.** Quando você muda uma opção no Claude Code ou no OpenCode, a cópia da máquina fica diferente da do repositório. O `install.ps1` guarda a versão da máquina como backup antes de sobrescrever. Para manter a mudança, copie o arquivo de volta para cá e faça commit.
- **O `~/.codex/config.toml` fica de fora.** O app do Codex escreve nele caminhos de runtime com hash, nomes de pipe e projetos confiáveis, coisas específicas desta máquina.
