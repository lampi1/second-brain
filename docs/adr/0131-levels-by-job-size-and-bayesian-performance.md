# ADR 0131 · Levels by job size, a Bayesian performance, the Orchestrator's choices and Flash's answers

Date: 2026-10-22 · Status: accepted (owner approved: levels and performance must be "veramente ben studiata e
realistica"; maximum level 100, reachable only after very long real use) · Builds on: ADR 0097 (the Orchestrator rated
by its decisions), 0100 (XP = verified successes), 0105 (Flash), 0108 (the Strategist's plan), 0125 (every role levels
up from outcomes), 0130 (run receipts)

## Context
The owner saw that Flash and the Orchestrator never level up. What the code did:
- **XP = one per verified success**, the curve `5 × N × (N − 1) ÷ 2` (Lv 2 at 5, top Lv 50): a one-line lookup and a
  two-hour delegated build were worth the same, and the curve was neither quick at first nor long at the top.
- **Flash records no AgentRun** (a read-only quick lane, ADR 0105): it could never earn anything.
- **The Orchestrator** earned only from verified outcomes of the root runs it opened. With few user verdicts most of
  them rest on the receipts (ADR 0130), and two things lost them:
  1. *an Orchestrator's opinion hides the receipts.* `judge-sample.ts` records a receipts verdict only on a run with no
     outcome or the agent's own word, and only samples those; once the Orchestrator gave its opinion on a run
     (`agent_feedback`, basis `orchestrator-opinion`, very common), the receipts were never recorded, so neither the role
     nor the Orchestrator got the XP of a run whose tests passed after its last change;
  2. *a prune dropped the Orchestrator's receipts XP.* `rollUp` counted `decisionWins` from the user's or a review's
     verdict only, while the live standing also counted the receipts and chains: at a prune the Orchestrator lost them.
  On the frozen demo (every run started by the Orchestrator, 55–100% judged by the user) the Orchestrator did level up
  (Lv 5 with 73 verified successes): the demo hid both bugs, as it had no receipts.
- **Performance = weighted ratio** shown after 5 weighted verdicts: 5 successes read 100%, with no sense of how sure.

## Decision
1. **XP by the size of the job** (`agents/xp.ts`, pure). A verified success (the same rules as before: the user, a
   verified review, the receipts, a verified parent, a graded review; never the agent's own word, never silence) earns
   `1 + four signals`, each 0, ½ or 1 point: settled turns (3 / 8), working time (10 / 40 min of `executionMs`), files
   changed from the receipts (3 / 10), delegated child runs (1 / 3). Bounded 1..5. A signal a run did not record adds
   nothing: old runs count at their floor. A typical job (a few turns, 10–40 min, a few files) is 2–2.5 XP.
2. **The curve**: Lv L starts at `round(6 × (L − 1)^1.6)` XP, top Lv 100.

   | Lv | XP | at 10 XP a working day (≈ 4 verified jobs), 220 working days a year |
   |----|----|----|
   | 2 | 6 | about 3 typical jobs |
   | 5 | 55 | about a week |
   | 10 | 202 | about a month |
   | 20 | 667 | about 3 months |
   | 35 | 1 692 | about 8 months |
   | 50 | 3 037 | about 1.4 years |
   | 75 | 5 874 | about 2.7 years |
   | 100 | 9 358 | about 4.25 years |

   Titles: Recluta (1), Apprendista (2–4), Praticante (5–9), Esperto (10–19), Veterano (20–34), Maestro (35–49), Gran
   maestro (50–74), Leggenda (75–99), Mito (100).
3. **The Orchestrator's choices** (`standing.ts decisionSignals`), deterministic, from explicit events only:
   - *re-delegated*: a later run the Orchestrator started with `reworkOf` this run and **another role** (the first choice
     of role was wrong);
   - *reopened / reworked*: the user reopened it or a run explicitly reworked it within 7 days;
   - *the plan's fate*: a Strategist run records `AgentRun.plan { proposals, changes, approvedAt }` (`ChatManager.planPropose`,
     `planDecide`): approved with no change, after one or two, after three or more.
   A decision's XP is its job's size (its delegated chats included) when the job is a verified success, **halved** when
   re-delegated or reworked, plus **1 XP for a plan the user approved as proposed** (the user's own click); at most 5.
   The signals also enter its performance (source `decision`, trust 0.5): re-delegated, reworked or a plan changed three
   times or more = fail, one or two changes = partial, approved as proposed = success. No signal = no verdict.
4. **The receipts are no longer hidden** (the bug): `earnedVerdict` reads the receipts' own verdict (`receiptDecision`:
   a pass the report agrees with, or a failed check the report admits) on a completed run whose outcome is none, the
   agent's own word or an Orchestrator's opinion; the user's verdict and a review still outrank it. `rollUp` counts
   `decisionWins` with the same verified success as the live standing (the second bug).
