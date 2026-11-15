# ADR 0314 · CI that tells the truth on Windows, Linux and macOS

Date: 2026-11-15 · Status: accepted (owner, thread «Rendere l'app solida su Mac e Linux», 2026-11-15: «siamo sicuri
che funzioni tutto bene su mac e linux?» and «una pulizia generale dei test che falliscono da un sacco anche per
favore è un repo pubblico di un certo livello precisione e pulizia») · Amends: ADR 0054 (stage 5), ADR 0061 (the CI
guard), ADR 0027 (what CI runs on main)

## Context

Every push to `main` was red on GitHub, for reasons that said nothing about the code:

- **`check` on main ran the full `npm run check`, e2e included**, on the three systems. Linux and macOS were cancelled
  at the job's 60 minutes on every push; Windows ended red on the e2e baseline (stale since 2026-10-21). The rule since
  2026-11-08 is that the e2e suite runs only when the owner asks and is never a gate (`docs/agents/rules.md` §7): CI
  did not follow it.
- **`guard` ran `scan.mjs --history`, which reads `git rev-list --all`.** With a full checkout that is every branch on
  GitHub, the archived `archive/pre-1.0` history included: 149 findings, none of them in what a push to `main`
  publishes. On `main`'s own history four findings were left: three commits of 2026-11-13 whose committer is the
  coding tool's no-reply identity instead of the owner's, and one README screenshot published without its allow line.
- **One unit test was red on Windows only** (`file-copy.test.ts`): `fileFormat(path, 'linux')` built the file URL with
  the host's rules, so a POSIX path got a drive letter on a Windows host.
- **One unit test file was red on macOS only** (`chats/close-tree.test.ts`, seven tests at the 120 s ceiling): its
  start queue used the default number of slots, which follows the machine's cores (`floor(cores / 2)`); on GitHub's
  3-core macOS machines that is one slot, held for ever by the test's first turn that never answers. Reproduced on
  Linux with `slots: 1`. Not a macOS defect of the app: a real engine answers or exits and frees its slot.
- A pull request ran only the tests related to its diff (`check:branch`), so the three systems never ran the whole unit
  suite before a merge, and nothing ever started the app on macOS: ADR 0054 stage 5 («proof without a Mac») was open.
- **The stable copy never ran in CI** (`npm run test:stable` came after the red e2e, on Windows main only), and two
  defects sat behind it. Its test still waited for the app to find a brain by itself, which the app stopped doing with
  the clean install (ADR 0072). And `scripts/fuses.mjs` rewrote the copied Electron binary through a new file with
  default permissions: on Linux the stable copy did not start (`EACCES`, reproduced here). On macOS the release could
  not even be staged: the fuses are in the app's Electron Framework, not in its executable («fuse sentinel not found»
  in CI), and a failed staging said only «release mutation interrupted», not why.
- **The Windows installer test never ran in CI either**, and failed at its first run: Setup stopped and rolled back
  («MoveFile failed; code 3») on a file whose whole path was 261 characters, two over what Inno Setup 6 accepts. The
  path was the test's long temp folder plus the deepest file of the payload, a TypeScript declaration of a runtime
  package; whether it fitted depended on the length of the Windows user name.
