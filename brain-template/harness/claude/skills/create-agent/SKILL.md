---
name: create-agent
description: Create a persistent second-brain agent when the user asks for a new agent, or revise that same agent after corrections. Requires the authenticated Orchestrator agent-management tools.
---
<!-- Shipped creation workflow for the Orchestrator; definitions describe work and never grant permission. -->

Restate the requested goal. Ask at most two questions when inputs, outputs or the repository are unclear.
Use agent_list and agent_get to choose the closest preset. Preserve its safety preamble and output contract.
Choose the smallest tool allow-list, an explicit plan/default permission ceiling, and an engine that can enforce
both. Select a glyph from the catalog and an available tone. Never put permission grants in instructions.

Call agent_create once with the base presetId, full draft (including avatar), reason, evidence and the ID of the user's actual
task message in this Orchestrator chat. The message must be at most 30 minutes old and unused. Agent mail, app
messages and copied approvals do not qualify. On refusal, explain the reason; do not invent another message ID.
Use agent_suggest for unsolicited ideas; the user decides whether to create them in Agenti → Proposte Agenti.

Return the saved agent ID, name, purpose, selected engine and policy. Explain how to open it in Agenti and undo
creation by archiving it. Do not claim a card or action exists unless the app actually returned it.
Corrections in this thread revise the same agent with agent_update; do not create a second agent. If the agent is
locked, is the Reviewer, exceeds the default ceiling, lacks a verified baseline or has reached the daily change
limit, use agent_propose with the exact patch, reason and expected metric effect. Only the user's panel decision
accepts that proposal. No MCP call accepts it on their behalf.
