# ADR 0037 · Useful errors and stats: patterns, the period before, a discussion bar on every number

Date: 2026-10-13 · Status: accepted

## Context
The user, 13/10: "vorrei che gli errori fossero più utili, le stats in generale, vorrei un pulsante vicino tipo
'rifletti o avvia una chat per discuterne' come c'è già in altri punti". Survey of the pages: Qualità (ADR 0024) had
four true numbers but the errors themselves were only a link to ai-errors.md; Costi had a total with no comparison;
Confronto is a report; Fatto, Oggi and DevOps show lists, not stats; the notification center's error items already
open ai-errors.md. The discussion bar ("Discutine" / "Apri una chat") existed only for ideas and reflections (Idee).

## Decision
- **Errors grouped by pattern** (Qualità, "Errori che si ripetono"): ai-errors.md rows grouped by their type, read as
  recurrence.mjs normType() reads it (a non-official label is its own group, marked "tipo non ufficiale"; the brain's
  ALIASES are not copied: the type-based numbers above stay the brain's). Each recurring pattern: count, last seen,
  last 7 days against the 7 before, the latest "detto → vero", areas, chats (with "Apri" when the chat is in the app),
  the rule born from it (from the rows' "regola:" and from recurrence.mjs with its outcome) and how many the owner
  caught. Patterns seen once, patterns quiet for 30 days and rows without a type are one line each: nothing to act on.
- **Never a nameless error.** The old table showed "—" for rows the brain's parser (brain-site/parse.mjs aiErrors)
  leaves without a type: it needs "detto:" (or "vero:") as the 4th field or later, so a line with no type field or no
  "detto:" label gets tipo ''. The app reads the type from the raw line (`riga`) when one of its fields is an official
  type; otherwise the row goes to one group, "Formato non riconosciuto", that shows the raw lines to fix.
- **A "?" with the detailed explanation** next to "Errori che si ripetono": where errors come from (mem.mjs, when the
  user corrects an agent), type, area and chat, "visto da", the comparison, the rule, what to do with a recurring one.
  A plain `<details>` until the shared tooltip of the "Spiegazioni" branch lands.
- **A reading on every number**: one plain-Italian line against the previous period ("in calo: 3 contro 7"), never
  guessed: no previous data = said. Qualità: caught per 100 turns (last 7 days of the logs vs the 7 before), errors
  logged this week vs last. Costi: the period's spend vs the period before, from `/api/cost?days=2N` (the brain caps at
  90 days, so "90 giorni" says it has no comparison; "Oggi" has none either: half a day against a whole one would
  always read "in calo"; the longer periods say today is in, not finished). Rules, held PRs and reopened bugs are snapshots: no fake trend.
- **The discussion bar, generalized** (lib/discuss.ts `Topic` gains `{ kind: 'quote' }`): a recurring error or a
  number quoted with its source and the facts on screen, ending with "Perché succede e come lo evitiamo?" (errors) or
  "Cosa ci dice questo numero?" (numbers), or a question of its own. Same component, same "Discussa" mark keyed by a
  stable id (the pattern or the metric, never the values). On: each Qualità metric with data, each error pattern, the
  Costi total, its advice and every chart (`discuss` prop of the charts), the Confronto report.
- **Zero tokens**: everything is computed in the renderer from the brain's tables; a draft is built only on click.

## Consequences
- A pattern discussed stays "Discussa" while its numbers change; a new discussion adds to the same record.
- Grouping by type alone is coarse when the type is "altro"; areas and chats inside the card show where it comes from.
