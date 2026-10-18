# ADR 0074 · A developer updates by asking the app; release drafts without GitHub Actions

Date: 2026-10-18 · Status: accepted (owner, 18/10: "un dev che ha già una versione dell'app deve essere semplicissimo
per lui aggiornare: basta che chieda alla stessa app di aggiornarsi"; "il readme deve avere il download per ogni
versione") · Builds on: ADR 0007 (stable vs dev), ADR 0020 ("Migliora l'app"), ADR 0027 (checks), ADR 0061 (one repo)

## Context
A developer runs the app from a checkout. Updating it meant knowing `git pull`, when `npm run setup` is needed again
and `npm run build`. The staged updater for installed copies is hard-off until its Windows restart lifecycle is proven
(`docs/update-integration-evidence.md`), and legacy promotion from the app is off too. Release drafts were made only
by the manual "Windows release draft" workflow, but GitHub Actions are off on purpose for this repository.

## Decision
1. **`npm run pull`** (`scripts/pull.mjs`): fetch the remote's `main`, fast-forward the local `main` only (never a
   merge, rebase, reset or push), run `npm ci` plus the Electron binary only when `package.json`, `package-lock.json`
   or `.npmrc` changed, then build. It refuses another branch, uncommitted changes and diverged history, with the
   way out in Italian. It never promotes, restarts or touches the stable release.
2. **Asking the app**: the Orchestrator gets the app-control tool `app_update_code` (only on the tokenized Orchestrator mount
   `/mcp/app/r/<id>/<token>`, never on the plain `/mcp/app` or `/mcp/improve`, which local processes can reach), which runs that script in the code folder through
   `ImproveService.pull()` (one at a time, not while a promotion runs). It is refused unless the user wrote to the
   Orchestrator in the last 10 minutes (agent-labelled messages do not count). The Orchestrator then reports the
   result and the step left to the user: restart the dev app; a stable copy changes only when the user promotes it.
3. **Release drafts from the owner's PC**: `npm run release:draft -- v<version>` (`scripts/publish-windows.mjs
   --local`) on a clean `main` whose tip carries the tag, after `npm run package:windows`, makes the same verified
   **draft** the workflow would (same tag/source/hash checks, never published). The owner reviews and publishes it.

## Consequences
- "Aggiornati" in the Orchestrator brings a developer's checkout to the latest `main` with one sentence.
- Agents still never promote, roll back, push or publish. Re-enabling "Aggiorna" for copies promoted from a checkout
  is a separate decision for the owner (it was left off).
- Every published release appears on the Releases page; the README links each version there.
