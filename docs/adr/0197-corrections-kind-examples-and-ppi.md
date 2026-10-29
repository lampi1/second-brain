# 0197 — The user's corrections counted by the app, the kind of work by examples, and PPI for role success

Status: accepted. Builds on ADR 0037, ADR 0058, ADR 0068, ADR 0076, ADR 0125, ADR 0130 and ADR 0186.

2026-10-29.

## Context

Three measures did not say what really happened.

1. **Qualità, «Errori che hai dovuto trovare tu».** The owner, with a screenshot: «0 ogni 100 turni … dal 21/10 al
   29/10: 0 errori li hai visti tu su 3857 turni; altri 26 li hanno trovati reviewer, QA, hook o l'agente stesso. 186
   righe senza «visto da»» — «in questi ho sempre zero». The numerator came only from `ai-errors.md` rows whose «visto
   da» names him (brain-template `ops/tools/recurrence.mjs seenBy` → `tables.quality.seenByDay.owner`). Agents rarely
   write his name and 186 rows had none, so the card said 0 while he corrected agents every day. On top, the run field
   `corrections.afterReport` (AGENTS-DESIGN §5, «a reopen of a run whose agent had reported») was read by the metrics
   but never written anywhere.
2. **Kind of work.** `taskOf` (shared/work-concepts.ts, ADR 0186) is a lexicon: a request phrased with other words is
   «altro». The local e5 embedder of the search (ADR 0068) already runs on the user's PC.
3. **Role success.** Only verified verdicts count, from 5 (shared/success.ts, ADR 0186), so most roles show «troppo
   pochi» while Sentinel reviews and the receipts (ADR 0125, 0130) judge many more runs, with an unknown bias.

## Decision

### 1. The user's corrections, counted by the app (main/brain/user-corrections.ts)

- Every `chat:send` the user makes is classified after it is sent, zero tokens: the «Correggi il pensiero» tag first
  (shared/correction.ts); else the brain hook's decision: the local semantic detector (search/hybrid/corrections.ts)
  when warm, else the hook's `CORRECTION` regex (a pinned copy of `signals-regex.mjs`; the test checks it is equal).
  A CONFUSION-only match («non capisco», «spiegami») is a question, not an error: it never counts here (the hook
  still reminds the chat). A correction to a chat whose current run had already reported is «riapertura dopo il
  report» in the day's count; it increments that run's `corrections.afterReport` only on a semantic-detector yes (the
  tag has its own counter, `corrections.tagged`): the bare regex would count a plain «no» to «Apro la PR?» (review
  2026-10-29). `user-corrections.json` keeps `afterReportSince` (ms), the first start that wrote it; «riuscito se»
  `fewer-corrections` (ADR 0194) leaves out runs started before it.
- Only counts per Rome day are kept (messages, tagged, afterReport, recognized, semantic) plus the titles of the chats
  corrected that day (at most 30, to match ai-errors.md rows with no «visto da»), in `userData/user-corrections.json`,
  90 days. Never the message text.
- `/api/quality` carries them (`AppQuality.corrections`, contract addition) with the runs' own counters by day.
- The page (renderer/brain/lib/quality.ts `caughtPer100`): per day the app's count once it was counting, else the
  runs' tags; the ai-errors.md rows he saw (visto da = him, or no «visto da» in a chat he corrected that day) count only
  beyond that, so a correction written in both places counts once. The breakdown is said («12 correzioni tue su 3857
  turni: 7 «Correggi il pensiero», 3 riaperture dopo il report, 2 messaggi riconosciuti come correzione»), with «Come lo
  conto». With nothing measured (no app count, no run tag, no row signed) the card says «Nessun dato», never 0. An older
  main without the field: ai-errors.md alone, and the card says so.
- Writers: the brain hook's reminder now asks for `visto da: <owner>` («he caught it»), and the ai-errors.md header says
  the same. The app's own `error` command and mem.mjs stay as they are (mem.mjs takes the line as written; guessing the
  seer there would be wrong for review findings).

