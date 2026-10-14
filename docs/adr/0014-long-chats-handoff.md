# ADR 0014 · Long chats: context size, hand-off note and "Riprendi" in a new chat

Date: 2026-10-11 · Status: accepted · the automatic hand-off over the threshold is replaced by ADR 0031 (compaction window per process, invisible continuation of cold chats)

## Context
The user's costs (07-10/10/2026, `ops/tools/cost.mjs`): about 80% of the Claude spend was re-reading context, and
about $363 of $1,223 went to chats over 200k tokens. Every message of a long chat re-reads its whole history. The user
(11/10): "applica le ottimizzazioni che hai suggerito sul contesto delle chat anche per cursor".

## Decision
- **Context size per chat, both engines.** Claude: `get_context_usage` after each turn (real count and window).
  Cursor: ACP (CLI 2026.07) reports no usage, so the app estimates it as characters / 4 of everything that crossed the
  session (prompts, answers, thoughts, tool input and output, the replayed past), marked `contextEstimated` and shown
  with "~". A real `usage_update` replaces the estimate. The size is persisted, so a closed chat still shows it.
- **Threshold** = setting `contextWarnTokens` (default 200k, an agent may change it). Above it the tile's meter turns
  amber and a notice offers "Riprendi in chat nuova".
- **Hand-off note** (`src/main/chats/handoff.ts`): the app asks the chat, in one short turn, for a note between two
  markers (`<<<PASSAGGIO` … `PASSAGGIO>>>`) with five sections: Stato, File e worktree, Decisioni prese, Provato e
  scartato, Prossimo passo; when the brain has `ops/tools/mem.mjs`, the request also asks the chat to update its now.md
  line. Plain text, so it works on any engine without a file tool or a permission; the app saves it as
  `<userData>/handoffs/<chatId>.md`. When the chat cannot be asked (no turn yet, a stopped engine that must not start,
  an answer without the markers, 5 minutes without an answer) the app builds a token-free note from what it saw
  (requests, last answer, files with +/−, commands) and marks it "automatico".
- **Automatic hand-off** (setting `contextHandoff`, default on): a chat that ends a turn over the threshold, idle and with
  nothing pending, writes its note once per crossing. Never the Regia (its own menu restarts it).
- **"Riprendi"** (`ChatManager.continueChat`, IPC `chat:continue`): a NEW chat on the same engine, folder, model and
  choices, titled "X (2)", whose first message is the note plus "verify the real state first, do not redo what was
  dropped". The old chat's process ends; it stays readable and both are linked (`continuedFrom` / `continuedBy`,
  persisted). Idempotent: a second "Riprendi" (even concurrent) returns the same new chat. A saved note older than the
  last turn is rewritten first. Refused while the old chat works or waits for the user (never two agents on the same
  files); stopping the hand-off turn cancels it. A chat made with "Worktree separato" tells the new one to work in that
  worktree. A continuation that is closed later no longer counts: the old chat offers "Riprendi" again.
- **The hand-off turn is not a job turn** (no ledger entry, no estimate calibration). A cut answer (stopped, max
  tokens, no end marker) is not a note; after 5 minutes without an answer the turn is interrupted and the app writes
  its own note. The chat title in the now.md command is reduced to letters, digits and plain punctuation.
- **Agents** (MCP `/mcp/app`): `app_chats` shows `contextTokens`, `long`, the hand-off and the links;
  `app_handoff_chat` and `app_continue_chat` do the same as the UI, under the Cursor rules of messages: only with
  "Messaggi tra Claude e Cursor" on, and an agent never starts a stopped Cursor engine (the app writes the token-free
  note instead). The new chat's prompt carries the agent label.
- **Other modules** call `ChatService.ensureHandoff` (the automatic closing of finished chats, before archiving, with
  `ask: false`: only the token-free note, never a turn at close; the user, 2026-10-11) and
  `chat:handoff` (the Regia's "porta un riassunto" when it changes engine).

## Consequences
- A hand-off turn costs one short turn of the old chat (one cold re-read when its engine had stopped): worth it when the
  work goes on; the token-free note costs nothing but has no decisions.
- The Cursor size is an estimate: good to tell a 30k chat from a 300k one, not for billing.
- The transcript of the old chat keeps the hand-off turn (shown without the markers).
