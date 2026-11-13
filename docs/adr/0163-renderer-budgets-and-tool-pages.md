# ADR 0163: bounded renderer histories and agent tool pages

Status: accepted. Date: 2026-10-26.

## Context and evidence

The owner reported stuttering, roughly one renderer core and multi-GB memory in a large session. A hidden Electron harness (`scripts/profile-renderer.mjs`) drives 64 synthetic worker chats, 16 concurrent streams, an Orchestrator composer and repeated 620 KB routine / 255 KB automation snapshots. It records main-renderer cumulative CPU, V8 profiles, post-GC heap, long tasks and key-to-paint latency. No real brain, provider or deployment is used; this is a load profile, not the E2E suite.

The first 120-second profile consumed about 53% of one core. The largest application JavaScript hotspot was `actionSteps` and its folder/path formatting: every collapsed strip formatted all retained tool calls on each assistant chunk, although it displayed only the final action. This run did not reproduce the owner's 450 ms input p95 or 4 GB heap; it is evidence of a hot path, not proof of the entire Windows incident.

## Decisions

- Collapsed strips scan backwards for the final contiguous action group, preserving plan/action priority and all existing grouping semantics. Full delegated cards retain the full-history formatter.
- The renderer keeps the existing 600-item transcript tail, preserving prose, reasoning, artifacts, ordering, prompts and MCP receipts. Raw shell/file tool outputs share a 1 MiB UTF-16 preview budget per chat; opening a tool row reads that original output on demand, with loading/error/retry states, and closing it releases the full output. The projection runs before IPC and in the live reducer. A preview copies its text so V8 cannot retain a large backing string. Existing callers without limits retain their original API behavior; durable transcripts and user data formats do not change. This is a raw-output cache budget, not a process RSS guarantee: prose, tool inputs, reports and explicitly opened full outputs remain intact. Review rejected byte-based item eviction because it removed question evidence and could reorder late tool completions.
- Whole routine IPC snapshots reuse equal JSON subtrees. Workspace, sidebar and focus routing subscribe to run bindings rather than all definitions and automation activity. Every field, including revision and brain context, remains checked; no authorization decision trusts a cached revision.
- Agent-facing routine list tools return compact, owner-scoped pages. Definitions, drafts and runs are explicit selections with SHA-256-pinned JSON text chunks. Automation rules default to their calling Orchestrator, with explicit cross-owner discovery; event payloads remain private. All flow/automation tool results are bounded to approximately 40,000 serialized characters. Oversized read results (including match, lessons and dry-run commands) have digest-pinned continuation chunks; mutation receipts are compacted without repeating the mutation. Instructions explain pagination and viewer reports.
- `show_ui brief` includes a complete valid example, normalizes a single `done` string to a list, and collects shape errors before writing an artifact. Limits and unknown-key stripping remain unchanged.
- Task news/PR reads retry explicit transient transport failures at 1 and 3 seconds (three attempts total), with one quiet warning per refresh. Authentication/configuration errors do not retry. Shutdown and brain changes invalidate late results. Only reads retry, never writes.
- The existing log writer and log CLI already use UTF-8. A regression test round-trips an accented task title through JSONL and the actual CLI. Historical Windows mojibake has not been reproduced and is not heuristically rewritten.

No new dependencies, schema migrations, wider grants, releases or production operations. Profiling runs in an isolated cloud runner, not on the owner's working PC. The PR records comparable final measurements, fresh reviews, checks and remaining limits.
