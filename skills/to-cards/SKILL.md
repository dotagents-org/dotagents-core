---
name: to-cards
description: |
  Transforma qualquer texto solto (mensagem, e-mail, anotação de reunião, lista de
  tarefas, lista de artigos, pedido da orientadora) em cards de tarefa claros, prontos
  para o Trello: um card por ação, título com verbo, descrição curta do porquê,
  checklist, prioridade, prazo, lista e etiquetas sugeridas, mais um bloco de títulos
  para colar no Trello e criar todos de uma vez. Use sempre que o usuário pedir para
  "passar para cards", "virar tarefas", "organizar no Trello", "quebrar em tarefas",
  "transformar essa mensagem/lista em to-dos", ou colar um texto com várias coisas a
  fazer e pedir para organizar, mesmo sem citar o Trello.
metadata:
  version: "1.0.0"
---

# to-cards

Transforma um texto desorganizado em cards de tarefa que alguém consegue executar sem
reler o texto original. O valor está em três coisas: **separar** o que está misturado,
**reescrever** com clareza e **não inventar** nada.

A entrega é só no chat. A skill não acessa o Trello; o usuário cola o bloco final.

## Fluxo

1. **Ler o texto inteiro** e listar mentalmente cada ação distinta. Uma frase pode ter
   duas ações ("ler o artigo e mandar resumo para a orientadora" = 2 cards se forem
   entregas separadas; 1 card com checklist se o resumo for só o fim da leitura).
   Critério: se as duas partes podem ser concluídas, atribuídas ou adiadas
   independentemente, são cards diferentes.
2. **Verificar lacunas que mudariam os cards** (ver "Quando perguntar"). Se houver,
   perguntar antes de gerar e esperar a resposta.
3. **Gerar os cards** no formato abaixo.
4. **Fechar com o bloco para colar** no Trello.

## Quando perguntar

O usuário prefere ser consultado antes a receber cards com suposições. Mas perguntas
demais cansam, então:

- Pergunte **só** o que mudaria os cards: não está claro se algo é uma ou duas tarefas;
  um prazo é ambíguo ("até a reunião", sem saber quando é a reunião); não dá para saber
  o que a tarefa pede de fato; não há nenhum sinal de prioridade em nenhum item.
- Junte tudo em **uma única rodada de no máximo 3 perguntas**. Prefira perguntas
  agregadas ("Algum destes tem prazo? Se não, deixo sem.") a uma pergunta por card.
- Se o texto já é claro, **não pergunte**: gere direto.
- Se o usuário disser para seguir sem responder, marque o que faltar como
  `❓ a definir` e gere.

## Regras de conteúdo

- **Idioma:** o mesmo do texto de entrada. Nomes próprios, títulos de artigos, nomes de
  arquivos, comandos e termos técnicos ficam como no original.
- **Título:** começa com verbo no infinitivo que diz a ação concreta ("Ler…",
  "Corrigir…", "Configurar…", "Enviar…", "Decidir…"). Curto o bastante para ler numa
  coluna do Trello (idealmente até ~60 caracteres). Inclua o objeto específico
  ("Corrigir link quebrado no INDEX.md", não "Corrigir problema").
- **Descrição:** 1–2 linhas dizendo **por que** a tarefa existe ou o que ela destrava.
  Não repita o título com outras palavras.
- **Checklist:** só quando há passos reais; 2–6 itens, cada um verificável. Sem
  checklist para tarefa de um passo.
- **Prioridade:** `alta`, `média` ou `baixa`, tirada de sinais do texto (urgência,
  prazo próximo, bloqueia outra coisa, pedido da chefia/orientação). Se o texto não dá
  sinal e o usuário não respondeu, `❓ a definir`.
- **Prazo:** converta datas relativas em data exata a partir de hoje (use a data atual
  do contexto), no formato `DD/MM/AAAA`, e mostre a expressão original entre
  parênteses: `10/10/2026 (até sexta)`. Calcule o dia da semana com cuidado; na dúvida
  entre duas datas, pergunte. Sem prazo no texto: omita o campo, a menos que o usuário
  tenha pedido prazos.
