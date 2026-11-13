# ADR 0167 — User reconciliation of uncertain routine writes

Status: partly superseded by ADR 0169 (the terminal-only restriction) and ADR 0179 (app-execution portions); accepted. Date: 2026-10-26.

## Decision

The Routine inspector, including historical runs, exposes a user-only reconciliation modal. A stopped, terminal run is required: no workers, requests, commands or settlement jobs may still be active. Each selected operation needs an explicit verified outcome (not performed, effect reversed, or performed) and evidence. No selection or outcome is inferred from a failed tool response. Reconciliation does not contact DevOps, undo an effect, restart a run, widen grants or settle deployment leases.

Typed renderer IPC pins brain, run revision, operation digest and exact operation IDs. No agent tool can acknowledge these records. The existing writer queue serializes local reconciliation with remote writes; authority is rechecked in the queue. Historical approved scope identifies only the work-item fence to remove. Paused/replaced grants do not prevent this local bookkeeping and still grant no remote authority.

A schema-1 journal entry gains optional immutable user reconciliation metadata and state `reconciled`; its original request identity, timestamps and failure reason remain. The audit is durably written before removing only the selected uncertainty fences. Opening reconciliation replays interrupted local fence cleanup from the saved receipt. Unselected writes remain fenced. Deployment operations are excluded because their dedicated release/lease reconciliation still applies.

Replaying a reconciled write raises a typed receipt, never sends another request and never pretends a reverted/not-performed operation succeeded. History records this explicitly as `reconciled`, distinct from `sent`. Cleanup can advance only for a user-verified `done`; absent/reverted cleanup stays incomplete. A new run remains an explicit separate action.

## Verification

Mock-driver tests cover four selected writes, stale/foreign IDs, duplicate selections, missing evidence, deployment exclusion, crash recovery, queue authorization, no network mutation/replay, cancelled-run guards and honest history across reload. The native modal has an authored E2E and hidden visual capture. Existing records remain readable; no historical operation is silently reclassified.
