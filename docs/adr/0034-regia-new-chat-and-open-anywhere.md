# ADR 0034 · "Nuova chat" from the Regia's input, "Apri" on the chats she opens

Date: 2026-10-13 · Status: accepted · Builds on: ADR 0021 (several Regie), ADR 0028 (the docked Regia widget)

## Context
The user, 13/10: "vorrei che la regia mi portasse anche facilmente a una nuova chat e quando scrivo il prompt posso
spuntare tipo nuova chat e sa già che deve aprire una nuova chat e mi permetta di aprire la chat in questione ovunque
mi trovi nell'app". Until now a request had to say "apri una chat per…" in words, and the chat she opened had to be
found on the grid by hand.

## Decision
- **A "Nuova chat" toggle in every Regia's input** (`ChatInput.tsx`, `regia` only: the docked widget's tabs, also the
  app's Regia). On, the message goes with a first line `[nuova chat] Apri una nuova chat di lavoro per questa richiesta
  con app_create_chat (…) e non farla tu; poi rispondimi con una riga.` (`shared/newchat.ts`). The line names its own
  meaning, so it works on either engine even where the MCP instructions do not reach the model; the same rule is also in
  the Regia's MCP instructions (`NEW_CHAT_RULE`, `main/wiring.ts`, both `/mcp/app` and `/mcp/improve`). **The Regia
  opens the chat** with her usual title, folder, model and brief: the app never creates it itself. The toggle resets
  after a send; `Ctrl+Shift+Invio` sends as a new chat at once. The toggle needs words (an image alone is not a request).
- **The user's view hides the line**: the message shows a violet "Nuova chat" badge and only what they wrote; a queued
  one reads "Nuova chat · …".
- **"Apri" from anywhere, nothing moves by itself** (`lib/chatrefs.ts`, `ChatRefChips.tsx`): under a finished
  `app_create_chat` row "Chat aperta «titolo» · Apri" (chat id from its JSON result), under `app_send_to_chat` "Scritto a
  «titolo» · Apri" (its input's chatId); under a Regia's finished message one chip per known work chat it names («titolo»
  exactly, or a bare "Area · cosa" title standing as a whole; at most 4; not the chats the same turn's rows already show;
  a title two chats share gets none). The click is `actions.ts openChatRef` = `focusChat` (leaves a brain page, the map or
  focus mode, opens the column, focuses the input); a closed chat is reopened first, a removed one says so.
- **Zero extra tokens**: everything is found locally in the transcript; the only tokens are the Regia's own turn
  (and the work chat she starts, as with any request).

## Consequences
- e2e testids: `regia-input-newchat` (aria-pressed), `item-<id>-newchat`, `chatref-created`, `chatref-sent`,
  `chatref-named`, `chatref-open` (data-chat-id).
- The demo Regia answers a marked message by opening a "Demo · …" chat with an `app_create_chat` row (no CLI).
- A Regia that ignores the line still answers the request as usual: the badge only says what was asked.

## Revision 2026-10-20: "Veloce" and "Stratega" replace "Nuova chat"
The owner (2026-10-20): «il pulsante nuova chat oggi è inutile»; since ADR 0087 the Orchestrator opens a chat by itself
when a job needs one. The input now offers two exclusive modes instead (`shared/newchat.ts`): **Veloce** (`[veloce]`:
the quick path, she answers or opens ONE chat that works alone, never `agent_delegate`, the cheapest way through) and
**Stratega** (`[stratega]`: a Strategist chat plans the request and delegates the parts). Neither ticked = she decides
with `task_estimate` as before. Ctrl+Shift+Invio sends as Veloce. Older `[nuova chat]` messages keep their badge.
Testids: `orchestrator-input-mode-quick|plan` (aria-pressed), `item-<id>-mode`, `.msg-user[data-mode]`.
