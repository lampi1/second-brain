# ADR 0326 · One question, one row, one answer

Date: 2026-11-19 · Status: accepted (owner, 2026-11-19: «vorrei che gestissi in maniera nettamente migliore la UI delle
domande, il rischio di doppioni o di domande in coda: voglio logica semplice chiara che non crei mai casini» · «le
domande se espanse siano veramente leggibili per intero e che siano scritte bene» · «a volte quando rispondo su altro a
una domanda chiedendo spiegazioni mi risponde con un'altra domanda uguale senza realmente spiegarmi» · «l'orchestrator
deve prendere per mano l'utente e spiegare bene le cose» · «io parlo sempre e solo con l'orchestrator») · Amends:
ADR 0150, 0259, 0269, 0274

## Context

Read in the code on 2026-11-19, the causes of what the owner saw:

1. **A typed answer forced the same question again.** Every role read «free text is a clarification, never implicit
   approval» (`DECISION_FLOW_RULE`): after any answer in the user's words the only allowed move was to ask again.
2. **A request to explain was delivered as the answer.** Whatever he writes to the Orchestrator while its own question
   is open becomes that question's answer (`ChatInput`, ADR 0274). «Spiegami meglio» reached the engine as the picked
   answer, with nothing telling it what those words were. The app even had a label for the result («Te la richiede:
   avevi risposto …»).
3. **His question about a work chat's question could leave the Orchestrator.** The note with the open questions let
   the Orchestrator pass any of his words to the work chat, which he never reads.
4. **The same question twice in the column.** A worker's question has its row; the Orchestrator could ask it again as
   its own, and at the PC `relay_question` wrote it a third time in the chat.
5. **Rules against each other.** «do not paraphrase, duplicate or answer them» (news rule), «answer their questions …»
   (ADR 0275) and «Permission requests stay with the user» sat in the same Orchestrator role.
6. **The open card repeated itself.** The brief was drawn in the chat and again in the card under it; «Messaggio
   della chat» showed again the message just above; the reading area was a 120 px box that scrolled inside the
   scrolling card, under answers pinned over it.

Measured on the owner's PC on 2026-11-19 (read-only, his Claude transcripts changed since 2026-11-05: 726
`AskUserQuestion` calls in 75 chats): 17 times a chat asked again the question it had just asked (the same words, or
at least 80% of them). 11 of the 17 came after an answer in his own words, 9 of them after a request to explain («in
che senso?», «perché?»). In 9 of those 11 the chat wrote no text between his words and the same question, which came
back in the same turn after about 20 seconds; in 6 the only thing in between was a new brief. No question was asked
while another was open in the same chat. Not measured: the same question asked by a work chat and then by the
Orchestrator (the count was per chat).

How others ask, each read at its source on 2026-11-19:

- Claude Code `AskUserQuestion` (code.claude.com/docs/en/agent-sdk/user-input): 1-4 questions, 2-4 options each with a
  label and a description, free text always possible.
- obra/superpowers, brainstorming skill: one question at a time; never reopen what is already decided; say why you ask.
- GitHub spec-kit, clarify template: exactly one question at a time, a recommended option with its reason, a «why it
  matters» sentence.
- OpenAI Codex (`request_user_input` spec; plan-mode template): prefer one question, the recommended option first, one
  short sentence on the impact of each option; a question of the user is answered before anything else; never «should
  I proceed?».
- Nielsen Norman Group, confirmation dialogs: be specific, say the consequence, name the buttons after what they do.
- Apple Human Interface Guidelines, alerts: button titles that describe the result; an alert must not scroll.
- Google conversation design, errors: never repeat the original prompt in the same words.

No source states the whole rule below; joining them (answer first, then never the same words) is this ADR's choice.

## Decision

**One question, one row, one answer.** The pure rules are in `src/shared/ask-once.ts`; the manager applies them for
every engine (`chats/manager-requests.ts`), so they do not depend on a model following a text.

1. **His own words are his answer, and the chat is told so.** An answer that is not one of the options reaches the
   engine with one app note after it: these are his words; if they decide, act and do not ask to confirm; if they ask
   something, answer in the reply, in plain words (what each choice changes for him, one example); only after that
   reply may the question come back, and a brief is not that reply.
