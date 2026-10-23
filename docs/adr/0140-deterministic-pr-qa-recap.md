# 0140 — Routine PR and QA recaps use observed data first

Date: 2026-10-23

## Decision

Regia has a local PR and QA recap, built without a model from the existing Task reader.
The shared `workRecap` projection also feeds `app_digest`: both join QA to the complete
project/repository/PR identity, prefer full QA reports over duplicate linked test summaries,
and show failed or blocked tests, unexecuted tests, open QA bugs, negative reviews, build
failures and open discussions. An empty QA response never becomes a passing verdict.

PR and QA have separate last-successful-read timestamps. `qaAt` is persisted by the Task
service only after a successful QA response; legacy snapshots have unknown QA age. Failed
refreshes retain their previous data and remain visible. The recap labels cached observations
over one hour old, offers the existing read-only Task refresh, and creates no command or script.

The existing **Fai il punto** remains an optional request for interpretation through the
Orchestrator. The fixed recap neither approves a merge nor grants production authority.

## Verification and limits

Unit tests cover unknown/stale/failed reads, project identity, duplicate test cases, observed
risk ordering, escaped rendering and persisted QA timestamps. The cockpit E2E specification
includes the fixed recap; it is not run on the feature branch. Refresh still depends on the
user's existing DevOps reader and credentials. No generated automation, nightly replay or
performance claim is introduced.
