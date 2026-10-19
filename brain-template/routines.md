---
when: {"prompt":["routine","esegui ora","manutenzione","primo giorno"],"tools":[],"paths":["**/routines.md"]}
---
# Routines

Recurring procedures, run only when {{OWNER}} asks ("esegui ora"): nothing here runs on a schedule by itself.
Read when: the request matches a routine. Write when: a recurring procedure is learned or corrected.

## Primo giorno ("da dove comincio?", "come funziona?")
1. Show the "primi dieci minuti" of `START-HERE.md` in five lines, not the whole file.
2. Ask {{OWNER}} at most three questions on how they want to work (reply length, what an agent may do alone, what
   never); each answer is applied with the `brain-edit` skill, with their exact words.
3. Offer to open the first thread in `now.md` for what they are working on today.

## Report della giornata ("cosa ho fatto oggi")
1. `node {{BRAIN}}/ops/tools/day.mjs report` (journal + chats of the day).
2. Add the missing `fatto` lines to today's journal, then show the report in chat, grouped by area.

## Revisione ("com'è andata", "fai la revisione")
1. `ai-errors.md`, `ai-wins.md` and `proposals.md` since the last review; `node ops/tools/recurrence.mjs`.
2. `node ops/tools/cost.mjs --days 7` for costs; `node ops/tools/flow-signals.mjs --forced` for forced interventions.
3. At most 5 proposals, each with the number it should move; applied only after {{OWNER}}'s yes (`brain-rules.md`).

## Brain maintenance ("fai manutenzione")
1. `node ops/tools/brain-lint.mjs` (sizes, duplicates, map rows) and `node ops/tools/test.mjs` (offline tests).
2. Propose the fixes; apply only after the ok.
