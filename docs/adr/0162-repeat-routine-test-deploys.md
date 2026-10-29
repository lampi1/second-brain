# ADR 0162 — Sequential test deployments within a routine run

Status: partly superseded by ADR 0179 (app-execution portions); accepted.

A BEFORE/AFTER routine needs two builds from its own PR on the same approved test target. The existing adapter
retained one deployment forever and status selected the first record. Its writer also cached an omitted-build
request by its original JSON, so fixing the coordinator alone would still replay the first receipt.

## Decision

Keep the existing schema-1 append-only deployment array and existing grants. Permit another build only when every
previous deployment in that run has a verified terminal state, and only on the identical approved target snapshot.
The run keeps its environment lease between builds; another run still cannot take it. Creating/draft/queued or
unknown outcomes fail closed, including after restart. Before a repeat, re-read the prior release and shared
environment activity: an external redeploy invalidates cached terminal state and must finish first. Revalidate the live PR merge identity, published source,
release definition, node/App Service and local target on each new deployment as before. No wider production access.

`test-deploy-status {targetId,releaseId?}` defaults to the latest release; an explicit id must belong to that run and
target. Receipts contain release/environment id, build id, build number and sourceVersion. Older records remain
readable (missing build numbers are null). Historical success is historical evidence, not a claim about the current
node; `latest` makes this explicit. Only the latest deployment can adopt its initiating step lease or reconcile a
pending write. External redeploy/drift checks remain on the latest release and immutable BEFORE/AFTER leases.

Resolve an omitted build id before operation hashing, using the latest attempt of the live PR merge commit (not an
older successful attempt). Resolve an omitted cancellation release id similarly. Repeated resolved requests remain
idempotent; distinct builds/releases have distinct operation receipts. Pending records carry build/release identity
so an old status cannot clear an uncertain later mutation. Unknown remote creation never permits a replacement.

Expose `flow_pr_build_status {targetId}` as a read-only chat tool through the same host-bound adapter checks. Either
existing test-deploy or pr-validation permission suffices; no new grant, caller-supplied PR, pipeline or arbitrary URL.
It reads at most 100 latest attempts, reports queued/running/succeeded/failed/canceled/not-found/unknown, and does not
start a build. Latest failed attempts are never hidden by earlier successful ones. The host rechecks the PR source
before and after reading. Pagination/incomplete searches fail closed or are explicitly identified.

## Routine usage and verification

No definition/grant migration is required. BEFORE: publish the regression-test build, request its existing PR policy,
poll `flow_pr_build_status`, deploy, then poll `test-deploy-status` to terminal. AFTER: push the fix on the same owned
branch, repeat for the new live PR merge build, and retain both release ids as evidence. No PR merge is performed.
The MCP tool descriptions and capability catalog advertise this sequence. A sealed routine may be explicitly revised
to use the new read tool; it is not silently rewritten. This change alone does not recover an already blocked step.

Synthetic REST tests cover two deployments, latest/historical status, retained leases, unknown outcomes, target
switching, stale/foreign builds, dynamic request idempotency, cancellation, pending reconciliation, old journals,
both existing grants, bound chat enforcement and read-only tool input injection. No live Azure writes or E2E tests.
