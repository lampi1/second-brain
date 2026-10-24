<!-- Host-enforced cancellation and replay decisions for routine maintainers; preserves history and exact approval. -->
# 0147 — Recover routine executions without restarting the application

Date: 2026-10-24

## Context

A declined retry left a blocked automatic run occupying its concurrency slot. The catalog had no cancellation control, and changing the active definition did not resolve that old execution. Recovery must be explicit, preserve evidence, and never silently repeat external effects or inherit obsolete permissions.

## Decision

The section is named **Routine**. Each execution exposes **Interrompi**, **Riprendi da un passaggio**, and **Ricomincia** in both the catalog and fullscreen. Each action opens a native yes/no/free-text decision. An Orchestrator can propose cancellation or recovery through authenticated tools; the proposal itself does not execute it.

- Cancellation records a terminal status, withdraws adapter access, aborts in-flight host adapter requests and interrupts the exact bound worker. A new **No** to retry cancels the run. **Other** requests clarification without granting execution. Historical blocked runs remain explicitly recoverable; their old answer is not guessed.
- Cancelled runs release automatic concurrency slots only after the exact worker interruption is confirmed. A failed interruption retains the slot and is retried from durable state. Their events become cancelled, while the detection deduplication ledger remains intact. The same unchanged external item is not silently rediscovered as new work.
- Restart creates a distinct execution linked to its source. From the beginning, it uses the active version whose number and digest were shown in the decision. From a chosen step, it uses the original immutable version and carries only the preceding completed steps and their host-recorded receipts. Missing prerequisite evidence blocks the action.
- The host checks the source revision and target version before interrupting the worker and again after the asynchronous interruption. No runnable successor is created if interruption fails or the approved context has changed. Exact repeated requests resolve to the same successor. Persisted ready successors wake their owning Orchestrator; a busy owner or failed notification is retried without asking the user to send another message. Free-text recovery feedback is also preserved for owner delivery.
- Automatic recovery additionally requires the current enabled, user-approved rule revision, the same owner, scope and inputs, and the same external work-item identity. An old approval never grants a new rule/version access. Recovery events cannot be started as ordinary detector events after an interrupted commit.
- Repeated external-effect steps are listed in the confirmation. Stopping work does not undo completed writes, and an operation already accepted by an external service can still finish. A restarted step must reconcile its external state before repeating an effect.

The fullscreen control uses the conventional four-corner icon with an accessible label. Its fixed header contains only title, version and step count; long descriptions scroll with the body. The complete step list, role/model information, evidence and run state are primary content. The diagram is optional. Escape or the collapse icon closes fullscreen and restores focus. Opening a recovery decision first closes fullscreen, avoiding stacked competing modal focus traps.

## Verification and limits

Unit tests cover lifecycle persistence, cancellation and stale callbacks, approved prefix reuse, version/rule changes, interrupted commits, queue release, and native decision rendering. The hidden dev visual fixture uses twenty long steps and long model labels at wide and narrow widths. User-visible E2E specs are maintained but are not run on the branch; the repository's main CI owns those runs.

Recovery does not roll back code or external writes, bypass required gates, execute production operations, or automatically migrate a run to a different owner. A missing owning Orchestrator, unavailable pinned definition, missing evidence or withdrawn grant is an explicit blocker. Existing history and personal files are preserved.
