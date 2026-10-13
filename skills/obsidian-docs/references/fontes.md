# Fontes do Obsidian: URLs, formatos e armadilhas

## Ajuda oficial: obsidian.md/help

- Páginas em `https://obsidian.md/help/<seção>/<página>`. Exemplos: `/help/bases/syntax`, `/help/bases/views/kanban`, `/help/cli`.
- `help.obsidian.md/...` redireciona (301) pra `obsidian.md/help/...`. O WebFetch não segue redirecionamento entre domínios, então use a URL nova direto.
- O site é gerado do repositório `obsidianmd/obsidian-help`. A pasta `en/` é a fonte oficial e as outras línguas são traduções.
  - Listar uma pasta: `gh api repos/obsidianmd/obsidian-help/contents/en/Bases --jq '.[].name'`
  - Ler um arquivo: `https://raw.githubusercontent.com/obsidianmd/obsidian-help/HEAD/en/<caminho>.md`
- O que entrou em cada versão: `https://obsidian.md/changelog/`.

## Diretório da comunidade: community.obsidian.md

- Plugin: `https://community.obsidian.md/plugins/<id>`. Tema: `https://community.obsidian.md/themes/<slug>`.
- A página mostra downloads, versão atual, datas de criação e de última atualização, versão mínima do Obsidian, plataformas, licença, readme e uma nota de "Health".
- A busca (`/search?type=plugin`) é renderizada no navegador e volta vazia via fetch. Use `scripts/buscar-plugins.mjs`, que lê:
  - `https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json`, com os campos `id`, `name`, `author`, `description` e `repo`;
  - `.../community-css-themes.json`, com os campos `name`, `author`, `repo` e `screenshot`.
- A lista não traz downloads nem datas. Esses dados ficam na página do plugin.

## Fórum: forum.obsidian.md (Discourse)

- Busca: `https://forum.obsidian.md/search.json?q=<termos>`. Devolve `topics[]` com `id`, `slug`, `title`, `has_accepted_answer` e `last_posted_at`.
- Tópico: `https://forum.obsidian.md/t/<slug>/<id>`. Os posts em JSON ficam em `https://forum.obsidian.md/t/<id>.json`.
- Categorias úteis: "Help", "Bug reports" e "Feature requests" (veja se o pedido ainda está aberto).
- O fórum é quase todo em inglês, então busque com termos em inglês.

## Documentação para desenvolvedores

- `https://docs.obsidian.md`: API de plugins, manifest, guias de publicação. Só vale pra perguntas sobre criar plugins ou temas.

## CLI do Obsidian (app local)

- Precisa do app aberto. Exemplos: `obsidian version`, `obsidian plugins:enabled`, `obsidian base:query path=<arquivo.base>` e `obsidian help <comando>`.
- No Windows, o executável `Obsidian.com` fica ao lado do `Obsidian.exe`, e o CLI é ativado em Configurações → Geral → Command line interface.
