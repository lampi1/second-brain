# ADR 0027 · Light check on branches, full check only on main

Date: 2026-10-13 · Status: accepted

## Context
Every branch ran the full `npm run check` (typecheck, lint, all unit tests, the whole e2e suite) before it could be
merged. With several app chats working in parallel the PC is loaded, the suites queue one behind the other and
a one-line change waits many minutes for e2e specs of areas it never touched. The owner (2026-10-13): the full suite runs
only on main, before he promotes; branches run a light check.

## Decision
- **`npm run check:branch`** (`scripts/check-branch.mjs`): typecheck; lint of the changed files (the whole repo when
  the lint/TS config or the packages change); `vitest run --changed <merge-base with main>` (the unit tests related to
  the changes); only the e2e specs of the changed area. The mapping: a changed spec (or its snapshots) runs itself; a
  folder with known specs (`main/improve` → `improve`, `main/run` → `codeblocks`, `command-asks`, …); a spec named like
  the file (`store/improve.ts` → `improve.spec.ts`); a spec whose text names the file (`ImprovePage.tsx`, `run/asks.ts`;
  generic names like `service.ts` only with their folder); a fixture a spec uses. Files the whole app goes through
  (`contract.ts`, preload, `index.ts`, `wiring.ts`, `App.tsx`, styles, build and test config, e2e helpers) and files no
  spec names add the smoke set (`smoke.spec.ts`). At most 6 specs, the most touched first; never the whole suite.
  Docs, unit tests and scripts need no e2e. It refuses to run on main.
- **Records its kind.** `scripts/check-pass.mjs --kind light` writes `{ at, kind: 'light' }` into `sb-checks.json`;
  the full check writes `kind: 'full'`; entries written before this ADR have no kind and count as full. A light check
  never overwrites a full one on the same commit.
- **Stages ("Migliora l'app", ADR 0020).** A branch with either check on its tip is *Testata* and may be merged. Main's
  tip needs a **full** check for "Promuovi" (`promoteGate`, off with the reason otherwise); the candidate shows
  "testata" only with a full check. `npm run promote` still runs `npm run check` itself.
- **The app's Regia** (`appRegiaPrompt()`): a change is finished when `check:branch` is green on its commit; the Regia
  merges it into main, then runs the full `npm run check` on main, one at a time (the owner's brain serializes suites with a test lease; the app itself has none).

## Consequences
- A branch can break an area its mapping missed; the full check on main catches it before any promotion, and the
  Regia fixes main before merging more. The map lives in one place (`AREAS`, `GLOBAL` in the script) with unit tests.
- Promotion may take one more step: if the Regia has not run the full check on main yet, "Promuovi" says so.
