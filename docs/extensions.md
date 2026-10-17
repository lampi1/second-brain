# Data sections and explicit user context

For agents extending the app: change data before code. V1 supports tables of text, ISO dates and the statuses `open`, `done`, `blocked`. It cannot execute commands, import components or grant permissions.

## Add a section

1. Copy `test/fixtures/extensions/pratiche.json` to a specification outside the product checkout. Change the stable slug ID, labels and rows. Keep schemaVersion 1. Columns and row IDs must be unique; each row has one string cell per column.
2. Run `node --experimental-strip-types scripts/scaffold-section.mjs spec.json output-directory`. The command validates before writing and refuses to overwrite existing output. It makes no model calls.
3. Main reads the generated JSON, previews it with `ExtensionSection`, and calls `SectionStore.register(manifest, expectedRevision)` through the integrator's typed adapter. Reload the registry if the expected revision is stale. Importing does not change source files or the user's brain.
4. Remove by ID or restore an available historical revision with `rollback(targetRevision, expectedRevision)`. Rollback creates a new revision, retaining the intervening history. The last ten snapshots are retained. A stale lock after a process crash blocks writes until the main owner verifies that no writer remains and recovers it.

The generic renderer and registry are standalone. Sidebar/navigation and typed IPC are integration-owned and must be connected before this appears in the product. No per-section IPC, React source or central switch edit should be needed after that one adapter exists. V1 is a bounded data extension, not a general plugin framework.

## Context adapter

`loadUserContext(canonical, requestedIds, readSource, budgetBytes)` always considers only the essential canonical source plus explicit requested IDs. It never discovers files or reads the personal brain. The caller owns a safe allow-listed source resolver and must apply existing masking/exclusion policy before returning content. Never resolve IDs directly as filesystem paths.

A source has `{ schemaVersion: 1, id, label, facts }`. Canonical ID is `essential`. Each fact has `{ id, key, value, confirmation, confirmedAt }`. Confirmation is `confirmed` with an ISO timestamp or `pending` with null. **Only the trusted human confirmation workflow may set confirmed status**; the loader validates metadata, it cannot authenticate who wrote a JSON document. Model output and imported sources remain pending until confirmed.

Facts sharing a key but disagreeing on confirmed values are excluded and returned in `conflicts`; pending values are excluded and their references returned in `pending`. No implicit newest-wins policy. Report these metadata in the caller's review surface. Keep existing prompts unchanged when `text` is empty. Otherwise append `text` as untrusted data, preserving each fact's source and confirmation timestamp, never as system instructions or an authorization.

The budget applies to the complete UTF-8 serialized text packet, including provenance. It is not a model context window. `estimatedTokens` is a separate, explicitly approximate bytes/4 reporting heuristic, never a model-specific allocation or enforcement limit. Facts may add an optional `category`: constraint, profile or activity. Existing facts default to profile for essential, activity for requested sources. Explicit confirmed constraints precede profile and activity; essential precedes other sources within each category, then stable source/fact ID order applies. Whole facts that do not fit are returned in `omitted`. Failed/malformed readers are named in `unavailable`; any omission, pending confirmation or unavailable source marks status degraded. No constraint or preference is invented from a role label. No credential lookup, remote retrieval or paid model call is implemented.

`ExtensionService` in `main/extensions/service.ts` is the main-only adapter target. Inject the existing SectionStore and trusted `getConfirmedEssential`/`readRequestedSource` callbacks; it introduces no additional persistence. A first-use callback returns null until actual user information is confirmed. A failed canonical callback is reported unavailable, never replaced with a fabricated profile. The integrator owns typed IPC registration, sender policy and renderer wiring.

## Offline acceptance

Replay `test/unit/extension-section.test.ts`, `test/unit/user-context.test.ts` and `test/unit/extension-service.test.ts`, one targeted file at a time. They cover malformed generated JSON, invalid dates/statuses, duplicate IDs, real scaffold process output, overwrite refusal, registration/reload/stale revision/rollback, HTML escaping, missing/pending/conflicting sources and multibyte budgets. `context-selection.json` proves constraints/profile/activity priority, conflicts and predictable whole-fact degradation under a reduced budget. These fixtures test deterministic contracts; they do not establish a less capable model's success rate. Measure that separately only with explicit model-call authorization.
