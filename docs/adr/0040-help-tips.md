# ADR 0040 · One "?" explanation mark (HelpTip) across the app

Date: 2026-10-13 · Status: accepted

## Context
The owner (2026-10-13): "mi piacciono i punti di domanda con spiegazioni, però un tooltip carino… mettili un po' ovunque
dove ha senso". The app had two kinds of explanation: the brain pages' «Cosa significa?» (a `<details>` that pushed the
page down) and native `title=` tooltips (table columns, pills, a chat's "ripresa dopo il riavvio"), small, unstyled,
mouse only. The global `data-tip` layer (TooltipLayer) was one line, and any text after `|` was drawn as keyboard keys
(so "clic per copiare" or a context second line showed up as key caps).

## Decision
- **`components/HelpTip.tsx`**: the one "?" mark. A real button (CSS draws the "?", so it adds no text to the title next
  to it); hover after 250 ms, keyboard focus (focus-visible) or a click opens a bubble: optional bold title, 1-3 short
  sentences, optional "Esempio:". The bubble is a portal on `<body>` (never clipped by a scrolling card), placed below or
  above the mark inside the window (`lib/tips.ts` `placeBubble`, unit-tested), themed by the tokens, registered as an
  overlay so the browser views it covers hide. `aria-describedby` points at the bubble (in the DOM, `hidden` while
  closed). One open at a time; a click pins it until a press elsewhere; scroll, resize and window blur close it.
- **Esc closes the bubble first**: its window keydown listener (capture) is added when the module loads, imported early
  by `components/ui.tsx`, so it runs before any dialog's or page's own Esc and stops the key.
- **Where**: next to concepts that are not obvious, never on obvious buttons. Settings (comparison, effort, routing and
  its Area/Sforzo columns, Regia questions/events, command results, questions window, cross-engine mail, spend alerts
  and list price, Claude's 5-hour window, MCP port), Qualità (each metric), Costi (KPIs, how the estimate is made,
  Cursor's ±%), DevOps (auto-complete, QA bar), Stato (my PRs), "Migliora l'app" (Promuovi, branches, light vs full
  tests), the long-chat notice (hand-off). The brain's «Cosa significa?», the tables' column help and the statistics'
  `Help` (brain/components/Stats.tsx, ADR 0037: now a HelpTip with the `wide` bubble, ~480 px, for long texts) became
  HelpTips. Estimate texts follow the code: the 80% range when the brain's table is calibrated, else p25-p75.
- **`data-tip` tooltips wrap** past ~48 characters (max 320 px) and the part after `|` is keys only when it looks like a
  shortcut (`Ctrl+K`, `Esc`, `G U`); otherwise a second line (`lib/tips.ts` `splitTip`).
- `lib/viewports.ts` reads `window.sb` when it reports, not at import, so modules that import it (HelpTip, the brain
  pages) still load in node unit tests.

## Consequences
Other branches explain their pages with `import { HelpTip } from './HelpTip'` (from `src/renderer/components`) or
`'../../components/HelpTip'` (from `src/renderer/brain/*`). New explanations follow the same tone: plain Italian, what
it is and why it matters, an example when it helps. E2e: `test/e2e/helptip.spec.ts`.
