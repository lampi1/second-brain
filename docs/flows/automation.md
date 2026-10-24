<!-- Automatic-flow host contract, authorization and recovery notes for runtime integrators and reviewers. -->
# Automatic flows

An automatic flow is a current user-activated flow version plus an independently approved trigger configuration. It is not a second workflow system. There are no initial jobs, no model-generated timers, no shell detector, and no implicit approval for external or production effects. The default global state is unpaused, with background operation disabled.

`FlowAutomationService` persists rule revisions, events, source deduplication and detector cursors in one atomic ledger. `tick()` detects and dispatches; since ADR 0155 the runtime's dispatch starts the event itself (`startEvent` with the rule's owner), with no Orchestrator turn. The runtime supplies a read-only DevOps detector (include/exclude tags, work item ids, iteration, a maximum per hour). Interval detection is built in. Missed intervals coalesce into a single current event. The runtime owns its scheduler and application background policy.

The authenticated Orchestrator tools are `app_flow_auto_list`, `app_flow_auto_propose`, and `app_flow_auto_start`. Listing exposes all configuration revisions and owner IDs for deliberate owner recovery, but only the caller's events. Reading another owner's configuration does not grant start authority. Proposals are inert. Only renderer IPC may call `decide`, `pause`, or `control`; every call must retain its brain-context guard. The runtime service getter must validate that the caller remains the owning Orchestrator. The start tool accepts only an event ID and context key: scope, pinned version, inputs and subject come from the host ledger. Existing flow evidence, delegation and approval gates continue to apply.

## Revisions and scope

A proposal's `expectedRevision` is the existing rule's revision (0 when creating); a rule is unique per flow. A replacement cancels pending old events, resets the detector cursor and requires a new exact-revision user activation. A live authenticated Orchestrator can propose a replacement to recover a closed owner; the new owner receives no authority over already-started runs. Those runs retain their original owner and capacity slots. Decision/pause revisions refer to the rule. Global control revisions refer to the snapshot. Pausing preserves pending work. A new flow version blocks the old configuration until a replacement is explicitly proposed and approved.

DevOps configurations require project and area scope to match the detector scope exactly and remain inside the flow's scope. `work-item-id`, `work-item-revision` and `work-item-url` are host-reserved inputs. All required step inputs, including the configured workspace, must be present before approval; the three DevOps host inputs may be supplied by detection and are checked again against the actual event before start. Any detector/config input collision blocks detection without committing its cursor. On the initial successful DevOps scan, existing items establish a durable baseline unless the user approved `includeExisting`. Detector output is untrusted input for purposes of bounds, shape and collision validation.

## Delivery and recovery

One active run per work item per flow: a newer revision of a running item updates its `work-item-revision`, a newer revision of a waiting item replaces the waiting event. `startManual` creates one event for a pasted work item and starts it at once through the same rule (refused while the rule or the global switch is paused: a paused rule grants nothing). `clearQueue` cancels exactly the waiting events the user saw counted.


A busy notification adapter returns `false`, consumes no attempt, and leaves the event pending. A delivery failure throws, producing at most three attempts with one-minute and two-minute retry delays before a visible blocker. Successful notification becomes `notified`; it is not proof that work started. If the Orchestrator has not started the event within two minutes, notification is retried automatically, retaining the same event identity and a maximum of three total dispatch attempts across restarts. A third acknowledgement timeout becomes a visible blocker requiring explicit recovery. Repeated event starts return the same durable flow subject, including recovery after a crash between the flow write and event write.

At most two unfinished automatic flow runs exist globally and one per rule; approval and blocked runs occupy these slots. Urgent events are notified first. When at capacity, events stay queued. An authenticated start cannot bypass pause, rule approval, owner, pinned version or scope checks. Looking up an already committed run is allowed for recovery even while paused and never launches new work.

Explicit `pause({paused:false})` on an approved rule or `control({paused:false})` retries its blocked and previously notified events. This is also the recovery path after fixing a detector or owner blocker; it never resurrects cancelled configurations. Detector errors require this explicit recovery and never silently skip the cursor. Flow-step blockers still require their normal flow decisions.

The queue is capped at 200 pending/notified/blocked events. Completed/cancelled event history retains up to 2,000 entries; a separate deduplication ledger retains up to 20,000 source identities. Reaching a queue or deduplication bound blocks visibly without advancing the cursor. No old source identity is silently evicted to create duplicate work.

## Runtime lifecycle

The options are `{file, flow, detect, dispatch, now?, changed?}`. `flow()` must resolve the intended selected-brain service. The runtime calls `stop()` before switching brains or shutting down; stopping aborts detection and invalidates in-flight completions. Preserve the existing `FlowService` cache and recreate only its automation service from disk when returning to a brain. `stop()` is terminal. Single-flight ticks, generation checks and flow identity/context checks prevent stale detector or notification completions from updating a different context.

A malformed ledger fails closed, reports `storageError`, and is never overwritten with an empty valid file. Restore the original file and reopen the service to recover. Observer exceptions cannot undo committed state. Tests use fake clocks and injected adapters; no browser, live provider or external write is involved.
