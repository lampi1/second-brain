# 0201 — Cuts: Battito, model comparison, cloud agents, the composer's model suggestions, Veloce

Status: accepted. Owner decision, 2026-10-30, after the review in `/mnt/project-files/impara-v3/report.html`.
Supersedes ADR 0070 (Battito) and ADR 0080 (cloud agents); narrows ADR 0046 §4 (the comparison's side b), ADR 0118
(the composer's suggestion keeps only its local part) and ADR 0034 (the last "Veloce" traces).

2026-10-30.

## Context

The report found features that cost upkeep, tokens or screen space and that the owner no longer uses or trusts:

- **Battito / Pulse** (ADR 0070): a background agent that wrote idea, advice and reminder cards, the daily sentence on
  top of Memoria, its own approvals and three daily slots with a budget. Ideas now come only from the one-click
  maintenance (ADR 0153), so the Battito duplicated it, with a model of its own.
- **Confronto modelli** (ADR 0046 §4): the brain's comparison queue (the app ran side b of an A/B experiment as a hidden
  read-only run) and the Confronto page with the reports. Never part of the owner's routine.
- **Cloud agents** (ADR 0080): Cursor, Codex and Claude agents run in the vendor's cloud, their strips, the Cursor Cloud
  key. The Claude cloud status was always unknown, and the rest saw no use.
- **The composer's model suggestions** (ADR 0118): after a typing pause a model completed the line, with its own
  model switch and daily budget. The zero-token local suggestions (a past prompt, a role, a chat title, a file) were
  the useful part.
- **Veloce**: the Orchestrator input's "Veloce" toggle put a first line «[veloce] Via rapida: …» on the message (answer
  directly or open one chat, no delegation tree). The toggle went in #124 (2026-10-21) when Flash became the quick lane
  (ADR 0105, 0107); its tag, badge and words were still in the code.

The judge audit (one second independent review of 1 run in 10) was in the same list; block 3 of the same batch removes
it together with its sampling rework, so this ADR does not touch it.

## Decision

Each feature goes fully: code, IPC channels, settings, i18n (it/en/de), the Guida cards and app_guide entries, tests,
docs.

- **Battito**: `src/main/pulse/`, `shared/pulse.ts`, `main/headline.ts`, the cards (ContextPulse, PulseBoard), the
  sentence on Memoria (HomeHeadline), its Settings rows, the `pulse:*`, `approvals:*`, `headline:*` channels, the
  Pulse catalog entry and character, the proposals source `pulse` and its ask kind `rule`, the demo fixtures.
- **Model comparison**: `main/compare/queue.ts`, `main/brain/compare.ts`, the `compare:list` channel, the Confronto page
  (`brain/pages/Confronto.tsx`, `lib/compare.ts`) and its G M key. `main/compare/headless.ts` stays: the one-shot jobs
  (`agents/oneshot.ts`) and Impara run on it. `errLine` (stderr's error line) moved to `brain/node.ts`.
- **Cloud agents**: `src/main/cloud/`, `shared/cloud.ts`, CloudStrips, CloudKeySetting, `store/cloud.ts`, the
  `cloud:*` channels and event, `where: "cloud"` of `app_create_chat` (now refused with a clear error), the engines'
  `caps.cloud`, the cloud rows of the morning block, the Cursor Cloud key binding in `engines/service.ts`.
- **Composer suggestions**: `src/main/suggest/`, `shared/composer-suggest.ts`, the `suggest:*` channels, the settings
  `suggestModel` and `suggestDailyUsd`, Costi's "today" line for it. `suggestOn` and the local sources stay; Settings →
  Scrittura is one switch.
- **Veloce**: the `quick` sent mode and the `[veloce]` tag, its badge and words. Quick questions go to Flash, the one
  quick lane. The Orchestrator's own fast path stays: the app's estimate (ADR 0087) still lets it answer a short
  question itself or give a one-part job to one agent, which is delegation sizing, not a mode.

Old data keeps loading and old links keep working:

- `config.json`: `RETIRED_KEYS` (`pulse`, `headlineOn`, `headlineModel`, `headlineEffort`, `suggestModel`,
  `suggestDailyUsd`) are never read and are dropped from the file once at start (`ConfigStore.migrateRetired`).
- `secrets.json`: the `cursor-cloud` key is erased at load (`REMOVED_KEYS` beside `REMOVED_ENGINES`); the cloud
  agents' list `userData/cloud-agents.json` is deleted at start.
- The agent catalog drops a stored `pulse` entry (an unknown id). The runs and log events the Battito left still load:
  `ONE_SHOT_PURPOSES` keeps `pulse` and `headline`, `LogKind` keeps `pulse`; `standing.ts` gives the `pulse` id no
  level (unrated) and its jobs count for nobody.
- The page id `confronto` aliases to `qualita` (the agents' quality) in `PAGE_ALIAS` and in the go-to aliases of `renderer/actions.ts`.
- A message saved with the old `[veloce]` line loses that line in the chat view and gets no badge.

## Consequences

- Fewer background model calls: no Battito slots, no headline, no model suggestion while typing, no comparison runs,
  no polling of the vendors' clouds.
- Ideas come only from «Manutenzione»; Memoria's top shows the counters without a sentence.
- Starting work in a vendor's cloud is no longer an app feature; the Orchestrator opens only local chats.
- The JobScheduler (`jobs/scheduler.ts`) and the one-shot service stay as generic machinery for other jobs.
