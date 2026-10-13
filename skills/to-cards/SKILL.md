---
name: to-cards
description: |
  Turns any loose text (message, email, meeting notes, to-do list, reading list, a request
  from an advisor) into clear task cards, ready for Trello: one card per action, a title
  that starts with a verb, a short description of why, a checklist, priority, due date,
  suggested list and labels, plus a block of titles to paste into Trello and create them
  all at once. Use whenever the user asks to "turn this into cards", "make tasks",
  "organize in Trello", "break into tasks", "turn this message/list into to-dos", or pastes
  a text with several things to do and asks to organize it, even without mentioning Trello.
metadata:
  version: "1.1.0"
---

# to-cards

Turns a messy text into task cards that someone can carry out without rereading the
original text. The value is in three things: **separating** what is mixed together,
**rewriting** clearly and **not inventing** anything.

The output is chat only. The skill doesn't access Trello; the user pastes the final block.

## Flow

1. **Read the whole text** and list each distinct action. One sentence can hold two
   actions ("read the paper and send a summary to the advisor" = 2 cards if they are
   separate deliverables; 1 card with a checklist if the summary is just the end of the
   reading). Rule of thumb: if the two parts can be finished, assigned or postponed
   independently, they are different cards.
2. **Check for gaps that would change the cards** (see "When to ask"). If there are any,
   ask before generating and wait for the answer.
3. **Generate the cards** in the format below.
4. **Close with the block to paste** into Trello.

## When to ask

The user prefers being asked first to getting cards built on assumptions. But too many
questions are tiring, so:

- Ask **only** what would change the cards: it's unclear whether something is one task or
  two; a due date is ambiguous ("by the meeting", without knowing when the meeting is);
  you can't tell what the task actually asks for; no item has any sign of priority.
- Put everything in **a single round of at most 3 questions**. Prefer grouped questions
  ("Do any of these have a due date? If not, I'll leave them without.") to one question
  per card.
- If the text is already clear, **don't ask**: generate right away.
- If the user says to go ahead without answering, mark what is missing as `❓ TBD` (in the
  output language) and generate.

## Content rules

- **Language:** the same as the input text, including the field labels below (in
  Portuguese: `Lista`, `Etiquetas`, `Prioridade`, `Prazo`, `alta/média/baixa`, `❓ a
  definir`). Proper names, paper titles, file names, commands and technical terms stay as
  in the original.
- **Title:** starts with a verb that states the concrete action ("Read…", "Fix…",
  "Configure…", "Send…", "Decide…"; in Portuguese, the infinitive: "Ler…", "Corrigir…").
  Short enough to read in a Trello column (ideally up to ~60 characters). Include the
  specific object ("Fix broken link in INDEX.md", not "Fix problem").
- **Description:** 1–2 lines saying **why** the task exists or what it unblocks. Don't
  repeat the title in other words.
- **Checklist:** only when there are real steps; 2–6 items, each one checkable. No
  checklist for a one-step task.
- **Priority:** high, medium or low, taken from signals in the text (urgency, close due
  date, blocks something else, request from a manager or advisor). If the text gives no
  signal and the user didn't answer, `❓ TBD`.
- **Due date:** turn relative dates into exact dates from today (use the current date from
  the context), in the format `DD/MM/YYYY`, and show the original expression in
  parentheses: `10/10/2026 (by Friday)`. Work out the weekday carefully; if torn between
  two dates, ask. No due date in the text: leave the field out, unless the user asked for
  due dates.
- **List and labels:** suggest them from the content. List = where the card lives in the
  workflow or topic (e.g. "Literature", "Code", "Meeting", "To do"); labels = 1–3 short
  words for topic or type. Use the same names across all cards in the same answer, so the
  board stays consistent.
- **Preserve, don't invent:** links, dates, people's names, numbers, DOIs and file names go
  into the card exactly as they were. Don't add information that isn't in the text (steps,
  owners, reasons). If a reason is unclear, the description says what the text says,
  without filling in a guess.
- **Order:** the order of the text, unless there are clear dependencies; then what
  unblocks comes first, and the dependent card's description mentions the earlier card.

## Answer format

Start with one line saying how many cards came out and in how many lists. Then one block
per card:

```markdown
**<Title>**
List: <list> | Labels: <label>, <label> | Priority: <high/medium/low> | Due: <DD/MM/YYYY (original)>

<Description in 1–2 lines.>

- [ ] <step>
- [ ] <step>

<links, if any>
```

Separate the cards with a `---` line. Leave out of the metadata line the fields that don't
apply (e.g. no due date, no `Due:` part).

At the end, the **block to paste**, grouped by list, one title per line:

````markdown
To create them in Trello: open "Add a card" in the list and paste the block; Trello offers
to create one card per line.

List "<name>":
```
<Title 1>
<Title 2>
```
````

Don't use `·` or an em dash (`—`) as a separator; the user prefers `|`, `:` or `-`.

## Example

**Input:**

> folks, for thursday's meeting: I need someone to review bio-lab PR 82 (the event bus
> one) and run the tests. we also still need to send the prof the new version of the
> review protocol, she asked for it by tomorrow. and remember to renew the firebase
> domain, it expires next month

**Output** (today = 07/10/2026, Wednesday):

3 cards in 3 lists.

**Review bio-lab PR #82 (event bus)**
List: Code | Labels: review, bio-lab | Priority: high | Due: 08/10/2026 (Thursday's meeting)

The PR has to be reviewed and tested before Thursday's meeting.

- [ ] Read the changes in PR #82
- [ ] Run the tests
- [ ] Leave comments or approve

---

**Send the professor the new version of the review protocol**
List: Thesis | Labels: advising | Priority: high | Due: 08/10/2026 (by tomorrow)

Direct request from the advisor, with a short deadline.

---

**Renew the Firebase domain**
List: Infra | Labels: firebase | Priority: medium | Due: ❓ TBD (expires next month)

The domain expires next month; without renewal, the site goes down.

To create them in Trello: open "Add a card" in the list and paste the block; Trello offers
to create one card per line.

List "Code":
```
Review bio-lab PR #82 (event bus)
```

List "Thesis":
```
Send the professor the new version of the review protocol
```

List "Infra":
```
Renew the Firebase domain
```

Note: "run the tests" became a checklist item of the review card, not a card of its own,
because running the tests makes no sense without the review. The domain's due date stayed
as `❓ TBD` because "next month" doesn't give the day; in that case, if it were the only
open point, it would be worth asking first ("do you know the day the domain expires?").
