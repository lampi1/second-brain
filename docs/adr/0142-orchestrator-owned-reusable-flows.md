<!-- Why reusable flows are a separate, empty, governed catalog; for maintainers. -->
# 0142 — Orchestrator-owned reusable flows

## Context

Scattered memory rules cannot reliably encode reusable execution state, evidence, or one-time decisions. Company procedures are not known to the product. The user must build them inside the app from their own brain through short native questions. The Orchestrator remains the only entry point.

## Decision

Add an initially empty, brain-scoped catalog under Lavoro → Flussi. Creation, refinement and start buttons send requests to the Orchestrator; they never execute a flow themselves. The host supplies live catalog hints and authenticated tools for discovery, drafting and starting. A user activates the exact draft revision in the existing shared modal.

Definitions have immutable versions; executions pin a version, subject, scope, inputs and evidence requirements. Each agent step identifies the input holding its actual workspace. Binding requires a fresh visible worker in that canonical workspace and brain. A durable claim prevents one task run from certifying two steps or subjects. Successful canonical reports supply evidence; a review also requires an independent Sentinel and the exact reviewed run.

Only native decisions can pass user gates. Context and revisions prevent stale approvals. The modal exposes the actual subject, scope, inputs and required evidence. Free text requesting a change is distinct from evidence submitted with an affirmative decision. Home continues to show agents only.

The host performs only explicit metadata checks; script/query/action references and external/production effects block without a configured adapter. Definition approval grants no execution permission. Deadline reconciliation is a token-free local timer, never a job launcher. Restart or expiry requires inspection and a bounded retry; it cannot silently repeat an operation.

## Consequences and current limits

This is the execution and authoring foundation, not a configured company automation. Procedures and validated adapters still need to be defined in the app. An execution keeps its original Orchestrator owner; transfer to a replacement owner is not implemented, so a different owner is refused rather than starting duplicate work. Logical project/area fields are metadata constraints; local worker isolation additionally uses the explicit workspace input.

Unit tests cover transitions, persistence, evidence, authority and modal transport. The new E2E specification is authored but not run. No desktop visual validation is claimed in this environment.
