# ADR 0289 · Fewer refusals an agent learns only by failing: long outputs are cut, the tools' commands name the copy, a question has a place without an Orchestrator

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda»: «leggiti anche tutte le
chat dell'app per trovare possibili errori… errori di agenti ricorrenti») · Amends: ADR 0224 (caps instead of
refusals), ADR 0062 (the app-owned copy of the tools), ADR 0269 (questions live in the Orchestrator)

## Context

Read on the owner's PC: 1,820 transcripts of chats that use the app's tools (2026-10-15 to 2026-11-13), the run
store and the logs. Only counts left the PC. What this change takes from it:

- `agent_report` was refused 442 times. 33 for an output over 12,000 characters: the agent wrote the whole result
  again. The summary and the lesson line were already cut instead of refused (ADR 0224); the output was not, and its
  schema carried `maxLength`.
- 33 «Cannot find module <brain>/ops/tools/mem.mjs». In a product brain (ADR 0062) the tools are in the app's copy,
  but the copy's own code (hook messages, the chat prompt, the tool's help) still named them under the brain folder:
  only the product text was rewritten (`appText`), the code was rendered as it is. The same lookup in
  `brain/save-idea.ts` made the maintenance's app ideas fail to reach «Idee» on a product brain.
- `agent_delegate` refused every part that named `balanced` («unknown field balanced», 3 times before 2026-11-10
  and 10 after): the field is in the schema and in the tool's description (ADR 0218) but was missing from the list
  of known fields, so the agent's own pick in Balanced mode could never arrive.
- The questions' checks (the dev visual run and four e2e tests) still waited for the questions window ADR 0269
  removed. Realigning them showed a real defect: a chat's own tile never shows its requests, the rows are in the
  Orchestrator's column, and with no Orchestrator created that column showed only the setup: a question asked then
  had no place to be answered.

## Decision

1. An output over the limit is cut with the marker «…» and a warning that says how many characters were left out
   (counted after the cut) and that a shorter amended report is welcome only if it matters. The schema states the
   limit in words.
2. `rules/tools.ts codeReferences`: in the copy's code an absolute reference to shipped code under the brain becomes
   the same file in the copy (`render-v5`, so every copy is written again). Personal scripts and the brain's own
   files stay brain paths; `install-inbox-hooks.mjs` is left as it is (its paths are what it writes to the user's
   own Claude settings and looks for when it removes them). `ideaTool` finds the tool with `brainScript`.
   `agent_delegate` knows `balanced`; with Balanced mode off the field is left out with a warning.
3. The Orchestrator's column shows the question rows also before any Orchestrator exists; there the card keeps its
   own answer box (nobody could carry a free answer).
4. `scripts/dev-visual-smoke.mjs` and the e2e tests of `ui`, `strategist-plan` and `delegation-tree` follow the rows
   (`test/e2e/helpers.ts openAsk`); the visual run reads the children at work from the parent's bar (`data-run`),
   since the segments it counted left with ADR 0287.

## Consequences

- Not changed, on purpose: «outcome done needs every criterion met» (47) and the other checks of a result's truth;
  the hand-off's request for the `now.md` line (`wiring.ts memTool`) still looks only in the brain folder, so a
  product brain is not asked for it: turning it on adds text to every hand-off and nothing measured asks for it.
- Still red for the old window, not rewritten here: 28 e2e tests of the question specs (`questions*`, `panels`,
  `command-asks`, `one-popup`, `explain`, `strategist-plan-popup`, `voice-decision`); e2e is not a gate (rule 7).
- Left to the engine or to the user's own choice: the denials of the engine's auto mode (about 600), the engine's
  «read before edit» rule (383).