2. **The same question comes back only after a reply to his words.** After a words answer, the same question asked
   again at once, before the chat wrote a reply of at least 120 characters, is answered by the app with the same
   instruction and never becomes a row. After the reply it is a row again: he reads the reply with it (the
   Orchestrator's chat, or a work chat's message in the question's card) and answers with a click, and it counts in «Da
   rispondere». After two app answers in a row the question is shown anyway, so a chat can never be stuck.
   - «The same question» is strict: the same words once case, punctuation and the «(consigliato)» mark are gone, or
     one text with a few words added to the other (at least 60% in common). One changed word is another decision
     («file A» / «file B», «commit» / «push», «staging» / «prod») and is always shown.
   - «At once» is the exchange that was measured: the memory of his words ends when the chat does work (any tool that
     is not a card or a question), ends its turn, receives a new message or its engine ends. What he wrote never
     answers a later decision.
   - Only words he typed start the rule. A picked option does not («Applico anche il prossimo file?» asked again
     after a Sì stays his to answer), nor does «sì» typed instead of clicked, nor a text the app sends as an answer (a
     run's result, «Non voglio rispondere», «Basta domande»).
   - A question about production, a database or Azure is never answered by the app.
3. **The Orchestrator never asks a worker's open question as its own.** Its copy (the same strict match) is answered by
   the app: the row is already under its chat; answer it for him with `app_resolve_question` or leave it there. Told
   twice for the same row, its question is shown. (Away, the relay's own question panel still works: ADR 0255,
   unchanged.)
4. **A request to explain never leaves the Orchestrator.** `app_resolve_question` with `words` refuses when his message
   asks about the question instead of deciding it (it opens with «spiegami», «non ho capito», «perché», «cosa
   significa», or with a question word and ends with «?»; «sì, ma su dev?» and «usa dev, ok?» are answers). The
   Orchestrator explains in its chat and the row stays open.
5. **At the PC a question is not written again, by rule.** The news rule tells the Orchestrator that a worker's
   question keeps its own row and is brought with `relay_question` only when he is away (Remote Control, phone). The
   app does not refuse the relay: it can not know where he is (his last message from the PC does not mean he is
   still there), and a refused relay would leave Remote Control without the question.
6. **The rules say one thing.** `DECISION_FLOW_RULE`: a free-text answer is his answer; if it asks, answer it in the
   reply first; never the same question again without that reply; never a question the request, the brain or an
   earlier answer settles. News rule: a worker's question keeps its row; never asked again as the Orchestrator's; explained in
   plain words when he asks. «Permission requests stay with the user» is gone (ADR 0275 and 0294 decide that).
7. **A question is written for someone who did not follow the work.** `QUESTION_RULE`: one at a time; the question says
   what it decides; the brief gives `why` (what is at stake for him and why the recommended option), `ifYes` / `ifNo`
   (what happens next) and the buttons named after the action (`yesLabel` / `noLabel`); `done` is optional (a question
   can come before any work). The app's checks ask for the same.
8. **The open card says each thing once, in reading order.** Question, why, the two roads with their buttons, then the
   details («Cosa ho fatto», change, checks, files). No pinned block over the text and no box that scrolls inside the
   card: the card scrolls as one page. A brief whose question is open is drawn only in the card, not also in the chat;
   the Orchestrator's own question does not repeat its last message. A question with other options shows them right
   under the question, the context after.

## Consequences

- The Orchestrator's role is 465 characters longer (15,095; the cap is 16,000).
- A chat that ignores the note costs at most two short app answers before its question is shown again.
- «The same question» is words, not meaning: a re-ask with a word changed still gets a row (of the 17 measured, the
  ones reworded that way). Then the note of point 1 is the only guard. «A reply» is a length, not a judgement: 120
  characters of anything count.
- A brief without `done` is valid; older briefs draw as before.
- Untried on a real PC: the count above was taken before this change and has to be taken again after some days of
  use.

## Alternatives

- **Never the same question again before his next message, even after an explanation.** Simpler, and the first
  version of this change. Refused: after «in che senso?» the decision would leave «Da rispondere» and wait in a chat
  message, easy to miss from the phone.
- **Answer every repeated question by itself, option picks too.** Refused: «Applico anche il prossimo?» is a new
  decision each time; only his own words are carried over.
- **Make `why` required.** Refused: one more send-back for every question; the card falls back to the brief's summary.
- **A looser match (60% of the words in common, whatever changed).** The first version. Refused in review: it took
  «Faccio il commit?» and «Faccio il push?» for one question and let «sì» to the first answer the second.
- **Refuse `relay_question` when his last message came from the PC.** The first version. Refused in review: see
  point 5.
- **A model that judges whether two questions are the same.** Refused: tokens and a delay on every question, for a case
  the word count covers.
- **Keep «free text is a clarification».** It was written so that «ok» to something else never approved a production
  step; «never implicit approval of more» keeps that, without forcing the re-ask.
