# Rules, in full

`AGENTS.md` lists each rule in one line; this page is the system of record (moved from `AGENTS.md`, ADR 0198). The
numbers stay: code and docs cite "AGENTS.md rule N". Where a rule can be checked mechanically, a lint or test does it
and its failure message says the fix (see [Enforced by lints](#enforced-by-lints)).

## 1. Contract first, typed IPC only

No `ipcRenderer`/`ipcMain` outside `preload/index.ts` and `main/ipc.ts`.

## 2. Security baseline (never relax)

`contextIsolation`, `sandbox`, no `nodeIntegration`, CSP in `index.html`, IPC sender check, browser tabs in their own
partition, MCP bound to 127.0.0.1 with Host/Origin checks, no secrets in files or logs, credentials never handled by the
app (each CLI logs in itself) with these exceptions:

- a login hand-off's password, read from the user's brain file only when they click Copia, never stored or logged
  (ADR 0012);
- the API keys the user types in Settings → Motori, encrypted with safeStorage, write-only from the UI, given only to
  their own engine's process env or HTTP header (ADR 0046);
- the tokens of the MCP servers added in Settings → Connettori, the same way, given only by the app's MCP gateway to
  that server's own process env or request header, never to an engine or a chat (ADR 0086);
- the Telegram bot token the user types in Settings → Telefono, encrypted with safeStorage in its own slot, write-only
  from the UI, used only by the main process in its calls to `api.telegram.org`, redacted from logs (`addRedaction`,
  `src/main/log.ts`), never given to an engine, a chat, an agent or a file (ADR 0219);
- historical routine site passwords stay encrypted in the app profile and are read only during explicit package
  preparation/export for the terminal, never printed in transcripts, evidence or logs (ADR 0179).

The app no longer has a routine browser host.

## 3. Dependencies

Only well-known packages, exact versions, published ≥ 14 days before install (`npm install --save-exact
--before=<date>`), an ADR line for each new runtime dependency. Prefer writing 100 lines over adding a package with a
large tree.

## 4. Each harness spends only its own tokens

The app starts `claude` only for Claude chats and `agent` only for Cursor chats and for the token-free login check
(`agent status`), with the user's own login. An agent working on this repo inside Claude Code never runs
the Cursor CLI.

## 5. No production from agents or routines

No agent, tool or routine runner ever runs a prod command (prod DB, ops scripts, write `az`). The app never executes
routine commands, including production steps; historical receipts are read-only (ADR 0179). The terminal runtime's
production boundary remains unchanged.

## 6. Coexistence

The app never changes Claude desktop / Cursor config, hooks or settings files; it reads their transcripts and state
read-only; an external session is resumed only as a fork (never two writers).

## 7. Tests

Every module has unit tests; every user-visible feature has an e2e test with a screenshot. While working an agent runs
only the targeted tests (`npx vitest run <files>`; owner, 2026-11-07: "rifai i test mille volte"). A branch's gate
before the merge, with no e2e (owner, 2026-11-08: "fai finire tutto, fanculo i test e2e"): `npm run check:quick` green
on the branch's commit + a clean independent Sentinel review (rule 9) + the guard scan + a rebase on `main` right
before the merge, then a plain `git push origin main` (rule 8; never a force push). A visible change is still looked at in the
dev app. No e2e run and no machine lock gate a branch; `npm run check:branch` is no longer needed per branch. Never
repeated suites, never Sentinels only to compare main and the branch. After a batch of merges one dedicated chat runs
the non-e2e parts of `npm run check` once on main (typecheck, lint, all unit tests); whoever breaks main fixes it on
main. The e2e suite stays in the repo and runs only when the owner asks; its verdict is read against `test/e2e/known-red.json` (ADR 0198).

Never write load-sensitive tests; existing ones are removed (owner, 2026-11-09). A new test never depends on machine
load: no real timeouts, no sleeps or `waitFor` with ms (`vi.waitFor` and `expect.poll` have a 1 s default), no bounded
polling loops, no per-test or per-describe timeout under the suite's 120 s, no assertion on elapsed wall-clock time, no
real processes, ports or network. Use fake timers, fakes in the same process, or wait for an event (`waitFor` from
`test/unit/chats/helpers.ts` without its `ms`); a check that something does not happen waits for a later event or uses
fake timers. Every existing test with a real deadline, a sleep that waits for work, or an elapsed-time assertion was
removed on 2026-11-09 (`docs/tests/load-sensitive-removed.md`); an existing test that goes red under load is deleted,
never rerun and never given a longer deadline.

Load tests, stress tests, synthetic CPU/RAM load generators, benchmarks under load and e2e runs repeated to load the
machine run only at night, outside the owner's working hours; never during the day on their work PC (owner,
2026-10-15).

## 8. Commits and merge to main

Agents commit on their branch/worktree. Conventional messages (`feat(chats): …`), English. An agent of the app may
merge its verified branch into `main` and push it, without asking the owner each time (owner, 2026-11-07; ADR 0231),
only when all three hold on the exact commit that is pushed:

1. rule 7's branch gate, green by its exit code: `npm run check:quick`, no e2e and no machine lock (owner,
   2026-11-08); a visible change is also looked at in the dev app;
