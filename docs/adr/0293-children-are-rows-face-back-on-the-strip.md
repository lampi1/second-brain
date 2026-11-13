# ADR 0293 · A delegated chat is one row like its parent; the role's face is back on the strip

Date: 2026-11-13 · Status: accepted, partly amended by ADR 0295 (point 1: the portrait and its dot became the role's little person) (owner, thread «Rifare la UI della Grindhouse», after ADR 0292: «voglio l'iconcina
nella strisciolina e che sia bella visibile», «le striscioline dei figli le voglio più discrete come quelle del
padre, sono troppo grandi rispetto alle altre») · Amends: ADR 0292 point 1 (the dot alone), ADR 0083 and the compact
card of 2026-10-22 (the delegated chat as a thread card)

## Context

ADR 0292 made a root strip one flat row. Under it the delegated chats were still cards: a border, a gradient, two
head lines, every step, the result box. A child was three to eight times as tall as its parent. The same ADR had
replaced the role's character with a dot; the owner wants the character back, well visible.

## Decision

1. A strip starts with the role's character (26 px on a root strip, 22 px on a child) with the state dot on its
   corner. Full screen keeps the character alone.
2. A delegated chat closed is ONE row, drawn like its parent: face, task, role, what it does now (the live step;
   once ended, the first words of its result), time and cost against the estimate (`StripMeta.tsx`, shared with the
   root strip), a pill only when words are needed, ↗ on hover. No card, a hairline under it, thin thread lines.
3. What needs the user stays under the row without opening it: a permission to answer, an error, a refusal, a
   stall, the depth limit.
4. A click opens the row in place: the steps, the result with its criteria, the changed-goal and queue notes, then
   the chat. Skills and model show in the open row.
5. The «Mostra i passi» button of a finished child and the tokens / «contesto pulito» line are removed: the steps
   open with the row, the cost is in the figures.

## Consequences

- A tree of five children takes about 200 px instead of about 650.
- A finished child's whole result is one click away; its first words are on the row.
- Animated characters by state were proposed to the owner (three variants); nothing of that is in this change.
