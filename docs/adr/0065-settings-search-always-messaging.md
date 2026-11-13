# 0065 — Search settings and keep cross-engine messaging available

Status: accepted (owner request, 2026-10-16). Supersedes ADR 0046's cross-engine transport switch only.

The settings page has enough options to need local search. Search matches words in section titles, labels and
descriptions, ignoring case and accents. Matching sections retain their existing layout. Hidden sections stay
mounted, preserving unsaved routing and key drafts; input values are not indexed. Results include routing and
asynchronously loaded settings, with a live status, clear button, Escape and a useful empty state.

Chat engines can always exchange messages. Remove the cross-engine switch from the UI and settings schema.
Keep the legacy Settings.messaging.crossHarness field as true for compatibility, normalize saved false values on
load and persist the normalized value with an explicit migration log. Old callers supplying false cannot block
transport. Engine availability, trust, agent launch controls and action approvals retain their existing behavior.

The app no longer treats crossHarnessMessages in brain-settings.json as a live switch. At product startup an
explicitly logged one-way migration changes only a valid false to true, preserving other keys and accepting BOM
and UTF-16. Missing settings stay missing; unreadable settings stay intact with an explicit warning. This keeps an
older installed inbox working until its normal template update. The distributed inbox ignores that retired key,
including false and unreadable legacy files. No personal operating tool is silently replaced. Delivery timing
(regiaMail), sender identity and reply hop limits remain in place. Development/tests use synthetic folders only.

Validation: migration and policy regression tests, app-control integration, distributed inbox offline tests, search
unit coverage and hidden dev inspection. Updated settings e2e coverage is written on the branch and first runs on
main after integration, as required by AGENTS.md. No promotion or active-instance restart is part of this change.

## Scoped Codex autonomy

`codexAutonomyRoots` is an empty-by-default protected setting containing explicit existing repository/worktree
paths, canonicalized when the user saves them. A matching chat uses `never` with `workspace-write`, its matching
root only and no additional network access. Sibling prefixes, unselected worktrees, unreadable paths and replaced
junctions do not acquire consent. Read-only runs stay read-only. No personal CLI config or machine policy is edited.
Autonomous turns explicitly exclude implicit TMPDIR and /tmp writable roots; otherwise those sandbox defaults
would grant paths outside the selected repository. Normal on-request sessions retain their standard temp policy.

The adapter returns the selected approval/sandbox options and sessions propagates them. A live provider resolves
them again at every new turn, including revocation. `turn/steer` leaves the active turn's policy alone. A pending
approval is never answered automatically. Default sessions remain `on-request`; managed-policy failures remain
explicit errors rather than a fallback to full access. App Server's RPC enum spellings are camelCase; CLI `-c`
values remain kebab-case. Sources: https://learn.chatgpt.com/docs/app-server and
https://learn.chatgpt.com/docs/config-file/config-reference (read 2026-10-16).

This implementation is prepared in a writable validation snapshot. Its CodexSession bridge must be reconciled with
the MCP handler owner's in-flight changes before applying it. A running release needs the normal tested build
activation before it has this feature; after that, changing the selected roots applies on the next turn without
restarting chats. Chats whose cwd is outside the selected roots retain their original policy. The setting cannot
retroactively grant permissions to this development session, and it is not enabled by the patch itself.
