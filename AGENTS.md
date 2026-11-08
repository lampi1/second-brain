# second-brain app: agent guide

Desktop cockpit (Electron, Windows first) where the user runs their Claude Code and Cursor agents (a strip each in the
Grindhouse, coordinated by the Orchestrator), answers their questions and permissions as panels, watches internal
browsers that agents drive over MCP, and sees their brain (a brain folder chosen at setup) update live.
UI language Italian; code, comments, commits and docs English.

This file is a map: one line per topic, the details in `docs/` (the system of record). Open a page only when the task
touches it.

## Map

| Topic | Page |
|-------|------|
| Words (Orchestrator, role, delegation, Grindhouse, agent, skill, Brain/brain, Task, stable/dev, Aggiorna) | `docs/agents/glossary.md` |
| Every command in full (guard, setup, logs, MCP tools, demo, shots) | `docs/agents/commands.md` |
| Rules in full, and the lints that enforce them | `docs/agents/rules.md` |
| Code layout | `docs/agents/layout.md` |
| Stable vs dev instance; how an agent verifies a change | `docs/agents/stable-dev.md` |
| Vision · architecture · decisions | `docs/VISION.md` · `docs/architecture.md` · `docs/adr/` (index `docs/adr/README.md`) |
| Human contributors | `CONTRIBUTING.md` |

Key words: **Orchestrator** = the coordinating chat where work starts; **role** = Strategist, Scout, Artisan, Sentinel,
Herald or the Orchestrator; **brain** = the user's folder of notes, rules and tools; **stable / dev** = the user's frozen
release vs. anything run from this repo. The rest: `docs/agents/glossary.md`.

## Commands

| What | Command |
|------|---------|
| Install | `npm run setup` (npm ci with scripts off, Electron binary, git hooks) |
| Build · run | `npm run build` · `npm start` · `npm run dev` |
| Run as an agent (always) | `SB_HIDDEN=1 npm run dev` (off screen, never takes focus); look with `app_screenshot` |
| Typecheck | `npm run typecheck` (TypeScript 7 native, ~4 s) · `npm run typecheck:ts6` (the one eslint uses) |
| Lint | `npm run lint` |
| Quick check (a branch's gate) | `npm run check:quick`: typecheck, lint of changed files, only the tests reaching them directly, doc tests if needed |
| Light check (optional) | `npm run check:branch`: typecheck, lint + related unit tests + guard on changed files + doc freshness; no e2e |
| All checks (main only) | `npm run check`: + full unit + e2e; after a batch of merges only its non-e2e parts run on main; e2e read against `test/e2e/known-red.json` |
| Unit · e2e | `npm test` · `npm run test:e2e` · `node scripts/e2e.mjs <specs>` (only when the owner asks; never a merge gate) |
| e2e baseline | `node scripts/e2e-baseline.mjs [--update]` (main, after a full run) |
| Live tests (real tokens) | `SB_LIVE=1 npx vitest run test/live` (Claude only) |
| Machine ready? · logs | `npm run doctor -- --json` · `npm run logs -- --level warn --since 1h [--run <id>] [--scope renderer] [--dev]` |
| Demo data (no tokens) | `npm run demo -- --hidden` |
| Drive the app | MCP `http://127.0.0.1:<mcpPort>/mcp/app` (`app_state`, `app_ui`, `app_guide`, …) |
| Guard (public repo) | runs in the git hooks; by hand `node tools/guard/scan.mjs . --allow .guardallow`; never `--no-verify` |

Details, flags and ADR references of each: `docs/agents/commands.md`.

## Verify a change

While working, only the targeted tests → the branch's gate, no e2e and no lock (owner, 2026-11-08: "fanculo i test
e2e"): `npm run check:quick` green + a clean independent Sentinel + the guard, rebase on main, plain push (rule 8) → look at a
visible change in the dev app → on a runtime failure `npm run logs -- --level warn --since 15m`, then `npm run
doctor`. The non-e2e parts of `npm run check` run once on main after a batch of merges; whoever breaks main fixes it
on main. Details: `docs/agents/rules.md` §7.
Never start, test or kill the stable instance (`docs/agents/stable-dev.md`).

## Rules

One line each; the full text, its exceptions and ADRs: the same number in `docs/agents/rules.md`.

1. **Contract first, typed IPC only**: `src/shared/contract.ts` first; IPC only in `preload/index.ts` and `main/ipc.ts`.
2. **Security baseline, never relax**: isolation, sandbox, CSP, sender check, MCP on 127.0.0.1, no secrets in files or
   logs; the app handles credentials only in the listed exceptions.
3. **Dependencies**: well-known, exact versions, published ≥ 14 days before install, an ADR line per runtime dependency.
4. **Each harness spends only its own tokens**; an agent on this repo never runs the Cursor CLI.
5. **No production from agents or routines**: no prod command, ever.
6. **Coexistence**: never change Claude desktop / Cursor config, hooks or settings; external sessions only as a fork.
7. **Tests**: unit tests for every module, an e2e with a screenshot for every visible feature; a branch's gate =
   `check:quick` green + clean Sentinel + guard, no e2e (2026-11-08) + looked at in the dev app; `check` without e2e
   once on main after a batch of merges; never repeated suites; load tests only at night; no test on real time or
   load (fake timers or an event; a load-red test is deleted or made deterministic, never rerun).
8. **Agents merge to `main` only when verified**: conventional English messages; fast-forward and `git push origin
   main` only after rule 7's gate (no e2e, no lock), guard passing on every pushed commit; no force; «Aggiorna» is the
   human's.
9. **Review**: a fresh-context reviewer per touched dimension before a merge.
10. **Every file starts with a header comment** (what, why, who uses it); decisions go to `docs/adr/`.
11. **Parallel agents**: one worktree and one module each; shared files only by the integrator.
12. **Orchestrator capability contract**: every user-facing feature reachable through the live `app_guide`.
13. **Docs keep up with the code**: new tools, pages and screens update the tool catalog, the Guida and the English
    README with fresh screenshots in the same change; `check:branch` fails otherwise.

Enforced by lints, each failing with its fix: file header (`sb/file-header`), file size over 800 lines
(`sb/max-lines`, a warning), `log.error` with `cause` + `hint` (typed), process boundaries (`no-restricted-imports`),
e2e «nuovi rossi» (`npm run check`), doc freshness (`check:branch`: tool catalog, Guida coverage, README). Table:
`docs/agents/rules.md#enforced-by-lints`.
