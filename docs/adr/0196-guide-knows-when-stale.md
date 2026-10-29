# 0196 — The Guida knows when it is stale, answers questions, draws from the code and picks cards for the user

Status: accepted. Builds on ADR 0057, ADR 0070, ADR 0101, ADR 0117 and ADR 0149.

2026-10-29.

## Context

The Guida (src/shared/concept-guide.ts, 39 cards in it/en, German in concept-guide.de.ts) is hand-kept. Its unit test
only checked that the files a card cites exist, not that what the card says is still true: a card could describe code
that changed months ago and nothing would tell. The page could only be read and filtered; a question about the app went
to the Orchestrator, a full role chat. State of the art: Google's Code Wiki regenerates its docs after each change,
links every section to the code, draws diagrams from the code and answers questions; OpenAI's doc-gardening agent opens
fix-ups for stale docs. The owner's analysis asked for the same, zero tokens where possible and no new approval.

## Decision

**G1 — anchors.** A card's `anchors` name the code each point describes, by point index (-1 = the technical part):
`"src/main/chats/manager.ts#settleReport"` or a whole small file. They were taken from the comments that already cited
a file and a symbol beside each point; every card has at least one. shared/guide-anchors.ts cuts a symbol's block out of
its file without a parser (the first declaration by name: function, const, class, interface, type, method, object key,
then a quoted name such as an IPC channel or a tool name; brackets counted, strings and comments skipped), CRLF and
trailing blanks ignored. `node scripts/guide-anchors.mjs` hashes them (sha256, 16 hex) into
src/shared/guide-anchors.json, committed. test/unit/guide-anchors.test.ts fails when an anchor's code changed, naming the
card and point: "card X point Y: … code changed, re-read and update the text, then run node scripts/guide-anchors.mjs";
it also fails when an anchor no longer resolves. In a run from the repo (out/main/.. holds a .git, the same rule as
"Aggiorna"'s devRepo) IPC `guide:stale` gives the stale cards and the Guida marks them «da verificare», naming the points
and the code in the panel. A packaged build has no sources: nothing is marked. main/guide/maintenance.ts exports
`guideMaintenanceSection(repoRoot)`, a text section the Manutenzione research can take (the integrator wires it into the
research pack; research-pack.ts is not changed here).

**G2 — «Chiedi alla Guida».** A question box on top of the page. IPC `guide:ask` sends the question to
agents/oneshot.ts: Flash's engine at its lightest tier, no role text, no tools, so no permission prompt. The context is
the cards that share the question's words (in full, up to four, within the one-shot's 12 000-character prompt), the id
and title of every card and app_guide's index (appctl/guide.ts `guideIndex`). The model cites `[card:<id>]` and `path`;
the app keeps only citations of known cards and of files of the cards it gave, renders cards as chips that open them and
shows the model and its cost. The run is kept as a one-shot of job `guide`, which counts for no role's level or metrics.

**G3 — diagrams from the code.** shared/guide-diagrams.ts builds mermaid flowcharts from the app's own constants:
the roles with their tier and launches (ROLE_DEFAULTS) on «Ogni compito passa da un ruolo» and «I ruoli e il loro
editor», the delegation chain with DELEGATION_DEFAULTS on «Le deleghe tra ruoli», the contract's channels grouped by
area on «L'Orchestrator conosce l'app». Drawn by lib/viz/mermaid.ts (lazy, strict, an image) in the panel; the
hand-written small flows stay.

**G4 — «Per te».** Up to three cards, zero tokens, from local counters (localStorage, lib/guide-usage.ts): "?" opens
that name a Guida card, cards opened, the user's questions to the Orchestrator that contain a word only one card's title
has, and the Log's errors of a card's area. Being stuck ("?", questions) weighs most. No data, no section.

**G5 — German.** concept-guide.de.ts stays the source. shared/guide-german.ts `germanReport` lists per card the English
texts with no German (an English text that changed) beside the left-over entry it most likely was; the maintenance
section includes it, so the maintenance can translate. The existing test still fails on any gap.

## Consequences

- Any change to anchored code fails the unit suite until a person re-reads the card and runs the script: the price of
  a Guida that stays true. Branches merged in parallel may each need a run of the script after the merge.
- The extraction is not a parser: an odd regex literal may cut a block a little long or short, the same way each time.
- «Chiedi alla Guida» spends a few cents of the user's engine per question, shown under the answer; only their click
  spends it.
- New IPC channels `guide:ask` and `guide:stale` (contract additions); new one-shot job `guide`.
