<!-- Records the continuity, delivery and evidence decisions for maintainers and reviewers. -->
# 0110 — Conversation continuity, canonical results and honest evidence

Date: 2026-10-21. Status: accepted.

## Context

A follow-up could reuse a chat but reopen its old run, lose the next report and count a neutral question as a
correction. Root report delivery depended on volatile state and could spend an extra Orchestrator turn when
events were disabled. The review sample saw a short preview, and seven days without correction could be labeled
verified success. Role memory had neither project provenance nor explicit validity.

## Decision

Keep the visible conversation and model session when role and project remain compatible. Each new assignment
gets a distinct run and task version. `app_assign_task` names the conversation, expected version, role and project,
and distinguishes `continue`, `new-task` and explicit `rework`. Sources carry stable chat IDs; titles are display
labels. A role configuration change or independent Sentinel review requires a fresh conversation. Permissions
are never widened by reassignment.

Persist the complete canonical result with task ID, version, run ID, timestamp, output and criterion evidence.
Display root reports directly in the Orchestrator, with local expansion of their output. This display does not
require inference, including when app-news events are disabled. Child results continue to their responsible
parent for integration. Persist pending delivery before acknowledging it and retain failed deliveries for retry.
Delivery IDs deduplicate retries; restarting must not lose an accepted result.
CPU admission is not delivery: a child outbox is acknowledged only after the engine accepts the submission.
Delivery coverage, report-to-notice latency and unique synthesis batch counts use retained canonical runs.
Historical records without these observations stay unknown. A synthesis submission is not a completed model
turn, and display-only reports never add a synthesis batch.

Count completed execution separately from reported quality. A partial result can finish a plan step; it does not
prove every criterion met. The compact Plan view preserves the quality label and can expand its checklist.
Children name and link to their actual parent. Strategist asks the user for material missing information.

Only independent reviewed evidence or a human verdict is verified. No-correction observations stay proxies;
continuation links do not mean rework. Sentinel reviews the canonical output and evidence of the exact run.
Skill suggestions are captured at launch; legacy runs without snapshots are excluded from historical agreement.
Legacy aggregate quality counts with mixed provenance are not silently relabeled verified. Cost and usage data
remain available. Classifier coverage and inconclusive change measurements explain their limitations.

Memory proposals carry host-derived project/role scope and source run/event. Records retain dates, status and
supersession history. A proposed correction cannot invalidate a confirmed fact. Legacy files are preserved and
remain unverified; unknown scope is never silently treated as project scope. Recall selects complete relevant
records under a budget. The existing document BM25/vector/RRF search remains intact. Repeated task summaries
produce candidates outside active skill directories; duplication alone neither confirms facts nor globalizes them.

## Validation and limits

Deterministic fake-harness tests cover follow-up runs, explicit correction, full reports, restart delivery and
no-extra-turn display. Memory fixtures cover project isolation, contradictory proposals, supersession and legacy
preservation. Plan tests separate execution progress from quality. The branch uses light checks; Electron e2e
and screenshots run only after merging to main, as required by ADR 0027. No live model calls are needed.

Reported dollars are estimates from available engine usage, not actual subscription charges. Missing usage,
independent outcomes or historical snapshots remain unknown. Candidate creation is not automatic validation;
promotion needs independently reviewed examples and a relevant replay. Before/after observations on different
tasks do not establish causality, and this change makes no percentage savings claim.
