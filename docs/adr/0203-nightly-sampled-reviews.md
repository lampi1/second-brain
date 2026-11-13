# ADR 0203 · Agent levels: a nightly sample of reviews under a daily cap

Date: 2026-10-30 · Status: accepted (owner, report «Impara v3» Parte 2, codes L1-L4: "aggregare invece di tempo reale";
2026-10-30: «non voglio che compaiano gli agenti sulla grindhouse quando faccio revisioni»; the nightly timing with the
PC off made explicit the same day) · Supersedes: the "every finished run is reviewed, at once" part of ADR 0114 and
ADR 0170 (reviews on/off), the audit of ADR 0125 (one review in ten reviewed again) · Builds on: ADR 0083 (the app owns
the review loop), 0100 (XP = verified successes), 0130 (receipts before reviews), 0131 (Bayesian performance), 0186
(reviews graded verified or not), 0191 (Modalità notte)

## Context
With «Abilita controllo livello e performance» on (setting `judging`, the default) `judge-sample.ts` opened a Sentinel
chat for every finished root run that its receipts did not decide, plus a second review of one run in ten
(`AUDIT_EVERY`). Each review was a full chat, visible as a strip on the Grindhouse, started minutes after the run ended.
Computing level and performance (`agents/standing.ts`) is local and free: aggregating it saves nothing. The cost is the
reviews themselves. The owner wants fewer, cheaper reviews and none on the Grindhouse.

## Decision
1. **Free signals first (L3).** A run is never sampled when a free signal decides it: the user's verdict, a verified
   review, an opinion (the Orchestrator's or a parent's), its receipts (ADR 0130; recorded on every tick, at any time of
   day, zero tokens, basis `receipts`), a rework of it (`reworkOf`) or a reopen (`counters.reopened`). A delegated
   child's run (its parent judged it), a one-shot, a review itself (`reviewRuns`, now also a batch's own run) and a run
   older than 7 days are never candidates either. `judge-sample.ts undecided`.
