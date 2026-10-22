# ADR 0122 · Memoria is the hub: one page with tabs, no Dashboard

Date: 2026-10-22 · Status: accepted (owner, 2026-10-22: «io quasi toglierei la dashboard e terrei solo la memoria con
anche la frase in cima… la memoria deve proprio sembrare viva, con UI figa. Tutte le parti dashboard toglile e mergiale
senza ridondanza») · Builds on: ADR 0077 (brain pages), ADR 0101 (Andamento), ADR 0123 (the Proposte deck)

## Context
What the brain holds was spread over six rail entries (Memoria, Skill, Regole, Script, Idee, Apprendimento) plus a
Dashboard that repeated numbers already on Memoria, Costi and Qualità. Each page had its own head, its own «Manutenzione»
and its own counters.

## Decision
- **One page, nine tabs** (`lib/memory-hub.ts` `HUB_TABS`): Proposte, Approvate, Skill, Regole, Script & Query, Idee,
  File, Apprendimento, Statistiche. A pill tab bar with counts, a sliding marker, arrow / Home / End keys, sticky on top.
  The place is `memoria/<tab>[/<its own arg>]`, so back / forward, links and the palette reach a tab.
- **A live head**: the day's sentence (the old Dashboard headline), five counters that count up (proposals, agents at
  work, waiting for you, changes in 24 h, lines in memory; each opens its tab), the last four changes and the one
  «Manutenzione». Motion is subtle and off under `prefers-reduced-motion`.
- **Old pages redirect, ids stay.** `skill`, `regole`, `script`, `idee`, `apprendimento` remain page ids; `go()` turns
  them into `memoria/<tab>` (`hubRedirect`), so their G keys (G S, G L, G T, G I, G J), links and saved recents still
  work. They leave the rail; Memoria's rail entry carries the count of proposals (`useProposalCount`).
- **Approvate** lists skills, rules, confirmed facts and scripts with a bin and «Annulla». Skills, rules and scripts go
  through the new `brainmodel:remove` (brain skills only, `rules/*.md` not loaded always, scripts; ≤ 64 files of
  ≤ 256 KB), recorded in the change log, so «Annulla» is `brainmodel:rollback` and the change stays in Apprendimento.
  A confirmed fact is erased with `memory:delete` only when its toast expires.
- **Idee** splits «Le tue» and «Dell'AI» by the `Chi` column of ideas.md (`IA` is the AI) and «Rispolvera» brings back an
  open idea at least 30 days old (`pickOld`); the AI's Battito board and the ideas' themes live there.
- **The Dashboard is removed** (page id `dashboard` aliased to `memoria`, G D lands there). Each part moved once:
  headline and counters → Memoria head; «Contesto adesso» → Costi; the app's and tools' errors and the errors' themes →
  Qualità; the ideas' themes and the Battito → Idee. Dropped as duplicates: the agents' network (the Grindhouse tree and
  Mappa show it), the AI-error groups and by-day chart (Qualità's patterns), the cost tips (Costi «Adesso» and «Dove
  risparmiare»), Statistiche's KPI row and recurring errors, the per-page heads and their «Manutenzione».

## Consequences
One rail entry for the brain's content and no number shown twice. `brain-layout.ts` and the page ids are unchanged
except `dashboard`. Tests: `test/unit/memory-hub.test.ts`, the trash in `test/unit/brainmodel/service.test.ts`,
`test/e2e/memory-hub.spec.ts`.
