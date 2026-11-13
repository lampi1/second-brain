<!-- Stage-two process-boundary design and measured budgets; implementation and independent review ledger, not a completion claim. -->
# Agent runtime boundary

Status: in progress. The utility host must not replace the production session factory until permission consumption,
checkpoint ordering, durable shutdown and all supported adapter paths have parity evidence.

## Baseline measured before extraction

Windows x64, built main at `19a37a84` plus the instrumentation working diff. No installed engine or model was called.
The controlled workload is 12 new sessions × 2 sequential turns × 4 adapters (Claude, Codex, ACP, mock HTTP).
The replay explicitly answers the full app's auxiliary Claude usage polling and ACP preference requests, while
retaining strict matching of all recorded turn requests and recorded fixture hashes.

The first complete capture (`runtime-before.json`) had 96 operations, main event-loop p99 94.503 ms and 1,947 IPC
events. It did not observe DOM changes; do not compare it to a workload with expanded conversation tiles.

The final observation (`runtime-before-final.json`, schema 2, and its `.cpuprofile`, external evidence) expands each chat
before sending and observes its first nonempty assistant DOM node and the following animation-frame opportunity.
The frame is not a GPU-presentation timestamp. All 96 operations and all 96 DOM samples completed. Milestones use
the shared system epoch clock at 1 ms resolution; Node and Chromium performance time origins are not assumed equal.
An earlier expanded-tile capture had p99 88.277 ms; a subsequent smoke rejected one of eight timestamps, so the
cross-process clock contract was corrected and the full baseline recollected. No sample is clamped to zero to pass.

| Metric | p50 | p95 | p99 | Maximum |
|---|---:|---:|---:|---:|
| Main event-loop delay (ms; histogram resolution 10 ms, 3,216 samples) | 14.909 | 44.270 | 103.612 | 165.151 |
| First text IPC receipt → DOM mutation (ms) | 13 | 20 | 31 | 31 |
| First semantic text → DOM frame opportunity (ms) | 28 | 37 | 53 | 53 |

Main CPU: 9,109 ms user + 18,875 ms system. RSS: 178,130,944 → 202,272,768 bytes (endpoints, not peak).
Main→renderer: 1,976 events, 1,521,503 JSON bytes. Machine CPU samples are captured per session; this is uncontrolled
ordinary activity on the owner's machine, not generated load. The complete profile records 57,617 ms, 17,707 ms busy;
self time: spawn 3,403 ms, rename 3,274 ms, open 1,883 ms. The dominant inclusive emitter path costs ~7.9 s. The earlier
expanded-tile profile resolved emitter → observe → persist → writeLocalText (~6.1 s). Stage-three persistence
integration matters to p99; moving only parser code is insufficient.

## Quantitative budgets for the same expanded-tile replay

- Main event-loop p99 must improve below 88.277 ms (retain the stricter initial budget despite the final 103.612 ms);
  record machine CPU samples and do not attribute a less-loaded PC
  to extraction. Report p50/p95/p99/max rather than suppressing outliers.
- First semantic text → DOM-frame p99 must stay ≤69 ms (final baseline plus one 16 ms batching interval). First text
  is dispatched immediately, never held for that interval.
- Each engine/temperature group's send→transport-write and send→first-text p95 must stay within baseline +16 ms;
  the baseline JSON has each group. Cold startup is separately reported, never hidden in warm samples.
- Per session: at most 256 pending RPCs, 256 retained semantic items / 1 MiB of serialized queued events, at most
  64 events / 256 KiB per batch. Overflow fails explicitly; it never silently drops permission or result events.
- A single protocol event above 256 KiB is refused explicitly until a bounded chunk/reassembly path exists.
  This is an unresolved compatibility requirement for large valid tool/report payloads, not a new product limit.
- No dispatch timeout or process death triggers automatic retransmission. A dispatched operation without a reply
  is `uncertain`; work that was never sent is `not-dispatched`. Neither is successful completion.

These are diagnostic acceptance budgets, not flaky wall-clock unit assertions. There is no after result yet.

## Ownership and authorization

The eventual app-owned `utilityProcess` owns adapters, parsing, stream assembly, admission, checkpoint I/O and
runtime persistence. Main owns sender-checked renderer IPC, windows, MCP/trust binding, keys, permission decisions,
JobGuard and supervision. API requests are brokered in main against the pinned engine definition; keys and headers
never travel to the host. Broker replies must match protocol version, host epoch, session generation and operation ID.

Each session generation has a monotonic command sequence. Duplicate commands do not execute again. A fresh host
has a fresh epoch, so its sequence reset cannot authorize old messages. A session replacement fails outstanding
requests; late old replies are inert. Side-effecting operations are not replayed after uncertain transport failure.

Semantic items preserve original order. A first item is immediate; only adjacent replacement snapshots of that
same item may coalesce. Pending requests, results, errors, state boundaries, cancellation and close flush earlier
items before delivery. The batching interval is 16 ms with bounded buffers; each session has its own batcher.

## Integration dependency on stage three

`manager-requests.ts` currently expects `HarnessSession.answer()` to be synchronous, including policy answers and
away answers. Its owner must change every consumption path to await an exact runtime acknowledgement before
recording consumed permission/decision receipts. The phone provenance flag must survive until that acknowledgement.
Timeout leaves explicit uncertainty and must not retry. A boolean returned at enqueue time is not consumption.

The execution owner must not edit stage-three owned `manager-requests.ts`, `manager-work.ts`, `agents/runs.ts`,
`runs-db.ts`, `workflows/service.ts`, digest or receipts. No factory switch is safe before this shared change is
integrated and verified. The checkpoint first-write barrier must also cross as a named operation, never a Promise
serialized in session options; Codex/ACP retain snapshot-before-send (ADR 0228).
