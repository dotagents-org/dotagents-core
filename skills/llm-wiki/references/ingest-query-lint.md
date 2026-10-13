# Racional completo do padrão LLM Wiki

Carregue este arquivo apenas quando precisar explicar o padrão ao usuário
em profundidade, adaptá-lo a um domínio incomum, ou decidir um caso de
borda que o `SKILL.md` não cobre diretamente.

## Por que não é só RAG

RAG tradicional (upload de arquivos, retrieval de chunks por query) não
acumula nada — cada pergunta redescobre o conhecimento do zero. Uma
pergunta sutil que exige sintetizar cinco documentos obriga o sistema a
encontrar e recombinar os fragmentos relevantes toda vez.

O wiki é diferente: é um **artefato persistente e cumulativo**. As
referências cruzadas já existem. As contradições já foram sinalizadas. A
síntese já reflete tudo que foi lido até agora. Cada fonte nova enriquece
o wiki; nada é re-derivado.

## As três camadas

- **raw/** — fontes imutáveis. Fonte de verdade; a skill nunca edita isso.
- **wiki/** — markdown gerado e mantido pela IA. Resumos, páginas de
  entidade/conceito, comparações, síntese. A IA é dona total desta
  camada — o usuário lê, a IA escreve.
- **schema (AGENTS.md do workspace)** — como o wiki está estruturado,
  convenções, workflows de ingest/query/lint para *este* domínio
  específico. Co-evolui com o usuário ao longo do tempo.

## Por que o schema fica fora da skill

A skill (`SKILL.md`) é o procedimento — genérico, reutilizável entre
qualquer wiki. O schema (`AGENTS.md` do workspace) é a particularização —
que tipos de página existem, taxonomia, convenção de citação daquele
domínio específico. Misturar os dois faz a skill parar de ser portável: a
próxima vez que o usuário quiser um wiki de domínio diferente, teria que
editar a skill em vez de só escrever um novo `AGENTS.md`.

## Domínios de exemplo (para calibrar o schema com o usuário)

- **Pessoal**: metas, saúde, psicologia, autoconhecimento — arquivando
  entradas de diário, artigos, notas de podcast.
- **Pesquisa**: aprofundamento num tópico ao longo de semanas/meses,
  construindo uma tese que evolui.
- **Leitura de livro**: um capítulo por vez, páginas de personagens, temas,
  linhas de enredo e como se conectam.
- **Negócio/time**: wiki interno alimentado por threads de Slack,
  transcrições de reunião, documentos de projeto — possivelmente com
  humanos revisando updates.
- **Análise competitiva, due diligence, planejamento de viagem, notas de
  curso, hobby profundo** — qualquer acúmulo de conhecimento ao longo do
  tempo que se beneficia de estar organizado em vez de espalhado.

## Ferramentas complementares (opcionais, fora do escopo da skill)

- **Busca em escala** — quando o wiki passa de ~100 fontes / centenas de
  páginas, `index.md` sozinho começa a não bastar. `qmd`
  (github.com/tobi/qmd) é uma opção: busca local híbrida BM25/vetorial com
  re-ranking por LLM, tem CLI e servidor MCP.
- **Obsidian** como IDE do wiki — graph view pra ver a forma do
  conhecimento (hubs, órfãs), Web Clipper pra trazer artigos como
  markdown, Dataview pra tabelas dinâmicas a partir de frontmatter YAML
  se as páginas tiverem tags/datas estruturadas.
- **Marp** — decks de slide em markdown, útil quando "Query" pede uma
  apresentação em vez de uma página.
- O wiki é só um repo git de markdown — versionamento, branches e
  colaboração vêm de graça, sem ferramenta extra.

## Nota sobre imagens

IAs não leem markdown com imagens inline numa passada só. Se o schema do
usuário envolve imagens baixadas localmente (ex: artigos clipados), o
workflow correto é: ler o texto primeiro, depois visualizar as imagens
referenciadas separadamente para contexto adicional. Documente isso no
`AGENTS.md` do workspace se for relevante pro domínio.
