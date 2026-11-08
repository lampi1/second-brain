# Open risks after the fast merge of 2026-11-08

What it is: the reviews, checks and known reds that were skipped or left open when every finished branch was merged
into `main` at once. Why: the owner, 2026-11-08, «fai mergiare tutto ciò che è stato fatto adesso, mergialo su main
subito, niente controlli» and «beh che lo lasci in un documento per i prossimi agenti». Who uses it: any agent (a cloud
agent included, which sees only GitHub) before working on one of these areas. **Whoever fixes a risk removes its
line**; when the file is empty, delete it and its line in `AGENTS.md`.

Every branch came in through the integration branch `int/queue` as one `--no-ff` merge; the merge commit is named
after the branch (`git log --first-parent --oneline main`). The ADR clashes were renumbered: Remote Control
0222 → 0229, Impara 0221 → 0230, agents-merge rule 0221 → 0231, OpenCode permissions 0221 → 0232.

**Not run on the merged tree at all:** typecheck, lint, unit tests, e2e and README/doc-freshness checks
(`npm run check` without e2e is the first thing to run on `main`). The machine was saturated (100 % CPU) all day,
so many unit reds seen on the branches were timeouts, not verified failures.

## Per branch

| Branch (merge on main) | Skipped or open | Known risk | Look at |
|---|---|---|---|
| `feat/orchestrator-remote-control` (307d86a7) | README shots `orchestrator.webp`, `orchestrator-flash.webp` and their `.guardallow` pins not retaken on the merged tree | `readme-check` may fail on the shots | `docs/screenshots/`, `.guardallow`, `src/renderer/components/RemoteControl.tsx` |
| `feat/parallel-checkpoint` (on main before, 76ef2dcc) | none open: Sentinel clean, barrier tests 6/6 and 5/5 green on a lighter load | — | `src/main/chats/write-barrier.ts` |
| `feat/acp-catalog-replay` (9e7cb916 + 27875258 + 5ef1509b) | the fix of the Sentinel's first finding (the Codex thread preview, the user's first message, was written in clear in the wire recordings) was cherry-picked, not re-reviewed on the merged tree | a wire recording could still hold user text | `src/main/chats/wire-record.ts`, `test/unit/chats/wire-record.test.ts` |
| `impara/land` (36796d6d) | e2e «a topic» red on Windows (the frozen demo's `filesVerdicts` path escape; already red on main before) | — | `src/main/learn/demo.ts`, `test/e2e/impara.spec.ts` |
| `feat/worktree-pool` (746aa3e1) | none open: Sentinel clean on the commit and on the conflict resolution. Minor notes left: `README.md` (Worktree section) should say automatic cleanup starts only after the first «Pulisci ora»; comments in `src/main/ipc-handlers/app.ts` and `src/shared/contract/app.ts` say «Ruoli e deleghe» but the block is in Avanzate | — | `src/renderer/components/WorktreeSettings.tsx`, `src/main/brain/settings-schema.ts` |
| `test/restyle-e2e-refresh` (88135d5d) | e2e `agent-card-model`, `phone-bridge` and `setup-simple` red, not diagnosed | stale specs or real regressions, unknown | `test/e2e/` |
| `chore/faster-agent-checks` + `docs/gate-no-e2e` (703bc6c4) | the Sentinel review of 21a8a437..40c88d3b found 3 doc findings; they were fixed in 9dcb3df8 with no re-review. One minor note not acted on: `CONTRIBUTING.md` says the e2e suite runs only when the maintainer asks, while `npm run promote` runs `npm run check` (e2e included) | — | `scripts/check-quick.mjs`, `docs/agents/rules.md` §7 |
| `chore/auto-merge-main` (cf636cf3) | its rule 8 still required e2e and a machine lock; the merge rewrote it to point to rule 7's gate (no e2e, no lock) and added an amendment to ADR 0231. That rewrite was not reviewed | the gate rule must stay one: §7 is the source, §8 only points to it | `docs/agents/rules.md` §7-8, `AGENTS.md` rules 7-8, `docs/adr/0231-agents-merge-verified-branches-to-main.md`, `src/main/agents/orchestrator-role.ts` |
| `feat/agent-comms-cloudroom` (44cb99d3) | e2e `orchestrator-wake.spec.ts:35` red under load and never seen green; the unit test `delegation-reuse` timed out | the wake e2e may be a real regression from the quiet turn ends (ADR 0223) | `test/e2e/orchestrator-wake.spec.ts`, `src/main/agents/delegation.ts` |
| `fix/opencode-auto-permissions` (7161bde0) | Review 3 still open | auto-approved permissions on OpenCode chats: security-sensitive | `src/main/brain/adapters/opencode-permission.ts`, `docs/adr/0232-opencode-auto-permissions.md` |
| `chore/drop-load-flaky-tests` (3b3b546e) | Sentinel findings 2, 4, 6 fixed; 1, 3, 5 accepted as the owner's decision to delete the tests; no re-review of the fixes | coverage removed for load-sensitive paths | `test/unit/` (the files the merge commit touches) |
| `fix/harness-parity-resume-tools` (6d3d7b9b) | Sentinel (security clean, 79/79 green) left one medium finding unfixed, see below | a chat's cold-start slot may never be released | `src/main/chats/acp.ts`, `src/main/chats/manager-sink.ts` |

## Harness: `replaying` stuck after an engine exit (medium)

If the ACP engine exits during `session/load`, `Rec.replaying` stays `true` on the chat record (`acp.ts` around the
`replaying` assignment in `openSession`, `manager-sink.ts` where it reads and writes `replaying`). `AcpSession.end()`
calls `sink.exit` before `openSession`'s `finally`, so the `replaying: false` is dropped because `live()` is already
false. Effect: the chat's next engine may never release its cold-start slot until a question, a permission or its
exit, and other chats queue behind it. Fix: clear `r.replaying` in the exit handler and when a new session attaches
(or store the replaying session and compare it with `current()`). Test: kill the fake ACP engine during
`session/load`, then a new session that answers must free the slot.

Low residual risks of the same branch, to verify: trust by server name (a user-defined OpenCode MCP server named
`second-brain` would be treated as the app's own); shell permissions without a `kind` fall into the Tool category;
Kimi's MCP tool naming.

## Outside this repo

The brain's `code.md` "Repo exceptions" and its line B-171 still describe the old gate with e2e and a lock: a Scribe
updates them (not a repo file).
