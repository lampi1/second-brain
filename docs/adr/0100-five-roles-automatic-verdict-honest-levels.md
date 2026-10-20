# ADR 0100 · Five work roles, a verdict from facts, honest levels

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20) · Amends: ADR 0083 (nine fixed roles), ADR 0097 (Router and
Judge in the Orchestrator's rules, the Orchestrator's level), ADR 0095 (what counts as verified), `docs/VISION.md` ("no
gamification")

## Context
- **Too many roles.** Nine roles (Orchestrator + eight) overlapped: the Router only sorted a batch of requests, which
  the Orchestrator can do in one turn by opening one chat per request; the Judge gave the independent verdict that a
  Sentinel already gives when it runs the checks (and a review's independence is its clean session, ADR 0091, which
  any role gets); the Scribe wrote documents and brain notes, a change like any other once Artisan has the brain-edit
  skill. Each extra role is one more card, one more set of permissions and one more choice for the Orchestrator.
- **The owner does not want to judge the work himself.** Success rates, trials, tier suggestions and the levels rested
  on the user's thumbs (or a verified review). Most runs had no verdict, so the numbers stayed empty or leaned on the
  agent's own word.
- **Levels counted volume.** A level grew with every ended run, failed or not, and the performance gave the agent's own
  report a weight of 0.3: a busy agent that failed often still levelled up. The owner likes a bit of game (Recluta …
  Leggenda), but not on volume or self-assessment.

## Decision
1. **Five work roles + the Orchestrator** (`shared/roles.ts`): Strategist, Scout, Artisan, Sentinel, Herald. Router,
   Judge and Scribe are retired (`RETIRED_ROLE_IDS`, successor: router → orchestrator, judge → sentinel, scribe →
   artisan). Launches: Strategist → scout, artisan, sentinel, herald; Artisan → scout, sentinel; Sentinel → scout;
   Herald → scout. Sentinel verifies by running checks and, when nothing can be run, gives an independent verdict on
   the evidence, always in a clean session; Artisan writes documents and brain notes with the brain-edit skill.
   The Orchestrator's fixed rule: several independent requests → one chat per request, opened by itself in the same
   turn (parallel `app_create_chat`); an independent verdict → a sentinel chat only when a report is not verified, the
   change is large (more than about 100 lines) or it touches security, contracts or IPC.
   **Data compatibility**, never a crash on load: a retired profile in `roles.json` is left out (its successor has its
   own); a launches list, also in a stored version, drops a retired id; an untouched pre-0100 default text moves to
   today's (`role-migrate.ts fiveRolesTextFor`, a version "Cinque ruoli di lavoro (ADR 0100)"), and the Orchestrator's
   frame maps the old delegation line (`RETIRED_LINES`); an old chat's owner and a stored delegation read as the
   successor (an old Judge chat shows as Sentinel); a pack exported for Judge or Scribe imports onto Sentinel or
   Artisan (a Router pack has no work role and is refused); a retired role's MCP access entry is dropped, never merged
   (a Scribe narrowed off a server must not take it away from every Artisan); `roleName` and `characterOf` show the
   successor. Old runs keep their `agentId`: their per-version metrics stay under the retired id (the card shows only
   the six roles). The sampled reviews (`judge-sample.ts`) start Sentinel chats; a Judge review started before still
   counts when it ends. The stored names stay: `judge-samples.json`, the setting `delegation.judgeDaily` (now
   "Revisioni indipendenti al giorno") and the feedback caller `judge-sample`, since renaming them would orphan the
   user's data.
2. **A verdict from facts** (`shared/run-verdict.ts`), zero tokens, computed on read and never stored: a run is a
   verified **success** when it ended with an `agent_report` whose outcome is done with every done-criterion met
   (`report.via === 'agent_report'`, `verified: 'yes'`), the user made no correction during it (`run.corrections`
   recorded and zero) and it was not reopened or reworked within 7 days of its end (the §5 rework signal: a reopen, or
   a run with `reworkOf` / `continuedFrom` started within 7 days); a **failure** when its report says blocked or it was
   reworked within those 7 days; otherwise unknown. A would-be success is **provisional** for the 7 days and counts
   nowhere. The user's verdict always wins, then one a verified review backs (`reviewed-evidence`), then the facts.
   Basis name: `facts`. It is verified evidence wherever `human` / `reviewed-evidence` were: the §5 success rate
   (`run-metrics.ts`, so `agent_metrics` and the Agenti page), the trials' cohorts (`trials.ts`), the tier suggestions
   (`suggestions.ts`), the skill suggester's past runs (`skills/suggest.ts`) and the levels. The run's outcome line
   (`RunSurface.tsx`) says it in one line: «Verificato dai fatti: criteri soddisfatti, nessuna tua correzione, non
   rifatto in 7 giorni.» (or provisional until a date, or failed and why); its "?" explains the rule.
3. **Honest levels** (`agents/standing.ts`): the titles stay; the XP is the count of **verified successful runs**
   (`AgentStanding.wins`: human, reviewed-evidence or facts verdicts that are a success), never failed, unverified,
   provisional or self-reported runs. The card shows the real number beside the level: «Lv 6 Maestro · 38 riusciti
   verificati». Rolled-up runs keep their verified successes (`RunTally.verdicts.success`) and the Orchestrator's
   (`RunTally.decisionWins`). The performance gives the agent's own word weight 0 (it is counted in `sources.self`,
   never in `evaluated`), the facts weight 1 like the user and a review, and shows the n it rests on. The model tier
   chip reads «Modello: alto/medio/leggero», so «Livello» means only the level. VISION: light game elements only on top
   of verified data, never volume or self-assessment.

## Consequences
- The catalog shows six cards; an owner's `roles.json` of nine loads as it was for the six, with the retired entries
  ignored (they stay in the file until the next write, and in `role-history.json`).
- Levels drop for most agents at the first start (failed and unjudged runs no longer count), then grow only with work
  that held up; a run counts towards a level 7 days after it ended unless the user confirmed it sooner.
- A run pruned into the rollups while its facts were still provisional keeps no verdict (pruning starts past 5000
  runs, normally far older than 7 days).
- Not covered here: the Classificatori cards and the routing ledger (`outcomes.jsonl`, ADR 0095) still count only the
  user's and reviewed outcomes; the ledger line is written before the facts settle.
- The README's crew picture (`docs/screenshots/crew.webp`) still shows nine characters until `npm run shots` is run
  again on main.
