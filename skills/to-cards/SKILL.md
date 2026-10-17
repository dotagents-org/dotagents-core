---
name: to-cards
description: >
  Turns loose text into clear, actionable task cards. Use when the
  user asks to organize tasks, break text into action items, or
  transform messages, notes, lists, or requests into task cards.
metadata:
  version: "1.2.1"
---

# to-cards

Transform unstructured text into actionable task cards.
Prioritize clarity, useful structure, and factual accuracy.

## Process

1. Identify each distinct action and deliverable.
2. Create separate cards for tasks that can be completed,
   assigned, or postponed independently. Otherwise, use a checklist.
3. Ask up to 3 grouped questions if missing information would
   materially change the cards. Wait for the answers.
4. Generate the cards using the rules below.

Do not ask questions just to fill optional fields. If the user asks
you to proceed despite missing information, mark unresolved fields
as "TBD" or the equivalent in the output language.

## Rules

- Language: Match the input language, including field labels and
  placeholders. Preserve names, technical terms, filenames,
  identifiers, and links as written.

- Style: Do not use emojis or emoticons anywhere in the output.

- Title: Start with a verb expressing a concrete action.
  Be specific and concise, ideally no more than 60 characters.

- Description: Explain the goal or relevant context without
  repeating the title. Never invent reasons or details. Omit the
  description when no useful additional context is available.

- Checklist: Include 2–6 checkable steps only when the task
  genuinely involves multiple steps. Use information stated or
  clearly implied by the source. Omit checklists for simple tasks.

- Priority: Use high, medium, or low when supported by explicit
  urgency, importance, deadlines, or dependencies. Otherwise,
  use "TBD" or its equivalent in the output language.
  Do not ask questions solely to determine priority.

- Due date: Include a date only when mentioned or requested.
  Resolve relative dates using the current date available in context.
  Format as DD/MM/YYYY (original phrase). If the intended deadline
  cannot be determined, ask when it would materially affect the task.
  If the user chooses to proceed, use "TBD". Never guess dates.

- Group and labels: Suggest a relevant category or workflow group
  when useful. Add 1–3 short labels per card and reuse them consistently.

- Accuracy: Preserve dates, numbers, names, links, and filenames.
  Never invent owners, steps, facts, or commitments. Distinguish
  source information from suggestions, and omit unsupported details.

- Order: Preserve the original order unless a clear dependency
  requires otherwise. Put prerequisites first and mention dependencies
  only when supported by the source.

## Output format

Start by stating the number of cards generated.

Use this structure for each card:

**<Title>**

Group: <group> | Labels: <labels> | Priority: <priority> | Due: <date>

<Description, if useful and supported by the source>

- [ ] <Checklist step>
- [ ] <Checklist step>

<Links, if any>

Omit fields that do not apply. Include checklist items and links
only when relevant. Separate cards with ---

## Core principle

Make every card understandable and actionable without requiring
the reader to reread the original text. Separate independent tasks,
combine dependent steps, ask only essential questions, and never
invent information.