- Two unit tests of `flows/definition-file.test.ts` were red now and then on Windows (each seen once in this pull
  request's runs). Both waited for a directory's times to change right after a file was made in it. The likely cause
  (not proven on a Windows PC): the filesystem stamps with a clock that moves in steps, so a change in the same step
  as the snapshot leaves the times as they were. With the directory's times held still on Linux the second test fails
  with the same message. In the first the file's own identity check then refuses the swapped folder; the read is
  refused either way. In the second the reader simply reads the file, which is correct: only the test expected a retry.

The same review read the code for places that still assumed Windows.

## Decision

1. **CI runs what the rules say.** `npm run check -- --no-e2e` (new flag of `scripts/check.mjs`: typecheck, lint, every
   unit test, the publish guard, in a row; no build, no display, nothing recorded) is the gate of `main` on the three
   systems. A pull request runs `check:branch` and then every unit test. CI starts on pull requests and on pushes to
   `main` only (a branch with a pull request ran everything twice). The e2e suite has its own job, started by hand
   (`workflow_dispatch` with `e2e` ticked), read against `test/e2e/known-red.json` as before.
2. **The app is started once on each system** (`scripts/boot-smoke.mjs`, a step of `check`): the built app in its frozen
   demo, hidden, in an isolated profile; every sidebar page opened; any renderer error fails; one picture; a clean
   quit. This is the proof ADR 0054 stage 5 asked for, on GitHub's Windows, Linux and macOS machines. It is not a test
   of features and replaces no e2e. **The stable copy is started too** (`npm run test:stable`, on the three systems,
   pull requests included): the release staged in a temp folder with its own Electron copy, a new profile, a synthetic
   brain chosen with the banner's own button, three data sections opened. `fuses.mjs` keeps the binary's permissions;
   on macOS it changes the Electron Framework (`fuseFile`, the same rule in `src/main/browser/fuses.ts` for the app's
   own check) and signs the app again ad hoc (`codesign --force --deep --sign -`). A failed staging names its cause.
   The Windows installer steps stay on Windows main. The build leaves TypeScript declarations out of
   `out/node_modules` (nothing loads them at run time), the installer test uses a short folder name, and a wrong
   Setup exit code shows the end of Setup's own log.
3. **The CI guard scans the checkout and the commits that lead to it** (`git rev-list HEAD` → `scan.mjs --commits`),
   not every ref of the repository. The archived history stays where it is and is never rewritten.
4. **A published commit's identity can be pinned, one commit at a time, in CI only.** `.guardallow` takes
   `commit:<full sha> email`: with `scan.mjs --published` (passed by the CI guard job alone) it accepts the e-mail rule
   in the message and identities of that one commit. The id is the pin (it fixes author, committer, message and tree);
   any other rule, a pattern or a short id is refused, a path line never reaches a commit and a commit line never
   reaches a file. The hooks never pass `--published`: a commit being pushed is never silenced, as before. The three
   commits above are pinned so; every other commit with that identity still blocks, in the hooks and in CI.
5. **macOS and Linux fixes** found by the review:
   - Cursor's chat database was looked for under `%APPDATA%` only: the brain's tools (`chats.mjs`, `inbox.mjs`,
     `feedback-stats.mjs`, the Cursor hooks) and the app's watcher now share one rule
     (`brain-template/ops/tools/cursor-db.mjs`, `input-revision.ts` `cursorDatabase`): Windows `%APPDATA%`, macOS
     `~/Library/Application Support`, Linux `$XDG_CONFIG_HOME` (`~/.config`).
   - `mem.mjs` and `scripts/setup-pc.mjs` found the app's userData through `%APPDATA%`; they follow Electron's rule now.
   - The brain's `{{BRAIN_WIN}}`, `{{REPOS_WIN}}` and `{{HOME_WIN}}` values turned a POSIX path into backslashes: they
     are the path as the OS writes it, and the template's three `…_WIN}}\…` references use `{{BRAIN}}/…` instead.
   - An agent on macOS or Linux was told its command ran in «PowerShell 5.1» (the outcome and the check messages of
     Esegui), and the rules named `bash` whatever the login shell: `platform.ts` `userShellName` names the real one
     (zsh, bash…). The Esegui tooltips say «la tua shell» off Windows (`renderer/lib/host-os.ts`).
     The outcome message and the brain's readers of a command block (`chats.mjs`, `flow-signals.mjs`,
     `chat-feed.mjs`) follow the same rule: `powershell` on Windows, the shell's block elsewhere.
   - `fileFormat` builds a POSIX file URL with POSIX rules on any host (the red Windows test).
   - «Trovate sul PC» also looks in macOS's `Movies` and in the Italian Linux folder names.
6. **Tests say the same on every machine.** `close-tree.test.ts` fixes its start slots; the `readAskImage` and the
   Esegui refusal tests, which ran on Windows only, run on the three systems; the swapped-folder test of
   `definition-file` accepts either refusal and still asserts that nothing is read, and its retry-bound test shows
   every new file in the directory's time itself instead of waiting for the filesystem's clock.

Rejected:
- Rewriting `main` to fix the three committer identities: the owner's rule is never to rewrite public history.
- Exempting that no-reply address in the e-mail rule: every future commit with the wrong committer would pass.
- Keeping the e2e on `main` with a longer timeout: against the rule, and red for reasons unrelated to a push.

## Consequences

- A red check on `main` now means a broken typecheck, lint, unit test, guard finding or an app that does not start.
- macOS and Linux are proven by CI to install, pass the unit suite and start, as the dev build and as the stable
  copy; nobody has used the app on a real Mac or Linux desktop yet (engines, logins, launchers and shortcuts there
  are still untried by a person).
- A branch pushed without a pull request is no longer scanned by CI (the pre-push hook scans it; a merge goes through
  a pull request or the hook). The commit form of `.guardallow` has no unit test: the guard's tests that started git
  were removed as load-sensitive (2026-11-09); it was tried by hand in a scratch repository.
- On Windows the brain template's three path references now read `C:/…/` (forward slashes), which every tool there
  accepts.
- The Windows installer still has Inno Setup 6's limit of 259 characters for a whole path. With the default folder
  (`%LOCALAPPDATA%\second-brain`) the payload's deepest file fits up to a Windows user name of about 49 characters;
  a longer one stops Setup, which rolls back. Not handled with a message of its own.
- Known and left as it is: shortcut hints on screen say «Ctrl» on macOS too (Ctrl and ⌘ both work); the brain's
  `chat-prompt.mjs` opens Cursor by itself only on Windows (elsewhere it prints the block to copy); the in-app update
  is Windows only (ADR 0074), switched off everywhere.