5. **Flash's answers** (`agents/flash-outcomes.ts`, zero tokens, no prompt). Each Flash answer (the user's question →
   the turn's result) settles within 5 minutes: a correction («no, …», the correction tag) or the same question again
   (≥ 60% of the words both ways) is a **fail**; the same question in the user's next message to the Orchestrator (typed
   or «Fanne un lavoro») is a **partial** (Flash is meant to hand work over); otherwise it **held**: a success. Kept in
   `agent-runs.json` `flash`: question words only as FNV hashes, never text; at most 20 open answers, the last 300
   outcomes, totals beyond. A success is worth **0.25 XP**; its performance weight is **0.3**. Flash stays read-only and
   never delegable; it still records no run.
6. **Bayesian performance**: the weighted verdicts (same trust and 30-day half life; new sources `decision` × 0.5 and
   `quick` × 0.3) update a Beta(1, 1) prior centred on 50%; the card shows the posterior mean and its 90% spread
   (`±`, normal approximation). It stays "in rodaggio" below 5 verdicts or while the spread is wider than ±30 points.
   Five fresh user successes read about 86% ±20, never 100%.
7. **Migration, no loss, bounded.** `RunTally.xp` and `decisionXp` keep the XP of pruned runs; a rollup saved before
   counts each verified success at 1 XP (its floor) and merges cleanly. Rollups from before verdict schema 2 keep their
   counts but no quality, as before. The Flash log reads leniently (out of shape = a fresh log, never a refused file)
   and sits inside the same byte budget (a few tens of KB). A plan record out of shape is dropped, never the run.
8. **Diagnostic**: `npm run levels -- [<agent-runs.json>] [--dev] [--json] [--demo]` (`agents/level-diagnosis.ts`,
   `levels-cli.ts`, `scripts/levels.mjs`): read only, zero tokens; per role the counted runs, verified successes by
   basis, XP, the rollups, the Orchestrator's signals, Flash's answers, and why each other run earned no XP (no verdict,
   only its own word, only an opinion, an unverified or ungraded review, which link of a chain broke, the receipts'
   reason, not completed; open runs and headline one-shots left out).

## Consequences
- Levels move by real work: a quick role (Scout) climbs slower per job than an Artisan doing long builds; the busiest
  role (the Orchestrator, rated on every root job) levels fastest; Lv 100 is years away.
- The Orchestrator earns from the receipts of its decisions, from plans the user approves and loses from bad routing.
- Flash gets a level and a performance from a proxy, deliberately weak: low trust, small XP, a 5-minute window.
- The performance says how sure it is; a role with a few verdicts reads "in rodaggio" longer, an idle role drifts back
  towards wider spreads as its verdicts age.
- On the frozen demo (now with receipts, plans, children, two re-delegations and Flash answers): Orchestrator Lv 9
  (174.5 XP, 85 verified successes: 64 the user's, 21 receipts), Artisan Lv 7, Scout and Strategist Lv 3, Flash Lv 2,
  Herald Lv 1 "in rodaggio".
