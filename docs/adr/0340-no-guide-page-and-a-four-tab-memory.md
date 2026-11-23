# ADR 0340: No Guida page, and a Memoria of four tabs with a real Skill view

**Status:** Accepted (2026-11-23). Supersedes ADR 0196; supersedes the Guida parts of ADR 0101, 0117 and 0208 and the
Approvate, Sempre caricato and Idee tabs of ADR 0122 and 0243.

## Context

The owner never opened the Guida: the questions about the app go to the Orchestrator. It still cost a page, a German copy
of every card, hashes of the code each sentence described (`guide-anchors.json`), a coverage table, a light-model
question box, and a rule plus a check that failed a branch whose code changed under a card. Memoria had seven tabs, four
of them rarely used, and its Skill tab hid the files a skill is made of.

## Decision

1. **The Guida is deleted**: the page, its route, menu entry, `G E` key, the "?" link to a card, the question box, the
   diagrams, the German cards, the anchors, the coverage table, the maintenance of the stale cards, and the rule and
   checks that kept them current (rule 13, `check:branch`, `check:quick`, `scripts/guide-anchors.mjs`).
2. **What stays is what agents read**: the MCP tool `app_guide` (`src/main/appctl/guide.ts`) and its concept cards in
   Italian and English (`src/shared/concept-guide.ts`), which are also the source of an Impara lesson about the app. A
   German user interface reads the English ones. Nothing checks the cards' age any more.
3. **Memoria has four tabs: Diario, Artifact, Skill, Proposte** (Proposte opens first). Approvate, Sempre caricato and
   Idee are deleted, with the trash IPC `brainmodel:remove`. Their old links open Memoria. `ideas.md` is still written by
   the agents and read in Diario, among the notes; `brainmodel` still removes an item for a research card.
4. **A skill comes from the Brain or from the App**, nothing else: a skill of the user's home folders counts as Brain.
5. **The Skill view** is a searchable list ordered by most used, least used, name, last used or source, with two boards
   (most and least used) when nothing is selected. A skill opens on its SKILL.md; its files are grouped by kind (scripts,
   queries, references, other assets, `src/renderer/lib/skill-files.ts`), each opens with highlighted content and can be
   edited or deleted through the change log, so every change has «Annulla»; a deleted skill keeps its own in the toast, then in «Eliminate di recente» under the
   list, and what Undo could not put back (binary, not UTF-8, linked, hidden files) is not deleted from here. Editing an app skill makes the user's copy
   («Ripristina originale» brings it back); an app skill cannot be deleted and the button says why.
6. **Use counts** come from the agent runs' skill tags (`AgentRun.tags.skills`). Only Claude reports the skills it loads:
   the other engines and the plain chats are not counted, and the view says so.

## Consequences

- A change of a page or a setting no longer needs a card; the README and the tool catalog still follow the code.
- A concept card can become old without a red check: an agent that finds one wrong fixes it.
- The "?" help tips (ADR 0040) stay, without the link to a card.
