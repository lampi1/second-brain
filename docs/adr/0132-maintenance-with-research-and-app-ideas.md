# ADR 0132 · The maintenance with research, the «Idee dell'app» tab and the phrases of the day

Date: 2026-10-23 · Status: accepted (owner asked for it and approved the design doc, the 5 $ default cap and keeping the
6-hourly zero-token cleanup; «Ogni giorno in automatico» chosen on a decision card for the phrases) · Builds on: ADR
0077 (changes apply with log and undo), 0112 (the maintenance reads the logs), 0122 (Memoria is the hub of proposals),
0123 (the proposals deck), 0126 (every card asks a plain question)

## Context
The «Manutenzione» was free and blind: fixed jobs over the brain and a log step whose new groups were sent to the
Orchestrator as a message. The owner wanted:
- one always-visible «Manutenzione» button that lets him choose engine, model and effort;
- a costlier option, «Ricerca e miglioramento», that reads his history, the brain and the logs (and the web when the
  engine has it) and proposes real improvements, bold ones included, and what to forget;
- every proposal as a big card that says clearly what it adds and what it removes; no "if you press no it is rejected"
  lines;
- ideas and bugs about the app's code in their own tab, with the issue already well written, opened on GitHub by the
  Orchestrator from «Apri issue» or «Apri tutte»;
- the prompt visible and editable at every maintenance; no night runs;
- the working-line jokes rewritten every day at a very low cost.

## Decision
1. **One dialog.** The button (top bar `topbar-maint`, Orchestrator head, Memoria) opens a dialog instead of running at
   once. «Avvia la pulizia» runs the free cleanup as before. Ticked, «Ricerca e miglioramento» shows the engine (only
   engines that are on and read files: no API engines), the model (default: the strongest the app knows, `opus` on
   Claude), the effort (only where the engine has it), the spending cap (default 5 $, 0.5–50), the web switch, an
   estimate from the last researches' median cost, the prompt (editable, «Ripristina»; the last one run is shown next
   time) and, read-only, the fixed frame. Nothing runs at night or by itself.
2. **The research is an app chat «Manutenzione»** (`ChatManager` `research`, no role): a role's settings would override
   the model the user chose. Its tools: read (and web when allowed), `maintenance_pack` (a zero-token data pack:
   summary, runs, roles, skills, rules, memory, changes, logs, past findings; 30 days) and `maintenance_propose`, both
   pre-approved on every engine and visible only to this chat; it sees no app or agent tools and never wakes the
   Orchestrator. The chat is stopped when its live cost passes the cap, after an hour, or on «Ferma».
3. **Every finding is a card**, checked by `ResearchService.propose`: a title, what it adds and removes (one at least),
   why with the numbers, evidence, sources (https), expected effect, risk. Caps per research: 5 brain changes, 5 to
   forget, 5 app ideas or bugs, 1 bold. A card equal to an open or rejected one is refused. A change never grants
   permissions or touches settings or hooks; a forget names a brain skill (never the user's own), a `rules/` file or a
   memory line.
4. **Brain cards go to Memoria → Proposte** (source `research`) with the delta shown big (green adds, red removes, the
   exact text under «Mostra tutto»). Approve applies through the change log (`BrainModelService.applyResearch`, job
   `research`, with «Annulla» in Apprendimento); reject keeps it from coming back. The yes/no meaning lines are gone:
   the buttons' tips say it.
5. **App cards go to Memoria → «Idee dell'app»** (`app` tab) with the issue as it will be opened (title, labels, body
   cleaned of the home folder, the user name, e-mails and tokens). «Apri issue» sends one, «Apri tutte» every open one
   in one message, to the open Orchestrator as the user's own request (check for duplicates, then open with gh; the
   user's permission rules still apply) and marks them asked. «Scarta» drops one; a bug from a log group also marks the
   group known.
6. **The free cleanup makes cards too**, at zero tokens: one app bug per new log group (replacing the hand-off message
   to the Orchestrator of ADR 0112; a research may rewrite that card) and one forget card per brain skill no job used
   in 60 days and older than 30 (never re-proposed within 90 days).
7. **The phrases of the day** (`main/daily-phrases.ts`): once a day, 90 s after the app opens (and hourly after), one
   one-shot request on the lightest model (`OneShotService` `light`: no role text, low effort) rewrites the working-line
   jokes in the UI language. Each line is checked (one line, at most 70 characters, no link or markup); a kind with
   fewer than half its lines keeps the fixed ones. A failed day waits for the next. Off in the tests.

## Consequences
- The research costs what the user allows and shows its live cost; its findings change nothing until approved.
- «Apri issue» can still raise gh permission prompts, by the user's rules.
- Stored in `userData/maintenance-research.json` (90 days of decided cards, at most 400 cards and 30 runs) and
  `userData/daily-phrases.json`.
- Tests: `test/unit/brainmodel/research.test.ts`, `test/unit/daily-phrases.test.ts`,
  `test/e2e/maintenance-research.spec.ts`, `test/e2e/maintenance-logs.spec.ts`.
