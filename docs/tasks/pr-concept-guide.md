Title: feat(guide): in-app guide to the app's core concepts

## Summary

A new «Guida» page (left rail under App, Ctrl+K "Vai a", `G E`) that explains how the app works to a developer
without reading the code: one card per core concept (18 cards), in Italian and English. Every card has a plain
one-line summary and an expandable "Come funziona" with 4–8 numbered points, an everyday analogy, a small CSS
diagram where it helps, and "Dettagli tecnici" (data shape, files, thresholds, where it lives) with the source files
the claims come from. «Ogni compito passa da un agente» sits on top, full width, and keeps today's behaviour (catalog
agents, Generale for chats without a named agent, agents saved by the user, evaluation of existing probation profiles)
apart from the target (automatic agent creation, gap detection, "Save as agent"), clearly marked "Obiettivo, non ancora così oggi".

Facts that the guide states as they are today, not as the docs describe them:
- search is text only (Ctrl+K); the hybrid search is marked «in arrivo (PR #12)», with a TODO in the code to update
  the card after the merge;
- «Aggiorna» downloads and prepares the new version but does not install it (automatic apply is switched off);
- the Orchestrator can only propose a new agent, it cannot write the catalog; personal milestones are earnable locally;
- no classifier in the app calls a model: they are all regexes and thresholds in code.

«Discutine» on a card opens a chat about the concept with the card as a draft (never sent automatically): if the
catalog has an explainer agent that can start (whole id or name is Explainer / Spiegazioni, case-insensitive), a new chat with that
agent; otherwise the Orchestrator gets the card plus the instruction to reuse an "Explainer" agent from
`agent_catalog` or, since it cannot create one, to propose its definition for the user to save. It reuses the
existing paths (`createChat` + `setDraft`, `brainBridge.draftToRegia`); no new IPC. A synchronous per-card guard prevents
duplicate creation even before React renders the disabled button, and releases on completion/failure.

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

Review follow-up (2026-10-18): merged main through a44ab1a, reproduced all 15 failing review assertions, then fixed
both code findings and every false/partial claim in Italian and English against current sources. Also refreshed
Generale ownership/runs, probation evaluation, run tags and the latest Grindhouse layout. Codex is described as
on-request approval with ceiling enforcement, not an unconditional prompt for every command.

- `test/unit/concept-discuss-click.test.ts` exercises repeated clicks across remounts, successful completion,
  failed creation fallback and retry through the actual page handler.
- Review suite: `npx vitest run --config test/review/pr-26-29/vitest.config.ts test/review/pr-26-29/pr-29`: 22/22 passed
  (review tests imported temporarily from c111772, not product files).
- No e2e, screenshots or PNGs were produced in this follow-up. Earlier validation below belongs to the initial PR.
- Follow-up checks: `tsc --noEmit`, eslint on the four touched TypeScript files, guide/click/i18n unit tests
  (72/72) and `git diff --check` passed. A fresh-context reviewer found only the stale role-matching description
  in this document; corrected before commit.

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