- **Lista e etiquetas:** sugira conforme o conteúdo. Lista = onde o card mora no fluxo
  ou no tema (ex.: "Literatura", "Código", "Reunião", "A fazer"); etiquetas = 1–3
  palavras curtas de tema ou tipo. Use os mesmos nomes em todos os cards da mesma
  resposta, para o quadro ficar coerente.
- **Preservar, não inventar:** links, datas, nomes de pessoas, números, DOIs e nomes de
  arquivos vão para o card exatamente como estavam. Não acrescente informação que não
  está no texto (passos, responsáveis, motivos). Se um motivo não está claro, a
  descrição diz o que o texto diz, sem completar com suposição.
- **Ordem:** a ordem do texto, a menos que haja dependências claras; nesse caso, o que
  destrava vem antes, e a descrição do card dependente cita o card anterior.

## Formato da resposta

Comece com uma linha dizendo quantos cards saíram e em quantas listas. Depois, um
bloco por card:

```markdown
**<Título>**
Lista: <lista> | Etiquetas: <etiqueta>, <etiqueta> | Prioridade: <alta/média/baixa> | Prazo: <DD/MM/AAAA (original)>

<Descrição em 1–2 linhas.>

- [ ] <passo>
- [ ] <passo>

<links, se houver>
```

Separe os cards com uma linha `---`. Omita da linha de metadados os campos que não se
aplicam (ex.: sem prazo, sem a parte `Prazo:`).

No fim, o **bloco para colar**, agrupado por lista, um título por linha:

````markdown
Para criar no Trello: abra "Adicionar um cartão" na lista e cole o bloco; o Trello
oferece criar um cartão por linha.

Lista "<nome>":
```
<Título 1>
<Título 2>
```
````

Não use `·` nem travessão (`—`) como separador; o usuário prefere `|`, `:` ou `-`.

## Exemplo

**Entrada:**

> pessoal, pra reunião de quinta: preciso que alguém revise o PR 82 do bio-lab (o do
> event bus) e rode os testes. também falta mandar pra prof a versão nova do protocolo
> de revisão, ela pediu até amanhã. e lembrar de renovar o domínio do firebase, vence
> mês que vem

**Saída** (hoje = 07/10/2026, quarta-feira):

3 cards em 2 listas.

**Revisar o PR #82 do bio-lab (event bus)**
Lista: Código | Etiquetas: revisão, bio-lab | Prioridade: alta | Prazo: 08/10/2026 (reunião de quinta)

PR precisa estar revisado e testado antes da reunião de quinta.

- [ ] Ler as mudanças do PR #82
- [ ] Rodar os testes
- [ ] Deixar comentários ou aprovar

---

**Enviar à professora a versão nova do protocolo de revisão**
Lista: TCC | Etiquetas: orientação | Prioridade: alta | Prazo: 08/10/2026 (até amanhã)

Pedido direto da orientadora, com prazo curto.

---

**Renovar o domínio do Firebase**
Lista: Infra | Etiquetas: firebase | Prioridade: média | Prazo: ❓ a definir (vence mês que vem)

O domínio vence no mês que vem; sem renovação, o site sai do ar.

Para criar no Trello: abra "Adicionar um cartão" na lista e cole o bloco; o Trello
oferece criar um cartão por linha.

Lista "Código":
```
Revisar o PR #82 do bio-lab (event bus)
```

Lista "TCC":
```
Enviar à professora a versão nova do protocolo de revisão
```

Lista "Infra":
```
Renovar o domínio do Firebase
```

Repare: "rode os testes" virou checklist do card de revisão, não um card próprio,
porque não faz sentido rodar os testes sem a revisão. O prazo do domínio ficou como
`❓ a definir` porque "mês que vem" não diz o dia; nesse caso, se fosse o único ponto
em aberto, valeria perguntar antes ("sabe o dia em que o domínio vence?").
