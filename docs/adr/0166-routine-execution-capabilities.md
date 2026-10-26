# ADR 0166 — Composable routine execution capabilities

Status: accepted. Date: 2026-10-26.

## Problem

Definitions described arbitrary work but execution rejected missing adapters late. Grants depended on DevOps polling even for on-demand work. Pinned scripts already existed but automatic configuration rejected them. Reusable capabilities must be discoverable and approved as versioned data.

## Decision

- Share an execution catalog between authoring, activation, automation and UI. Unsupported drafts remain editable but cannot activate. Preflight distinguishes configuration, supported routes and intentional user gates. Host activation reports the concrete cause.
- Add a `manual` trigger with no polling. Manual, interval and DevOps configurations use the same exact-version grants and durable event provenance. DevOps writes still require an owned work item; interval rules must configure it. Paused/replaced configurations grant nothing. Script/query steps use their existing pinned executor; production always waits for the user's exact-command click.
- Add deterministic MCP connector recipes on `check` steps: exact server/tool, configuration and schema hashes, work role, bounded JSON arguments and declared input bindings. `app_flow_connectors` discovers schemas without calling tools. `{{input}}` binds a string; `{$input: "count", as: "integer"}` (also string/number/boolean/json) binds typed data, never code.
- The user marks an installed connector account test-only in Settings. Credentials stay in the existing vault and are supplied only to that connector. The host checks configuration, live tool metadata, role access and run authority immediately before dispatch. Drift requires a new approved version. No new dependency.
- A connector is a trusted integration, not an OS or network sandbox. Its account must actually restrict access to test resources; tool annotations cannot prove remote behavior. Scripts retain local process authority. These routes do not authorize production or bypass a denied specialized grant. Agent/browser/adapters retain their existing boundaries.
- Persist a receipt before dispatch. Proven pre-dispatch refusal is retryable; dispatched failure/timeout has unknown effects and cannot automatically retry. Cancellation and restart wait for host jobs to drain. Reload reconciles interrupted receipts and retains evidence through multiple partial restarts. Connector success certifies only the connector response; independent tests remain separate steps.
- Optional step `mentionReason: "analysis"` allows a bound DevOps agent to request one analysis comment mentioning approved grant identities. The writer serializes requests and reserves quota durably before POST. A successful replay returns the same receipt, unknown outcomes retain quota, and explicit pre-change rejection permits retry. Ordinary intake/block/downgrade/final history is unchanged.

## Migration and verification

Existing stored definitions and grants retain their meaning; new fields are optional. New connector recipes or analysis mentions need a newly approved definition. On-demand grants need an approved manual configuration. Export/import preserves recipes and opt-ins but imports only a draft. No company-specific recipe is bundled.

Unit coverage includes schema/role/config drift, typed inputs and credential rejection, manual event provenance, script/production gates, timeout/cancel/restart receipts, analysis mention authorization/quota/retry, and portable definitions. Native UI captures and an E2E spec cover approval scope; branch checks run without E2E. No live external system is mutated during tests.
