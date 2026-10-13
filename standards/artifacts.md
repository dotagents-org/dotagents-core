# Padrão da pasta `.artifacts/`

> **Tipo:** padrão · **Escopo:** qualquer workspace com `AGENTS.md`, `.agents/` e `.artifacts/` na raiz, aplicado pelo `init-workspace.ps1` deste repositório · **Última verificação:** 2026-10-13

`.artifacts/` guarda a documentação que agentes e pessoas escrevem sobre o projeto:
arquitetura, pendências, pesquisa e transcrições de sessão. A configuração dos agentes não
mora aqui ([padrão do `.agents/`](agents.md)), nem código, segredos ou saída de
build.

---

## Base

GALSTER, M. et al. *Configuring agentic AI coding tools: an exploratory study*. AIware '26,
ACM, 2026. DOI [10.1145/3805760.3814887](https://doi.org/10.1145/3805760.3814887).

O artigo define arquivo de contexto como o Markdown que a ferramenta carrega em toda sessão.
Ele aparece em 90,6% dos 2.853 repositórios estudados, muitas vezes como único mecanismo. Os
autores também apontam o risco de várias camadas de arquivos de contexto gerarem instruções
redundantes ou conflitantes.

Este padrão responde dividindo a carga:

- O `AGENTS.md` é o único documento carregado em toda sessão. Ele fica pequeno e só afirma
  o estado atual.
- O resto mora em `.artifacts/` e é lido **sob demanda**, como o corpo e as `references/`
  de uma skill no carregamento progressivo do padrão Agent Skills: o agente consulta o mapa
  (`INDEX.md`) e abre o documento quando a tarefa pede.
- Cada fato mora num lugar só.

Nenhuma das três ferramentas (Claude Code, Codex, OpenCode) lê `.artifacts/` por conta
própria. O único caminho até um documento é um link no `AGENTS.md` ou no `INDEX.md`. Para o
agente, documento sem link não existe.

O caso que deu origem à regra: o `AGENTS.md` do workspace do `modulo-simulacao-bio-lab`
virou um changelog de 21 KB, com 40% do conteúdo em notas datadas que repetiam os logs, e
entrava inteiro em toda sessão.

---

## Os cinco tipos de documento

| Tipo | Onde | Nome | Quando entra no contexto | Regra |
|---|---|---|---|---|
| **Instrução** | `AGENTS.md`, na raiz | fixo | em toda sessão | Só o que o agente precisa *fazer*. Teto de ~8 KB (o Codex corta o total em 32 KiB). Afirma o estado atual e linka o registro. **Nunca recebe entrada de changelog** |
| **Mapa** | `INDEX.md`, na raiz | fixo | quando o agente procura um documento | Uma linha por documento, com "para quê" |
| **Referência viva** | `.artifacts/<área>/` | `<slug>.md`, sem data | quando a tarefa pede | Descreve o estado atual. É mantida e reescrita, e pode contradizer versões anteriores |
| **Registro datado** | `.artifacts/session-archives/` | `AAAA-MM-DD-<id>.md` | quando alguém procura o histórico | Transcrição da sessão. **Imutável** depois que a sessão termina. É um retrato da data: confira contra o código antes de confiar |
| **Fonte** | junto da referência que a usa | `<slug>.<ext>` | quando uma referência aponta para ela | Material bruto ou de terceiros (PDF, JSON, requisição). Não é reescrito |

---

## Estrutura

```
.artifacts/
├── README.md                       aponta para este padrão no repositório agents
├── coding/                         sempre existe: código e projeto
│   ├── pendencias.md               sempre existe: tudo diagnosticado e não corrigido
│   └── <slug>.md
├── <área>/                         outra área, quando o assunto não cabe em coding/
│   ├── <slug>.md
│   └── <fontes>/                   ex.: papers/pdf/ e papers/abstract/
└── session-archives/               sempre existe
    ├── AAAA-MM-DD-<session-id>.md
    ├── AAAA-MM-DD-<origem>-<slug>.md
    └── AAAA-MM-DD-<...>/           anexos da sessão
```

- **Nomes fixos:** `coding/`, `coding/pendencias.md` e `session-archives/`. Assim, em
  qualquer workspace, o agente sabe onde procurar o que está quebrado e o que já aconteceu.
- **Outras áreas** levam o nome do domínio, numa palavra minúscula. No workspace do
  `modulo-simulacao-bio-lab`, `poc/` guarda o TCC.
- **Nomes de arquivo:** kebab-case, sem acento e sem data fora de `session-archives/`.
- **Fonte com resumo:** o resumo tem o mesmo nome-base da fonte (`papers/pdf/x.pdf` →
  `papers/abstract/x.md`).
- **Transcrições:** sessão do Claude Code usa o id da sessão e é gerada pela skill
  `session-archive`. Sessão de outra origem (claude.ai, Codex, OpenCode) usa
  `<origem>-<slug>`, como em `2026-10-12-claude-ai-orquestracao-agentes.md`. Os anexos ficam
  numa pasta com o mesmo nome do `.md`, sem a extensão.

---

## Cabeçalho

Toda referência viva abre com uma linha:

```
> **Tipo:** … · **Escopo:** … · **Última verificação:** AAAA-MM-DD
```

Com ela, o agente decide em 200 bytes se o documento ainda vale. O resumo de uma fonte troca
os dois últimos campos pelos que fazem sentido para ele, por exemplo
`**Fonte:** … · **Lido em:** …`.

---

## Onde escrever o quê

| Aconteceu | Vai para |
|---|---|
| A sessão terminou | a transcrição (`/session-archive`) |
| Fato novo que o agente precisa para agir | `AGENTS.md`, **reescrevendo** a afirmação antiga em vez de empilhar uma nova |
| Problema achado e não corrigido | uma linha em `coding/pendencias.md` |
| Mudou a arquitetura ou uma convenção de código | o documento correspondente em `coding/` |
| Mudou algo de outra área | o documento daquela área |
| Decisão que continua valendo | onde o agente precisa dela (`AGENTS.md` ou a referência da área); o porquê fica na transcrição |
| Documento novo | uma linha no `INDEX.md` |
| Regra, skill, subagente ou hook | não é documento: vai para `.agents/` |

---

## Conferência

- [ ] `AGENTS.md` com até ~8 KB e sem notas datadas.
- [ ] Toda referência viva tem link no `INDEX.md`, direto ou pela pasta.
- [ ] Toda referência viva abre com a linha de cabeçalho.
- [ ] Nenhum nome de arquivo com data fora de `session-archives/`.
- [ ] Nenhuma transcrição editada depois da sessão. Correção vai para a referência viva.
