<!-- Battito implementation addendum for maintainers; supplements the design on docs/brain-pulse. -->
# 0070 — Battito v0.1.0 isolation decisions

Date: 2026-10-18. Supplements ADR 0070 at `25e76d5` on `docs/brain-pulse`.
The coordinator supplied these implementation decisions on 2026-10-18.

- Automatic fallback is restricted to eligible API engines, then Claude Code with no tools.
  Codex, Cursor and other ACP engines remain unavailable for Battito, with the reason
  **non ancora isolato**, until their digest-only isolation is proven. They remain usable for ordinary chats.
- Every CLI one-shot uses a fresh empty per-run folder under userData/oneshot. For these two
  eligible transports the earlier home/brain denyRead requirement is dropped: no tools are
  exposed, no MCP endpoint is supplied, hooks are disabled, and permission requests are refused.
  This exception does not change comparison runs or other adapters' denyRead checks.
- The editable Battito preset uses a Sonnet-class model at low effort. Its card job has three
  daily slots while the app is open; its headline job shares the $0.25 daily budget.
- One Bacheca has Per te and Da approvare sections; each card shows its actual engine, and no
  popup is introduced. Proposed changes wait for explicit user action.

The first implementation checkpoint exposes only typed IPC and unavailable handlers. It does
not start model calls or claim that the complete feature is ready.
