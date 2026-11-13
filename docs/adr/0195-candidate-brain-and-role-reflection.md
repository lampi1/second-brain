# 0195 — The maintenance writes a candidate brain, and reflects on one role's text as a trial

Status: accepted. Builds on ADR 0077, ADR 0083, ADR 0123, ADR 0132, ADR 0153 and ADR 0186.

2026-10-29.

## Context

The owner asked to implement the analysis «Second-brain: app solida, brain e Manutenzione». Two of its proposals:

- **M3, a candidate brain.** Anthropic's «dreaming» for managed agents (platform docs `managed-agents/dreams`; blog «New
  in Claude Managed Agents», 2026-05-19): a job reads the sessions and a memory store and writes a NEW output store
  (duplicates merged, superseded values replaced, new insights) without modifying its input; the user compares and uses
  or discards it. Our research (ADR 0132) made one Proposte card per brain change: five cards that touch the same files,
  decided one by one, each with its own «Annulla», none showing what the brain would look like as a whole.
- **M5, reflective role-text evolution.** GEPA (Agrawal et al., ICLR 2026 oral): an LLM reflects on recorded
  trajectories of a prompt's failures and proposes a revised prompt; candidates are kept on a Pareto front and the best
  survive. The roles are fixed (owner rule: no new roles), but their behaviour text may change as a trial (ADR 0083,
  0186: a trial version measured against the frozen baseline, kept or rolled back by the user).

Constraints: approval only for production, permissions/settings/hooks and texts to others; zero tokens where
possible; the 5 $ cap of a research (ADR 0153); no timer; the brain itself is never written before the user's yes.

## Decision

**The candidate brain** (`brainmodel/research-candidate.ts`).

- A research finding that only writes brain files — a skill without a role, a rule for every role
  (`rules/lessons.md` and its `brain.json` topic), forgetting a brain skill or a `rules/` file — is held while the
  research runs (`ResearchProposal.candidateId = 'pending'`, no card of its own). Findings that touch a role (its text,
  a skill linked to it) and app ideas/bugs stay individual cards, as before.
- When the research ends (`ResearchService.finish` → `gather`), the held findings are planned in order on a virtual
  copy of the brain, with the same texts a single card's approval writes (`service.ts applyResearch`); a finding that
  cannot be planned (a user skill, a file over 256 KB, a forgotten file a later finding writes) goes back to its own
  card. The affected files are copied, as the candidate has them, under `userData/brain-candidates/<id>/files/` with
  `candidate.json` (before/after per file; the last 12 kept). The brain is not written.
- Evaluation: zero-token checks (files and lines touched, skill headers valid, lines added to always-loaded rules,
  no permission text) and the existing recorded-task replay (`evaluation.ts` via `LearningReviewService
  .replayBrainCandidate`) on the newest anonymized dataset with holdout cases, started only when the estimate
  (holdout cases × 2 runs × the median cost of recent runs) fits in what the research left of its cap; otherwise
  skipped with the reason on the card (no set, no cost data, budget spent). The synthetic fixture never counts.
- One Proposte card (group «Versione candidata», source `research`, id `bc-…`): the findings, the checks, the replay's
  note and state, and a before/after diff per file (the file viewer's own `DiffView`). Approving applies every file
  as ONE `BrainChange` (`BrainModelService.applyCandidate`, job `research`, target `candidate:<id>`): its one «Annulla»
  restores all files. A brain file changed since the candidate was built makes it stale: never applied over the
  user's edit, its findings become single cards again. Rejecting discards it and its findings.

**The role reflection** (`brainmodel/role-reflect.ts`).

- Zero-token pick at research start: the work role (never the Orchestrator, never one on trial) with the most runs in
  the last 30 days that went wrong by a verified judgement (fail or partial from the user or a verified review) or that
  the user corrected; at least two; ties go to the newest. One role per click.
- The research reads `maintenance_pack` section `role_reflect` (served by `research.ts`, not in `PACK_SECTIONS`): the
  role's text now and up to 8 of those runs (goal, report, verdict note), cut, scrubbed of private paths and names,
  secrets masked. Only while the chat's live cost is under 80 % of its cap (engines without cost reports never run a
  research); otherwise the section says to skip.
- It may call `maintenance_role_trial` once with the whole revised text (bounded, different, not a fragment, no
  permission grants). That is a card with the role text's before/after; approving it calls the catalog's
  `approveTrial` (refused when the role left the version the text was written against). The trial then runs and is
  kept or rolled back on its existing trial card (`trials.ts` against the frozen baseline: the «front» is the user's
  keep/rollback, not an automatic replacement).

## Consequences

- One click's brain-file changes are one decision with one undo; the per-file diff shows exactly what would change.
- A forgotten skill's role links are still removed after the apply as separate, individually undoable entries (as the
  Memoria trash does); the candidate's own undo restores the skill files.
- The replay can spend outside the research chat; it starts only under the estimate, but real cost may differ from the
  estimate (runs are not stopped mid-way). With no anonymized holdout set (a fresh install) it is always skipped.
- New optional fields: `ResearchProposal.candidateId`, `ResearchProposal.roleTrial`; new types `BrainCandidate`,
  `BrainCandidateView`; `Proposal.diffs`, ask kind `candidate`, group `brain`. Old files read as before.
