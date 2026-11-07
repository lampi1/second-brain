# 0221: Report corrections, a short child-result debounce, caps instead of refusals

Status: accepted (owner, 2026-11-07: «Sì», max 2 corrections). Amends ADR 0083 (one report per delegation) and ADR 0099
(a child's result waits up to 60 s for its siblings').

## Context

The cloudroom comms study (2026-11-07) counted the refused `agent_report` calls: «already has its result» 3 times in
four days (the agent then asked the user to forward a fix by hand), a summary over 300 characters and an over-long
`remember` line 2 of the 5 refusals of one day. Child results waited up to 60 s for still-working siblings, so a parent
read a finished part a minute late; cloudroom groups child news per parent with a 2 s debounce, the newest entry of a
child replacing the older one.

## Decision

- **Corrections.** `agent_report` with `amends: true` after the first report is a new version of the result. It goes
  the same way as the first (`manager-delegation.ts` `reportDelegation`, `reportRoot`): to the parent as a message
  marked `[correzione n/2 del risultato · …] (sostituisce il risultato precedente di questa chat)`, or to the
  Orchestrator with the same delivery policy as the first: `display` and `notify` stay a notice («Correzione n/2: …»)
  and never open an Orchestrator turn of their own; `synthesize` asks for a synthesis again. At most `MAX_CORRECTIONS`
  = 2 per assignment (the count is kept on the trace, `ChatDelegation.result.corrections`, and on the run,
  `AgentRunReport.corrections`); the third is refused with «already corrected 2 times … the last correction stands».
  A second report without `amends` is refused as before, and the error now says how to correct. `amends` on a first
  report is just the first report.
- **Debounce.** While siblings still owe their results, a child's result waits `CHILD_RESULTS_MS` = 2 s, restarted by
  each new result of the same parent and capped at 2.5 × that (5 s) from the batch's first; then the batch goes, whether
  or not the siblings are done. One entry per child: a newer result (a correction) replaces the one not sent yet; a
  batch already submitting keeps its own copy. When no sibling is left working the batch goes at once, as before.
  2 s is cloudroom's value; the 5 s cap keeps a steady stream of sibling reports from holding the first one.
- **Caps, not refusals.** A summary over `SUMMARY_MAX` (300) is cut at a word boundary with the marker «…» (`capText`,
  `shared/delegation.ts`); its full text is appended to `output` («Sintesi completa: …») when it fits. A `remember` line
  over 300 characters is cut the same way before the worth check. The tool answer carries a warning for each cut.

## Consequences

A wrong result is fixed in one call instead of a trip through the user; a corrected child result can still reach the
parent in the same batch, newest only. A parent may read a batch before every sibling is done (more parent turns in
a long fan-out, each shorter to wait for). Two corrections bound the loop of a child that keeps «fixing».
