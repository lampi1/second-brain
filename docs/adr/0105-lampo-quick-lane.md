# ADR 0105 · «Lampo», the quick lane beside the Orchestrator

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20: «forse manca una fast chat: la velocità di risposta non è la
stessa di Claude Code o Codex») · Builds on: ADR 0083 (work starts only from the Orchestrator), ADR 0099 (warm engines)

## Context
Every question to the Orchestrator goes through its long frame, its tools and its planning: a "what does this file do?"
waits as long as a job. The user wants a chat that answers in seconds, like Claude Code or Codex in a terminal, without
a second place where work starts.

## Decision
- The Orchestrator's column gets two tabs: Orchestrator and «Lampo». Lampo is one chat per user (`NewChat.quick`),
  created only by the user (an agent's request is refused), titled «Lampo», always the same chat (a second create
  returns it).
- It runs the Orchestrator's engine on the user's mid tier model (no new model choice), in plan mode with read and web
  tools only (`LAMPO_POLICY`) and a short frame (`LAMPO_FRAME`): it answers, explains and reads; it changes nothing,
  runs no commands and starts no work. Its engine is prewarmed with the Orchestrator's (ADR 0099).
- «Fanne un lavoro» drafts the last question and its answer into the Orchestrator's input; the user sends it. Work
  still starts only from the Orchestrator.
- Lampo is not a work chat: it is off the Grindhouse and the sidebar, never auto-closed or released as idle, and the
  Orchestrator neither sees it in its digest nor is woken by it.

## Consequences
- Quick answers no longer cost an Orchestrator turn (its frame and context), and the Orchestrator's context stays on
  the work.
- Lampo cannot be asked to "just fix it": by design the answer is the hand-off button. If that proves too strict, a
  later ADR can widen its tools; not now.

## After the review (2026-10-20)
- Lampo sees none of the chat endpoint's mail, delegation, report or script tools, and they are not pre-allowed: it
  cannot start work through another chat either.
- It stays Lampo after a restart (`quick` is kept in chats.json); Ctrl+K does not list it.
