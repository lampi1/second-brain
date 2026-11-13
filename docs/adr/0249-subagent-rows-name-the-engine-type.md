# ADR 0249 · A sub-agent row names the engine's real agent type

Date: 2026-11-09 · Status: accepted (owner, issue #356, «risolvi tutte le issue aperte») · Builds on: ADR 0083 (generic
roles and direct delegation, §3: engine sub-agents only as Explore)

## Context
A Strategist ran two engine sub-agents with `subagent_type: "Explore"`, which ADR 0083 allows. The sub-agent strip said
«nessun agente» and the chat row «Affida a un agente: …», exactly as for a general-purpose sub-agent. The owner read it
as the Explore-only rule being broken. The engine type was known (`ChildRow.agentType`) but only shown in a data
attribute.

## Decision
- **The strip** (`ChildStrips.tsx`) names the app role when the type is one, else the engine's type: «Explore · sola
  lettura» for `Explore`, the type itself for any other (e.g. «general-purpose»). «nessun agente» stays only when the
  engine named no type. `Explore` is matched exactly, as `role-gate.ts` matches it.
- **The chat row** (`shared/explain.ts`) says «Ricerca in sola lettura (Explore): …» for Explore and «Affida a un agente
  (<type>): …» for another type; the engine log line (`chats/claude-map.ts`) carries the type too.
- **A refused call** keeps the gate's own path: the hook denies it, the tool row ends in error and opens on the gate's
  reason (`role-gate.ts subagentRefusal`, pointing to `agent_delegate`).
- The rule itself does not change.

## Consequences
- The demo's Orchestrator strip shows an Explore child; the child-strips e2e checks its label.
- A refused call has not yet been observed live (the ADR 0083 caveat stays).
