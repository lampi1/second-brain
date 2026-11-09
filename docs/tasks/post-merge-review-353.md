# Post-merge gate and review of the five cloud branches (issue #353)

Date: 2026-11-09. The five branches were already on `main` (one fast-forward, four rebased). This file records the
gate, the independent review, the decisions on the commits left out, the WIP commits and the branch deletion.

## 1. Gate on main's tip (`npm run check` without e2e)

The non-e2e steps of `scripts/check.mjs` (build, typecheck, lint, unit, publish guard, unit with real processes) were
run in order on the tip pushed with this record: all six exit 0. The full output is in
[`post-merge-gate-353.log`](post-merge-gate-353.log); its last lines are the per-step summary. The e2e projects were not
run (issue #353 asks for the gate without e2e; two e2e specs, agent-card-model and admission, are red on `main` already
and are not part of this record).

## 2. Independent review (fresh-context reviewers, one per dimension)

### Runtime (`3cf9d238..9ac52276`, `3413fcf5..4812cce1`, `17d79327`)

Fixed on `main` (commit «fix(browser,runtime): post-merge review…»):
- an exception in the host's `event()` handler no longer kills the main process: it is caught and logged;
- closing the host waits with no timeout and, if the close is refused before any exit was seen, the engine is treated
  as dead (`hostDied()`), so its chats do not stay «running».

Left open (none blocks the current, default-off use):
- the semantic queue holds 256 events and an ack waits 30 s: under a long stall events are dropped, not back-pressured;
- the size test trips the count limit, not the byte limit, so the byte limit has no test of its own;
- `9ac52276`'s message describes a polling loop that the code does not have (message only, code is fine);
- the proxy advertises optional methods the host may not implement;
- a fixed cap of 64 sessions per host;
- at quit the host is closed after the windows, not before.

### Browser passwords (`c34338ef`, `268c61ef..ad9ca995`)

The issue asks to prove that no password can leak into screenshots, logs or recorded key presses. Answer:
- **Recorded key presses: no leak.** Text typed by the browser tools (`type`, `fill_form`, `key`) is masked in the feed
  and in the wire record, for Claude, Codex and the ACP engines (OpenCode's `second-brain_browser_type` titles too,
  fixed in this review); a panel whose arguments the app cannot read is blanked, not shown raw.
- **Logs: no leak after the fixes.** The OpenCode title form and the ACP permission panel were the two gaps; both fixed.
- **Screenshots: no in the normal path, with edge cases.** Password fields are masked before a capture, but
  `capturePage` may run before the mask is painted (a race, not reproduced) and the password-field hint is narrow
  (it may miss a custom field that is not `type=password`).

Left open: an agent that reads a credentials file puts its text in the feed (best fix: a `fill_credentials` tool that
types from the file without the agent reading it); the capture race and the narrow hint above; the ACP content text in
the wire record; the `javascript` tool can read a field's value (it is a full page script by design).

### Maintenance (`d93b785b..a6da5302`, `76e7bf04..8486dc54`)

Fixed on `main` (commit «fix(maintenance): post-merge review…»): the research no longer reads the body of an issue
(a stranger's text never reaches the model); the issue snapshot respects hidden runs; duplicates are matched only
against open or rejected cards of the same family, so a bug that came back can be proposed again; the deck has one
total order.

Left open: the inventory is read twice per run (cost only); some paths have no unit test; the cleanup budget has two
slots per run.

## 3. The three stage4 commits not on `main`

`99a70101` (phone: await queued outcome delivery), `5db7ba27` (delegation: sibling-worktree reuse without the 5 s git
cap) and `f0520f38` (drop or rewrite load-sensitive tests) were **dropped on purpose**: they tune tests that real
processes, git or clocks made load-sensitive, and those tests were then removed from the suite under rule 7 (no
load-sensitive tests, `docs/tests/load-sensitive-removed.md`): `test/unit/phone/bridge.test.ts` and
`test/unit/chats/orchestrator-cursor.test.ts` are deleted, and the `delegation-reuse` and `delegation-isolation` cases
they touch are listed there as removed. Bringing them over would add back what rule 7 forbids.

## 4. WIP commits on `main` (not rewritten, rule 8)

- **`509d718d`** «test(delegation): pin a continued child's base with a scripted git (WIP)»: the test works for what it
  claims (the pinned base is kept and refused once the source left its branch or rewrote the base), and `check:quick`
  is now green with it. Its header said it drives `ChatManager.create`; it drives only `DelegateWorktrees.prepare` (header
  corrected). Its message names review items F2-F4 that are recorded nowhere, so they cannot be checked. Not covered,
  left open: staging the whole chain's delta from the pinned base through `stageDelegatedChanges`, refusing a dirty
  successor (the fake `status` is always clean) and the root/common-dir mismatch branch of `worktrees.ts`.
- **`a6da5302`** «wip(maintenance): browser fallback for unverified dedup, honest issue draft labels»: the code is
  complete. The items it left open are done: sort order and duplicate scope (maintenance fix above), the memory
  screenshot retake (`55478782`) and the Guida text.

## 5. Remote branches deleted

Each was checked against `main` before deletion (non-equivalent patches found on `main` in rebased form or dropped as
in point 3). Tips recorded here so any of them can be restored with `git push origin <sha>:refs/heads/<name>`:

| Branch | Tip | Check |
|---|---|---|
| `chore/no-load-sensitive-tests` | `2a73574f` | fast-forwarded, the tip is on `main` |
| `feat/maintenance-deep-analysis` | `cfa68cda` | 0 patches missing |
| `feat/browser-allow-passwords` | `b5375422` | its one patch is `c34338ef` on `main` (rebased, renamed from wip to feat) |
| `feat/app-owned-agent-runtime` | `7cebefb9` | the 5 real patches are `f50faadd`, `1b0ba649`, `9fa11c42`, `d1627c25`, `9ac52276`; the 6th is an empty wip commit |
| `stage4-review-fix` | `bfc4ac3d` | `aeaafab8` → `f89b7566`, `07a0dee6` → `f2c53b4a`; the other 3 are point 3 |
