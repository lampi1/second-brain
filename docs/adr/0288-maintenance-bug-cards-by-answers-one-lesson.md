# ADR 0288 · The maintenance stays on the click: app-bug cards follow the user's answers, a report notes one lesson

Date: 2026-11-13 · Status: accepted (owner, thread «Preparare la 1.0 con analisi profonda», card «Scegli come deve
partire la manutenzione»: «Resta al clic, con due correzioni») · Amends: ADR 0153 (the click stays), ADR 0258 (the
quality bar), ADR 0129 (the worth gate of a lesson)

## Context

The report proposed a nightly zero-token pass. Counted again on the owner's data before building it:

- 183 research cards. 79 are app bugs: 61 made with zero tokens from a new group of log lines (54 approved, 7
  rejected), 18 by the research (17 approved). His decisions on issue cards: 41 approved, 2 rejected. For him the bug
  cards are wanted; a user who is not a developer of the app has no use for them, and nothing stopped them.
- Lessons (`agent_report.remember`, `memory_propose`): 447 lines in four days from 242 runs (67 with one line, 145
  with two, 30 with three), all for the role's own skill, none ever noted twice (not even at a loose 0.4 word
  overlap), 200 waiting (the cap), about one skill change per Maintenance. The log shows «oldest noted lessons
  dropped» 66 times in one day.
- In a month of his chats 51 reports were refused whole because their lesson line was tied to one case (a branch,
  an id, a date, a path): the agent wrote the report again for a line nobody had asked for.

The owner chose: the maintenance stays on the click; app-bug cards only when they serve who uses the app; fewer
useless lessons.

## Decision

1. Nothing starts by itself: no nightly pass (ADR 0153 stands).
2. App-bug cards follow the user's own answers (`proposals/policy.ts issueCardsWanted`): when the last 5 decisions
   on issue cards in 90 days hold at most 1 approval, the maintenance makes no app-bug card (neither the zero-token
   ones from the logs nor the research's: `maintenance_propose` refuses the kind and the research's frame says so).
   An app idea still passes. Fewer than 5 decisions: cards as before. Old decisions leave the count after 90 days,
   so the cards come back by themselves.
3. A report notes one lesson, not three (`REMEMBER_MAX = 1`): further lines are left out with a warning. The tool's
   description and the role's text say that most runs teach nothing and that the line is for a wrong turn or a
   search the next run would be spared.
4. A lesson line the worth gate refuses is left out with its reason in `warnings`; the report is accepted.

## Consequences

- The owner keeps his bug cards (41 approvals of 43); a user who turns five down stops seeing them for three months.
- Fewer lessons is expected, not measured: the effect of the new wording on a real model is a hypothesis. To read
  after a week of use: lines noted per run (was 1.85) and «oldest noted lessons dropped» in the log.
- A case-specific lesson no longer costs a second report.

## Rejected

- A nightly zero-token pass: the measured need was not there (the click is used, the cards are approved).
- Asking at least two log lines before a bug card: he approved the single-line ones 4 times out of 4.
