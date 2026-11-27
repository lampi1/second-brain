# ADR 0312 · Benches of one height, helpers with name tags, a torch for who works, people who speak only where asked

Date: 2026-11-15 · Status: superseded by ADR 0366 (thin strips grouped by Strategist replace the benches); before that accepted (owner, thread «Proporre nuova Grindhouse e Orchestrator», 2026-11-15: «le card
della grindhouse devono essere tutte sempre alte uguali … devo anche poter vedere i figli dei figli dell'artisan nella
card doppia. Devo vedere a colpo d'occhio chi è in attività o chi no»; «quello che manca nella card doppia è la
possibilità di cliccare un agente e andare direttamente nella sua tab, però non voglio perdere le reaction al click»;
«rimuovi completamente i fumetti … tienili solo quando giochiamo a scacchi e nelle card agenti»; «lo sfondo degli
agenti fallo più carino … poco medievale»; «nelle card agenti si ripetono troppe info … le animazioni ci mettono troppo
a ripartire»; «anche la navigazione tra le sezioni dell'app deve essere veramente super fluida») · Amends: ADR 0311
(benches, helpers), ADR 0303 and 0305 (where the people speak), ADR 0295 (the spark of the working line) · Amended
by: ADR 0313 (the workshop picture, no fading), ADR 0353 (every helper, workers first, the limit explained)

## Context

After the workshop of ADR 0311 the owner found: benches of different heights (a Strategist's plan and its rows of
children grew its bench), no way to open one helper from the bench without the sidebar, the hover square on a helper,
the bubbles over the bench's buttons, a blinking star in the working line, an outline on the «In attesa» chip, a bench
turning «in attesa» for a tenth of a second and back, an empty stage, role cards repeating what the back says, and a
vice that took too long to come back on a card. He asked for a deep look at what makes the app stutter.

Measured in this container (headless Electron, software GL, demo data, 2 s traces): on the Agents page every frame of
the people's animation ran a layout of the whole document, because the scroller's scrollbar was marked changed at each
SVG transform (Layout 212 ms and Paint 146 ms in 2 s). With `scrollbar-gutter: stable` on the page body: 55 ms and
31 ms. The Grindhouse itself was already light (about 2 ms of layout per frame).

## Decision

1. **One height for every bench** (`ChatTile.tsx`, `agent-strips.css`): stage, plate (area, title, role and what it
   does now, model with time and cost) and a foot of one line. What used to grow a bench sits in that foot, in this
   order: a queue, an error, the countdown or the wait, the plan's dots (`StrategyPanel` `compact`: a click opens the
   chat, where the whole plan unfolds), the team's counts with the limit hit (`BenchKidsSum`), the engine's own
   sub-agents (`ChildStrips` `compact`: the first and «+N»). The rows of the children are gone from the bench; the open
   chat keeps its team as tabs (ADR 0311). The model's name gives way to the figures on a narrow bench, never the other
   way round.
2. **Helpers with name tags** (`BenchKids.tsx`): every chat under the bench stands at it, children and grandchildren,
   depth first, a grandchild smaller (up to five, then «+N», which opens the first one not shown). Under the pointer
   or the keyboard a helper shows its tag over its head (name, state in words, «›»); a click on the tag opens that
   chat as the sidebar does. A click on the person stays a pat or a whack (ADR 0297). No hover square.
3. **Who works, at a glance**: a torch on the stage's stone wall burns while the chat works (its glow breathes, opacity
   only, on its own layer) and is out otherwise; a resting person and a resting helper are fainter; a working bench's
   state is a filled chip and its border takes the accent.
4. **No flicker** (`lib/steady.ts`): a state that leaves «working» is held on screen for 700 ms; if the chat is back at
   work in that time nothing changed on screen. An error shows at once. Used by the bench, each helper and the
   sidebar row.
5. **People speak only where asked** (`AgentSprite.tsx` `talk`): in chess and on the role cards, at a click. In the
   Grindhouse and on the Orchestrator's working line they are silent; the lines of the day stay (cards and chess still
   draw on them). The blinking spark of the working line is gone everywhere; the outline of the amber pill too.
6. **A medieval stage, cheap** (`agent-strips.css` `:root --wall, --torch-lit, --torch-out`): a stone wall drawn once
   as an SVG tile, a beam, planks, a torch; static pictures in data URIs, `contain: layout paint` on the stage. The
   role cards' hero uses the same wall with two torches, lit while the role works.
7. **Role cards say it once** (`AgentCatalogCard.tsx`): the front is the person and its name, then level, performance
   and figures; the purpose, the engine, the model and the level medal left the front (the engine and the model the
   role really ran on are on the back). On a card the vice plays again after a short breath (`restlessScene`), not
   after the workshop's long pause.
8. **Fluid**: `scrollbar-gutter: stable` on the page body, so an animated person never re-measures the whole page.
9. **README**: the six vices as animated WebP under the crew (`docs/vices/`), rendered from `viceScene` on the stage's
   wall by a one-off script (frames at fixed times, joined by Pillow); render them again when a vice changes.

## Consequences

- e2e that read the bench rows now read the helpers and their tags (`bench-helper-*`, `bench-helper-open-*`); the plan
  on a closed bench is one line that opens the chat (`strategist-plan.spec.ts`, `dev-visual-smoke.mjs`).
- A real wait shows 700 ms later than before.
- Untried on the owner's real PC.
