# ADR 0186 · Closing chats frees what they started; repeated work stops growing with the day

Status: accepted (2026-10-29, owner: "verso fine giornata va a scatti, o quando iniziano ad esserci tante chat attive va
a scatti, anche se dopo le chiudo").

## Context

ADR 0172 found that the freezes were the app's main process waiting for a PC kept busy by the agents' process trees
(2026-10-27: 44-45 claude.exe, 35-71 node.exe, CPU 78-100%). A read of the code on 2026-10-29 found what makes that
pile grow over a day, and why closing chats did not bring it down:

- **Engines' leftovers kept past the close.** An engine that ends while its chat goes on (model change, continuation,
  cold switch, an engine started while typing and never used, idle release) keeps its children (MCP servers, shells,
  a dev server) on purpose, and only `ChatManager.close()` reaped them. A chat archived with no engine running (the
  auto-close, the ✕ before its «Annulla» ran out, or after an idle release) never reaped them, and a pruned archive
  dropped the record with them. The Orchestrator and Flash never close, so theirs piled up all day.
- **One copy of every connector per chat.** The MCP gateway (ADR 0086) opens a connector's stdio process per chat and
  per server at the chat's first tools listing (every chat lists its tools at start) and ended it only after 10 idle
  minutes, at the window's priority.
- **The brain's tools at the window's priority.** `cost.mjs` re-reads every transcript changed today every few minutes
  (`usage.ts`), so its CPU grows with the day; it ran at normal priority beside below-normal engines.
- **Work that grows with history on the main thread.** `ChatManager.resultIndex()` walked every saved run (up to 5000)
  for every `summary()` (the auto-close tick asks it for each open chat every second) and every `updated()` (several
  per assistant message). Every assistant message with a context reading asked for a full `chats.json` write.

## Decision

1. Archiving a chat (by hand or automatically) reaps the tools of the engines it outlived, whether or not it has an
   engine now; pruning an archive reaps them before the record goes. The Orchestrator and Flash never keep an old
   engine's tools (they run no dev server of their own), and an engine started while typing that ends unused takes its
   tools with it (it ran no turn). A chat that goes on still keeps a dev server it started until it really closes.
2. A chat that closes (archived or removed) ends its connector processes at once (`McpGateway.closeChat`); a reopened
   chat opens them again at its next call. Connector processes and the brain's Node tools start below normal priority,
   like the engines; the update's build (the user waits on it) keeps normal priority.
3. The result index is rebuilt only when the runs changed (`AgentRunStore.revision`); which chat a run belongs to is
   checked when it is read. The context meter is saved at the turn's end, not with every assistant message.
4. `chats.json`'s synchronous checkpoint (write, fsync, read back) is named in the stall log
   (`chats.json checkpoint`), so the next stall log says whether it is a cause.

## Consequences

- Closing chats now lowers the process count right away; the end-of-day pile no longer depends on how chats were closed.
- `scripts/bench-soak.mjs` (new): batches of chats opened, used and closed, measuring the app at rest after each one
  (idle CPU, retained heap of main and renderer, DOM nodes, listeners, handles, typing lag, one streaming chat's cost).
  `scripts/profile-renderer.mjs` takes `--open`, `--archived` and `--orch-items` to profile an end-of-day state.
- Not changed: `chats.json` keeps the archived chats' rows (their reopen needs them); the continuation decisions and
  user events in it stay unbounded (the protected hand-off reads them, ADR 0083). The next stall log decides.
