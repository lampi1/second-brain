# ADR 0017 · Commands left for the user, the Regia's news, questions answered in the Regia

Date: 2026-10-12 · Status: accepted

## Context
Three gaps the user hit on 12/10/2026:
- "non mi appare come notifica quando devo premere Esegui": a shell block a chat left for him stood unnoticed under
  its Esegui, and the work stood still.
- "quando le chat finiscono non ti notificano nulla": the Regia saw the other chats only when he wrote to it.
- "anche se rispondi te alle chat, rimane la UI della domanda nella chat": the Regia asked him a work chat's question,
  sent the answer as a message, and the chat's panel stayed open (and in "Ti aspettano"), because agents could not
  answer panels (ADR 0006).

## Decision
- **"Comando da eseguire"** (`shared/command-ask.ts`, `main/run/asks.ts`). When a chat's turn ends, its last assistant
  message is read with a narrow rule: top-level fenced shell blocks only, and either the message's last block (at most
  one short line after it) or one the text right before asks to run ("lancia", "esegui", "in PowerShell"); never one
  called an example or run by the agent itself. Each becomes a `PendingRequest` of type `command` (lane, layer, Regia
  card, notification), answered by Esegui (`run:start`, the run stays tied to the chat and message that proposed it)
  or "Non serve" (`run:dismiss`), gone when the chat goes on. It never counts in `ChatSummary.pending` (the chat is
  not blocked), and the auto-close waits for it. A hand-off turn is not the chat going on and its note is never read.
- **"Eventi alla Regia"** (`main/chats/regia-wake.ts`, setting `regiaEvents`, default on). A work chat that ends a
  turn, stops on an error, asks a question or permission or leaves a command is told to the Regia in one grouped
  message (20 s window, at most once per chat every 2 minutes), labelled as the app's and never worth as the user's
  ok. It waits while the Regia works or waits for the user; news about a request answered meanwhile is dropped.
- **`app_resolve_question`** (`main/appctl/tools.ts`): the one exception to "agents never answer panels". Only
  questions of work chats (never permissions, commands or the Regia's own questions), every question answered, each
  answer marked "Risposto in Regia dall'utente: …", and only if the user wrote to the Regia (an unlabelled message) or
  answered one of its questions after the question opened. Permissions stay his click only.
- **"Esito alla chat"** (`main/run/results.ts`, setting `runResults`, default on). When a run of Esegui ends, the chat
  that proposed the block gets one message (labelled as the app's, never worth as the user's ok) with the command, the
  exit code and the output's tail (redacted, at most 3000 characters); runs that end close together go in one message.
  A chat that works, waits for the user or writes a hand-off gets it once it is free; a closed chat is resumed by it.
  Asked by the user on 12/10/2026: "vorrei che ti accorgessi da sola quando eseguo un comando dal play senza che ti
  scriva fatto o copiarti la risposta".

## Consequences
- An agent can close a question for the user, but only after he spoke in the Regia, and the chat always sees that the
  answer came through the Regia. The Regia's MCP tools are pre-allowed, so the check lives in the tool, not in a
  permission prompt.
- Each Regia wake-up is a turn of the Regia (tokens): grouped and rate-limited, off with the setting.
- Each run result is a turn of the chat that proposed the command (tokens); off with `runResults`.
- Nothing is persisted: after a restart command requests are gone (the blocks keep their Esegui in the chat).
