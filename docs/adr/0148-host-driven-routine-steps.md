<!-- Host-driven step transitions for maintainers; preserves existing execution authority and manual recovery tools. -->
# 0148 — Advance routine agent steps in the host

Date: 2026-10-24

Canonical `agent_report` persistence now notifies the routine runtime for every root-report outcome. The runtime uses the bound agent run's `report.at` and the existing host completion checks, including immutable task identity, successful verified outcome, exact required evidence labels and independent Sentinel review. Success advances without an Orchestrator model turn. Invalid results leave an explicit blocked reason and notify the owning Orchestrator.

A ready eligible agent step opens a fresh catalog-resolved chat with its declared role, tier and workspace. The host binds the immutable chat/run/task identity before sending the first instructions. The prompt contains quoted run inputs and preceding verified evidence. Final submission revalidates authorization immediately before the engine receives the prompt, after asynchronous startup or queueing. Failed or stale launches cannot advance the run; orphaned idle workers are closed. Per-run serialization and a worker cap prevent duplicate or unbounded launches.

Approval/manual gates and production restrictions remain unchanged. External-write steps are not automatically launched; the existing exact grants and manual coordination remain required. The Orchestrator still owns initial starts and trigger handling. `app_flow_report` and `app_flow_bind` remain available for manual recovery, with report ID diagnostics naming `<chatRunId>:<report.at>` and the host timestamp.

Unit coverage exercises completion, rejected reports, next-worker binding, independent review, approval boundaries, duplicate events, cancellation races, policy refusal and saved-report notifications. No live model or provider is needed for these transitions. E2E execution remains owned by main CI.
