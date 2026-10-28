# 0177 — Bound routine polling to the records it needs

Date: 2026-10-28. Status: accepted. Issues: #254, #255, #256.

## Context

The stable Windows app reports main-process stalls on a five-second cadence even with spare machine CPU.
The routine timer matches that cadence. Its asynchronous continuation repeatedly cloned the complete flow
archive for each historical run, then regenerated and read each dossier even when nothing changed.
The synchronous timer label missed work after the first await. Process CPU is not a main-thread profile,
so the production logs alone do not establish the GC share or explain all renderer CPU.

## Decision

Host polling reads isolated copies of the run or immutable version it needs. Full snapshots remain available
for UI and authorization paths that inspect the whole state. Narrow reads reconcile deadlines before returning,
and callers cannot mutate the stored records through them. Terminal runs still receive required cleanup.

Cache successful dossier inputs by brain context and run, bounded to 1,000 entries. Compare the complete run,
write ledger, deployment history and approved configuration: revision alone misses settlement-error updates.
A failed projection is retried; the public dossier read still regenerates from current host records.

The `brainmodel:state` view also reuses its catalog snapshot for rollback eligibility and reads each changed
file only once per listing. An actual rollback checks fresh bytes and versions, preserving conflict refusal.

## Evidence and limits

An isolated Linux fixture with 32 versions, 21 cancelled runs and a 2.18 MB archive reproduced **89 complete
archive clones per idle tick** at base `be9141a6`. Five warm ticks took 199–270 ms. With this change there are
**zero complete archive clones** and the same five ticks took 6–9 ms. These are synthetic measurements,
not a Windows latency guarantee or a production CPU profile.

Regression tests cover bounded clone counts, unchanged dossier reads, settlement-error invalidation without
a revision bump, copy isolation, deadline reconciliation, recovery, write reconciliation and fresh rollback
conflict detection. The owner's Windows release and renderer CPU need observation after updating; do not
claim that every visual stall is fixed from this measurement alone. No dependencies were added.
