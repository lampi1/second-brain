# 0208 — Docs keep up with the code: tool catalog, Guida coverage, README freshness

Status: accepted. Builds on ADR 0027, ADR 0149, ADR 0196 and ADR 0198.

2026-10-30.

## Context

The owner (2026-10-30): keep the README always updated, with fresh screenshots, always in English, and the Guida too;
«metti proprio dei constraint a codice che obbligano sempre ad aggiornare ste cose, tra cui i tool nuovi
dell'Orchestrator, in modo che sappia sempre come funziona l'app». Until now only part of this was checked. The anchors
(ADR 0196) said when a card's code changed, but not when a page had no card at all: the Guida page itself, Settings and
the Map had none. `app_guide` listed the caller's own tools from their live definitions, so the Orchestrator knew
nothing of the tools only the work chats, the browser or the brain hooks get (`agent_delegate`, `navigate`, `recall`…),
and no doc listed every tool. The README had a picture no test takes (`crew.webp`) and never mentioned two pages.
Nothing tied a screenshot to the UI it shows.

## Decision

Three checks. Each fails `npm run check:branch` with the fix in its message (AGENTS.md rule 13), and each runs on every
branch whatever it changed: a new tool, page or screen rarely touches the imports `vitest --changed` follows.
check-branch.mjs runs `scripts/readme-check.mjs --base <merge base>` and the `DOC_TESTS` after the related unit tests.
The tests are also part of the unit suite on main.

**D1 — every MCP tool, in app_guide and in the docs.** `src/main/appctl/tool-catalog.ts` has one row per tool the app
exposes: where it is mounted (`app`, `orchestrator` only, `chat`, `browser`, `hook`, `script`) and one plain line.
`app_guide` adds the rows of the tools the caller lacks to its entries. They appear in its index by mount, and an exact
name returns the row, so the Orchestrator knows the whole app. `test/unit/tool-catalog.test.ts` enumerates the
registered tools two ways. The first is the real `appControlTools`, built with a proxy that stands in for every optional
module, on /mcp/app and on the Orchestrator's own endpoint. The second is a scan of `src/main` for every other tool
definition: a snake_case or one-word `name` followed by an `inputSchema` before the next `name`. It fails on a tool
without a row, on a row for a tool that is gone and on a wrong mount. It also fails when a tool is missing from
app_guide's entries or from the «MCP tools» table of docs/agents/commands.md. We considered building every mount's live
list (the browser module, the chat tools in wiring.ts). That needs Electron and half the app. The scan finds the same
names, and the live list covers the `tool('…')` helpers the scan cannot see.

**D2 — every page and Settings section has a Guida card.** This extends the anchors rather than adding a second
mechanism. `src/shared/guide-coverage.ts` maps each `BRAIN_PAGES` id (aliases excluded) and each `SETTINGS_SECTION_IDS`
entry to the card that explains it. The pure `coverageGaps` reports four things: a missing mapping, a card that does not
exist, a card without its title or summary in Italian, English or German, and a stale line. A page that is being removed
may be exempt, with the reason (Confronto modelli and Scrittura, cut by the Impara v3 work in parallel; drop the lines
with them). `src/main/guide/coverage.ts` reads the ids from the source text, so it runs in Node without the renderer,
and fails when that text changes shape. `node scripts/guide-anchors.mjs --check` and test/unit/guide-anchors.test.ts
report the gaps beside the stale cards. Three new cards closed the real gaps: `settings` (Profilo, Account e strumenti,
Il mio spazio, Aspetto e lingua, and where the other sections are explained), `guide` (the Guida itself) and
`brain-map` (the Mappa page and the 3D map). The `orchestrator-app` card now says that app_guide knows every tool.

**D3 — the README.** `docs/readme-shots.json` maps each screenshot to the test of test/shots/readme.spec.ts that takes
it and to the UI source paths it shows. It also has a `global` list (the theme tokens) and maps each page to the
English words that mention it. `scripts/readme-check.mjs` checks:

- English: no paragraph of six or more words with more than 12% (and at least two) Italian or German stop words. The
  stop words are those that are not English words too. The whole text stays under 2%. Code, link targets, comments and
  «quoted labels» are left out. The check is a cheap heuristic, deliberately: a language model or a dictionary would be
  a dependency for one check.
- Images: every image the README references exists. Every `docs/screenshots/` image is taken by the spec, in the test
  the manifest names. Every shot the spec takes is in the manifest, and every manifest path matches a file.
- Pages: every `BRAIN_PAGES` page is mentioned in prose or in an image's alt text (case-sensitive words).
- Freshness, on branches only, against the merge base with main: a branch that changes a shot's sources (or a global
  path) and not `docs/screenshots/<shot>.webp` fails. The fix: `npm run shots`, look at the shot and commit it. A
  change nobody can see opts out with a commit message line `shots: unchanged-visually` (every shot) or
  `shots: unchanged-visually <shot> …`. It is explicit and reviewed with the commit, like a `.guardallow` line.

Known gaps wait in the manifest's `pending` with a note. They print as warnings and fail nothing, and the check asks to
remove a key once its gap is fixed. On 2026-10-30 three were pending, left for the integrator, who regenerates the
README and the shots after the parallel blocks merge: `no-test:crew` (the crew picture), `page:task` (the Task page is
not in the README) and `page:confronto` (removed with that page).

## Consequences

- A new MCP tool needs its catalog row and its commands.md line in the same change. A new page or Settings section
  needs its card (it, en, de) and its README words. A UI change needs a fresh shot or an explicit opt-out.
- Shared components (ChatItems, OrchestratorTile, Sidebar) appear in several shots, so changing them asks for several
  shots at once: `npm run shots` takes them all in one run.
- The checks read source text (BRAIN_PAGES, SETTINGS_SECTION_IDS, `name:` + `inputSchema`, `save('…')`). A refactor
  that changes those shapes makes the check say so and name the reader to update. It never passes silently.
- Freshness compares against the local `main`. A stale local main widens the diff, so update it before
  `check:branch`, as the other steps already assume.
