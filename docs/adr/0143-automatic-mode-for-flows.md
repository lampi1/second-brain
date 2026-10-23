<!-- Decision: opt-in automatic flow triggers and background execution, for maintainers and UI integrators. -->
# 0143 — Automatic mode belongs to Flussi

## Context

Repeatable work needs deterministic detection without spending model tokens on empty polls. A separate routines catalog would duplicate flow definitions and hide their ownership, approvals and execution state. The Orchestrator remains the only entry point for defining and coordinating work.

## Decision

Keep one Flussi catalog. Each approved flow version can have an independently approved automatic configuration: interval or scoped read-only DevOps polling, concrete inputs, priority and exact version. No company workflows ship by default. The Orchestrator proposes configuration through authenticated tools; the user activates it in the native Sì/No/Altro decision panel. Free answers wake its owner to revise the proposal.

A five-second host timer drives a durable event outbox. Detection has no model calls; dispatch wakes the authenticated owner, which starts the event through a host-validated tool. Actual agent work can spend tokens. No arbitrary scripts, production actions or external writes are added. Existing run decisions and canonical report evidence still apply. Global pause and per-flow pause stop new detection/dispatch, not already running agents.

The UI presents a catalog and detail view with a diagram derived from actual sequential steps and review relationships. Status, event history, agent links and report links remain together. Layout responds to the available content width beside the persistent Orchestrator. Reduced-motion preferences disable animation.

Background operation is a separate opt-in setting. Closing the window hides it in the system tray only when enabled and tray creation succeeds; explicit Quit and system shutdown still stop the app. The PC must stay awake. This change installs no OS service, startup task or sleep inhibitor.

Canonical reports and persisted active runs are reconciled by the runtime after delivery failures and returning to a brain. Restart preserves the existing interrupted-step blocker and requires its explicit retry. Owner-idle checks and a one-minute notification cooldown avoid flooding. A report notification is never evidence of step completion; the normal verified report tool must advance the run.

## Consequences

Detector, event ledger and scheduler use injected adapters and are independent of Electron; future cloud workers can reuse those boundaries. Deployment to cloud still requires identity, credentials, distributed ownership and workspace mapping. This release is a single local worker, not a cloud service.

The host checks pinned revisions, scope and required inputs before activation and start. Configuration changes invalidate queued events and require new approval. Source identities and cursors are bounded and persisted atomically. Queue exhaustion, provider errors and unavailable owners remain visible blockers rather than dropping work.

Validation uses unit tests, type checking, changed-file lint and a production build. The new E2E scenario is authored but is not executed on the feature branch. Visual runtime validation is not claimed when unavailable in the execution environment.
