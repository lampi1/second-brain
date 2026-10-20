# ADR 0095 · Classifier outcomes come from the ledger too; verified and unverified stay apart

Date: 2026-10-20 · Status: accepted (issue #110) · Builds on: ADR 0032 (routing ledger), ADR 0047 (the brain settles
works: judge beats proxy), ADR 0077 (Classificatori page), ADR 0078 (known outcomes of agent runs on the ledger)

## Context
The Classificatori page showed "Esiti verificati" 0 and "nessun dato ancora" on every card while
`<brain>/ops/state/improve/outcomes.jsonl` held 62 known outcomes (28 `human`, 34 `proxy`). The per-route results read
only `userData/agent-runs.json`, which a reinstall restarts. The cards did read the ledger, but every `known: false`
line erased an earlier known outcome, and the app wrote such lines after the brain's verdict: the writer cached the
ledger's known outcomes once per process, so an outcome the brain's loop settled later (ADR 0047) was not carried by the
chat's next measured line (ADR 0078 says it must be). The cards also counted any known outcome as "verified", proxies
included.

## Decision
- **One fold for every reader** (`brain/routing.ts` `lineOutcome` / `foldOutcome`, used by the Classificatori reader
  and `allKindStats`): later line wins; a measured line (`known: false, source: 'measured'`) never undoes a known
  outcome; an explicit `known: false` with another source still retracts; an unverified outcome never replaces a
  verified one. Brain lines may leave out `known` (a boolean `success` is enough), `domain` (an `app:` id is a routing
  line) or name the source as `basis`.
- **Verified** = `human`, `agent-user` (the user's verdict), `agent-review` (a Judge review), `judge` (the brain's
  sample judge, ADR 0047). Everything else — `proxy` (closed without an error line), `agent-orchestrator` (an opinion),
  an unnamed source — is **known but unverified**.
- **Counts**: a chat's verified outcome is its agent run's verified verdict, else the ledger's verified outcome: one
  value per ledger id, so a run present in both sources counts once (the run's verdict first, as before). It feeds the
  cards' success, slices, weeks, compare, the learning meter and the routing rows' success. A chat whose only outcome is
  unverified goes to the card's `unverified` stat, shown on its own line ("Non verificati: N esiti automatici, X%
  riusciti. Non contano nelle riuscite.") and as "+ N non verificati" under "Esiti verificati"; it never fills the
  meter toward the 20 cases. The kinds table (`kindStats`, ADR 0078) still counts any known outcome, as before.
- **The writer re-reads the ledger** whenever it grew by someone else's lines (size check), so the next measured line
  carries the brain's outcome.

## Consequences
- After a reinstall the page shows the ledger's human verdicts at once; proxies are visible but labelled.
- A brain line with a known outcome and no source counts as unverified (before: as verified on the cards).
- The routing rows still measure only the table's own predictions (`source: 'table'`): with agent-first routing
  (ADR 0078) few chats are decided by the table, so most rows stay small by design.
