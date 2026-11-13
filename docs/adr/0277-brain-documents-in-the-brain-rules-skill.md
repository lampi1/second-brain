# ADR 0277 · The brain tools find the brain's own documents at the root or in the `brain-rules` skill

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda»: «non serve che apri
l'issue, fixalo e basta») · Amends: ADR 0062 (app-owned tools), ADR 0241 (skill packages), ADR 0243 (no loose rules)

## Context

The owner wants his brain «pulito come un utente che ha appena installato l'app», keeping every piece of information.
The clean-up of 2026-11-13 could not move `map.md`, `brain-rules.md` and `tests/behavior.md` into a skill: the app's
copy of the brain tools reads them from the brain's root (`brain-lint.mjs` and `brain-map.mjs` read `map.md`;
`chat-prompt.mjs` tells every new chat to read `map.md` and `brain-rules.md`). The same `chat-prompt.mjs` also still
sent new chats to `code.md`, `rules\qa.md` and `harness\tools.md`, which his brain moved into skills on 2026-11-10.

## Decision

1. `brain-template/ops/tools/brain-doc.mjs` (pure) knows the homes of the three documents, first found wins: the root
   file, then the `brain-rules` skill package (`.agents/skills/brain-rules/`: `SKILL.md` = the rules,
   `references/memory-map.md` = the map, `references/behavior-tests.md` = the tests).
2. `brain-lint.mjs` and `brain-map.mjs` read the memory map through it.
3. `chat-prompt.mjs` builds a new chat's «leggi» list through it (`readList`): each file is named where the brain
   keeps it, and a file the brain no longer has is left out. A brain folder that is not on disk cannot be checked, so
   the names stay. `AGENTS.md` follows the same rule: a fresh brain has none (ADR 0072), so it is not named there.

## Consequences

- A brain can move the three documents into the skill and its root matches a fresh install; older brains change nothing.
- A new chat is never told to read a missing file.
- Not changed: `ops/AGENTS.md` and `ops/runbook/index.md` (kind `prod`) stay brain paths; the map's own rows keep
  naming brain-relative files.
- Test: `test/unit/brain/brain-doc.test.ts`.
