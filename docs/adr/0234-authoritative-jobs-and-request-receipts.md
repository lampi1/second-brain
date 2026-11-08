<!-- Coordination ownership, durable authorization facts and recovery semantics for the runtime integrator and maintainers. -->
# 0234 — One job projection and exact request receipts

Status: implemented core; integration verification and independent persistence/authorization review pending.

## Context

The workflow ledger, chat state and agent runs previously answered different questions under the same word “done”.
`app_digest` inferred activity from chats and even described automatic closure as finished work. A question's answer
was sent to the engine before its continuation record was persisted. A plan submission failure reopened its approval.
These orders cannot distinguish a decision from transport success, and can repeat an accepted answer after a crash.

## Decision

`coordination/projection.ts` is the shared evidence-based read model consumed by `Workflows.list()` and `app_digest`.
Explicit workflows retain their phase, priority, proposals and historical events. Root task assignments without a
workflow also appear, using their durable task/run/version identity. Their read model survives chat pruning and run
rollup. An agent report is labelled **reported**, not an independent success. Only an explicit human success verdict
completes an assignment-only job. Chat closure without completion evidence leaves work blocked, never done.

The `coordination` area in the existing `app.db` contains row-oriented jobs, chat links, append-only workflow history,
semantic assignment snapshots, current-task indexes, requests, decisions, deliveries and execution observations.
`RunsDb` updates the small assignment snapshot in the same transaction as the run. Token/cost-only updates do not
rewrite the semantic snapshot. Work-list queries do not parse full run history; current assignment and request queries
are indexed and bounded. The workflow display retains its bounded history tail; the journal keeps earlier events.

Every request identity includes **original request + job + chat + run + task version + proposal revision + SHA-256**
of the proposal scope. Object-key order does not change the hash. The host reconstructs this binding from its current
state before resolving it, rather than trusting a binding supplied by a model. A compare-and-set changes only an exact
pending request to accepted. A transaction commits the decision (and a workflow transition when applicable) before
any engine submission. Competing connections, duplicate clicks and changed bindings cannot consume a second answer.

Three receipts have different meanings:

1. **Decision:** the host accepted an exact answer. Actor is explicitly user/channel or named policy. Phone remains
   phone. Night-mode choices remain policy actions, never synthetic user consent. Agent relays are refused.
2. **Delivery:** dispatching, delivered, failed or uncertain. Persist dispatch intent first; one dispatch attempt per
   decision. A crash while dispatching remains unconfirmed. Missing acknowledgement is not permission to retry.
3. **Execution:** a separately labelled runtime observation or agent report. Delivery does not prove execution, and
   an agent's report does not independently prove success or create authority. Report observations are linked only
   to accepted decisions of the same run and cannot predate their decision.

## Migration and recovery

The old workflow JSON is validated and imported transactionally once, retaining every original record/event and the
untouched source file. Subsequent writes update individual SQL rows. Existing approved history is not turned into
new consent. A still-proposed legacy workflow/plan can acquire a pending request, but existing request identities are
never rebound to a new run on restart. Existing agent runs are indexed once; pruning them does not delete jobs.

Pending requests and accepted answers remain queryable after reopening the database. Engine request callbacks are
not persisted and recovered rows are not silently reinstalled as live engine permissions. Removing an in-memory panel
on shutdown is therefore different from cancelling a durable request. Accepted/undelivered decisions remain explicit
recovery work. Neither startup nor a failed plan send reopens an accepted approval or blindly resends it.

## Host boundary

The new modules use Node/SQLite only, with serializable records and no Electron APIs. The existing chat store remains
the sole writer of `chats.json`; coordination does not write it independently. The runtime migration must place the
coordination owner beside its job state and expose a bounded typed projection to Electron main. Main retains sender
authentication, permission/credential policy and channel restrictions. A receipt never grants more tool permissions,
permits production, changes settings, or makes agent prose an owner decision.

Question registration uses the existing `countRequest` point after gate/policy processing and before `pending:added`.
Policy answers register their own exact request. No shared manager option or extra sink writer is required. The plan
delivery receipt is settled by `SubmissionReceipt` at actual engine submission, not queue admission.

The old `app_resolve_question` timestamp heuristic is not an exact receipt: its `relay` path is refused by the manager.
The sole-conversation stage must route the original request through the host-owned panel/channel and retain its real
user provenance; nearby Orchestrator messages cannot be converted into consent. Its tool description must be updated
with that channel integration, not interpreted as a permission bypass.

Until renderer IPC carries the whole binding, native chat/request-id pairs cannot be recycled for changed scope:
otherwise an old button could address a new proposal. Such reuse is refused before exposure. Explicit reassignment
cancels prior pending callbacks but retains accepted decisions and their delivery uncertainty. Plain chats and the
Orchestrator have request-only jobs too, so their recovered questions remain visible without a role run. A separate
open-request index prevents recent completed policy traffic from evicting old unanswered requests from the projection.

## Verification and remaining integration evidence

Deterministic tests cover two SQLite connections racing for one decision, wrong job/chat/run/version/revision/hash,
restart in pending/accepted/dispatching states, preserved phone origin, policy/report separation, atomic workflow
transition rollback, durable orphan assignments and no semantic rewrite on cost-only updates. Manager tests verify
commit before panel exposure and before the engine receives the answer, invalid answers, duplicate replies and failed
delivery without consent rollback. Workflow regression tests now inject SQLite write failure rather than JSON failure.

The fifth Workflows constructor argument can bind the current chat/pending snapshot and existing CoordinationStore.
Its wiring and the runtime-host move belong to the stage-2 integrator. Screenshots, the dev-product check, independent
review and comparable request/list/digest p95 plus event-loop p99 must be recorded on the integrated build. No speedup
or end-to-end channel validation is claimed from unit tests alone. The current projection cap is 2000 jobs/requests;
pagination/visibility of a larger pending queue must be completed before calling that workload supported.

### Recorded development evidence

On core commit `3a9ae5b8` against baseline `b2c8aa0b`, the hidden Electron dev renderer showed the real service outputs
for the same one-job/closed-chat fixture at 1600×1000, with no renderer errors. This is a synthetic-fixture product
inspection, not a live engine/phone channel test. Twenty-four sequential proposal/decision/list/digest cycles in
Electron main, warm services and uncontrolled ordinary shared-machine activity, gave these diagnostic milliseconds:

| Metric | Before | Core after |
|---|---:|---:|
| Request insert p95 | 6.826 | 3.610 |
| Request resolve p95 | 6.544 | 3.424 |
| Work-list p95 | 0.117 | 0.847 |
| Digest p95 | 0.660 | 1.295 |
| Main event-loop p99 | 15.434 | 13.255 |

The richer read projection costs more in this sample; no general speedup is claimed. The later open-request index and
request-only recovery additions need the integrated performance pass. A deterministic row-change test establishes that
token/cost-only updates do not rewrite assignment snapshots. No wall-clock threshold is asserted by unit tests.
