# ADR 0259 · The question card, redesigned: still while open, «Bivio», Esegui as a question

Date: 2026-11-10 · Status: partly superseded by ADR 0275, ADR 0269 (the card lives in the Orchestrator); accepted (owner, thread «Rendere chiare le domande degli agenti») · Builds on: ADR 0049
(questions window), ADR 0135 (yes/no questions), ADR 0150 (decision card), ADR 0255 (phone answers) · Amended by: ADR 0272

## Context
The owner (2026-11-10): questions are a core part of the app and they «non spiegano bene la domanda e sono formattate
male», «a volte la modale si modifica da sola mentre è aperta», «le domande con esegui a volte non compaiono bene», and
they must work from the phone. He reviewed proposals A-G and three card designs, picked «3 · Bivio» and asked for all of
it («Sì, tutto»), the Esegui commands too, from Telegram and Remote Control (reserved ones stay on the PC).

## Decision (built in steps; each step adds its section)

### 1. The card stays still while it is open
- The questions window freezes the asking chat's items when a card opens (`lib/askItems.tsx useFrozenItems`,
  `AskItemsProvider`): the card's context, brief, visuals and the turn's commands read that copy (`useAskItems`).
  What the chat writes afterwards shows one notice, «L'agente ha aggiunto qualcosa mentre leggevi · Mostra»; a click
  takes the new items in. What counts as new is the current turn's text, reasoning and attached visuals
  (`lib/askContext.ts turnSignature`), never a tool's status. Tiles and the lane keep reading the live store.
- The answers (Sì / No, write, skip) are one block (`.dc-act`) pinned to the bottom of the window's scrolling body, so a
  long context never pushes them out of sight.

### 2. «Bivio»: a short question, one sentence of context, two roads
- The brief (`UiBrief`, `shared/genui.ts`) gains optional fields: `why` (one plain sentence of context), `yesLabel` /
  `noLabel` (what the buttons say: «Sì, faccio il commit»), `yesSteps` / `noSteps` (what happens next on each road,
  up to 4 / 3 steps) and `change {what, before, after}` (a measurable result, shown large as Prima → Dopo).
- `DecisionCard.tsx` draws: the question, the context sentence under it, the before → after, the evidence (what was
  done as numbered steps, no green ticks; checks, screenshots, files), then the two roads «Se Sì» / «Se No», each with
  its numbered next steps (or the ifYes / ifNo sentence) and its button. Plans and work approvals get the same roads.
- A question without a brief shows the agent's own context sentence and keeps the chat's text folded (one click), never
  open as a wall of text.
- The rule every chat reads (`QUESTION_RULE`) asks for these fields, a question of at most 120 characters with no code
  or paths, and never a question on whether the user ran a command. The engines' gate sends back a question longer than
  `MAX_QUESTION_CHARS` (160) or with a code fence, like a non yes/no one (same retry limit: after two it is shown as
  it is).

### 3. Esegui is the question; the user never has to say «Fatto»
- A command the chat left (`main/run/asks.ts`) is a «Bivio» card: «Eseguo questo comando sul tuo PC?» (or the chat's
  own lead when it is a short question), the chat's reason under it, the command whole with its folder and Copia, and
  the roads «Sì, eseguilo» (runs here, the result goes to the chat by itself) / «Non serve» (the chat goes on without).
- The turn's last message is read when the chat stops on a question too (`waiting`), not only when the turn ends; a
  question or a visual (`AskUserQuestion`, `show_ui`) is not work, so it does not hide the block before it. The command
  card comes before that chat's question in the window. A dismissed command is not asked again in the same turn.
- When the run ends while its chat waits on a single plain yes/no question from the same turn (the old «Hai lanciato
  il comando?»), the result answers that question (`run/results.ts answerWaiting`) with a note that it was not a reply.
- After Sì the card leaves at once; a small strip at the bottom (`components/RunWatch.tsx`) shows the run: running with
  its last line, «Fatto: esito mandato a …» (gone after 4 s) or the error with Riprova.
- The rule asks agents never to ask whether the user ran something, and to list any step only the user can do in the
  brief's `todo` («Tocca a te», shown above the evidence). The gate sends back vague questions («Fatto?», «Ok?»,
  «Procedo?»: `vagueQuestion` in `shared/yes-no.ts`).

### 4. Telegram and Remote Control get the same card
- `main/chats/ask-text.ts` writes a question away from the PC with the card's parts, one per line: the question, the
  context sentence, before → after, «Tocca a te» steps, what was done, «Se Sì» / «Se No» with their steps. Telegram
  (`phone-port.ts`) sends it with the Sì / No buttons (the question alone when the whole text does not fit, as before);
  `relay_question` (Remote Control and the phone's chat, through the Orchestrator) hands the same text to write.
- A command a chat left is decided away too (the owner, 2026-11-10: «Sì, tranne i riservati»): «Eseguo questo comando
  sul tuo PC?» with the command whole. Telegram's Sì or a relayed «sì» runs it on the PC through the same runner as
  Esegui (a block of that message only); No puts it aside. A relayed chat's command goes before its question.
- Telegram's outgoing filter (`phone/filter.ts`) turns most command lines and paths into «[comando: eseguilo dal
  PC]»; a command it would not show whole gets no buttons, and a relayed «sì» typed in the phone's chat does not run it
  (`commandShownWhole`): the user never says sì to a command they cannot read. Remote Control shows it whole. The
  filter is unchanged (relaxing it is the owner's call).
- Reserved commands stay on the PC: production (the runner wants the PC's second click), reserved words
  (`shared/away.ts`), databases and migrations, Azure and other cloud or cluster tools, bulk deletes, also with a path before the tool
  (`commandReserved`). A reserved command does not block the chat's other relays. Checked again when the answer arrives.

## Consequences
- A card can show a turn a few seconds old; the notice says so and one click updates it.
- A command can now run while the user is away from the PC, by their own «sì»; the reserved list decides which. A
  command that is risky but not on that list (a script that deletes, for example) runs if the user says sì from the phone.
- A plain yes/no question can be answered by a run's result; the note in the answer says so, and the chat can ask again.