2. the reviews of rule 9 (an independent Sentinel per touched dimension) have no open findings;
3. `node tools/guard/scan.mjs . --allow .guardallow` passes, and the pre-push hook passes on every pushed commit.

The method is local and fast-forward only: `git merge --ff-only` of the verified branch into `main`, then
`git push origin main`. If `main` moved, rebase the branch on it and run 1-3 again, so what is pushed is what was
checked. After a batch of merges, the non-e2e parts of `npm run check` run once on `main` (rule 7).
Never a force push, a token, a pull request opened on the owner's behalf, a new remote or another remote. «Aggiorna»,
`npm run promote`, publishing a release and restarting the app stay the owner's clicks. The app's own permission
layer still asks before `git push` (ADR 0103); allowing it is the owner's setting. The rule covers only this
repository: other repositories keep their own rules.

## 9. Review

Before merging a branch, a fresh-context reviewer per touched dimension (security, correctness, UI/UX); fix what they
confirm.

## 10. Every file starts with a header comment

What it does, why, who uses it. Decisions go to `docs/adr/`. Enforced by the `sb/file-header` lint (below).

## 11. Parallel agents

One worktree per agent (`git worktree add ../second-brain-wt/<name> -b feat/<name>`), one module each; shared files
(`contract.ts`, `wiring.ts`, `index.ts`) are changed only by the integrator.

## 12. Orchestrator capability contract

Every user-facing feature must be discoverable through the live `app_guide`, with its supported tool/configuration
route and approval boundary. Mount new Orchestrator tools on its authenticated endpoint and test the actual app-control
wiring, not only the isolated tool factory. Update relevant capability guidance and role instructions in the same
change. Do not expose user-only confirmation or widen worker permissions.

## 13. Docs keep up with the code

The README (always English, with fresh screenshots), the Guida and the Orchestrator's `app_guide` describe the app as it
is now, in the same change that alters it (owner, 2026-10-30; ADR 0208). `npm run check:branch` fails, with the fix in
its message, when:

- an MCP tool the app registers has no row in `src/main/appctl/tool-catalog.ts` (what `app_guide` reads for the tools
  of other mounts) or no line in [commands.md «MCP tools»](commands.md#mcp-tools), or a row names a tool that is gone;
- a page of `BRAIN_PAGES` or a Settings section has no Guida card in Italian, English and German
  (`src/shared/guide-coverage.ts`), or a card describes code that changed after its text (the anchors, ADR 0196);
- README.md reads as Italian or German, shows an image that does not exist or a screenshot that
  `test/shots/readme.spec.ts` does not take, or never mentions a page of `BRAIN_PAGES`;
- the branch changed the UI a screenshot shows (its sources in `docs/readme-shots.json`) without taking it again
  (`npm run shots`). For a change that is not visible, a commit message line `shots: unchanged-visually [shot …]` opts
  out. Known gaps wait in the manifest's `pending`, printed as warnings until fixed.

## Enforced by lints

Each check fails (or warns) with the fix in its message, so an agent can act on it without reading this page.

| Rule | Where | Level | The fix the message gives |
|------|-------|-------|---------------------------|
| Header comment (rule 10) | `sb/file-header` in `eslint.config.js`, every linted file | error | start the file with a `//` comment: what it does, why, who uses it |
| File size | `sb/max-lines` in `eslint.config.js`, 800 lines | warning, never fails the build | split the file by responsibility into modules beside it, each with its own header and tests. The 11 files over it on 2026-10-29 (`LONG_FILES` in `eslint.config.js`) are known debt being split; take a file out of the list once it is under 800 |
| Errors carry cause + hint | `log.error(scope, msg, { cause, hint })` in `src/main/log.ts`: the type requires both | typecheck error | say why it failed (`cause`) and the next step (`hint`) |
| Process boundaries | `no-restricted-imports` in `eslint.config.js` | error | the renderer never imports main, preload, Node or Electron; main never imports the renderer; the routine runtime never imports Electron, main or the renderer |
| e2e red on main | `scripts/e2e-verdict.mjs` in `npm run check` | check fails on «nuovi rossi» | fix the test; a test red on main for another reason goes in `test/e2e/known-red.json` with `node scripts/e2e-baseline.mjs --update` |
| Tools documented (rule 13) | `test/unit/tool-catalog.test.ts`, always run by `npm run check:branch` | test fails | add the tool's row to `src/main/appctl/tool-catalog.ts` and its line to commands.md «MCP tools»; drop the rows of a removed tool |
| Guida covers the app (rule 13) | `test/unit/guide-anchors.test.ts` and `node scripts/guide-anchors.mjs --check` | test fails | write the card (it, en, de) or map the page/section to one in `src/shared/guide-coverage.ts`; re-read a stale card, then `node scripts/guide-anchors.mjs` |
| README fresh (rule 13) | `scripts/readme-check.mjs` in `npm run check:branch`; `test/unit/readme-check.test.ts` | check fails | write it in English, take the shot (`npm run shots`) and map it in `docs/readme-shots.json`, mention the page; or `shots: unchanged-visually [shot]` in a commit message for a change nobody can see |
