# Padrão da pasta `.agents/`

> **Tipo:** padrão · **Escopo:** qualquer workspace com `AGENTS.md`, `.agents/` e `.artifacts/` na raiz, aplicado pelo `init-workspace.ps1` deste repositório · **Última verificação:** 2026-10-13

`.agents/` é a fonte única da configuração dos agentes de código: Claude Code, Codex e
OpenCode. As pastas `.claude/`, `.codex/` e `.opencode/` só **adaptam** esse conteúdo ao
formato de cada ferramenta. Se algo pode ser escrito uma vez para as três, ele mora aqui.
A documentação do projeto não fica aqui: ela segue o [padrão do `.artifacts/`](artifacts.md).

---

## Base

GALSTER, M. et al. *Configuring agentic AI coding tools: an exploratory study*. AIware '26,
ACM, 2026. DOI [10.1145/3805760.3814887](https://doi.org/10.1145/3805760.3814887). O
resumo fica no workspace another workspace, em
`.artifacts/poc/papers/abstract/configuring-agentic-ai-coding-tools-an-exploratory-study.md`.

O artigo mapeia 8 mecanismos de configuração em 5 ferramentas e mede a adoção deles em
2.853 repositórios. Três resultados viram regra aqui:

1. **Núcleo comum e adaptadores.** Para quem usa mais de uma ferramenta, os autores
   recomendam manter o `AGENTS.md` como núcleo e usar o arquivo de cada ferramenta como
   adaptador que aponta para ele. Este padrão aplica a mesma ideia aos outros mecanismos: o
   conteúdo fica em `.agents/`, e as pastas das ferramentas só apontam para ele.
2. **Só arquivos de contexto e skills existem nas cinco ferramentas.** São os dois
   mecanismos que este padrão trata como portáveis sem ressalva.
3. **Rules e Commands prendem o fluxo a uma ferramenta.** Commands não entram em
   `.agents/`. A pasta `.agents/rules/` guarda outra coisa, explicada abaixo.

O retrato do artigo é de fevereiro de 2026 e já envelheceu: as skills do Codex, por
exemplo, saíram de `.codex/skills/` para `.agents/skills/`. Os caminhos abaixo foram
conferidos na documentação oficial em 2026-10-13 (skills das três ferramentas; regras e
agentes do OpenCode) e em 2026-09-30 (o resto, em `.artifacts/poc/agentes-de-codigo.md` do
workspace another workspace).

---

## Onde cada mecanismo mora

| Mecanismo | Fonte | Claude Code | Codex | OpenCode |
|---|---|---|---|---|
| Arquivo de contexto | `AGENTS.md` na raiz | `CLAUDE.md` com `@AGENTS.md` | lê direto | lê direto; ignora `CLAUDE.md` quando há `AGENTS.md` |
| Skills | `.agents/skills/<nome>/` | junção `.claude/skills` | lê direto | lê direto |
| Instruções modulares | `.agents/rules/<tema>.md` | junção `.claude/rules` | só pelo link no `AGENTS.md` | `instructions` no `opencode.json` |
| Subagentes | `.agents/agents/<nome>.md` | junção `.claude/agents` | `.codex/agents/<nome>.toml`, escrito a partir do `.md` | junção `.opencode/agents` |
| Hooks | scripts em `.agents/hooks/` | registro no `.claude/settings.json` | registro em `hooks.json` ou `[hooks]` | plugin JS/TS que chama o script |
| Settings | não fica em `.agents/` | `.claude/settings.json` | `.codex/config.toml` | `opencode.json` |
| MCP | não fica em `.agents/` | `.mcp.json` | `[mcp_servers]` no `config.toml` | `mcp` no `opencode.json` |
| Commands | não usar: vira skill | a skill já é `/nome` | descontinuado em favor de skills | `.opencode/commands/` só como atalho para uma skill |

Settings e MCP não têm formato comum entre as ferramentas, por isso ficam direto no arquivo
de cada uma. Credenciais nunca entram nesses arquivos. Servidor MCP que só existe numa
máquina vai no escopo local da ferramenta, não no arquivo do projeto.

---

## Estrutura

```
<workspace>/
├── AGENTS.md                    núcleo (regras de escrita em .artifacts/README.md)
├── CLAUDE.md                    @AGENTS.md + só o que é exclusivo do Claude Code
├── INDEX.md                     mapa dos documentos (padrão do .artifacts/)
├── opencode.json                só se usar OpenCode: instructions, mcp, permissões
├── .agents/
│   ├── README.md                aponta para este padrão no repositório agents
│   ├── rules/<tema>.md          só regras deste projeto
│   ├── skills/<nome>            junção para agents/skills/<nome>, ou skill do projeto
│   ├── agents/<nome>.md         só quando houver o primeiro subagente
│   └── hooks/<script>           só quando houver o primeiro hook
├── .claude/
│   ├── rules  → .agents/rules   junção
│   ├── skills → .agents/skills  junção
│   ├── agents → .agents/agents  junção, quando existir
│   └── settings.json
├── .codex/                      só arquivos no formato do Codex
├── .opencode/
│   └── agents → .agents/agents  junção, quando existir
├── .artifacts/
└── <checkout-git>/
```

Não crie pasta vazia "para o futuro". O artigo achou skills em 5,5% dos repositórios e
subagentes em 4,6%. Mecanismo sem uso real só dá manutenção.

---

## `skills/`

- **Skills reutilizáveis moram no repositório `agents`**, em `skills/<nome>/`, e entram no
  workspace como junção `.agents/skills/<nome>`: `init-workspace.ps1 -Skills <nome>`. Cada
  workspace liga só as que usa. Editar pela junção edita o repositório; faça o commit lá.
- Skill que só faz sentido num projeto fica direto em `.agents/skills/<nome>/` do
  workspace. Se ela ficar útil em outro lugar, mova para o repositório e troque por junção.
- Uma pasta por skill, com o mesmo nome do campo `name`, em kebab-case.
- `SKILL.md` com `name` e `description` no frontmatter, os dois campos que o padrão Agent
  Skills exige. A `description` diz **o que a skill faz e quando usar**. Ela é a única parte
  carregada em toda sessão; o corpo só entra quando a tarefa pede.
- `SKILL.md` com menos de 500 linhas, como recomenda a especificação. Detalhe vai para
  `references/`, código executável para `scripts/` e modelos para `assets/`. O artigo achou
  85,5% das skills sem nenhum desses recursos, só texto. Uma skill que repete um
  procedimento com comandos deve trazer o script.
- O Codex limita a lista inicial de skills a 2% do contexto ou 8.000 caracteres. Por isso:
  descrições curtas, e itens parecidos agrupados numa skill com uma referência por item, em
  vez de uma skill por item.
- O script de uma skill tem a forma de rodar declarada no `SKILL.md`. Não conte com
  `python` ou `node` no PATH.
- Skills de terceiros são instaladas a partir da raiz do workspace, nunca de dentro de
  `.agents/`, senão o instalador cria `.agents/.agents/`. Ficam registradas em
  `skills-lock.json` e não são editadas à mão: a próxima atualização desfaz a edição.
- Em `skills/` só ficam pastas de skill, sem arquivo solto.

---

## `rules/`

O nome engana. No artigo, *Rules* é o mecanismo do Cursor e do Codex, e no Codex
`.codex/rules/` guarda regras de **execução de comandos** (`prefix_rule`), não texto.
`.agents/rules/` segue o sentido do Claude Code (`.claude/rules/`): instruções em Markdown,
separadas por tema, que estendem o arquivo de contexto.

- **Regra que vale em todo lugar não entra aqui.** Ela mora em `rules/` do repositório
  `agents` e é global: o `install.ps1` liga `~/.claude/rules` a ela, e o `AGENTS.md` global
  tem o link para o Codex e o OpenCode. Exemplo: a convenção de commits.
  `.agents/rules/` só guarda o que é específico deste projeto.
- Um tema por arquivo, em kebab-case.
- O Claude Code carrega todo arquivo desta pasta em toda sessão, como faz com o
  `AGENTS.md`. O frontmatter `paths` limita uma regra a certos arquivos, mas só no Claude
  Code. Então só entra aqui o que vale para qualquer tarefa do projeto. O que vale para um
  tipo de tarefa vira skill.
- Todo arquivo daqui tem link no `AGENTS.md`. O Codex não lê esta pasta, e o link é o único
  caminho dele até a regra.
- No OpenCode: `"instructions": [".agents/rules/*.md"]` no `opencode.json`.
- Nada que não seja regra entra aqui, nem README: tudo nesta pasta vai para o contexto.
- Nunca ligue `.agents/rules` a `.codex/rules`.

---

## `agents/`

- Só crie quando houver um caso real: trabalho que precisa de contexto isolado e devolve um
  resumo, como uma busca longa.
- Um arquivo `<nome>.md` por subagente. O núcleo comum às duas ferramentas é `name` (igual
  ao nome do arquivo, de onde o OpenCode tira o nome), `description` (obrigatório nas duas)
  e o corpo, que é o prompt.
- Os outros campos não são compatíveis. O modelo é um apelido no Claude Code e
  `provedor/modelo` no OpenCode; o Claude Code usa `tools` e o OpenCode usa `permission`. Sem
  `mode`, o OpenCode também oferece o subagente como agente principal (`mode: all`). Nenhum
  subagente deste padrão foi testado nas duas ferramentas ainda: confira o primeiro nas duas
  antes de usá-lo como modelo.
- O Codex usa TOML em `.codex/agents/`. Não há gerador: o `.toml` é escrito a partir do
  `.md` e atualizado junto com ele.

---

## `hooks/`

Uma instrução pede, um hook garante. O que precisa acontecer sempre, como rodar os testes
depois de uma edição, vira hook.

- O script mora aqui; o registro fica no arquivo de cada ferramenta (ver a tabela).
- O formato da entrada do hook muda de uma ferramenta para outra. O script recebe por
  argumento o que precisa, e o registro de cada ferramenta faz a ponte.

---

## Commands

Não existe `.agents/commands/`. O artigo mostra que commands prendem o fluxo a uma
ferramenta. O Claude Code fundiu commands com skills (`.claude/skills/x/` vira `/x`), e o
Codex descontinuou os prompts personalizados em favor de skills. Se o OpenCode precisar de
um atalho de barra, o `.opencode/commands/<nome>.md` só manda usar a skill.

---

## Pastas das ferramentas

- Guardam só junções para `.agents/` e arquivos no formato da própria ferramenta.
- **Windows:** use junção: `cmd /c mklink /J <link> <alvo-absoluto>`. Link simbólico exige
  o Modo de Desenvolvedor. O `ln -s` do Git Bash **copia a pasta** e sai com código 0, então
  nunca o use para estes links. Para remover uma junção, use `cmd /c rmdir <link>`; `rm -rf`
  ou `Remove-Item -Recurse` podem apagar o conteúdo do alvo. A junção guarda o caminho
  absoluto: se o workspace mudar de lugar, recrie as junções.
- **Linux e macOS:** `ln -s` com caminho relativo.
- **O OpenCode vê as skills em dobro**, porque lê `.claude/skills` e `.agents/skills`.
  Segundo a documentação dele, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` desliga a leitura de
  `.claude/skills`.

---

## Onde rodar os agentes

Na **raiz do workspace**, onde estão o `AGENTS.md`, o `.agents/` e as junções.

Dentro de um checkout git, as três ferramentas procuram skills subindo só até a raiz
daquele repositório, e o Codex lê o `AGENTS.md` a partir dela. Nenhuma enxerga o `.agents/`
do workspace. Rodar de dentro de um repositório exige links em cada repositório, que este
padrão ainda não define.

---

## Limites

- Quando a raiz do workspace não é um repositório git, como no workspace do
  `modulo-simulacao-bio-lab`, nada daqui é versionado nem chega a quem clona um dos
  repositórios. O artigo só estudou configuração versionada dentro do repositório.
- As ferramentas mudam rápido. Ao atualizar uma delas, confira a tabela de mecanismos e
  atualize a data de "Última verificação".

---

## Conferência

- [ ] Toda pasta de skill tem `SKILL.md` com `name` igual ao nome da pasta, `description` e
      menos de 500 linhas.
- [ ] Todo arquivo de `rules/` tem link no `AGENTS.md`.
- [ ] `.claude/rules` e `.claude/skills` são junções, não cópias: `cmd /c dir /AL .claude`
      lista as duas como `<JUNCTION>`.
- [ ] Não existem `.agents/commands/`, `.agents/.agents/` nem `.codex/skills/`.
- [ ] `.codex/rules/` não tem nada vindo de `.agents/rules/`.
- [ ] `CLAUDE.md` começa com `@AGENTS.md` e não repete o que está nele.
