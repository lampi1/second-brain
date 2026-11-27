# ADR 0367 · The Orchestrator column: thin rows, short cards, «Stai aspettando», the estimate as metadata, and a credentials card the model never reads

Date: 2026-11-27 · Status: accepted (owner, restyle of 2026-11-27, mockup `restyle-2026-11-27/nuova-ui.html`, issue #491) ·
Amends: [0012](0012-login-handoff.md) (the clipboard gets its earlier text back), [0087](0087-quick-path-and-task-estimates.md) (where the
estimate lives), #351 (the folded result card). A rule-2 exception (`docs/agents/rules.md` §2).

## Context

- Results other agents send to the Orchestrator were a fat card («Air refactoring · PaymentService · Artisan · risultato
  pronto», a long first line, «Mostra il risultato»). The owner: «discreti, come la UI dei messaggi delle altre chat, non
  così grassi». The open chat view also carried «Incarico corrente · v1 · <role>», which he calls useless.
- The app's routing estimate rode inside the user's message (`[app estimate · path …] …`). The live item kept his words,
  but an engine's echo (ACP, Codex) or a transcript re-read with a hint after the line showed it in his bubble.
- He asks for test credentials about a dozen times a week («dammi le credenziali di test 3») and wants them ready to copy,
  without the values ever going through a model, a transcript or a log.
- He cannot see which of the things he asked for are still running.

## Decision

1. **Thin rows.** A `resultReady` item is one 30 px row like «Evento app» (`ResultRow.tsx`): the agent's head (18 px), the
   chat's title, the outcome's first sentence with an ellipsis (`lib/orch-lines.ts outcomeLine`), › to unfold the whole
   result, its questions and criteria and «Apri la chat». A result the user waited for reads «✓ Finito quello che
   aspettavi» (the notice carries `params.waited`). The app-news rows (`.foreign-row`) get the same look.
2. **«Incarico corrente» is removed** from the open chat view (`TaskContext.tsx` deleted).
3. **Short cards in the waiting list** (`OrchAskCard.tsx`, drawn by `QuestionsWindow.tsx` for a closed row): a command is
   «▶ Esegui · what it does (shared/gist.ts) · folder · risk», the command in one mono line with «Copia», the chat's reason
   in one sentence, Esegui / No (production still asks a second click); a yes/no question is «role · topic», the question in
   one line, Sì / No / «Cosa cambia?». The head opens the full card as before.
4. **«Stai aspettando».** Main already knew which root chats the user waits for (`userWaits`, #123: opened or assigned by
   the Orchestrator while it answered his own message). `ChatSummary.userWait { since, doneAt? }` mirrors it
   (`manager-core.ts syncUserWait`, restored from the persisted `userWaits` at load); `releaseResult` sets `doneAt`. The
   row under the topic pills (`WaitingRow.tsx`) lists them: a coloured dot and coloured text (plan step or state), a green
   ✓ «finito» for 30 minutes; no box or pill (owner). No new tool: the data is the app's own.
5. **The estimate is metadata.** The user item gets `estimate { path, why }` (`shared/task-estimate.ts splitEstimate`, set
   in `deliverNow` and when a transcript is read back); the renderer also splits an older or echoed line. The bubble shows
   only his words and a small closed chip «stima · …» that opens the line on click. The model still reads the estimate as
   the app's own block after his words, in the same format the role text names.
6. **The credentials card (rule-2 exception).** `app_show_credentials { ref }` on the Orchestrator's own endpoint (required
   tool, `shared/role-tools.ts`; one line in its role text): main finds the entry of the user's credentials file
   (`browser/logins.ts cardMatch`: an exact user name or host, then whole words of the group and hosts, then words inside
   the group's; a user name never matches in part) and adds a `credentialCard` system item holding only the entry's
   opaque id and group. No match, several, or production only all get the same plain refusal naming nothing
   (`CARD_REFUSAL`), so a model cannot probe the file by trying references. The tool's result says the card is shown and
   nothing else. The entry goes live for 10 minutes (`browser/card-gate.ts`, `shared/credential-card.ts`): only then does
   main answer the renderer `credentials:card` (URL, user) and, on «Mostra», `credentials:reveal` (password), reading the
   entry again and refusing it if it now looks like production (the id does not cover loginUrls);
   `credentials:copy` writes one field to the clipboard on the user's click. The card hides itself after 10 minutes and
   forgets the values. Logs name the entry id, never a value.
   **`app_screenshot` hides the values** before it captures the app window (`appctl/ui-shot-mask.ts`): the renderer
   sets `data-shot-mask` (every value carries `.oc-cred-val`, hidden by orch-chat.css), waits for a painted frame and
   confirms each value hidden; the capture follows and the values come back. Without that confirmation the screenshot
   is refused, as `browser/shot-mask.ts` refuses a tab whose passwords cannot be hidden. No other capture of the app
   window reaches an agent (the tab screenshots never show the column; the dev and README shots are CI/human only).
7. **The clipboard gets its earlier text back** 30 s after a password copy, only if it still holds the password
   (`browser/password-clip.ts`, for hand-offs, the panel and the card alike); empty before means cleared, as before. A
   repeat copy takes the earlier text again when the clipboard no longer holds the password (X, password, Y, password
   gives back Y).
8. Every code block already has «Copia» (`CodeBlock.tsx`), the command card has its own; radii come from the tokens.

## Consequences

- The Orchestrator column reads as a list of short lines; the details are one click away.
- A password reaches the renderer only on the user's «Mostra», for a card he asked for in the last 10 minutes; it is never
  in a tool result, an item, a transcript, a log or an agent's screenshot. Pinned by
  `test/unit/appctl-credential-card.test.ts`, `test/unit/ui-shot-mask.test.ts`,
  `test/unit/password-clip.test.ts`, `test/unit/orch-lines.test.ts`, `test/unit/orch-column-render.test.ts`,
  `test/unit/chat-items-estimate.test.ts`, `test/unit/chats/user-wait.test.ts`, `test/unit/chats/request-estimate.test.ts`.
- «Entra tu al posto mio» (an agent signs in with that entry) is left out: `fill_credential` already does it inside a chat's
  browser tab; a button here would need a chat and a tab to act in.
- A waited result's ✓ survives 30 minutes in one app run; after a restart only the open waits come back.
