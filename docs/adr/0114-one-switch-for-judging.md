# ADR 0114 · One switch turns on the judging of every run, with its daily cost

Date: 2026-10-22 · Status: accepted (owner, 22/10: "un toggle semplice nella schermata agenti «Abilita controllo livello
e performance», a ogni iterazione, con una stima del costo al giorno") · Supersedes: the daily review count of the
delegation settings (JudgeSampler `daily`) · Builds on: ADR 0100 (levels from verified successes)

## Decision
- The Agenti page has one switch, «Abilita controllo livello e performance» (`JudgingSwitch.tsx`), off by default
  (settings `judging`, `judgingSince`). Turning it on sets `judgingSince` to now: only runs that end after it are judged.
- On: every finished run of a work role gets an independent Sentinel review (`agents/judge-sample.ts`), at most two at
  a time, five seconds after the run ends; a review older than six hours is dropped as stale. Off: none, and the levels
  and percentages keep what was judged before.
- Beside the switch, the estimated cost per day (`judgingEstimate`): the runs per day of the last 14 days times the
  median cost of a review (or of a run when no review exists yet), with the basis it was computed on; no runs yet says so
  instead of a made-up number.
- The delegation settings no longer show the number of reviews per day.

## Consequences
- With the switch on, the cost of judging grows with the work done; the estimate is the user's only brake.
