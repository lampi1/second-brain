# ADR 0168 · A routine test deploy creates one started release; a stuck draft is deleted

Numbered 0170 until 2026-10-29, when duplicate ADR numbers were removed.

Status: partly superseded by ADR 0179 (app-execution portions); accepted (owner, 2026-10-27). Supersedes the draft/activation part of ADR 0158 and the "before activation"
part of ADR 0159.

## Context

The routine test-deploy adapter created a draft release with its environment manual, checked the returned snapshot,
then activated the release and started its environment instance (three writes). The owner deploys test 1 with
`az pipelines release create` (one write: an active release whose only stage starts on `ReleaseStarted`) and asked
the routine to deploy the same way. A cancelled run also showed that cleanup could not remove its own never-started
draft: cleanup sent `PATCH releases/{id} {status: abandoned}`, Azure answered HTTP 400 (the documented abandon case
is an active release), the write stayed "unknown" and the test slot stayed held.

## Decision

1. Every check (target confirmed test-only, definition revision and fingerprint, single stage id, phases, allowed
   App Service tasks and parameter defaults, node or App Service identity, run-owned PR source, live definition
   recheck) runs before one `POST releases` with `isDraft: false` and no `manualEnvironments`. The live stage must be
   triggered by `ReleaseStarted`, otherwise nothing is created.
2. The returned release is still checked (active, revision, environment, phases, defaults, variables, build). It is
   already deploying, so a mismatch keeps the lease and records the run deployment as queued; settlement stops it
   with `cancel-test-deploy` (environment `canceled`).
3. `cancel-test-deploy` on a draft (older runs) sends `DELETE releases/{id}?comment=…` and records the deployment as
   canceled and deleted. A delete with an unknown outcome is proven from the soft-deleted list
   (`releases?releaseIdFilter=…&isDeleted=true`) before the release is read again.
4. A refused DevOps write keeps Azure's short `message` in its error, so the next refusal is diagnosable from the run.

Idempotency, the operation journal, unknown-outcome handling and lease rules are unchanged.

## Consequences

The window between the last check and the deploy is one request, as in the owner's script, but a mismatching created
release has already started and is stopped afterwards instead of never being activated.
