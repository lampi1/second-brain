# ADR 0314 · Every helper at the bench, the ones at work first, and a limit that says what it means

Date: 2026-11-15 · Status: accepted (owner, thread «Proporre nuova Grindhouse e Orchestrator», 2026-11-15: «Non capisco
questa cosa del limite di 5 figli. e perchè se io volessi scorrere tutti i figli dovrei poterlo fare e vorrei vedere
quelli in attività per primi») · Amends: ADR 0312 (point 2: up to five helpers and «+N»; the limit chip)

## Context

A double bench showed five helpers and «+N», which opened only the first one hidden: with 11 children most of the team
could not be seen from the bench. The order was the tree's (depth first), so a finished child could stand before one at
work. The foot's chip «Limite: 5 figli in corso» stayed for good once a delegation had been refused, and said nothing of
what had happened.

## Decision

1. **All of them** (`BenchKids.tsx`, cap 40): every open chat under the bench stands at it, in one row that scrolls
   sideways when it does not fit (the wheel, the trackpad, or a thin bar shown under the pointer); a side with more to
   see fades out. «+N» is gone.
2. **At work first**: at work, starting, queued, waiting for someone or between two turns, then failed or refused,
   then the rest; the tree's order
   inside each group. A short stop (run → wait or stall → run) keeps its place.
3. **One name tag for the row**: the tag of the helper under the pointer or the keyboard is drawn in the row's frame (a
   portal, with the helper's own held state), placed again when the row scrolls or resizes, and kept inside it, so it is never cut at an edge. A helper takes the focus and opens its chat with Enter; a click on the
   person stays a pat or a whack (ADR 0297).
4. **The limit says what it means**: «Max 5 insieme» (it asked for more sub-agents at once than allowed), shown only
   while something under the bench is at work; under the pointer: the app refused that delegation (the whole call) and told it to wait
   for a result of one at work, then it delegates again itself; the number is in Settings → Roles and delegation.
   The open chat's team line (`DelegationCard.tsx`) carries the same explanation.

## Consequences

- The tag is not in the DOM until a helper is hovered or focused (e2e hover first).
- Untried on the owner's real PC.
