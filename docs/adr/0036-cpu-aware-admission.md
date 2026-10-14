# ADR 0036 · CPU-aware admission of agents' chats and turns

Date: 2026-10-13 · Status: accepted

## Context
With many chats the PC sits at 100 % CPU: the Regia opens work chats, chats write to each other, a restart resumes
every cut turn, and each start is a CLI process with its MCP servers (10-25 s of start-up, ADR 0025). The user:
"la Regia decide in base alla CPU, a costo zero, con una coda". Nothing may be refused, nothing running may be paused
or killed, and the user must never wait for their own messages.

## Decision
- **A queue in main, FIFO within two priorities** (`chats/admission.ts`, used by `ChatManager`). Before an agent's work wakes the machine
  it asks the queue: a new chat's engine (`app_create_chat`, `create(req, 'agent')`) or a message that would start a
  turn of an idle chat (`send` with `from` set: the Regia's `app_send_to_chat`, chat mail; or `resumed`: the app's own
  resume after a restart). Under the thresholds with nobody waiting it runs at once; otherwise it waits.
- **Work chats first** (2026-10-14, the user: "hanno sempre la precedenza le chat di lavoro rispetto a quelle
  dell'app"): the queued work of a chat on the app itself (space "Migliora l'app", or a title in an app area, `App · …`
  / `Pers · App: …`: `isAppChat` in `brain/routing.ts`, the same `APP_AREAS` as the routing) waits behind every other
  chat's queued work; within each group the order of arrival holds. It applies only while something waits (the machine
  over the thresholds): with the PC free an app chat starts at once, and there is no cap on how many app chats run
  together (the user chose "solo in coda", 2026-10-14: a cap would hold app chats back on an idle PC). Nothing running
  is paused; a key already waiting keeps its later messages in its entry and its place.
- **Load, zero tokens, no dependency:** CPU busy % from `os.cpus()` deltas sampled every 2 s, averaged over the last
  3 intervals (~6 s); free RAM from `os.freemem()/os.totalmem()`. Over = CPU > `loadQueueCpu` (default 75 %) or free
  RAM < `loadQueueRam` (default 15 %). `SB_LOAD_FORCE="cpu,freeRam"` fixes the load (e2e).
- **Admission with hysteresis:** while something waits, a sample every 2 s; two samples in a row under admit the head,
  one per sample (work chats first), then the count restarts (the started engine needs seconds to show in the load). A chat already
  waiting keeps its later messages behind its one entry, in order.
- **Never waits:** the user's own messages and chats (IPC `chat:send`/`chat:create`); a message to a chat in the middle
  of a turn (it joins the running work); the Regia's wake-ups and command results (`regia-wake.ts`, `run/results.ts`:
  app notices to the Regia, which must stay responsive); "Riprendi" and hand-off turns. A user's message to a queued
  chat runs the queued work first, then theirs. Nothing running is paused or killed.
- **Visible and overridable:** `ChatSummary.queued` (kind, position, load) → the tile shows "In coda · CPU X% · la
  prossima" with **Avvia ora** (`chat:admitNow`), the top bar counts the waiting chats; `app_create_chat` and
  `app_send_to_chat` return `queued (CPU X%, RAM Y% free, position N)` at once; `app_chats` has `queued` per chat and
  `app_state` a `queue` block.
- **Settings** `loadQueue` (on), `loadQueueCpu`, `loadQueueRam`, in Impostazioni → Chat. Protected: an agent turning
  the queue off would start its own chats ahead of the machine.
- **Interplay:** adopting the warm Claude engine (ADR 0025) is no new start (its first turn still asks the queue); no
  warm engine is started while the queue is busy (over the thresholds or someone waiting). The Job Object and orphan
  sweep (ADR 0026) are unchanged. A queued chat is never auto-closed; closed or archived by hand, its waiting work is
  dropped.

## Consequences
- The queue lives in memory: at quit what waits is lost. A cut turn (`working` persisted) still resumes on the next
  start (through the queue again); an agent's new chat that never started stays on the grid with its title only, and
  the Regia sees it in `app_chats`.
- A queued delivery that fails when it finally runs shows on the chat (`lastError`); the agent that asked got
  "queued" already.
- The sampler costs one `os.cpus()` every 2 s; the admission timer runs only while something waits.
