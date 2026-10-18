<!-- Decision for catalog consumers and maintainers: bounded declarations help delegation without changing permission policy. -->
# 0066: Agent operating manifest

Status: accepted for first-build integration.

AgentDraft/Profile gains optional `manifest` fields: whenToUse, whenNotToUse, input, output,
declaredTools, accessScopes and successCriteria. Main validates types, control characters, text/list limits
and unknown keys. Version 1 catalogs remain readable. Loading never rewrites the archive; pristine system
seeds gain missing metadata in memory, while customized profiles retain their data. Old-client saves and
AI drafts which omit the additive field retain it. Explicit `{}` clears declarations. New seeds use the
configured IT/EN language; existing user content is not translated on language changes.

Agent Studio displays and edits declarations in both UI languages. These are desired duties and resource
requirements, not evidence that the engine has a tool, account, capability or permission.

`agent_catalog` is read-only on every token-protected chat endpoint and existing app-control endpoints.
It pages four profiles at a time or fetches an explicit ID. It excludes instructions, images and secrets;
observed engine availability is separate from declarations, capability evidence remains unknown.
Regia turn briefs carry a bounded compact candidate list and direct the agent to discover full metadata
before choosing a delegate or proposing a new profile. This list is JSON-labelled untrusted data.

`app_create_chat(agentId)` selects the existing catalog identity through the existing router and launch
validator. Explicit null model/effort means engine default; omitted route fields still inherit policy.
Profile selection never supplies a reason for overrides or max effort. Explicit profile selection keeps
the profile engine rather than applying a writing row's API diversion. Engine switches, trust, app-space
folder/engine rules and pending permissions remain enforced independently of all manifest fields.

Tests cover validation, corrupt-file preservation, version 1 compatibility, seed migration, read-only
discovery, prompt delivery, renderer recovery, IT/EN escaping and profile routing policy. The panel e2e
with screenshot first runs on main under the existing check policy; it invokes no real model.

> Chat-space behavior below is historical: [ADR 0071](0071-all-workers-in-grindhouse.md) removes the app partition. All workers live in the Grindhouse; source-code launch checks remain.
