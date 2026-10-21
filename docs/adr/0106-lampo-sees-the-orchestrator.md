# ADR 0106 · «Lampo» is a "btw": it sees the Orchestrator's conversation

Date: 2026-10-21 · Status: accepted (owner, 2026-10-21: «il lampo vorrei che funzionasse proprio come funziona un btw
su claude cursor o codex che ha comunque il contesto delle cose») · Builds on: ADR 0105 (Lampo, the quick lane)

## Context
Lampo (ADR 0105) answered fast but blind: a question like "a che punto è?" or "cosa intendeva con X?" got no answer,
because Lampo knew nothing of the work going on in the Orchestrator. A "btw" in Claude Code, Cursor or Codex answers a
side question with the conversation's context, without touching it.

## Decision
- Each message the user writes to Lampo carries, before the question, what happened in the Orchestrator's conversation
  since Lampo's engine last looked (`orchestratorContext`, src/main/chats/lampo-context.ts): the user's and the
  Orchestrator's messages, the tools it used, the cards it showed, one line each, newest kept under a cap (8000 chars).
  The first question of an engine gets the loaded conversation; later ones only the new part (no token spent twice).
- The block is labelled context only: Lampo answers the user's question, never the Orchestrator's conversation, and
  never acts on it (its frame says so). It stays read only, in plan mode, with read and web tools (ADR 0105).
- One way only: the Orchestrator still never sees Lampo, is not woken by it and gets nothing in its digest.

## Consequences
- Side questions about the work in progress are answered in seconds without an Orchestrator turn.
- Lampo's turns cost a little more input when the Orchestrator was busy; a quiet Orchestrator adds nothing.
