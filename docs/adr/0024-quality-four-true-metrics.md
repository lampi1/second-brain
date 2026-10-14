# ADR 0024 · Qualità: four true metrics, each with its source; /api/quality answered by main

Date: 2026-10-13 · Status: accepted

## Context
The user, 13/10: "la sezione qualità sia veramente utile e veritiera". An audit of the old page found: the error count
included 15 unreadable rows; "Errori per tipo" had 95 labels for 11 official types (48% off the list), so its
percentages meant nothing; errors per day tracked logging habits (backfill before 7/10) and not the workload; "20 regole
su 24 hanno fermato il loro errore" was a heuristic shown as a fact (16 rules were 6 days old or less); praise had 3
days of data and a bug (data "positivo" vs UI "pieno"); notebooks had 0 points; measures stopped on 6/10 and missed
Cursor; the bug list was a bulk import of 30/9.

## Decision
- **Four numbers, each saying its source and the days it covers**, with the next step: (1) errors the user had to
  catch himself per 100 turns: ai-errors.md "visto da: <owner>" ÷ the app's finished turns ('turn done' / 'cursor turn
  done' in its own logs), only over the days the logs cover (14), and the page says the turns miss chats run outside
  the app; (2) errors back after their rule: same official type (near-duplicate labels mapped to the 11 types in the
  brain's recurrence.mjs ALIASES, never guessed) and an area sharing a word, within 14 days; rules younger than 14 days
  are "troppo presto"; rows out of the count (unreadable, no valid type) are said on screen; (3) his active PRs held by
  a failed build, a Failed/Blocked linked test case or a negative vote (the DevOps page's last read); (4) his resolved
  bugs sent back to an open state (the brain's read-only ops/tools/bug-reopen.mjs, work item updates; Resolved → Ready
  for Pilot is a step forward, not a reopening).
- **Praise, notebooks, measures and the bug list are gone** until they have real data; proposals are one row.
- **/api/quality is answered by main** (`brain/quality.ts`), mounted on the brain data proxy (`brain.serveApi`): turns
  and the DevOps state live in the app, not in the brain. Same path allow-list, no child, no new IPC channel.
- **bug-reopen.mjs runs in the background** at most every 12 h, only while DevOps reading is on, 10 minutes apart after
  a failure; its last result is cached in userData/quality-reopen.json. Read-only: one WIQL, one workitemsbatch, one
  GET of updates per bug (≤ 200).

## Consequences
The numbers are smaller and less colourful, but each can be checked against its file. The first metric is an upper
bound until every chat runs in the app. The ALIASES table is a list to keep short: a new label belongs in ai-errors.md
as one of the 11 types, not in the table.
