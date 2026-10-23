# 0138 — Fresh engine sessions at an observed idle boundary

The persistent chat, its task/run, event ledger and workflow are the identity of the work. A provider session is
replaceable context, not a new work item. Budget freshness is enabled by the host and never reports a measured loss
of quality: its input is the provider's actual context usage and budget (at least 50,000 tokens and 80% of budget).
Estimated or absent budgets do not qualify.

After three idle minutes, prepare a deterministic handoff without a model call. On the next delivery, recheck the
boundary and replace only the engine session. An explicit continued assignment reserves the already-checked idle
boundary before marking its new run assigned; only that exact run can use the reservation, and the note then
contains the new task/version/contract. The assignment’s normal one new run is retained; freshness adds none. Keep the chat ID, title, cwd, task ID/version, run ID, workflow IDs,
report identity and delivery ledger unchanged. The handoff contains the exact durable user-event ledger, including
the user’s actual question-answer values and permission choices, task/plan state, host-supplied workflow decisions and
outstanding context, visible user messages and assistant questions. The last assistant answer is preserved in full. Complete question wording and permission scope are stored privately
for this chat’s continuation; parent/Orchestrator user-event tools and notifications receive only the user’s own
answer values or permission choice/message plus an opaque request ID. Every permission answer is retained, including
a denial without a message; its scope remains the original request, never a general permission.
If protected state exceeds 32,000 characters or authoritative workflow state cannot be read, retain the old session;
never truncate protected directives to fit. Chats carrying image inputs also retain their session because a text
note cannot preserve the image context. History eviction and image inputs set a durable safety flag: even after
the item leaves the visible history or the app restarts, freshness stays blocked. A bounded transcript read also
blocks freshness when the file or item count may be truncated. A note is context, not an authorization or a request to duplicate work.

For live Claude, freshness uses the existing automatic-close **observed idle** boundary: a clean completed turn,
no pending questions/permissions/commands, no assigned/background/child work, no proposed plan or awaited parent,
and no running, waiting or unknown observed children. Claude currently reports partial child coverage: the app does
not relabel it complete or claim it proves the absence of every process. This is the same operational boundary
already used for automatic closure, with a three-minute pause and a new delivery required. `closeKeeping` preserves
external dev servers as it does for engine changes. Recheck activity after teardown. The older cache-expiry cold
continuation retains its stricter complete-census rule. Cursor's estimated budget is not eligible; the Orchestrator
and Flash retain their existing continuity paths. Deferrals are logged once per session/reason.

Archive the note and durably mark its delivery pending before starting the new session. Clear that marker only
after submission. A failed first send or an app restart therefore carries the same immutable note on retry; an
unavailable note stops delivery rather than silently starting without constraints. Engine-start failure restores
the previous session metadata. Preparing/switching makes no model turn, new task, workflow event, or agent report.

Validation: manager tests cover ordinary Claude partial observations, pending and newly arriving questions,
running/unknown children, exact decisions and constraints, oversized/unavailable context, stable identity, and a
failed first submission followed by restart. Existing cold/handoff/storage tests cover the retained legacy paths.
No e2e runs are part of this branch validation.