2. **A sample, not all (L1).** Of the runs left, each role has a fixed, unpredictable share picked by the run id's hash
   (`samplePicked`: sha256 of `sample:<runId>`; the same run gives the same answer every night, and the 10% sample is
   inside the 25% one): **25%** by default; **10%** when the role's performance spread (± from `standing.ts`) is under
   **10 points** and it has at least **5 verdicts** (the user's, a review's, the receipts') on runs of the versions that
   share its current **model, skills and rules** (engine, model, tier, instructions, know-how, skills; `coreVersions`
   over the role history of `agents/versions.ts`). Changing any of them puts the role back to 25% until the new version
   has its 5 verdicts (`roleShares`). Other changes (tools, permissions, context) do not reset it.
3. **One nightly batch (L2).** The batch is **due once a day**: none since the latest 03:00 local (`batchDue`).
   - **The app is running at 03:00** (open since before 03:00, and within the hour after): it runs then (`batchWhen` =
     `night`). A PC asleep through that hour counts as "off".
   - **Otherwise** (the PC was off or asleep): at the **first idle moment after the next start**: the app open for at
     least **5 minutes** (never in the startup rush) and **no keyboard or mouse input for 10 minutes** (Electron
     `powerMonitor.getSystemIdleTime`; sending a chat message is input too). The engines already run below normal CPU
     priority (`chats/jobguard.ts lowerEnginePriority`), so the window always goes first.
   - **Modalità notte** (`awayMode`, ADR 0191) on: the user is away, so a due batch runs once the startup rush is over
     without waiting for idle (`batchWhen` = `away`); that mode also keeps the PC awake.
   - **Missed nights:** still **one** session. It covers every pending sampled run of the last 7 days, **oldest first**
     (the first to leave the window), as many as the daily cap buys; older ones drop out of the window unreviewed.
   - The day is claimed when the batch starts (or finds nothing to do), so a failure is not retried the same day; a
     refused engine or a missing Sentinel does not claim it (tried again 5 minutes later). The claim is **saved to disk
     before the batch starts** (`judge-samples.json`), and the batch's run is in the run store from its start: a quit or
     crash during the batch (up to 45 minutes) never runs it again at the next start, which would pay twice. At its first
     tick the next process ends such an interrupted batch run (`endInterrupted`: `stale`, no verdicts, its cost if one was
     recorded, report `blocked`), keeps it in the batch list with the error «interrotta: l'app si è chiusa prima della
     fine» and says so in the Log; its runs have no verdict, so they stay pending for the next nights.
   - The batch is **one hidden read-only run** (`compare/headless.ts HeadlessRunner`, the Sentinel's engine, model and
     effort, effort `max` lowered to `high`): **no chat record, no Grindhouse strip, no notification**. One prompt lists
     every run (folder, goal, report, result cut to 2 500 characters, criteria and evidence, receipts); the answer ends
     with a fenced `review-verdicts-<nonce>` JSON array, one `{ run, verdict, verified, note }` per run (`batchPrompt`,
     `parseBatchVerdicts`).
   - **A run cannot steer the verdicts.** Its goal, report, result, evidence and receipts are text an agent wrote (or
     that a file it read put there): a fake heading, a fake «### 2. r_…» run or a fake verdicts block could pass as the
     app's. Each batch draws a random **nonce** (`batchNonce`, 16 hex characters, never stored in a run). Every such
     field sits between `[data <nonce>]` and `[/data <nonce>]`, made inert first (`inert`: the nonce, code fences,
     the verdicts block's name, data markers and line-start `#` are defused). The prompt says that text is data. Only
     the last block named `review-verdicts-<nonce>` is read (one without the nonce, or with another, is ignored); only
     the batch's run ids count, with valid values; a run named twice in it is dropped (ambiguous). At most 20 runs a batch;
     45 minutes, then it is killed. The working folder is the one most runs are in; the others are read by absolute path.
   - Each verdict becomes the run's feedback (`run-feedback.ts recordFeedback`, caller `judge-sample`, evidence = the
     batch's run). It is **reviewed evidence** only when the batch lists that run with the same verdict and `verified:
     yes` (`batchBacks`: an app-started Sentinel run, job `review`, ended completed); otherwise it is an opinion.
   - The batch is recorded as the **Sentinel's own run** in the run store (`app.db`, ADR 0199): `source: 'oneshot'`, `oneshot.job:
     'review'` (new purpose), `reviewBatch: [{ runId, verdict?, verified? }]` (new field, at most 40, validated on read),
     its cost and tokens, a report (`done`/`blocked`, verified yes/partial/no by how many it checked). So the cost counts
     (the cap, `judgingEstimate`, Costi) and `standing.ts` grades it like a review (`gradableBatch`, `gradedBatch`;
     verified or not, as ADR 0186 grades a single review): item by item, the user's later verdict on the run, else a
     rework of it (against a pass, for a fail); every graded item agrees = success, any opposite = fail, else partial;
     nothing graded = no XP yet.
   - The Log gets **«Revisione notturna: N run, X $»** (kind `task`, step `verdict`, with cost and duration; a warning
     when it failed or found no verdicts). The work roles' cards on the Agenti page say **«Aggiornato stanotte alle
     03:00»** (or «oggi / ieri alle …», or a date) from the last batch (`JudgingEstimate.lastBatch`); the switch says
     «Ultima revisione …: N lavori giudicati, X $».
4. **No audit, a daily cap (L4).** The second review of one run in ten (`AUDIT_EVERY`, `auditPicked`, `pickAudits`,
   `pickReceiptAudits`, `gradeReceipt`) is removed from `judge-sample.ts`; stored audit entries are dropped on read. The
   reviewer is graded by the user's verdicts and the facts. A new setting **`judgingCapUsd`** (protected, 0.1–20 $,
   default **1 $ a day**) bounds the batch: `batchSize` = what the cap buys at the median cost of one reviewed run
   (past batches per run, else past single reviews, else the Sentinel's own runs; `reviewCost`), at most 20; 5 while no
   cost is known; 0 = the night is skipped with a Log warning. A batch cannot be stopped half way when it costs more
   than estimated: the next night's size follows the measured cost. The cap is a segmented choice (0,5 / 1 / 2 / 5 $)
   beside the switch, «Tetto al giorno».
5. **The estimate.** `judgingEstimate` returns: undecided runs a day (`runsPerDay`), the receipts' runs a day, the
   sampled runs a day (Σ share per role / 7), the cost of a reviewed run, `perDayUsd` = min(sampled × cost, cap), the
   cap and the last batch. `auditsPerDay` is gone.
6. **Timers.** `wiring.ts` ticks the sampler every 5 minutes (the first after 5 minutes: never in the startup rush) and
   5 seconds after a run ends (for the receipts). Still never in tests or an agent's hidden run (`judgeSamplingOn`).
7. **Before this ADR.** A «Revisione · …» chat opened before the upgrade is still recorded when it ends (`ended`); no
   path opens one any more. `REVIEW_CRITERIA` and `reviewPrompt` stay for the Learning page's replay review.

## Consequences
- Review tokens drop by the sample (≈ 25% → 10% of the undecided runs) and by one shared context a night instead of a
  fresh session per run; the cap bounds the worst day. Estimate, not measured: −70-85%; compare the Sentinel's
  `review` one-shot costs before and after.
- Levels move once a day for the reviewed share; the user's verdicts and the receipts still count at once. The card
  says when the last update was.
- A single batch is one point of failure for the night: a failed or interrupted run records no verdicts, and a run with
  no verdict (the batch failed, the app quit during it, or the Sentinel left it out) stays pending for the next nights,
  within its 7 days. An interrupted batch's tokens are lost (its cost is usually unknown), but it is never run twice in
  one day.
- The nonce bounds what a run's text can do to the answer's structure; it cannot stop the Sentinel from being persuaded
  by the content itself. An unverified verdict stays an opinion, and the user's verdict always wins.
- Honest levels are unchanged: only verified successes earn XP; an unverified batch verdict is an opinion.

## Files
`src/main/agents/judge-sample.ts` (rewritten), `src/main/agents/run-feedback.ts` (`batchBacks`),
`src/main/agents/standing.ts` (`gradableBatch`, `gradedBatch`), `src/main/agents/runs.ts` (`reviewBatch`),
`src/main/agents/level-diagnosis.ts`, `src/shared/agents.ts` (`ReviewBatchEntry`, `JudgingEstimate`, purpose `review`),
`src/shared/contract/settings.ts` + `src/main/brain/settings-schema.ts` (`judgingCapUsd`), `src/main/wiring.ts`,
`src/main/wiring-types.ts`, `src/main/ipc-handlers/agents.ts`, `src/renderer/components/JudgingSwitch.tsx`, `AgentCatalogPage.tsx`, `AgentCatalogCard.tsx`,
i18n (catalog, explain, levels), `src/shared/concept-guide.ts` (+ DE), `src/main/appctl/guide.ts`; tests in
`test/unit/agents/judge-sample.test.ts`, `standing.test.ts`, `role-loop.test.ts`, `test/unit/agent-runs.test.ts`,
`test/unit/appctl-guide.test.ts`.
