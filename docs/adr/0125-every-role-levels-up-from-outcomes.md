# ADR 0125 · Every role levels up from outcomes; no copy-link bar button, no agent packs

Date: 2026-10-22 · Status: accepted (owner, 22/10: "assicurati che tutti gli agenti riescano a progredire di livello,
tipo il Sentinel che è quello che giudica: da chi viene giudicato? Deve progredire anche senza giudizi manuali";
"i pulsanti copia link in cima alle pagine non servono a una sega, e anche importa/esporta agente") · Builds on: ADR
0100 (XP = verified successes), 0114 (the judging switch) · Supersedes: the agent pack import/export (ADR 0077
"Export / import", the packs ADR 0083 and 0088 build on)

## Context
With the judging switch on, a Sentinel reviews every finished **root** run, so the Orchestrator (its decisions) and a
role opened by it could gain XP. Two kinds of run could never be verified without the owner's hand:
- **delegated children** (a Scout, Artisan, Sentinel or Herald started by a Strategist or an Artisan): never sampled,
  because a root review chat would show the child's content to the Orchestrator (ADR 0083); their parent's
  `agent_child_feedback` is an opinion (× 0.6), never verified;
- **the Sentinel's own reviews**, its main job: excluded from sampling (`reviewOf`) and never judged by anyone.

## Decision
`standing.ts earnedVerdict` (pure, deterministic, from agent-runs.json only) gives the XP verdict of a run:
1. the user's or a verified review's (unchanged);
2. **chain**: a delegated child is a success (or partial) when its `agent_report` met every criterion
   (`via: agent_report`, `verified: yes`), reached its parent before the parent ended, it had no correction (counted
   and zero), no reopen or rework in 7 days, the parent did not rate it partial or fail, and the parent run is itself
   verified (recursively). A failed parent gives nothing (the cause is unknown). Weight in the performance × 0.5;
3. **graded** (the judge is judged): a Sentinel review with verified evidence and a verdict is graded by what happened
   later: the user's verdict on the reviewed run, else a later independent second review of it, else a fact against
   it (it said success and the run was then reopened or reworked). Agreement = success, one step off = partial,
   opposite = fail. Silence never grades for. Weight × 0.8;
4. **audits**: `judge-sample.ts` gives one reviewed run in 10 (`AUDIT_EVERY`, a fixed sha256 pick of the run id) a
   second Sentinel review in another fresh session, with the same prompt (it never sees the first verdict), after the
   first one was recorded. The audit never becomes the run's feedback; it only grades the first review.
Child runs are still never sampled: the chain covers them at zero tokens. The pruned runs keep these successes in
`RunTally.earnedWins`. The §5 success rate (`run-metrics.ts`) still counts only the user and verified reviews.

Cost: the audits add 1/10 of the switch's review cost (`judgingEstimate.auditsPerDay`, shown beside the switch); the
chain and the grading are free. Without the switch and without the user's verdicts nothing is verified, so no level
grows: the switch is the automatic path.

Also removed: the «Copia link» button of the page bar (the palette's "Copia il link di questo punto" and the chat menu
keep it), and the agent pack import/export (`agents:exportPlan|exportFix|export|importInspect|importApply|importCancel`,
`AgentPackHost`, `AgentPackDetails`, the drop overlay): the roles are fixed (`shared/roles.ts`). The shareable brain
zip (ADR 0088) stays, with what it shares with the pack code (`pack/zip.ts`, `toml.ts`, `rules.ts packRules`, the
runtime plugin sanitizer `read.ts`).

## Consequences
- A Sentinel and every delegated role now level up from outcomes; a child's credit is bounded by an independent verdict
  on its parent, and a Sentinel can lose by disagreeing with the user or a second review.
- Two Sentinel sessions on the same model can share a blind spot: an audit agreement weighs less than the user's.
- Not done: test or build results inside a run, a merged PR, a plan step done are not recorded per run; they would be
  further objective facts (open point).
