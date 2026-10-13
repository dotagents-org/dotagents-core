---
name: map-source-files
description: Mapeia todos os arquivos-fonte de um repositório (ou pasta) em uma tabela Markdown estática de Arquivo / Local / Responsabilidade, lendo cada arquivo para inferir sua responsabilidade real. Use quando o usuário pedir um "mapa do repositório", "inventário de arquivos", "tabela de responsabilidades" ou similar.
---

# Mapear arquivos-fonte em tabela de responsabilidades

Gera um inventário completo dos arquivos-fonte de um repositório (ou de uma
subpasta indicada), com uma linha por arquivo e três colunas: **Arquivo**,
**Local** (pasta/módulo) e **Responsabilidade** (o que o arquivo faz, inferido
lendo seu conteúdo — não apenas o nome/caminho).

## Quando usar

- O usuário pede um mapa/inventário/tabela de todos os arquivos de um repo,
  módulo ou pasta.
- Útil antes de um refactor grande (ex.: a reorganização planejada em
  `artifacts/architecture-target.md` deste workspace) para ter uma foto do
  estado atual.

## Argumentos

O usuário deve indicar (pergunte se faltar):
1. **Repositório/pasta alvo** — ex. `modulo-simulacao-bio-lab/Assets/scripts`,
   ou o repo inteiro.
2. **Filtro de extensões**, se houver (padrão: extensões de código-fonte do
   projeto — `.cs` para Unity; adapte ao stack real do repo alvo, não assuma
   `.cs` fora deste contexto).
3. **Onde salvar o Markdown** — padrão: `artifacts/mapa-arquivos-<slug-da-pasta>-<data-YYYY-MM-DD>.md`
   dentro do `.agents` (este workspace guarda docs gerados por agente
   em `artifacts/`, nunca dentro do repo de código — ver AGENTS.md).

## Passo a passo

1. **Enumerar arquivos** com Glob (não Bash `find`), um padrão por extensão
   relevante, excluindo diretórios gerados/vendor: `Library/`, `Temp/`,
   `obj/`, `bin/`, `node_modules/`, `.git/`, pacotes de terceiros dentro de
   `Packages/` (Unity), `Logs/`, `Build/`.
   - Para um repo grande, rode um Glob por extensão em vez de um único padrão
     `**/*` para manter a lista gerenciável.

2. **Agrupar por pasta** (Local = caminho relativo do diretório até a raiz do
   repo alvo). Isso vira a base da coluna "Local" e da ordenação/seções da
   tabela final.

3. **Ler cada arquivo e inferir a responsabilidade.** Este passo é o que
   distingue esta skill de um simples `ls`: não infira a responsabilidade só
   pelo nome do arquivo.
   - Leia o conteúdo real (Read) de cada arquivo.
   - Escreva a responsabilidade em 1 frase curta e concreta: o que a
     classe/módulo faz, não uma paráfrase do nome do arquivo (ex.:
     "Controla abertura/fechamento do microtubo e notifica a view via evento
     Observer", não "Controlador do microtubo").
   - Se o repo for grande (dezenas/centenas de arquivos), despache a leitura
     em lotes para subagentes (`Agent`, tipo `Explore` ou `general-purpose`)
     em paralelo — um subagente por subpasta/módulo — cada um devolvendo já
     as linhas da tabela nesse formato, para não estourar contexto lendo tudo
     serialmente na conversa principal.
   - Para arquivos claramente triviais/gerados (ex. `*.designer.cs`,
     `AssemblyInfo.cs`, arquivos `.meta` do Unity) pode registrar
     "arquivo gerado/boilerplate — não analisado em detalhe" sem ler o
     conteúdo inteiro, mas não pule silenciosamente: liste-os mesmo assim.

4. **Montar o Markdown final** com uma tabela por seção de pasta (ou uma
   tabela única ordenada por Local, se o total for pequeno — até ~40 linhas).
   Formato de cada tabela:

   ```markdown
   ## `<Local/da/pasta>`

   | Arquivo | Responsabilidade |
   |---|---|
   | `NomeDoArquivo.cs` | Frase curta e concreta do que o arquivo faz. |
   ```

   No topo do documento, incluir:
   - Título com o repo/pasta mapeada e a data.
   - Uma linha de resumo: total de arquivos, total de pastas.
   - Um sumário/índice com links para cada seção de pasta (âncoras
     Markdown), útil em repos grandes.

5. **Salvar** com Write no caminho combinado no passo de argumentos. Não
   sobrescrever um mapa existente sem checar antes se já existe (Read) —
   se existir e o pedido for para atualizar, faça merge das mudanças reais
   em vez de regenerar do zero, e diga ao usuário o que mudou.

6. Ao final, informe ao usuário: caminho do arquivo gerado, quantidade de
   arquivos mapeados, e quaisquer arquivos que não puderam ser lidos
   (binários, arquivos enormes, etc.) para transparência.

## Notas

- Esta skill é somente leitura sobre o código — nunca editar/mover arquivos
  do repo mapeado.
- Repita a leitura arquivo-a-arquivo mesmo que o nome pareça autoexplicativo:
  o objetivo declarado desta skill é responsabilidade real, não paráfrase de
  nome de arquivo/pasta.
- Se o repo alvo já tiver documentação de arquitetura (como
  `artifacts/architecture-current.md` neste workspace), pode usá-la como
  contexto para nomear responsabilidades de forma consistente com os termos
  já estabelecidos — mas sempre confirme contra o conteúdo real do arquivo.
