# 0230. Impara: «Spiegazione», a lesson with pictures and no quiz

Date: 2026-11-07. Status: accepted (merged 2026-11-08; written as a proposal). Amends 0185, 0205 and 0213.

## Context

The owner (2026-11-07) is a visual learner and wants lessons that explain: «spiegazioni senza quiz». An Impara lesson
(ADR 0185) asked something every second piece (a recall check), had a half-done and a practice piece (ADR 0205), ended
on a graded «Spiegalo tu» with «Eri sicuro?», and left review cards. The pictures were optional: a piece without its own
visual only lit some nodes of the lesson's flowchart, and the text under the board was a full paragraph.

## Decision

- A lesson has a kind, `mode` on `LessonStart` and `Lesson` (shared/lesson.ts): `explain` («Spiegazione», the default)
  or `quiz` («Quiz», the lesson as it was). A lesson saved without one (before this ADR, the demo's seeded lessons) is a
  quiz lesson (`modeOf`). The start form's options have «Tipo di lezione: Spiegazione · Quiz», remembered like the other
  options; `app_learn` takes `mode` (default explain; quiz only when the user asks to be tested).
- «Spiegazione» asks nothing:
  - the plan and the rest are asked for no check, no half-done or practice piece and no final question
    (main/learn/explain-rules.ts EXPLAIN_STRUCTURE), and whatever asks that the model still writes is dropped
    (`withoutAsking`); an extra («Spiegamelo meglio») adds no check;
  - at most ONE question before the lesson, only when the ask can mean different things (the owner's D6);
  - the tutor always answers («Dimmelo e basta»), the coach switch is hidden;
  - no review card: neither the lesson's cards nor the tutor's (D8). The exception: the Studio's «Flashcard» and
    «Quiz» tiles still put their cards into the review, because the learner opens them (the owner's D8: «Niente schede
    di ripasso dalle lezioni Spiegazione, salvo tua richiesta»; opening the tile is that request);
  - a half-done or practice piece the model still writes is told as a worked one (`toldRole`), in the plan, the rest,
    the gate's rewrites and the extras;
  - the lesson ends on its recap: standing on the last item of the play-list (the recap, an extra asked on it, a
    one-piece lesson) sets `doneAt` (`endsHere`); there is no graded end on the rail. The last piece
    offers «Spiegalo tu» as a button, never opened by itself, with no score, no «Eri sicuro?» and no cards (D7).
  - The Studio's live tiles («Mettimi alla prova», «Esercitati», «Interrogazione a voce») stay: the learner opens them.
- Visual first: in «Spiegazione» every piece has a picture (its own visual, its own diagram or lit nodes of the
  flowchart): the prompt asks for it and the quality gate (ADR 0205) checks a new rule, `visual`, instead of
  `questions` (`gateRules`). The caption is about 40 words (the app flags over 60 when the piece wrote a caption of its own, not when
  the narration was copied in as its text); the full text is behind «Testo
  completo», as with the voice on.
- A new visual kind, `compare` (shared/lesson-visual.ts): `{before, after}`, two mermaid diagrams of the same kind
  (flowchart, sequence or state), side by side («Prima» · «Dopo»). «Dopo» joins from the second half of the beats
  (`compareAfterShown`). Each side is drawn with its own SVG id prefix (`compareIds`, `DrawOptions.idPrefix` in
  lib/viz/mermaid.ts): two drawings with the same ids hide each other's arrowheads.
- The drawing and narration rules are adapted from two public skills, rewritten in our own words, with attribution in
  explain-rules.ts and NOTICE: diagram-design v2.6 by Cathryn Lavery (MIT) and HyperFrames' explainer guidance by HeyGen
  (Apache-2.0). No file of theirs is copied; no script, npx or binary of theirs was run or fetched. Read 2026-11-07:
  diagram-design's `skills/diagram-design/SKILL.md` (version 2.6) and `references/type-architecture-delta.md` at commit
  e57eda6102a19444538ebd611d39534fad65b663; HyperFrames' `skills/hyperframes/references/types/explainer.md` and
  `story.md` at commit 688229314fb219c4317351c25483ecc3c56a519b.

## Consequences

- An explain lesson is cheaper: no cards run, no grading run unless the learner chooses «Spiegalo tu».
- What the learner retains is not measured in «Spiegazione»; who wants that picks «Quiz».
- Amends 0185 (checks and the final «Spiegalo tu» only in «Quiz»), 0205 (the gate's rules by kind, a picture per piece,
  the compare) and 0213 (the live tiles stay in both kinds).
- No new dependency. Voice and video lessons (part B of the plan) are not part of this decision.
