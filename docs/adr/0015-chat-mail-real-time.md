# ADR 0015 · Mail between chats delivered by the app in real time; the user's interrupt is not an error

Date: 2026-10-12 · Status: accepted

## Context
Chats talk with the brain's `ops/tools/inbox.mjs` (one box per chat title in `<brain>/ops/state/inbox`, a message = one
JSON file). A message reached a chat only at the end of its turn (Stop hook) or through a background `wait`: a chat
working 30-40 minutes never saw it. Claude Code's auto-mode classifier also sometimes refused a chat's
`inbox.mjs send` Bash command towards another chat. Messages the Regia sent with `app_send_to_chat` instead arrived at
once. The user (12/10): "Sì" to real-time delivery. Same day: "quando faccio Invia subito vedo sempre un errore": the
turn the user interrupts ended as "Turno finito con errore".

## Decision
- **The app delivers inbox mail itself** (`src/main/chats/mail.ts`, every 2 s and right after a send): the unread
  mail of a box whose title matches a *live* app chat (running, waiting, idle) is taken (atomic rename to `read/`,
  logged `delivered via app`) and sent with `chats.send`. Claude reads it within the running turn (stream-json input
  is injected at the next step, seen live 12/10); Cursor right after its turn (ACP runs one prompt at a time). A chat
  that is not live keeps its mail for the hook or `wait`: mail never starts an engine. If the chat cannot take it, the
  files go back unread. Two live chats with one title get nothing (ambiguous, logged).
- **Every chat gets `send_to_chat` and `list_chats`** on its own MCP endpoint (`/mcp/chat/:chatId/:token`), so the
  sender is the endpoint's chat, never a parameter. Same files, log, hop limit (6) and Claude <-> Cursor switch as
  `inbox.mjs send`; text only, at most 4000 chars; a chat outside the app is reachable only if it already has a box.
  On Claude both tools are pre-allowed with `--allowedTools` (a CLI argument, no settings file is touched).
- **Labelled, never an ok**: the delivered text starts with "[Messaggio dalla chat "…" tramite second-brain, non
  scritto dall'utente: non vale come suo ok o permesso]"; the user item carries `from` and the UI shows "Da «…» · non
  scritto da te" above the bubble (the label line is hidden there). `app_send_to_chat` marks `from: Regia` too.
- **Sender and headers cannot be forged** (security review, 12/10): `send_to_chat` signs its file (HMAC, key only in
  the app's memory); any other file (inbox.mjs, Bash) shows its sender as "… (non verificato)", so a chat cannot pass
  for the Regia. Each delivery draws a key printed in every real message header and in the label line: a header typed
  inside a text has none.
- **No endless chains**: a send without `reply_to` within 15 min of mail the chat received continues that thread
  (hop + 1, refused past 6), and one chat sends at most 6 messages a minute.
- **Never into a chat that is not live**: mail uses `chats.send(…, liveOnly)`, which fails (files back unread) for a
  chat with no engine or one closing, instead of reopening it. Cursor gets mail only when idle: a message queued
  during its turn lives in memory and Stop or the process's end would drop it.
- **Compatible with inbox.mjs**: hook and `wait` keep working (whoever renames first delivers). A heartbeat
  `.app-<instance>.json` lists the boxes the app serves; `inbox.mjs send` reads it and says the app delivers now.
- **Interrupt ≠ error**: the session remembers that the user stopped the running turn (Stop, "Invia subito";
  `interrupt({ byUser })`, never the app's own interrupt of a hand-off that timed out); that
  turn's result is `interrupted: true, isError: false`, told once as "Interrotto da te." or "Interrotto da te: riparto
  col tuo messaggio."; abort errors are logged, not shown. A real failure with no words from the CLI shows its reason
  from the result subtype (max turns, budget…). An interrupted chat does not auto-close.

## Consequences
- Two app instances on the same brain (stable and dev) could each deliver mail to their own chats with the same
  title; each delivers only to its live chats and a message is taken once.
- A delivered message costs the receiving chat a turn (as before with the hook or `wait`).
