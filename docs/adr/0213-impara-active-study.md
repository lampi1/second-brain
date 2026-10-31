# 0213. Impara: exercises and an oral exam

Date: 2026-10-31. Status: accepted.

## Context

The owner (2026-10-31): Impara is good to look at but «manca una parte in cui l'utente deve fare qualcosa, anche
interrogazioni a voce». The Studio (ADR 0205) made things to read or listen to; only «Mettimi alla prova» asked the
learner something, by writing.

## Decision

- Two new Studio tiles, first in the column with «Mettimi alla prova»: the three where the learner does the work
  (`StudioLive` in shared/lesson-studio.ts). They have no run of their own: each starts a session of the tutor in its
  own mode (`TutorMode` 'practice' and 'oral', shared/lesson.ts; prompts in main/learn/prompt.ts).
- «Esercitati» (practice): one exercise at a time that makes the learner do something (solve, apply to a new case,
  compute, find the mistake, write code only for a code lesson); the answer is corrected, a short model solution
  follows, then the next exercise, harder or simpler.
- «Interrogazione a voce» (oral): turns on the app's voice and «Rispondo a voce»; the tutor's text is written to be
  read aloud; what the microphone hears while the session is open goes to the tutor as the answer, even when short
  (ImparaPlayer onHeard); after five answers, or «Dammi il voto», the tutor gives «Voto: N su 10» and what to review.
- The tutor's row says which session is open and how far it is («Domanda 2 di 5», «Esercizio 3»). A tile pressed while
  an answer still streams starts its session when that answer ends; the start is consumed once (it used to be sent
  again each time the tutor tab remounted).
- These sessions leave no review card, like the quiz.

## Consequences

One tutor run per answer, as before; no new storage. The mark is the model's judgement against the verified facts, not
a test score.
