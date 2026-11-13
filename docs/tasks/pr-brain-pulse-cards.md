Title: feat(pulse): add isolated Battito jobs, cards and approvals backend

<!-- Reviewer handoff for the Battito implementation branch; UI work consumes its earlier contract commit. -->

Battito now has a digest-only one-shot path restricted to enabled, trusted, agent-authorized API engines and
Claude Code with no tools. Automatic fallback tries a usable API model before Claude; Codex/ACP report
`non ancora isolato`. Headless calls get a fresh empty working directory and bounded deadlines/output.
Agent runs retain actual engine, job, fallback and cost basis across reloads.

The editable, non-routable Battito preset owns scheduled cards and the Dashboard headline. A serial scheduler
claims slots durably; the persistent ledger admits up to three scheduled card runs and one manual refresh,
with independent 80/20 allocations of the default $0.25 daily estimate. Unknown costs remain explicitly unknown.
The headline uses the same agent, preserving legacy opt-out, model/effort and monthly spend. No previous API-only
headline timer runs alongside it.

Cards use scrubbed, bounded evidence with opaque citation IDs, strict JSON validation, TTL, dedupe and reference
revalidation. Save invokes the brain's mem.mjs only on a user click; Act sends to an already-open Orchestrator.
Learned rules and agent suggestions wait in a persistent approval queue. Demo handlers use in-memory fixtures.

Validation:
- TypeScript noEmit, touched-file ESLint, related unit tests, guard and diff checks (exact final results in handoff).
- Fresh-context correctness/security review: findings fixed, final review approved.
- Build and isolated hidden Electron demo IPC smoke: 2 cards → 1 after dismiss; 1 approval; runNow refused.
  Screenshot inspected at tmp/pulse-runtime.png. No live model calls, e2e suite, push or promotion.

Integration notes / limits:
- The Bacheca renderer, engine-choice labels, Settings UI for slots, Costi presentation and UI localization belong
  to the parallel UI branch. Remove the old headline model/effort controls there; Battito's agent version is now authoritative.
- Model output is a soft cap on Claude Code. Budget admission estimates do not guarantee a hard billing cap.
- No engine-specific live provider validation was performed; tests use fake transports.
- Act requires an existing Orchestrator. Unsupported maintenance approvals remain pending with an explicit failure.
- Learned rules currently append approved text to the agent's versioned instructions; integrating ADR 0069 skill
  know-how/trial UI and an agent-page per-job analytics read model remains follow-up work. Fallback/headline runs
  are excluded from the comparable baseline; their costs remain in the Battito ledger.
- The fresh preset may be deferred when the catalog is already at its hard capacity. No existing agent is evicted.

Contract checkpoint: 13cc0ae28920247261bebef0289bac6a1200b9f6. No renderer changes are included here.
