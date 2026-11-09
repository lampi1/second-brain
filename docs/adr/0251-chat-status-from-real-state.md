# ADR 0251 · A chat tile has one short status, from real state only

Date: 2026-11-09 · Status: accepted (owner, issue #359, «risolvi tutte le issue aperte») · Builds on: ADR 0084 (what a
held chat waits for), amends its «In attesa dell'utente / dei colleghi» labels

## Context
Davide: «i tag degli agenti … devono essere reali brevi e informativi». A tile could show «finito» and «In attesa
dell'utente» at once. The user and colleagues waits came from the words of the last answer (`shared/waiting.ts`
waitsForPeople): an Artisan whose answer said «serve un tuo ok» to its parent kept «In attesa dell'utente» after the
parent had handled it, and «Aspetto il tuo ok sul testo «nota.md»» read as a wait for colleagues.

## Decision
- **Sources** (`manager-lifecycle.ts waitingOf`), most urgent first: a permission, a question, a plan to approve
  (`plan`, new), a command left to Esegui, a browser hand-off, its sub-chats and engine sub-agents still at work
  (`children`, with `waitingN`), its background tasks (`background`, with `waitingN`), a command or page of its own
  still running (`work`), mail, no final report yet (`report`, only when no final `agent_report` came), unsaved work,
  the repository check. `user` and `colleagues` are gone from `AutoCloseWaiting`.
- **The words still hold, never tag.** `waitsOn` and `waitsOnWork` (read from answers and reports) still keep a chat open
  and still stop its assignment from completing, so no chat closes earlier than before. They never name a wait.
- **Labels** (`lib/waiting-label.ts`, `cmp.autoClose.waiting.*`), at most three words in it, en and de: «Aspetta te:
  domanda / permesso / piano / browser», «Aspetta Esegui», «Aspetta N sotto-chat», «In background: N», «Lavoro in
  corso», «Aspetta posta», «Senza report», «Non salvato», «Controllo repository».
- **One status per tile** (`ChatTile.tsx`): while a wait is shown the state pill steps aside. With an open request the
  «Ti aspetta» button carries the specific label and the strip does not repeat it. The pill's «in attesa» for sub-agents
  reads «aspetta sotto-agenti». The Orchestrator's tally counts waits from real state only.

## Consequences
- A worker that sent its report and asked its parent for something shows «finito», and stays open as before.
- A unit test checks every label is at most three words and never says «utente» or «colleghi».