### 2. Kind of work by examples (main/brainmodel/kind-centroids.ts, kind-model.ts)

- Nearest centroid over the e5 embeddings (query mode) of the user's ended runs with a verified outcome
  (standing.ts `earnedVerdict`: his verdict, a review's, the receipts', a verified parent's), labelled by the word rule
  (`kindOfRun` = `taskOf` on the request). Motivation: SetFit (Tunstall et al. 2022, https://arxiv.org/abs/2209.11055):
  few examples per class plus a sentence encoder classify well without prompts; here without fine-tuning.
- Split by run id (FNV hash): 20% test, 20% calibration, 60% training. A kind needs 5 examples for a centroid; the
  «altro» threshold is the one that agrees most with the labels on the calibration part (abstaining is right on
  «altro»); final centroids from training + calibration, tested on the test part only. Under two kinds with 5
  examples, or without the local model: the word rule decides (`KindModel.classify` falls back to `taskOf`).
- **Limitation, said on the card:** the labels are the word rule's, so the test measures agreement with it, not the
  truth; where the words are wrong it learns the error. What it proposes where the words say «altro» is shown apart, as
  unverifiable. The routing table keeps deciding on the word rule; promoting the classifier is the owner's call.
- CPU: nothing runs until Classificatori asks; examples capped at 600 newest; embeddings cached by run id (a goal is
  frozen at the run's end); batches of 16 with a 50 ms pause, in the search worker thread; one computation at a time,
  its card kept 10 minutes or until the runs change; the page shows «busy» and looks again every 5 s.
- Classificatori: a wide card with examples, agreement with the words (k/n), the threshold, the confusion matrix on the
  held-out 20%, examples per kind and «Come funziona». The demo shows fixed numbers.

### 3. Prediction-powered success and the Sentinel's agreement (shared/ppi.ts, main/agents/judge-agreement.ts)

- Per role, over the kept runs (rollups keep no per-run judgments): the automatic judgment of a run = the newest
  completed Sentinel review's verdict on it, else the receipts' decision; the human one = the user's verdict (basis
  human). A partial is 0.5, as in success.ts.
- PPI (Angelopoulos et al., Science 2023; the rectifier for LLM judges, Chen et al., ICML 2026
  https://icml.cc/virtual/2026/poster/61131): θ̂ = mean(auto over runs only the judge saw) + mean(human − auto over
  runs with both); 90% normal interval from both variances, clipped to 0..1. Only from 5 runs with both
  (`MIN_PAIRS`, the same bar as success.ts); with no unlabeled run it is the human mean.
- «Accordo Sentinel–te»: share of equal verdicts and Cohen's kappa (null when chance agreement is total) with n.
- `VersionMetrics.judges` on the all-versions row only; the role page (AgentStudio.tsx) shows «Stima con tutti i
  giudizi» beside «Successi verificati» and «Accordo Sentinel–te» when there is a pair. The card's front and the level
  are unchanged: the estimate is shown, it decides nothing.

## Consequences

- The Qualità number can only grow from the day the app starts counting; before it, the runs' tags and ai-errors.md
  give the rest, and the card says from which day the app counted. While the semantic model is not ready the
  regex may also count a «no» that corrected nothing, so the day's number can be a little over as well as under.
- Contract additions (all optional): `AppQuality.corrections` (`UserCorrections`, `UserCorrectionDay`),
  `ClassifiersState.kindModel` (`KindModelCard`), `VersionMetrics.judges` (`RoleJudges`). Services: `ChatService`
  `correctionContext`, `correctedAfterReport`; `Wired.userCorrections`; `BrainModelDeps.kindModel`.
- `corrections.afterReport` is now written: a run corrected after its report has `factsVerdict` unknown and no chain
  credit, as AGENTS-DESIGN §5 always said.
- Tests: test/unit/brain/user-corrections.test.ts, test/unit/brain-ui/quality.test.ts,
  test/unit/brainmodel/kind-centroids.test.ts, test/unit/shared/ppi.test.ts.
