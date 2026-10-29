# 0182 — Task page: one strip per record, detail beside it

2026-10-29. Accepted. Supersedes the Task layout of ADR 0041 and issue #160 (tiles, section bar, stacked sections).

## Context

The owner (2026-10-29): "migliora di molto la sezione task deve essere molto più pulita e usabile con una striscia per
task o notifica mooolto più figa fammi dei mockup e delle proposte". Three mockups were shown (A one inbox, B grouped
cards, C list and detail); the owner picked C («preferisco la c»).

## Decision

pages/Task.tsx is a list of strips on the left and the selected strip's detail on the right:

- one strip per news, followed ticket, PR, review, work item and QA run: the kind's glyph in its tone, kind, time,
  title and one line saying what it is about (PR: who it waits for; work item: state and how long it is stuck);
- tabs Per te · Notifiche · PR · Work item · Test e QA (only with QA data) · Tutto; «Per te» holds what waits for the
  user (unread mentions, reviews, taken items and builds; own PRs waiting for the user with a red or amber reason;
  reviews asked; hot work items) and opens by default when not empty;
- the detail pane reuses the existing cards (news, PR, review, work item with description, comments and tests, QA run);
- J/K or arrows move, E marks the selected strip read; «Segna tutte lette» stays in the list footer;
- tiles, the section bar and the per-state groups are removed with their helpers (lib/tasks.ts byState, lib/qa.ts
  qaPeople, TaskQa QaSection) and their texts.

Under 900 px wide the detail goes under the list.

## Consequences

Same data, same reads (devops-me.mjs, zero tokens), no permission change.
