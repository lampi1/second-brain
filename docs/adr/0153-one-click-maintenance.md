# ADR 0153 · One-click «Manutenzione»: proposals only on the user's click, issues opened from a card

Date: 2026-10-24 · Status: accepted (owner asked for it in the project thread) · Supersedes: the dialog of ADR 0132 (§1),
«Idee dell'app» and «Apri issue» through the Orchestrator (ADR 0132 §5), the six-hourly cleanup (ADR 0132 Consequences,
ADR 0077/0137 timers) and, for skills and rules, the owner's 2026-10-19 rule that their changes apply by themselves
(ADR 0077) · Builds on: ADR 0123 (the Proposte deck), 0137 (exact proposals before any semantic edit), 0151 (notices)

## Context
The owner (2026-10-24): «idee, pulizie memorie, proposte di skill e rule devono avvenire solo quando l'utente fa la
manutenzione». The maintenance dialog (engine, model, effort, cap, web, prompt) was «troppo macchinoso»: the user must
only press the button; an invisible agent in the background places the cards in Memoria (new skills and rules), adds
the ideas to the AI's ideas and always proposes, as a card, to open the GitHub issue; approving opens it directly. He
also wants a good-looking notice when it ends.

## Decision
1. **One click.** `maintenance:run` runs the free cleanup (every job, the log step and its cards, unchanged) and then
   the research with the app's best choice (`ResearchService.defaults`: Claude when on, else the first engine that reads
   files and reports cost; its strongest model; high effort where the engine has it; the web where it has it; the 5 $
   cap; the shipped method). No dialog, no prompt to edit. With no such engine only the cleanup runs. One at a time.
2. **Invisible.** The research chat never reaches the renderer's chat state (no strip, list or palette entry), makes no
   «finished» feed event and never wakes the Orchestrator (already so, ADR 0132). The button breathes while it works;
   the Memoria hero shows the live cost and «Ferma».
3. **The end notice** (`maintenance:done`, `MaintenanceDone`): a celebrate notice on the app's notice card (ADR 0151)
   with chips (proposals, ideas, issues to open) and «Apri Memoria»; calm when nothing was found, a warning when the
   research failed or hit its cap. The button sparkles once. The last end is kept and shown in the hero.
4. **Issues are cards.** Every app idea or bug (and a bold idea that is an issue) is a Proposte card in the new group
   `issue`: «Apro su GitHub la issue «…»?» with the issue as it will be opened. Approve opens it at once
   (`brainmodel/issue-open.ts`): `gh issue create` with the user's own gh login (body on stdin, no shell; again without
   labels when the repository lacks one), else GitHub's new-issue page pre-filled in the browser. Reject keeps it from
   coming back and marks a log bug's group known. The «Idee dell'app» tab and its IPC are gone (`memoria/app` opens
   Proposte). An agent's hidden run and the demo never reach GitHub.
5. **Ideas land in Idee.** An app idea is also written to the brain's ideas, on the AI's side («Fonte: IA ·
   Manutenzione»), through the brain's `mem.mjs idea` like the Battito's «Salva» (`brain/save-idea.ts`).
6. **Nothing proposes by itself.** No six-hourly cleanup (only the one-time structural migration a minute after
   start); the per-job «Esegui ora» buttons on Regole and Memoria are gone; the Battito makes no idea cards; the skill
   candidates and the Battito's learned rules made after the last click wait in the deck until the next one
   (`proposals/service.ts` `heldBack`, the click time in `maintenance-research.json`). Settings, trials, tiers,
   policies and already-applied changes are not held: they are not skill or rule proposals. Memory facts are the
   «Domande sì/no e fatti in memoria» work (saved by themselves, tidied by the `merge-memory` job of the click).
7. **Skill and rule changes wait for the user's yes.** The maintenance proposes exact text as cards; nothing changes
   the brain's skills or rules before the approval (ADR 0137 already deferred semantic edits; this ends ADR 0077's
   «apply by themselves» for skills and rules). Approved changes keep their log entry and «Annulla».

## Consequences
- A click spends up to the cap (5 $) without a question; the hero shows the live cost and «Ferma».
- Approving an issue card publishes on GitHub: the card shows the full text first; private data is scrubbed as before.
- A user without gh gets the pre-filled page and presses «Submit» there.
- Tests: `test/unit/brainmodel/research.test.ts`, `test/unit/brainmodel/issue-open.test.ts`,
  `test/unit/proposals/held.test.ts`, `test/e2e/maintenance-research.spec.ts`, `test/e2e/maintenance-logs.spec.ts`.

## Amendment (2026-10-24, owner's screenshot)
- The repository is never unknown: package.json `bugs`, else its GitHub `repository`, else the app's own
  (`APP_ISSUES_URL`, lampi1/second-brain). A frozen release's package.json now keeps `repository` and `bugs`
  (`scripts/release.mjs`); before, it had only name and version, so every issue card said «Non so in quale repository».
- The log step writes its issue in the user's language, and its card has no raw log line: the line is in the issue
  only. The deck never quotes a log line, JSON or code under «da …» (it stays in «Mostra tutto»).
