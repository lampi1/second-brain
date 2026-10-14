# ADR 0031 · Compaction window per process, and the invisible continuation of cold chats

Date: 2026-10-13 · Status: accepted · Replaces the automatic hand-off of ADR 0014 (the rest of 0014 stays)

## Context
The owner's measured analysis (13/10, 79 app Claude chats, Opus 5.5 prices):
- The automatic note at 200k (ADR 0014) wrote 30 notes in 3 days; only 12 were used, and "Riprendi" opened "X (2)".
  Claude Code already compacts by itself at ~268k (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000` in the user's
  settings env), invisibly and at the same cost.
- Leak (a): 17 of 79 chats on a 1M window never compacted at 300k; one QA chat reached 898k, $90.78 spent above 200k.
- Leak (b): 17 resumes after the 1 h prompt cache expired re-wrote more than 100k of context, ~$2.10 each, against
  ~$0.35 for a fresh chat; a note asked while the cache is warm costs ~$0.08.

Why leak (a) (found 13/10 with `get_context_usage`, a control request that spends no tokens): every leaking chat ran
in the owner's ops folder, whose `.claude/settings.local.json` sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000`; project-local
settings beat the user's settings, so the engine reported `maxTokens 1000000, autoCompactThreshold 967000`. The model id
(`[1m]` or not) made no difference. An env var inherited from the app and the `autoCompactWindow` key both lose to that
file; only an `env` in the inline `--settings` flag wins (measured: 300000 / 267000 in that folder).

## Decision
- **Compaction window per process.** Every Claude engine the app starts (new, resumed, warm) gets
  `--settings {"env":{"CLAUDE_CODE_AUTO_COMPACT_WINDOW":"<n>"}}` (merged with the stable guard rails; session-only, no
  file written: rule 6 holds). Setting `compactWindowTokens`, default 300000, 0 = the user's Claude settings decide;
  the CLI accepts 100000-1000000 (clamped). The engine reports the window back as `contextMaxTokens`.
- **No automatic note at 200k.** The meter stays; its amber now means "compaction is near": 80% of the reported window
  on Claude (`shared/context.ts`), the user's `contextWarnTokens` on Cursor (no window reported). The amber "Riprendi"
  notice shows only on Cursor; manual "Riprendi" (a new chat "X (2)") stays in the menu and the hand-off dialog, for a
  change of engine, model or task.
- **Cold chats, invisible continuation** (`handoff.ts` coldAsk / coldArmed / coldRoute, `ChatManager.coldTick` and
  `coldSwitch`; setting `contextHandoff`, now "Continua le chat fredde in una sessione nuova", default on; Claude
  only, never a Regia):
  - A chat idle with context ≥ 100k, nothing pending, not busy, its engine alive, gets its note asked
    `coldHandoffMin` (default 50) minutes after its last call, while the cache is warm (before 55 min). One quiet turn:
    no line, no busy bar, no tool (no now.md step), the answer kept out of the tile; the request adds an "In corso"
    section (background tasks, monitors, inbox waits and the command to restart them). Once per idle stretch, even when
    it fails; a failed or off-format answer saves nothing (a token-free note is no base for a continuation).
  - Until the note is written the engine is kept: the idle release skips the chat, and the auto-close archives it but
    keeps its engine until the note (then it ends). Never a turn at close (ADR 0014 rule): the note comes at its time.
  - A message (the user's, an agent's, mail) to that chat more than 55 minutes after its last call, with a note newer
    than its last turn, goes on in a fresh session of the SAME chat: old engine closed (its tools kept until the real
    close), new session id, same title and choices, no "(2)". The first message carries the note and the user's text
    after a separator (`coldPrompt`); the transcript and the tile show only the user's text. The old session stays,
    folded above a "Continua da qui" divider (ChatItem system `continued`) with a link to the note it started from (a
    copy per continuation, `handoffs/<chat>.<old session>.md`, read only; a later note overwrites the chat's own file);
    the switch is undone when the fresh engine does not start (the note stays for the next message); the past session
    ids are persisted (`pastSessions`) so a restart reads both back. A warm cache (≤ 55 min) keeps the old session.
- **Counters** (`context-stats.ts`, zero tokens, from the API usage every engine reports, one per response id):
  calls, calls over 200k, cache re-writes over 100k, compactions, cold notes written and used, list-price $ of the
  first 5 calls after a continuation vs after a compaction. Logged on scope `chats` (`context: …`), kept in
  `<userData>/context-stats.json`, shown by MCP `app_state` (`context`).

## Consequences
- Chats in folders that ask a larger window (that ops folder) now compact at the app's window too; a folder that really
  needs more sets `compactWindowTokens` (or 0) for the whole app.
- A long chat that sits idle costs one ~$0.08 note per idle stretch even if nobody writes to it again; a cold
  resume costs a fresh start plus the note instead of a >100k re-write.
- An archived long chat keeps its engine up to `coldHandoffMin` minutes after its last call.
- The quiet note turn still lands in the old session's transcript (read back above the divider).
