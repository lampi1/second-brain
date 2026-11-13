# 0189 — Impara: subjects, verified review cards, spaced review

Status: accepted. Builds on ADR 0185 and ADR 0188.

2026-10-29.

## Context

The owner, 2026-10-29, on Impara: it must be ideal for learning, "con anche una sorta di ripasso a quiz su ogni materia".
A lesson read once fades; the checks inside a lesson were answered once and never came back. Retrieval practice spread
over time is among the techniques with the strongest evidence in Dunlosky et al. 2013 ("practice testing" and
"distributed practice", the two rated high utility); mixing related problems instead of blocking them by type helped in
Rohrer & Taylor 2007 ("The shuffling of mathematics problems improves learning").

## Decision

**Subjects.** Every lesson belongs to a subject. The plan run picks one among the user's subjects (listed in its prompt)
or names a new one of 1 to 3 words; with none, a PR's lesson takes its repository's name and any other «Generale». The
user moves a lesson to another subject (or a new one) from the subject chip on its card; its cards move with it. The
lesson list filters by subject.

**Cards, verified.** A finished lesson leaves review cards:
- each of its checks, at once and at zero tokens (also the ones an extra piece adds);
- the cards one more short run writes (`impara-cards`, the lesson's teacher, medium effort) from the lesson's **verified
  facts only** (ADR 0188; the unconfirmed ones are not offered), one idea per card, asking how and why rather than trivia
  (Wozniak 1999, "Effective learning: Twenty rules of formulating knowledge"). Each card must cite at least one of
  those facts by id, else it is dropped (`parseCards`); a node card must name a node of the lesson's diagram. Kinds:
  **recall** (answer in your head, then «Mostra la risposta» and grade yourself), **choice** (3-4 options, may ask to
  predict an outcome or complete a piece of code) and **node** (click the part of the lesson's diagram that answers).
  A lesson with no verified fact keeps only its checks. A failed cards run shows «Riprova» at the lesson's end; a lesson
  finished before cards existed shows «Crea le carte» there.

**Scheduling: FSRS.** Each card has a memory state (stability, difficulty, due date) updated with FSRS, the model Anki
ships, with its 19 default weights; formulas as in Borretti, "Implementing FSRS in 100 Lines" (2025). The next review
falls when the predicted chance of remembering drops to 90%. Grades: forgot, hard, good, easy. A wrong choice or node
answer, or «Non lo so», counts as forgotten; a right one asks how it felt (hard, good, easy); recall offers all four. A forgotten card
comes back once at the end of the same session and tomorrow at the latest.

**Sessions.** «Ripassa ora» on Impara's start: the due cards (the least likely remembered first) and up to five new ones. New
cards come only from lessons the user read to the end (a lesson just written never quizzes its reader blind).
A subject's «Quiz»: its due cards, its new ones, then the ones least likely remembered, ten at most. Both are
interleaved by lesson (no two cards of the same lesson in a row while another lesson has some). A session is full screen
like a lesson (Esc leaves it), one card at a time; after the answer: why, and the verified facts the card stands on with
their sources (a web page opens in the browser, a file in the app's viewer). Each grade is saved at once.

**Honest mastery.** A subject's tile shows its lessons, its cards, how many are due, and "memoria stimata oggi: N%": the
FSRS estimate of recall today averaged over the cards reviewed at least once, said as an estimate in its tooltip;
«mai ripassata» until one is. No invented score, no percentage of right answers presented as mastery. The start also
shows days in a row with at least one review.

## Storage

`userData/learn/review.json` beside the lessons (only on this PC, like them): the cards with their memory and the last
3000 reviews. A removed lesson takes its cards away. A file that cannot be parsed is moved aside (`review.json.bad-<time>`),
never overwritten; a read error other than a missing file is not taken for an empty review. IPC `impara:queue`, `impara:grade`, `impara:subject`; the summary
travels in `ImparaState.review`. Code: `shared/review.ts` (FSRS, parsing, queues, summary), `main/learn/review-store.ts`,
`main/learn/service.ts`, `renderer/components/impara/ImparaReview.tsx` and `ImparaReviewHome.tsx`.

## Consequences

One more short run per lesson (cards). The FSRS weights are the defaults, not fitted to the user's own reviews; fitting
needs many reviews and is left for later. The demo seeds two subjects, two due cards and one new; the cards and their
grades were tried on the demo, not yet on a real model.
