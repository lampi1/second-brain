# ADR 0109 · An evidence claim on every brain change, and the Apprendimento page

Date: 2026-10-21 · Status: accepted (owner, 2026-10-21: issue #127, «Evidence layer, the rest of the report's move 12»)
· Builds on: ADR 0104 (intervals, checkpoints, one primary metric), ADR 0077 (the change log) · Amends: nothing

## Context
ADR 0104 put intervals and checkpoints on the role trials only. The maintenance jobs (ADR 0077) change skills, rules,
memory and roles by themselves; those changes became active at once and were never measured. The 2026-10-20 analysis
(move 12) asked for each of them to carry a hypothesis, one metric, a frozen baseline and a verdict at fixed
checkpoints, and for one page that shows the real progress without levels.

## Decision
- `brainmodel/evidence.ts`. Every `BrainChange` gets a `claim`. The metric is one, the user's corrections per run
  (`AgentRunCorrections`: tagged corrections plus reopens after a report). It is the most frequent signal and the
  user's own word, never a model's. Success rate stays the trials' metric (ADR 0104); at one person's volume it is too
  rare for single changes.
- The hypothesis comes from the action. A create, update or link should lower the corrections («fewer»). A merge,
  removal or unlink should not raise them («not-more»: tidying, not teaching).
- What a change is measured on is sealed when it is recorded (`ChangeLog` `seed`): a role change on that role's runs,
  a rule on every role's, an agent's memory file on that agent's, other memory on every role's. A new or updated skill
  is measured on the runs that loaded it (`AgentRunTags.skills`), within the roles that declare it, or every role when
  none does. An update or merge compares with the runs that loaded it before too. A removed skill uses its former users'
  runs. Entries recorded before this ADR are sealed with the roles of the moment they are first shown.
- The baseline is the scope's newest 40 runs that ended before the change, frozen. The after side counts runs started
  after it until it is undone. Only chat runs that ended with corrections counted are used (older runs: unknown, never
  zero).
- A verdict comes only at the checkpoints of `shared/evidence-stats.ts`: each side is judged on its first 20, 40, 80 or
  160 runs, with a seeded 90% bootstrap interval of mean(after) − mean(before).
  - «aiuta»: the interval is below zero.
  - «peggiora»: the interval is above zero. The change is shown with its Annulla, never undone silently.
  - «nessun effetto»: the interval is inside ± max(0.1, a quarter of the baseline mean), or there is still no verdict
    after 160 runs.
  - «annullato»: the change was undone.
  - «in raccolta» otherwise, with the runs counted toward the next checkpoint. A baseline under 20 runs never gets a
    verdict; the page says so.
- The page «Apprendimento» (Andamento, G J) has four parts. First, the counter: beneficio provato, senza effetto, in
  raccolta, peggiora, annullati. Second, the changes that worsen things, each with Annulla. Third, per role, the
  corrections per run of the last 12 weeks, with the changes on its runs as markers. Fourth, every change with its
  hypothesis, scope, numbers and interval. The maintenance panels of Skill, Regole and Memoria show the same claim
  line under each change. No tokens: everything is computed in main from `agent-runs.json` and the change log.

## Consequences
- Most changes will read «in raccolta» for weeks. That is the honest state of one person's data (ADR 0104: about 150
  runs a side are needed to see +15 points of success).
- Changes that overlap in time share runs. A verdict is about the period after the change, not proof of one cause. The
  page says this under the list.
- Not done here: a per-mechanism verdict (all lessons together), the reviewer's calibration against the facts, a
  held-out replay bench at night (ADR 0104, Consequences).
