# ADR 0366 · The Grindhouse becomes strips grouped by Strategist; a quieter, dark-only shell

Date: 2026-11-27 · Status: accepted (owner, restyle mockup `restyle-2026-11-27/nuova-ui.html`: «mi piace moltissimo solo
gli angoli un pelino più arrotondati», issue #491) · Supersedes: ADR 0311, 0312, 0313 and 0353 (the benches, the
workshop picture, the helpers at the bench) · Amends: ADR 0075 (a start on the new version is no banner any more)

Closes #491

## Context

- The Grindhouse drew every chat as a square bench with a workshop picture behind its people. With a Strategist and its
  helpers the page was tall, busy and hard to scan: who waits for me, who works, what is finished.
- The shell carried a light theme nobody used, radii from 3 to 20 px, coloured badges with coloured text on coloured
  backgrounds below 4.5:1, a full-width green «Partita la versione nuova» banner after every update, and a ☰ menu with
  twelve entries.
- The demo copy did not start: it limited the MCP access of the retired role 'herald' and threw «Ruolo non valido.».

## Decision

1. **Thin strips, grouped by Strategist** (`components/AgentStrips.tsx`, `components/ChatTile.tsx` `row`,
   `lib/grind-groups.ts`). Each chat is one row. A lead strip (sprite 56 px) shows the title, «Role · what it does now»,
   the plan's step dots with «n/m», the state, time · cost, an ⓘ and the actions on hover (stop / open / close). Its
   helpers are indented strips (sprite 44 px) on a thin 1 px `--border-3` tree line with a rounded elbow; the last
   child ends at its elbow; grandchildren nest. Chats without a Strategist are plain strips. No stage background.
2. **Three sections, in this order**: «Ti aspetta» (amber heading; the strip has a 2 px amber line on the left),
   «Al lavoro», «Finite oggi» (one compact, dimmed line each, the sprite still). A team goes where its worst member is
   (waiting before working before finished); siblings are ordered the same way, stable. A chat that stops working is held
   in its section for 700 ms (`holdStatuses`, the same hold as `useSteady`) so a short pause does not make it jump. An
   error is a 2 px red line and sits in «Ti aspetta».
3. **The state is a word, not a pill**: a small coloured dot and coloured text with no box, padding or background, like
   «Finita», each tone ≥ 4.5:1 on every surface. Coloured text never sits on a coloured background.
4. **The ⓘ holds what the chips held** (`components/GrindStrip.tsx`): model · effort in bold, the estimate, the skills
   used (or loaded, for a run that does not report use), the project folder. A tab stop with a label that says it all.
   `StripMeta`'s `figures` mode shows only time · cost, amber once past the estimate. `SkillChips.tsx` and
   `BenchKids.tsx` are removed. Only working sprites animate; pat / whack clicks stay.
5. **The version chip** (`lib/version-chip.ts`, `components/VersionChip.tsx`) in the top bar replaces the green banner:
   «● Versione nuova · Aggiorna» (a neutral button with a small green dot) when GitHub is ahead, otherwise «Aggiornata a
   <sha> · Novità ✕» after a start on a new version until dismissed. `LaunchBanner` keeps only the fallback warning.
6. **Dark only, radii 3 / 4 / 6**: the light theme and its toggle (Settings, palette) are removed; `--r-s` 3, `--r-m` 4,
   `--r-l` 6 px; hard-coded radii above 6 px become tokens (circles stay circles). Every text / badge pair in the renderer
   CSS is ≥ 4.5:1 (`--on-red` for text on red).
7. **The ☰ menu lists eight pages** (`lib/nav-menu.ts`): Lavoro (Grindhouse, Piani), Svago (Impara, Scacchi), Sistema
   (Agenti, Memoria, Andamento, Impostazioni). Task, Registrazioni, Collegamenti and Log are hidden from it, not removed:
   the palette (Ctrl+K), their keys and the Orchestrator still open them.
8. **The demo starts again**: it limits the Artisan's MCP access.

## Consequences

- The Grindhouse reads top to bottom: what needs me, what runs, what is done. A team of a Strategist and five helpers
  takes about a sixth of the height of the bench.
- The Orchestrator column is untouched except for the tokens it shares.
- Pinned by `test/unit/grind-groups.test.ts`, `grind-strip.test.ts`, `version-chip.test.ts`, `nav-menu.test.ts`,
  `skill-chips.test.ts` (skills in the ⓘ), `tokens-contrast.test.ts` (dark only, radii, ≥ 4.5:1 scan) and
  `mcp-servers/demo.test.ts`.
- The e2e specs that look for the bench (`bench-helper-*`, `bench-kids-sum-*`, `skill-chips-*`, `st-theme-select`, the
  `ok` launch banner, the menu's Task / Log entries) need updating; they were not run.
