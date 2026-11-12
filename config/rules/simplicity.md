# Simplicity

Applies to every task: code, plans, docs and questions. Based on the Karpathy guidelines
(forrestchang/andrej-karpathy-skills), Ponytail (DietrichGebert/ponytail) and Anthropic's
prompting best practices.

- Do what was asked. Make only the changes that are requested or clearly necessary: no extra
  features, options, configurability or "while I'm here" refactors.
- Before writing anything, ask: does it need to exist? Does the platform, the standard library
  or a dependency we already have do it? Can it be shorter?
- No abstraction for a single use. A few repeated lines beat an early helper.
- No handling for cases that can't happen. Validate at the boundaries (user input, network,
  environment) and trust internal code.
- Surgical changes: touch only what the task needs, follow the existing style, and every changed
  line traces back to the request. Point out unrelated problems instead of fixing them.
- Plans follow the same rule: the smallest version that works now. The rest goes to a short
  "later" list, not designed in advance. Ask few questions, only the ones that change the work.
- Test: would a senior engineer call this too complicated? Then simplify.
- Never cut correctness to save lines: input validation, security (auth, injection, path
  traversal, secrets) and data integrity always stay.
