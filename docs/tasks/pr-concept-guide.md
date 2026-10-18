Title: feat(guide): in-app guide to the app's core concepts

## Summary

A new «Guida» page (left rail under App, Ctrl+K "Vai a", `G E`) that explains how the app works to a developer
without reading the code: one card per core concept (18 cards), in Italian and English. Every card has a plain
one-line summary and an expandable "Come funziona" with 4–8 numbered points, an everyday analogy, a small CSS
diagram where it helps, and "Dettagli tecnici" (data shape, files, thresholds, where it lives) with the source files
the claims come from. «Ogni compito passa da un agente» sits on top, full width, and keeps today's behaviour (catalog
agents, ad-hoc routed chats, agents saved by the user) apart from the target (the Orchestrator creating and keeping
agents by itself, gap detection, "Save as agent"), which is clearly marked "Obiettivo, non ancora così oggi".

Facts that the guide states as they are today, not as the docs describe them:
- search is text only (Ctrl+K); the hybrid search is marked «in arrivo (PR #12)», with a TODO in the code to update
  the card after the merge;
- «Aggiorna» downloads and prepares the new version but does not install it (automatic apply is switched off);
- the Orchestrator can only propose a new agent, it cannot write the catalog; «Traguardi personali» are retired;
- no classifier in the app calls a model: they are all regexes and thresholds in code.

«Discutine» on a card opens a chat about the concept with the card as a draft (never sent automatically): if the
catalog has an explainer agent that can start (id, name or role says Explainer / Spiegazioni), a new chat with that
agent; otherwise the Orchestrator gets the card plus the instruction to reuse an "Explainer" agent from
`agent_catalog` or, since it cannot create one, to propose its definition for the user to save. It reuses the
existing paths (`createChat` + `setDraft`, `brainBridge.draftToRegia`); no new IPC.

## What changed

- `src/shared/concept-guide.ts`: the typed content (cards, `Bi` texts, diagrams, `target` and `coming` parts,
  source refs, with a comment citing the source file beside each part) and the pure text builders for «Discutine»
  (`cardText`, `discussText`, `regiaText`, `isExplainer`).
- `src/renderer/lib/concept-discuss.ts`: `planDiscuss` / `explainerOf` (explainer agent vs Orchestrator).
- `src/renderer/components/GuidePage.tsx` + `src/renderer/styles/guide.css`: the page (filter, cards, diagrams).
- Navigation: page id `guida` in `brain/index.tsx`, `Sidebar.tsx` (App group), `CommandPalette.tsx` (icon and
  search words), `App.tsx` (PageFrame).
- i18n: `i18n/areas/guide.{it,en}.ts` (page frame) and `brainPages.nav.guida`.
- Docs: this file (screenshots are not committed: Brother chose to keep binaries out of the guard allowlist).

## Tests

- Unit: `test/unit/concept-guide.test.ts`. It checks that every card has a summary, 4–8 points, an analogy and a
  technical part in both languages; that every cited source file exists; that diagram labels stay short; that the
  prominent card is first; and that search marks PR #12 as coming. It also covers the «Discutine» plan: explainer
  agent → its own chat with the card as draft; no explainer, an engine that can't start, or no folder → Orchestrator
  with the Explainer instruction. Plus `test/unit/i18n` (it/en key parity).
- E2E: `test/e2e/concept-guide.spec.ts` covers opening from the rail and Ctrl+K, expanding a card, the filter, and
  «Discutine» docking the Orchestrator with the unsent draft. It ran green here under xvfb (3/3). Per the repo rule
  its first official run is on main.
- Pre-existing e2e failures, the same on main 687bd79 without this branch: `menus.spec.ts` (expects `nav-migliora`
  in the rail) and 4 tests in `navigation.spec.ts`.
- Screenshots: `test/shots/concept-guide.spec.ts` → `docs/screenshots/concept-guide/` (run with `npm run shots`; output not committed).
- `npx tsc --noEmit` clean, eslint clean on the touched files, `npm run check:branch` green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01JWXR9ZHRA41V93dHCPtUxa
