# ADR 0311 · The Grindhouse becomes a workshop: square benches, scenes without screens, a vice at rest

Date: 2026-11-14 · Status: accepted (owner, thread «Proporre nuova Grindhouse e Orchestrator»: «mi piace procedi»,
then «si bellissimo la a» for the helpers, and the vices one by one) · Amends: ADR 0287 and 0292 (a closed chat is a
bench, not a one-line strip), ADR 0293 (children are rows at the parent's bench), ADR 0295 and 0305 (scenes without
computers, a vice at rest)

## Context

The owner asked for bigger people, a workshop instead of strips, no computer or IT props in the animations («pulito,
AAA»), an Orchestrator less square than before but in line with the rest of the app, and an app that stays fluid. He
picked proposal A («bottega») over a village square and taller strips, and helper people at the parent's bench over a
team frame. Then he asked for one vice per role, shown discreetly, also on the agent cards.

Measured before the change (headless Chromium without GPU, 8 sprites, CPU % of a core): strips 15.9; benches at 150 px
29.2; without the `drop-shadow` filter on big sprites 21.1. The filter is the biggest cost at large size.

## Decision

1. **A bench per chat** (`ChatTile.tsx`, `agent-strips.css`). A closed chat is a square bench: its person at 134 px
   doing what the chat does, its state, then a plate with area, title, what it does now, time and cost. Stop and ✕ are
   always in sight on every bench (the owner: «tutti i quadrati avessero la x e lo stop visibili»). A click on the
   bench opens the chat in the Grindhouse; a click on the person stays a pat (ADR 0297).
2. **Helpers at the same bench** (`BenchKids.tsx`). The chats a chat delegated stand at its bench, smaller, up to
   three and «+N», and the plate has a line that counts them (running, waiting, stuck, done) with the limit the bench
   hit, then one row per helper (who, what it does now, for how long, or its state when it needs someone). A bench with
   helpers spans two columns. A click on a helper or its row opens that chat.
3. **The open chat shows its team as tabs** (`AgentStrips.tsx TeamTabs`): «back to the workshop», then the chat that
   delegated and every chat under it, each with its dot and what it does now. With several chats open, the one opened
   last is shown (`ui.opened`).
4. **Scenes without screens** (`agent-sprites.ts`). A command turns an hourglass over, a web page arrives by carrier
   pigeon, the tests weigh on a brass balance with a green seal. The Artisan hammers for an edit, a command and the
   tests. The Strategist's chess pieces keep a board's proportions.
5. **A vice at rest** (`agent-vices.ts`): Orchestrator a churchwarden pipe and smoke rings, Strategist two moves then
   fists on the board, Scout a metal hip flask, Artisan a beer stein, Sentinel an energy can then a flex, Herald red
   wine (and a heavier build). It plays only in the idle state, once in the first 40 % of a long loop, then the person
   holds still (`unhurried`), so it is not seen more often than the other scenes. The agent cards show it on their front
   (`AgentCatalogCard.tsx`).
6. **Arms that bend like arms** (`sprite-kit.ts reach`, `agent-vices.ts armGlide`, `sprite-rig.ts`). Two-bone IK
   prefers the elbow out. A drink moves along a straight hand path between key poses, each step solved by IK and kept
   on the elbow branch of the step before, so the arm never spins between keys. Vessels are held from the bottom so the
   hand stays clear of the face. A pauldron is drawn between upper arm and forearm; a table can stand between body and
   arms (`Pose.mid`); fingers are drawn in front of what the hand holds (`grip`).
7. **Three radii** (`tokens.css`): `--r-s` 4 px, `--r-m` 6 px, `--r-l` 8 px across the app; fully round only for dots,
   counters, avatars and switches. The 409 literal radii in the style sheets map onto them.
8. **Orchestrator rows**: each question row has a colour rule (violet the Orchestrator or a plan, red a permission or
   a command, amber any other decision); a plain permission is answered on its row («Consenti una volta», «Nega»). The
   approved plan is a flat row with one round dot per step (`StrategyPanel.tsx`).
9. **Fluid**: sprites out of sight stand still (`IntersectionObserver`), two people never move in step (each starts its
   loops at its own moment), and the `drop-shadow` filter stays only on small sprites.

## Consequences

- The Grindhouse shows fewer chats per screen than the strips did; a long one scrolls, and what is scrolled away costs
  nothing.
- e2e tests that read strip parts (`.strip-now`, `delegation-card-*` under a closed parent) now read the bench
  (`bench-kid-*`, `bench-kids-sum-*`, `chat-x-*`).
- Untried on the owner's real PC; the vices of Scout, Sentinel and Herald went through four rounds of his review.
