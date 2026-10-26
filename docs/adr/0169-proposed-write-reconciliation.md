# ADR 0169 — Proposed write reconciliation and same-run recovery

Status: accepted. Date: 2026-10-26. Supersedes the terminal-only restriction in ADR 0167.

## Decision

Blocked runs can be reconciled directly. Missing legacy request bodies do not disable user attestation: operation, timestamp and hash identify the record. The writer records a validated `link-pr` routing identity (work item, project/repository GUIDs, PR id) before dispatch. It never saves raw request bodies, comment text or credentials.

The authenticated Orchestrator reads `app_flow_reconciliation`, verifies the external outcome and calls `app_flow_reconcile_propose` with the exact operation/hash, run revision, applied/not-applied outcome and evidence. This persists a proposal, not authority. The existing Questions modal offers Sì/No, including the evidence in voice mode. Only sender-checked user IPC can confirm. No discards the proposal and leaves the run blocked.

Yes interrupts and verifies the exact worker, serializes the local receipt with the writer queue, and pins brain, revision and journal digest. It then resumes the same blocked DevOps agent step when no uncertain writes remain and the original execution grant remains valid. It preserves the run/branch, completed prefix, original attempt count, scope and version. One user-confirmed reconciliation can authorize one extra recovery attempt at the exhausted limit; it cannot authorize automatic retry loops or production. Manual reconciliation remains available without automatic resume. Deployment settlement still uses its release-specific verification.

An applied write returns a truthful user-verified receipt without network replay. An absent/reverted write may retry under live grants using a new journal entry linked by requestKey; its original user receipt remains immutable. Resource ids absent from old records are never fabricated: the worker must read them back, and host ownership checks remain in force. History/cleanup retain their existing conservative typed-receipt behavior. Verified absent analysis mentions do not consume the one-comment quota.

The receipt is persisted before the step is reset. A crash in between leaves the proposal available for another confirmation; the host rechecks worker quiescence even when a matching receipt already exists. Once ready is durable, the normal runner resumes after restart. A changed run, changed ledger, another unresolved write or withdrawn grant cannot gain execution authority from a proposal.

## Orchestrator discovery

The real authenticated app-control mount exposes both tools; its live `app_guide` indexes the mounted registry. An exact tool-name query now returns the complete bounded description, including approval boundaries, instead of only its first sentence. Role instructions, routine capabilities and the routine guide describe this recovery path. AGENTS requires this wiring/discovery contract for future features; tests exercise the actual mount and reject public/closed-owner use.

## Verification

Regression tests cover the original blocked-run refusal, legacy missing payload, safe link routing ids before dispatch, scoped proposals, persistence, No, Yes, duplicate clicks, changed grants, actual automatic worker create/bind/send, exhausted normal attempts, crash after receipt, old worker refusal, no repeated applied effect, immutable not-applied retries and the analysis mention quota. UI tests cover the unified queue and exact IPC; a hidden native fixture and main-only E2E cover both manual and proposed confirmation. No live work item is reconciled by these tests.
