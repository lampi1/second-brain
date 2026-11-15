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
- A pull request ran only the tests related to its diff (`check:branch`), so the three systems never ran the whole unit
  suite before a merge, and nothing ever started the app on macOS: ADR 0054 stage 5 («proof without a Mac») was open.

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
   of features and replaces no e2e.
3. **The CI guard scans the checkout and the commits that lead to it** (`git rev-list HEAD` → `scan.mjs --commits`),
   not every ref of the repository. The archived history stays where it is and is never rewritten.
4. **A published commit's identity can be pinned, one commit at a time.** `.guardallow` takes `commit:<full sha> <rule>`:
   it silences that one rule in the message and identities of that one commit. The id is the pin (it fixes author,
   committer, message and tree); a pattern, a `*` rule or a short id is refused, and a path line never reaches a commit.
   The three commits above are pinned so; every other commit with that identity still blocks, in the hooks and in CI.
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
   - `fileFormat` builds a POSIX file URL with POSIX rules on any host (the red Windows test).
   - «Trovate sul PC» also looks in macOS's `Movies` and in the Italian Linux folder names.

Rejected:
- Rewriting `main` to fix the three committer identities: the owner's rule is never to rewrite public history.
- Exempting that no-reply address in the e-mail rule: every future commit with the wrong committer would pass.
- Keeping the e2e on `main` with a longer timeout: against the rule, and red for reasons unrelated to a push.

## Consequences

- A red check on `main` now means a broken typecheck, lint, unit test, guard finding or an app that does not start.
- macOS and Linux are proven by CI to install, pass the unit suite and start; nobody has used the app on a real Mac
  or Linux desktop yet (engines, logins, launchers and shortcuts there are still untried by a person).
- Known and left as it is: shortcut hints on screen say «Ctrl» on macOS too (Ctrl and ⌘ both work); the brain's
  `chat-prompt.mjs` opens Cursor by itself only on Windows (elsewhere it prints the block to copy); the in-app update
  is Windows only (ADR 0074), switched off everywhere.
