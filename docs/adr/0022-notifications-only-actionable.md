# ADR 0022 · Only what needs the user interrupts; the rest is a list he reads when he wants

Date: 2026-10-13 · Status: accepted

## Context
The user (13/10): "le notifiche sono troppe e non le guardo mai". Measured on 12/10: 627 "chat finita" toasts (every
turn end, the Regia's included), ≥137 "filo aggiornato", 41 red toasts for lines of ai-errors.md, 40 identical red
"pubblicazione bloccata" toasts, 19 proposals, 11 "fatto", playbook bursts (7 at the same millisecond: files touched
without a content change). Only questions and permissions (~216) really needed him. Windows toasts were already off.

## Decision
- **Toast (interrupts)**: a chat waiting for him, a sign-in to redo, the budget at 100 % (priority urgent), a chat turn
  that ended with an error (new kind `chat-failed`). Questions and permissions stay the global layer's cards.
  `TOAST_KINDS` / `tierOf` in `renderer/lib/notify.ts`.
- **Bell and the center's header count** actionable unread events only (`isActionable`, `bellCount`): the toast kinds
  plus `question`, `sync-blocked`, `sync-error`, `mail-blocked`.
- **Center only**: `chat-done` (never for a Regia's own turns: `doneEvent` in `main/brain/live.ts`), `error`, `win`,
  `idea`, `reflection` (no toast, no sidebar badge).
- **Silent** (kept in the center's list, no bell, badge or toast): `now`, `done`, `decision`, `proposal`, `mail`,
  `sync-ok`, `playbook`, `chat-closed`.
- **Same failure once**: a sync block or error with the same findings as the open one (release ids and timestamps
  ignored) is not published again until a sync goes through (`FailureDedup` in `main/sync.ts`).
- **Playbooks**: an event only when the file's content hash changes (baseline at start).

## Consequences
The center is a pull-only list; the user can still mute a kind. A sidebar badge now means something to act on
(Comunicazione for blocked mail, until ADR 0041 removed it; Costi for the budget, DevOps news).
