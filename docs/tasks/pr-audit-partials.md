Title: fix(audit): timer registry, IT/EN app shell, skill-save race and hook-script packaging
<!-- PR draft for the release integrator: scope, evidence, the shared-file patch to apply and the remaining work. -->

Closes the partial items of the v0.1.0 audit that fit one branch: ADR 18 (skill edits), ADR 24/37 (recurrence producer),
ADR 41 (Fatto and appRepo), ADR 56 (timer registry), ADR 57 (IT/EN UI, app shell) and ADR 60 (hook-script packaging).

## What changes

- **Timer registry (ADR 56).** `src/main/timers.ts` wraps setInterval/setTimeout per owner (`timersFor(owner)`): each
  live timer is tracked until it fires or is cleared. `app_state` exposes the snapshot (`appctl/tools.ts`) and doctor
  reports it (`scripts/doctor-timers.mjs`, wired in `scripts/doctor.mjs`). The recurring owners in main use it
  (chats manager, mail, regia-wake, sweep, warm, admission, jobs scheduler, sync, headline, overlay, browser tabs,
  compare queue, devops, brain live/usage/engines/estimates, demo and demo-browser). Tests: `test/unit/timers.test.ts`.
- **IT/EN app shell (ADR 57).** Every visible text in `src/renderer/components/`, `App.tsx` and `main.tsx` now comes from
  the dictionary: new areas `audit`, `audit-expressions` and `components` (`src/renderer/i18n/areas/`). The Italian text
  is unchanged, so the Italian e2e specs keep matching. Module-level labels became functions (`resumeLabel()`,
  `openNextLabel()`), the command palette shows translated group names while keeping its internal group ids, and dates
  in palette hits follow the UI language. `RolePreferences` moved from inline `it ? … : …` to dictionary keys.
- **Language tests.** `test/unit/visible-language.test.ts` checks key parity for the whole dictionary and for every
  `areas/*.it.ts`/`*.en.ts` pair (found from disk, so a new area is covered automatically). It asserts English renders
  of converted labels. It adds a guard: Italian-looking text in JSX text, visible attributes (title, aria-label,
  placeholder, label, alt, example) or toast/announce/setError/setStatus/askConfirm arguments under
  `components/`, `App.tsx` or `main.tsx` fails the test. The guard was checked to fail on an inserted Italian label.
- **Skill saves (ADR 18).** After the async Write hooks, the save rechecks the source contents and mtime and the
  destination, and refuses before moving or writing if any changed (`src/main/skills/service.ts`, test in
  `test/unit/skills.test.ts`).
- **Fatto and appRepo (ADR 41).** Fatto and the stand-up report drop neutral-title chats under the configured `appRepo`
  and its nested worktrees (`src/renderer/brain/lib/appwork.ts`). Sibling paths are kept and Windows paths compare
  case-insensitively. The brain pages read `appRepo` through `window.sb` (`useAppRepo` in `brain/api.ts`) instead of
  importing the app store, so they still load in unit tests without the bridge.
- **Recurrence producer (ADR 24/37).** `recurrence.mjs` already ships. `test/unit/recurrence-producer.test.ts` pins
  aliases, excluded rows and the returned/quiet/young verdicts, including the 14-day boundary.
- **Hook scripts (ADR 60).** Claude plugin packaging includes the hook directory and its local script dependencies, and
  a script change invalidates the plugin signature (`src/main/brain/adapters/claude-plugin.ts`).
- The daily compaction and browser correction prompts are in English. They keep the user's reply language and the
  non-approval disclaimer.

## Integrator: shared-file change

`src/main/wiring.ts` is integrator-only (AGENTS.md). The integrator applied the change in its own commit, after the
last import, so the auto-close timer joins the registry:

```diff
 import { mountRecallTool, RECALL_ENV } from './search/hybrid/recall';
+import { timersFor } from './timers';
+const { setInterval, clearInterval } = timersFor('wiring/auto-close');
```

## Validation (2026-10-18, this worktree, after `npm ci`)

- `npx tsc --noEmit`: passed.
- `eslint .`: no findings in tracked or branch files. The only findings are in untracked `tmp/*.cjs` helper scripts,
  which are not part of the branch.
- `npx vitest run`: 306 files passed, 2 failed (2627 tests passed, 13 skipped).
  - `publish-guard`: every finding is in untracked `tmp/` working notes (the audit text, the brief), which are not
    committed.
  - `default-brain` ("renders the actual bundled template…"): timed out at 15 s in the full run. Run alone it passed 4
    times out of 5, taking between 3 s and 28 s. This branch does not touch `src/modules/ai-first` or the template.
    The cause is the machine's disk speed, not this branch; it is left as is, not weakened.
- `npm run check:branch` (on d1b2cf6, with the untracked tmp helper scripts moved out of the worktree): not green.
  7 of 1911 tests failed: publish-guard on untracked `tmp/` only, plus 15 s timeouts in default-brain, chats/archive,
  file-diff, compare/headless and correction-catch-hook. Re-run alone, all of these pass except `file-diff.test.ts`,
  which still times out at 15 s on this machine (slow git spawns). The branch does not touch file-diff, and it passed
  in the earlier full run.
- Integrator, after the rebase on main ad1c983 and the wiring.ts commit: `npx tsc --noEmit` passed; `npm run
  check:branch` (untracked `tmp/` moved out) passed typecheck and lint, unit 1297 passed, 1 failed:
  `compare/headless` "a run past its time is killed" (the fake's log had no process yet under load). It passes alone
  (21/21) and failed the same way on another branch that does not touch compare/. The branch changes only the timer
  registry lines of `compare/queue.ts`. Known timeouts to check in the final gate on main: this one and `file-diff`.
- Guard on the branch commits (`tools/guard/scan.mjs --commits`): clean.
- E2E was not run, and the app was not launched (the brief forbids it). The English rendering of the converted labels
  is covered by unit assertions only.

## Remaining work (inventory, not closed)

ADR 57 is closed for the app shell only. Italian-looking string literals still found by a heuristic scan (some are ids
or prompts, not UI text):

- Renderer, 531 hits:
  - brain pages: 122
  - dashboard: 79
  - lib: 74
  - store: 53
  - brain components: 49
  - actions.ts: 34
  - brain map: 29
  - brain lib: 18
  - genui fixtures (preview only): 11
- Main and shared, 1699 hits, including:
  - main/brain: 293
  - shared/concept-guide.ts: 245
  - main/chats: 244
  - main/agents: 124
  - main/demo.ts: 115
  - main/appctl: 81
  - main/improve: 76
  - main/devops: 59
  - main/update: 49
  - shared/sys.ts: 43

  This includes the main-side skill-save errors.

Each of these areas needs its own conversion PR. The guard test can then widen its roots one area at a time.

Other limits:

- ADR 41: detached sibling worktrees and brief threads without cwd metadata still rely on the title rules.
- ADR 60: packaging uses the existing directory-depth and file-size limits. Live CLI loading is unverified.
- ADR 18: closes the await window. It is not a cross-process file lock.

No Battito fallback, no changes to contract.ts or index.ts, no app launch. wiring.ts changes only by the integrator
commit above.
