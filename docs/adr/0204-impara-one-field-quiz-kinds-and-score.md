# 0204 — Impara: one start field, more question kinds with instant feedback, an honest score

Status: accepted. Builds on ADR 0185, ADR 0189 and ADR 0190; the sounds are ADR 0151's.

2026-10-30.

## Context

The owner asked for all of these to be done («Procedi con tutte le modifiche»), with a UI as good as the best apps
(«copia dai migliori»). The Impara report found three problems.

1. The start page asked for the kind first (topic, PR or text), then had a field for each kind. Below that were five
   rows of options and two buttons of the same weight.
2. Every check and review card was a four-option multiple choice. Feedback was a plain colour change, and no progress
   or end screen said how the session went.
3. Nothing told the learner how much they know. The only number was each subject's recall percentage, and it was not
   a score.

## Decision

**One field.** The start page has one multiline field that grows with its text. Enter starts a new line and
Ctrl/Cmd+Enter starts the lesson. The kind is worked out by `detectKind` (`shared/impara-start.ts`):
- A PR link (GitHub, or a DevOps `/pullrequest/N`) makes a PR lesson.
- A long text makes a text lesson. Long means 600 characters or more, or 8 lines or more.
- Anything else is a topic.

A small chip shows the detected kind, and a click picks another one. Files and folders can be added in two ways:
«Aggiungi fonte» (a file or a folder picker) or a drop on the field. They show as chips.

The page reads these files itself, with the File API. Main never opens a path the page names. The page skips:
- hidden files and folders, so `.env` is never sent to a model;
- binaries;
- build and dependency folders;
- anything past 40 files or 400 KB per file.

The files go through `impara:start` as `LessonStart.files`. Main cleans them again (`learn/user-files.ts`):
- control characters are removed;
- NUL and binary content is dropped;
- the limits are at most 40 files, 120,000 characters per file and 600,000 in all.

Main then writes the files to `fonti.md` in the lesson's material, so both the research and the tutor read them like
the rest of the material. The options fold into one line, «Conosco le basi · 15′ · Claude Opus alto · voce attiva»,
and «Cambia» opens them in a popover. The page has one primary button.

**Question kinds.** `shared/quiz.ts` holds one body for checks and cards. The kinds are:
- choice (and predict);
- true or false, with the why;
- complete the code (cloze, one `___` in up to 14 lines);
- put in order (3-6 steps);
- match (3-5 pairs);
- click on the diagram (`node`), unchanged.

`parseQuiz` checks each kind. The prompts (`learn/prompt.ts`, `CHECK_SHAPE`, `CHECK_KINDS` and `cardsPrompt`) ask
for a mix of kinds.

The format stays backward compatible. Every kind still has `options` and `correct`. Order and match keep their right
answer in `items` and `pairs` and are shown shuffled (`shuffled`, seeded, never in the right order). Their answer is
stored as `correct` when right and -1 when wrong, with the learner's sequence in `seq`. So `choice === correct`
still means right everywhere, including old lessons and `progressOf`.

**Feedback.** Each answer gives feedback at once: a colour, the app's sounds (ADR 0151, only when the sound setting is
on) and a short pop or shake. The animation is off under reduced motion.

The review adds:
- a segmented green/red progress bar;
- a streak of right answers;
- keys 1-4 or A-D, V/F for true or false, and Enter;
- «Eri sicuro?», kept from before;
- an end screen with the score of the session, the time, the cards strengthened (their FSRS stability grew) and the
  best streak.

«Rifai le sbagliate» asks the wrong ones again as a practice round. That round grades nothing, so the schedule stays
honest. It replaces the old rule that put a forgotten card at the end of the same session. «Sfida a tempo» gives 20
seconds per question. Running out counts as «Non lo so». It is never on by default and lasts one session only.

**The score.** These are pure functions in `shared/mastery.ts`:
- **Memory** is the mean FSRS chance of remembering today, over the cards studied at least once.
- **A solid card** has a stability of at least 21 days, and its last grade is at least «Giusto».
- **The score** is round(100 × memory × solid cards ÷ all cards).

So the score falls day by day without reviews. More lessons do not raise it until their cards are solid. The change
this week replays the review log up to seven days ago and scores the cards as they were then.

Each subject has a level, computed from three numbers the learner can see: the share of cards reviewed, the share of
solid cards, and memory today.

| Level | Cards reviewed | Solid cards | Memory today |
|---|---|---|---|
| Padroneggiato | all | 80% | 90% |
| Competente | 80% | 40% | 80% |
| Familiare | 50% | (no minimum) | 70% |
| Iniziato | anything below | | |

The top of the Impara home shows a ring with the score and four tiles: memory, solid cards, days in a row and lessons
finished. The Orchestrator's `app_learn` lists the same score and levels.

No new dependency.

## Consequences

The review sessions of the demo now hold order, match, true or false and cloze cards. Its counts in the unit and e2e
tests changed with them.

ImparaPlayer belongs to the lesson's own work, but it changed in three lines: it grades with `quizRight` and does not
read a letter aloud for order and match. LessonStage and the lesson's buttons did not change.

A model can still write only multiple choice. The prompt asks for a mix but does not enforce one.

The score depends on FSRS's estimate. A learner who answers carelessly can keep cards "solid" for a while, until
they come due.

Files added as sources go to every model that reads the lesson's material. Only the web research does not see them,
as before.
