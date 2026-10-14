# ADR 0038 · "Mandato" on texts to send, and the chat learns by itself when the user is done

Date: 2026-10-13 · Status: accepted

## Context
The user, 2026-10-13: "quando ti chiedo cose da mandare mettimi sempre un pulsantino 'mandato' in modo che ti segni che
l'ho fatto, e devi capire meglio da sola quando finisco di fare qualcosa". Agents put mails, Teams messages and PR or
DevOps comments in fenced blocks (me.md); the user copied them, sent them elsewhere, and then had to write "fatto" so
the chat would know. Esegui outcomes already reach the chat by themselves (main/run/results.ts, setting runResults),
but the block still offered "Manda l'esito alla chat" as if it were manual. A command card answered "Non serve" told
the chat nothing.

## Decision
- **Which blocks**: a fenced block with no language or tagged text/txt/plain/plaintext/markdown/md/mail/email/teams/
  message/msg/comment is a text to send (`renderer/lib/sendable.ts` `isSendable`). Shell, SQL and code never are.
- **Buttons** (CodeBlock.tsx), in chat tiles, the Regia and the questions window (AskContext.tsx renders the turn's
  texts to send as code blocks; other code there stays plain): Copia leaves "Copiato hh:mm"; Mandato leaves
  "Mandato ✓ hh:mm" with Annulla for 5 s. Marks are per block (chat + hash of the text: not the message id,
  which changes when a transcript is read back after a restart; the same text twice in a chat shares its mark) in
  localStorage (`lib/marks.ts`, newest 500), so they survive a restart and show the same in every window.
- **What the chat hears** (store/store.ts notes): one line per block, "[Mandato] <first line…>", "[Copiato] …",
  "[Non serve] <command's first line>". Only the first non-empty line, cut to 60 characters, words of 24+ characters
  masked (URLs keep their path, lose the query): never the block's content.
  - Mandato and Non serve: told when the chat is free (idle, nothing asked, no hand-off being written: a short message
    of its own, after the undo window); otherwise held apart (never inside a queued message, so removing that one loses
    nothing) and attached to the next message that leaves, or sent as one line for all of them when it is free again.
    Never a queued message of their own, never one turn each; Enter on an empty field never sends notes alone.
  - main/run/asks.ts reads a message of notes only (shared/notes.ts) as the app's own: the chat's other open
    "Comando da eseguire" cards stay (a typed message still clears them).
  - Copiato: only rides on the user's next message (copying is not sending); Mandato on the same block replaces it.
  - A message of notes only folds to one line "Fatto da te" (lib/foreign.ts kind `done`); notes riding on the user's
    message show as one muted line under the bubble.
- **Esegui**: the outcome goes by itself (unchanged, main); the block now says "Esito mandato alla chat da solo" when
  the labelled result item is in the chat, "va alla chat da solo, appena è libera" before, and the button is
  "Rimanda l'esito", shown only once the outcome arrived (before, a manual send would reach the chat twice). With
  runResults off it is "Manda l'esito alla chat" as before. Known gap: if main fails to deliver the outcome (send error,
  setting off when the run ended) the block keeps saying it is on its way; fixing it needs main to publish each run's
  delivery state (a contract change, left to the integrator).

## Consequences
- Zero tokens on the app side: the agent's next turn is the only cost; a Mandato on an idle chat starts one short turn.
- Notes held in memory are lost if the app restarts before they are told (the marks stay).
- A closed chat is not woken by a note: it hears it with the next message.
- Pinned by test/unit/sendable.test.ts, test/unit/command-ask.test.ts and test/e2e/mandato.spec.ts.
