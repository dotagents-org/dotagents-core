---
name: obsidian-docs
description: Consulta a documentação oficial do Obsidian (obsidian.md/help), o diretório da comunidade (community.obsidian.md, plugins e temas) e o fórum (forum.obsidian.md) para responder dúvidas sobre o Obsidian com fontes. Use quando a pergunta envolver recursos nativos (Bases, Canvas, Markdown do Obsidian, propriedades, Sync, Publish, CLI, configurações), "existe plugin/tema que faz X", comparar ou avaliar plugins, bugs conhecidos, workarounds ou pedidos de recurso.
compatibility: Requer Node 18+ e acesso à internet. O gh (GitHub CLI) e o CLI do Obsidian são opcionais.
metadata:
  author: gabrieldulolmarques
  version: "1.0.0"
---

# Consulta à documentação e à comunidade do Obsidian

Responda dúvidas sobre o Obsidian com base em fontes verificáveis, não de memória. O Obsidian muda rápido (o Kanban do Bases, por exemplo, chegou na 1.14), então sempre confira.

## 1. Escolha a fonte pela pergunta

| Tipo de pergunta | Fonte |
|---|---|
| Recurso nativo, sintaxe, configuração | Ajuda oficial |
| "Tem plugin/tema que…", avaliar plugin | Diretório da comunidade |
| Bug, workaround, "alguém já fez…", pedido de recurso | Fórum |
| Criar plugin, API | docs.obsidian.md |

Em perguntas mistas, comece pela ajuda oficial e complete com o fórum. URLs, formatos e armadilhas de cada fonte estão em [references/fontes.md](references/fontes.md).

## 2. Busque

**Ajuda oficial:** abra `https://obsidian.md/help/<seção>/<página>` com WebFetch (ex.: `/help/bases/syntax`). Se não souber o caminho, busque no repositório que gera o site:
```bash
gh search code --repo obsidianmd/obsidian-help "<termo>" --limit 10
```

**Plugins e temas:** a busca do community.obsidian.md não funciona via fetch. Use o script, que filtra a lista oficial:
```bash
node scripts/buscar-plugins.mjs "<termo ou regex>"           # plugins
node scripts/buscar-plugins.mjs "<termo>" --temas            # temas
```
Depois abra a página `community.obsidian.md/plugins/<id>` dos melhores candidatos pra ver downloads, data da última atualização, versão mínima e plataformas.

**Fórum:**
```bash
node scripts/buscar-forum.mjs "<termos em inglês>"
```
Leia de 1 a 3 tópicos. Priorize os marcados `[resolvido]` e as respostas da equipe.

Os caminhos `scripts/` são relativos à pasta desta skill.

## 3. Confira no vault quando fizer diferença

Se o Obsidian estiver aberto, `obsidian version` e `obsidian plugins:enabled` mostram a versão instalada e os plugins ativos. Avise quando o recurso pedir uma versão mais nova que a instalada.

## 4. Responda

- Seja direto e cite as URLs consultadas.
- Separe o que é **documentação oficial** do que é **relato da comunidade**.
- Ao recomendar plugin, compare downloads e data da última atualização. Avise quando ele está há mais de 1 ano sem atualização, ou quando um recurso nativo já resolve (ex.: Bases no lugar de Dataview ou Kanban).
- Se nada confirmar a resposta, diga isso, em vez de completar de memória.
