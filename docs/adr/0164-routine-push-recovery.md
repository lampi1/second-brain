<!-- Branch identity, incremental publication and honest write outcomes for routine engine maintainers. -->
# 0164 — Routine push recovery without full-history bundles

## Context

A one-commit fix failed because the host bundled the complete history (256 MiB cap). A partial restart also changed
its required branch from the source run's ID to the successor ID. Both local refusals were journaled as uncertain
remote effects, preventing retry and step history. Authentication refusals on the first REST mutation behaved likewise.

## Decision

Use native Git negotiation to push exactly the captured commit to the host-owned fix ref. Keep the host-created bare
repository, credential-free source ref/path reads, sanitized Git environment, disabled hooks/fsmonitor/replacements,
no lazy fetching, fixed HTTPS destination, no redirects, force, deletion, tags or arbitrary refspec. Borrow local
objects through the temporary repository's alternates; all traversal uses host-owned config. Do not create or copy a
full-history bundle. Remove its 256 MiB cap rather than claim it bounds outgoing bytes: native negotiation sends only
missing objects; the existing operation timeout still bounds execution. No new grant or destination is introduced.
Concurrent local object pruning can fail a push; failure after dispatch remains uncertain and is not auto-retried.

For a partial restart with a completed prefix, persist `restartOf.branchRunId`, derived from the validated ancestry,
and use it in both worker instructions and the writer. Old records derive the same identity from `restartOf` without
rewriting their approvals. Restart from the beginning/first step starts a fresh branch identity. Inherit only branch
publication receipts (latest ancestor first), never PR/test/deployment resources. Current exact grant, project,
workspace and live ref checks remain mandatory. Refuse concurrent active successors, reuse from stale ancestors (even after successor cancellation), and uncertain
ancestor pushes. Check latest ownership again at dispatch. Existing restrictions on partial restart with PR/deployment resources remain.

Journal intent immediately before the real remote mutation, after local push preparation. Record `not-done` with a
bounded host-authored reason for failures with no dispatch, and for HTTP 401/403/412 when no earlier mutation in the
logical operation may have changed anything. Include status in the error without storing provider body/credentials.
Clear only that operation's revision-attribution fence. A retry never erases an earlier pending cleanup intent; only
a successful receipt or live terminal-state reconciliation settles it. Release a deployment creation intent only when
its first POST was definitively unperformed, not after ambiguous responses or accepted creation. First-request network loss, 5xx, invalid successful receipts,
and failures after an earlier mutation remain `pending`; later rejection cannot erase an earlier created resource.
Failed tool calls name not-done versus unknown outcome explicitly, with retry or reconciliation guidance.
Schema 1, prior pending/done entries and run records remain readable. Historical pending entries cannot safely be
reclassified without evidence: reconcile them before retrying; this fix does not silently clear old uncertainty.

Every worker receives the current host-verified grant scope and instructions to execute covered operations without
asking for the same approval, explicitly resolving generic role instructions to wait for external writes. Explicit approval/manual steps, missing authority, changed scope and production gates
still stop. Questions recommend forward progress unless the card explains a concrete reason to stop. This is prompt
clarity, not an automatic answer or a permission bypass; frozen routine packages remain unchanged.

## Verification and limits

Real local Git fixtures reproduce a branch over 257 MiB of common incompressible history, isolated config/hook
handling, exact ref publication, and partial-restart publication without changing the checkout. Mocked HTTP tests
cover pre-dispatch refusal, retry after restart, first HTTP denial versus partial effects and ambiguous network loss.
Recovery tests cover legacy records, chained partial restarts, fresh starts, forged ancestry and concurrent successors.
No live DevOps write, production operation or app packaging. Host prompt tests cannot guarantee every model will comply.
