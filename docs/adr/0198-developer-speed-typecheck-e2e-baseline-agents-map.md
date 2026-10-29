# 0198 — Developer speed: TypeScript 7 typecheck, an e2e baseline of known reds, AGENTS.md as a map

Status: accepted. Builds on ADR 0027 and ADR 0042.

2026-10-29.

## Context

Three costs paid by every agent job, from the analysis «Second-brain: app solida, brain e Manutenzione»:

- **Typecheck time.** `tsc -p tsconfig.json --noEmit` takes about 36 s in the Linux container (4 cores), on every
  `npm run check:branch` and `npm run check`. TypeScript 7.0, the native compiler, was released in 2026 (InfoQ,
  2026-08: 8-12x faster full builds); its stable programmatic API comes only with 7.1, so typescript-eslint
  (8.70.1, peer `typescript <6.1.0`) must stay on TypeScript 6.
- **A red e2e is no signal.** About 92 e2e tests are red on main in the Linux container (list of 2026-10-21, triaged
  into groups A, B and C). Every `npm run check` fails, so a new regression hides among the known ones.
- **AGENTS.md is 14 KB** and every agent reads all of it on every job. OpenAI's «harness engineering» note recommends a
  ~100-line AGENTS.md as a table of contents, `docs/` as the system of record, and rules enforced by lints whose
  messages say the fix.

## Decision

**TypeScript 7 for the typecheck only.** `typescript7` = `npm:typescript@7.0.2` (published 2026-07-08, exact, installed
with `--before=2026-10-15`) is a devDependency beside `typescript@6.0.3`. `npm run typecheck` (and so
`npm run check:branch`) and the typecheck step of `scripts/check.mjs` run `node_modules/typescript7/bin/tsc`;
`npm run typecheck:ts6` keeps the TypeScript 6 check. ESLint, Vite, Vitest and esbuild still resolve `typescript`
(6.0.3). TS7 accepts the codebase and `tsconfig.json` unchanged (0 errors, same as TS6). Measured in the container,
`-p tsconfig.json --noEmit`: TS6 36.9 s and 35.8 s; TS7 5.0 s, 4.1 s, 4.0 s (about 9x). Note: both packages declare a
`tsc` bin; `node_modules/.bin/tsc` currently links to TS7, so the scripts name the path explicitly. The `@typescript/
native-preview` dev builds were not used: 7.0.2 is the stable release. Remove the alias and move `typescript` to 7.x
when typescript-eslint supports it.

**An e2e baseline, never a skip.** `test/e2e/known-red.json` lists the tests red on main (spec file + full title
without line numbers, since, group, reason); it is seeded from the 2026-10-21 list (92 tests, groups A/B/C, one
ungrouped). Every e2e project writes its Playwright JSON report (`test-results/e2e-report/<project>.json`) and
`scripts/e2e-verdict.mjs` reads it: a failure not in the baseline is a «nuovo rosso» (the run fails), a failure in it a
«rosso noto» (listed, the run passes), a baseline test that passed cleanly a «nuovo verde» (remove it). A global error
or a failure with no failed test keeps Playwright's exit code; `--raw` keeps it always. `npm run check` prints the
verdict of both projects, including baseline entries no test has any more. `node scripts/e2e-baseline.mjs --update
[--drop-missing]` rewrites the baseline from the reports, on main after a full run. Every test still runs.

**AGENTS.md as a map.** AGENTS.md is now ~75 lines: a map table, the key words, a compact command table, how to verify,
and the twelve rules in one line each (numbers unchanged). The full text moved, sentence by sentence, to
`docs/agents/` (`glossary.md`, `commands.md`, `rules.md`, `layout.md`, `stable-dev.md`).

**Rules as lints with remediation.** `eslint.config.js` has a tiny local plugin `sb`: `sb/file-header` (error: a file
must start with a comment, rule 10) and `sb/max-lines` (warning over 800 lines; the 11 files over it today are listed
in `LONG_FILES` and exempt until another task splits them; warnings never fail the build). Both messages say the fix.
`log.error` already requires `cause` and `hint` by type. 17 files without a header got one.

## Consequences

- A branch's typecheck takes seconds; an error the native compiler misses would show in `npm run typecheck:ts6` (and
  typescript-eslint's typed rules still use TS6).
- `npm run check` on main goes green while only known reds fail, so a new red is visible again. The baseline can rot:
  26 of the seeded titles no longer exist (renamed or deleted since 2026-10-21) and show as «not in this run» until
  `--update --drop-missing` after the next full run on main.
- Agents read a ~5 KB map instead of 14 KB, and open the page they need.
- The header lint is checked on changed files by `check:branch`, so a new file without a header fails the branch.
