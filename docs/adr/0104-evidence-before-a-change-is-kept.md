# ADR 0104 · Evidence before a change is kept: intervals, checkpoints, one primary metric

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20: «le tecniche usate non hanno fonti che ne dimostrano la
validità») · Amends: ADR 0073, 0083 (trial evaluation, tier proposals) · Builds on: ADR 0100 (verdict from facts)

## Context
The audit of the learning loops (2026-10-20) simulated the rules with two identical versions: `evaluateTrial` (four
metrics in OR, fixed thresholds, 5-10 runs a side) proposed "keep" 20-30% of the time, and 49% when re-evaluated after
every run as `loop.ts` does; the tier rule (+25 points at 5 vs 5 outcomes) proposed a false move up 14-16% of the time.
For one person's volume a real +15-point improvement needs ~150 judged runs a side to be seen reliably.

## Decision
- `shared/evidence-stats.ts`: Wilson interval for a proportion (Wilson 1927; Brown, Cai & DasGupta 2001), Newcombe's
  interval for a difference of proportions (Newcombe 1998, pinned against the paper's example), a seeded percentile
  bootstrap for a difference of means (Efron & Tibshirani 1993); verdicts only at fixed checkpoints (20, 40, 80, 160
  per side) against "peeking" (Johari et al., KDD 2017); «k/n (IC 90% a–b%)» or «dati insufficienti (n/m)» as text.
- A trial: the primary metric is the verified success rate (the user's, a verified review's or the facts' verdict, ADR
  0100), compared with Newcombe's 90% interval; the user's corrections per run are the second signal (bootstrap); cost,
  time and questions are guardrails, never a reason to keep. Up to 40 baseline runs. Below the first checkpoint the
  trial waits (up to 60 days), then an unproven change is proposed to go back. Its reason shows the numbers and the
  interval.
- A tier proposal needs 20 verified outcomes a side and an interval of the difference above zero (a cheaper tier: not
  worse than 10 points at the interval's low end, at ≤ 0.7× the cost per success).

## Consequences
- Fewer proposals, each one backed by an interval; most single changes will read «in raccolta» for weeks. That is the
  honest state of one person's data; the evidence per mechanism (all lessons together) is the next step.
- Not done here: an evidence claim on every brain maintenance change (skills, rules, memory), a calibration of the
  sampled reviewer against the facts, a held-out replay bench run at night.

## After the review (2026-10-20)
- A side is judged on the cases up to its last checkpoint (`atCheckpoint`: 20, 40, 80, 160), so a verdict changes only
  when a side reaches the next checkpoint, never at every new run.
