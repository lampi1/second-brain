Title: fix(settings): connect Azure DevOps, retire Kimi and expose scoped Codex autonomy

## What

Settings now presents GitHub, Jira Cloud and Azure DevOps as spaced cards with a primary sign-in action, explicit verification and expandable connection details. Azure reuses the existing Azure CLI login and the brain DevOps reader; it does not introduce another credential store. Its projects come from the user's work items and pull requests, with that limit explained in both languages. Verification starts a fresh read, rejects account changes during it and skips malformed record URLs.

Kimi is retired (Brother's decision: the engines are Claude Code, Codex and Cursor only). It no longer has a launcher preset, onboarding choice, usage reader, dashboard metric or routing-model choice; `kimi` joins `REMOVED_ENGINES`, so a brain entry or saved switch for it is dropped, and an old setup guide on Kimi returns to engine selection without losing preferences. Historical Kimi chats stay readable. The Anthropic API text service is retained internally but is no longer listed in `engineInfos()`.

The Codex account now includes a searchable repository-autonomy section. A native folder picker validates repository/worktree roots (`canonicalRepoRoot`); adding or removing a folder goes through the existing protected `settings:propose` / `settings:confirm` boundary and shows the resulting scope before acceptance.

## Relation to #35 (engine-parity, merged)

Rebased on `a120c8a` (main with #35). #35's engine changes are kept as merged: Codex built-in and on by default, `checkLogin: true` and the readiness ranking in `ai-first/port.ts`. This PR only removes the Kimi lines next to them. Tests that used Codex as the example of an off/untrusted preset (`engines/trust`, `compare/headless`) now use the remaining app preset, the Anthropic API, with the same assertions; `brain/config` now expects Codex on by default, as #35 ships it.

## Integrator wiring (shared files, AGENTS.md rule 11)

Kept in a separate commit `chore(wiring): …` so the integrator can review or redo it:

- `src/shared/contract.ts`: remove `Usage.kimi` and `KimiUsage`; add `'app:pickRepo': [void, string | null]` to `InvokeMap` and to `INVOKE_CHANNELS` (after `app:pickBrain`); `EngineInfo.runs` doc example becomes "agent acp".
- `src/main/index.ts`: import `canonicalRepoRoot` from `./brain/adapters/codex-policy`; `createAppConnectors(app.getPath('userData'), () => s.devops.refreshFresh())`; new handler `'app:pickRepo'` (native folder dialog, returns `canonicalRepoRoot(selected)` or a plain-language error, `null` when cancelled).
- `src/main/wiring.ts`: no change.

`.gitignore` gains `tmp/` (agent scratch files and test temp folders stay out of commits).

## Validation (branch)

- `npx tsc --noEmit`: pass. `npm run lint` (full `eslint .`): pass. `npm run check:branch`: see the handoff for the result on the final commit.
- `npm ci` could not run: Windows refused to delete `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` (EPERM, no process holding it). Dependencies were reinstalled with `npm install` from the unchanged `package-lock.json` plus `node node_modules/electron/install.js`.
- Full unit run before the per-branch rule changed: all green except 3 timing tests (`correction-catch-hook`, `file-diff`, `default-brain` template render) that fail identically on a clean `origin/main` under load and pass when run alone.
- No e2e and no visual check on the branch (by rule: once on main). `test/e2e/settings-tools.spec.ts` is new and `settings.spec.ts` / `usage.spec.ts` were updated for the Kimi removal: run them in the main gate.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
