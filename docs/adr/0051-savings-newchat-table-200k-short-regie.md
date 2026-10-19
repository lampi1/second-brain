# ADR 0051 · Savings: "Nuova chat" through the table, Claude chats compact at 200k, Regie compact on a new day

> Routing parts superseded by [ADR 0078](0078-agent-first-routing.md): an agent's profile decides engine, model and
> effort; the table only fills a model the profile leaves open, and the override rule applies only to agentless chats.

Date: 2026-10-14 · Status: accepted · Amends: ADR 0031 (compaction window default), ADR 0032 (user-started chats)

## Context
On 2026-10-14 the app cost $431/day against $214 before it; 3016 of 3020 $ were Opus 5.5. 19 chats went over 400k
context (about $425 saveable by starting again near 200k) and the Regie cost $491 (16%). Three causes:
- "Nuova chat" sent the chat with the dialog's defaults (the user's harness, model and effort): the routing table
  (ADR 0032) chose models only for chats opened by agents, so a quick question by hand could run on Opus high.
- The compaction window set per process (ADR 0031, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`) defaulted to 300k, and the
  setting was not on the settings page.
- A Regia lives for days: yesterday's context is paid again on every turn of today.

Of the 19 long chats, most were Claude desktop worktree sessions outside the app (it cannot and must not change
them, rule 6); the one app chat ("QA · IVA proporzionale", 12/10) predates the per-process window.

## Decision
- **"Nuova chat" goes through the table** (`chat:createRouted`, `routed.ts`): the kind comes from the title and the
  prompt, the area from the title; a model or effort picked by hand is an override and wins (recorded as
  `source: 'override'`). The title may be empty (then the prompt names the chat), the prompt is required but for a
  Regia. A new read-only channel `routing:preview` resolves the same request without creating anything and without
  exploring (no counts, so the preview never shows a random model); the dialog shows it in one line: "Claude · Opus
  5.5 · ragionamento media — dalla tabella (Fix di bug · App): chat sull'app", or "scelto da te: vince sulla tabella"
  with "torna automatico" to undo the pick; one row (cut with an ellipsis, the whole text in its tooltip) so typing
  never moves the fields; "Crea chat" is off while the line says "Non parte". A chat started by the user from the
  renderer (`byUser`) never explores either, so it starts on the model the dialog showed, has no cap on its first
  message (as `chat:create`), and keeps the permission mode picked on whatever engine the table chose. The worktree
  checkbox is kept (Claude only).
- **Claude chats compact at 200k** (`COMPACT_WINDOW`), still through the env var in the inline `--settings` of the
  processes the app starts (ADR 0031). Chosen over the alternatives:
  - a model without the 1M context: it changes the model the table chose and caps the long chats that need it;
  - a "Riparti" notice: it needs the user's click on every long chat, and a new chat loses the session's cache;
  - writing `autoCompactWindow` in Claude's settings: forbidden by rule 6 and it would change the desktop sessions too.
  The env var beats the folder settings and the flag, touches only the app's processes and keeps the session (the CLI
  writes its own summary). A saved 300000 (the old default) with no change by the user in `changes.jsonl` moves to
  200000 at the first start of this build (a marker file in userData: the change log keeps only its last entries, so
  later starts never check again); a value the user set stays. Impostazioni → Chat shows "Riparti le chat Claude a" (150k, 200k,
  300k, 500k, "Impostazioni di Claude").
- **Regie corte** (`chats/regia-day.ts`, setting `regiaDayCompact`, on by default): a Regia on Claude whose context
  began on an earlier day in Rome and is 50k or more compacts once on the new day, the first time it has been idle 3
  minutes with nothing pending: one quiet `/compact <what to keep>` turn (the chats it follows and what it waits from
  each, open questions to the user, his decisions still valid, background work). It is the same chat and session, so
  its queue, its `regiaOf` links and its mail address do not change; only a system line ("Giorno nuovo: …") and the
  engine's "Contesto compattato" show in the tile. A compaction (by the window or the day) restarts the context's day
  (`ctxSince`, saved). Over the threshold during the day the 200k window already compacts it.

## Consequences
- Routing of user chats is visible and correctable before sending; the table's rows (area beats kind) now decide the
  cost of hand-started chats too.
- A compaction costs one turn on the summary; with 200k it happens on more chats than at 300k (the gain is every later
  turn paid on less context).
- Tests: `test/unit/routed-chat.test.ts` (Nuova chat, preview), `test/unit/brain/routing.test.ts` (routeLine),
  `test/unit/brain/config.test.ts` (migration), `test/unit/chats/regia-day.test.ts` (rule and manager flow on the fake
  CLI); e2e `newchat-routing.spec.ts` (shots `newchat-route-*`) and `settings.spec.ts` (shot `settings-compact`).
