<!-- Decision record for the app's local classifiers: a bilingual work lexicon, per-channel thresholds for the agent
classifier, and a threshold calibrated on the user's confirmed runs that applies only on the user's click. -->
# ADR 0174: Classifiers learn from confirmed outcomes, under the user's approval

Numbered 0074 until 2026-10-29, when duplicate ADR numbers were removed.

Date: 2026-10-18

The owner (2026-10-18) asked to make the classifiers "davvero utili ed efficaci", based on solid sources, and explained
in the Guida. The agents' improvement loop already runs under approval (ADR 0073); this extends the same rule to the
classifier that picks the agent.

## Measured before the change

On hand-written requests (`test/fixtures/classifiers/requests.ts`, 30 of them never used to tune; not the user's data):
the agent classifier's words channel picked the right packaged agent 7/30 times (Italian requests, English agent
descriptions, and a preamble shared by every packaged agent); on a fresh brain (no `estimates.json` rules, ADR 0072) the
routing kind was "altro" for 24/30; the cost-ledger kind was right 26/30.

## Decision

- **One bilingual work lexicon** (`src/shared/work-concepts.ts`): Italian and English words for eleven kinds of work.
  The agent classifier folds them into concept tokens on both sides (dictionary-based query translation, Ballesteros &
  Croft, SIGIR 1997); `taskOf` uses it when the brain's rules give no kind. After: agent 18/30, routing kind 28/30.
- **The agent classifier ignores the packaged preamble** (`PRESET_PREAMBLE`) and weighs a match found only in the
  instructions at 0.75.
- **One threshold per channel**: hybrid 60 (unchanged, never measured on the real model: multilingual-e5 puts even
  unrelated texts at cosine 0.7–1.0, so only the user's data can place it), words 20 (the best cut on the DEV requests).
- **Calibration from confirmed runs** (`agents/classifier-calibration.ts`): every run already records the score of its
  agent (`AgentRun.routing`). Runs confirmed successful by the user or by reviewed evidence, of a routable specialist
  (not Generale), are right matches; with n ≥ 20 per channel the suggested threshold is the ⌊α(n+1)⌋-th smallest score,
  α = 0.1 (split conformal prediction, Angelopoulos & Bates 2021): at least 90% of future right matches stay above it if
  future requests resemble past ones.
- **Applied only by the user**: a suggestion at least 5 points from the threshold in force is a card in "Da approvare"
  (`agents:classifierCalibration` / `agents:classifierDecide`, sender-checked IPC, no MCP tool). Apply can be undone;
  a dismissed value does not come back until the data moves it. Approved values live in `userData/agent-classifier.json`.

## Not done (target)

- Fusing the two channels with a tuned convex combination instead of the maximum (Bruch, Gai & Ingber, ACM TOIS 2023).
- Failed runs as negative examples; calibrating the work kind the same way.
- The classifier card has a unit render test but no e2e: the demo has no confirmed runs to calibrate from.
