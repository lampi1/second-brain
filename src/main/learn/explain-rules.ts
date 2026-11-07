// The words Impara adds to a lesson's prompt in «Spiegazione» (ADR 0219): a lesson that explains with pictures and asks
// nothing (the owner, 2026-11-07: «spiegazioni senza quiz», visual learner), and the drawing rules every lesson's
// visuals follow. Imported by prompt.ts (RULES, planPrompt, restPrompt, extraPrompt, gatePrompt); pinned by
// test/unit/learn-prompt.test.ts.
//
// Adapted, rewritten in our own words, never copied; no script, npx or binary of theirs was run or fetched:
// - The drawing rules (delete before adding, a density of about 4 out of 10, at most 9 nodes and 12 arrows, one or two
//   accent colours, orthogonal connectors, «would a paragraph do?» before any diagram, the before/after picture as an
//   architecture delta) from diagram-design v2.6 by Cathryn Lavery, https://github.com/cathrynlavery/diagram-design
//   (SKILL.md, read 2026-11-07 on the default branch; the commit was not recorded: to verify). MIT License; its
//   copyright notice and permission notice are the ones in that repository's LICENSE file, reproduced in NOTICE.
// - The visual-first narration (the voice comments what is on screen and never reads it, each part appears when the
//   voice names it, one idea and one picture that grows) from HyperFrames' explainer guidance (types/explainer.md and
//   story.md) by HeyGen, https://github.com/heygen-com/hyperframes (read 2026-11-07 on the default branch; the commit
//   was not recorded: to verify). Licensed under the Apache License, Version 2.0
//   (http://www.apache.org/licenses/LICENSE-2.0); modified: rewritten as prompt rules for a lesson, not a video. See
//   the NOTICE file at the repository's root.

/** The lesson's structure in «Spiegazione»: the quiz mode's, without anything that asks (no recall check, no
 *  worked → faded → practice trio with its «predict», no final question). */
export const EXPLAIN_STRUCTURE = `The lesson's structure (always, in this order; "role" names each piece's place). This lesson ASKS NOTHING: no question to the learner, no check, no exercise, no «try it yourself», no rhetorical question to answer.
1. "problem": the first piece states a concrete problem and why it matters, as a statement (never as a question to the learner). No explanation yet.
2. "example" then "rule": a concrete case with real names and values first, THEN the general rule it shows (concrete before abstract). Never the rule first.
3. "worked": when the subject has a procedure, one fully worked example, every step shown and explained. Never a half-done one, never a step left to the learner.
4. "misconception": ONE common misconception, only if a verified fact states it (cite it), told and corrected; otherwise no such piece.
5. "recap": the last piece sums up what matters most with a "mindmap" visual of the whole lesson.`;

/** Visual-first (adapted from HyperFrames' explainer guidance, Apache-2.0): the picture carries the lesson, the voice
 *  comments it. Only in «Spiegazione». */
export const VISUAL_FIRST = `Visual first (this lesson is watched more than read):
- EVERY piece has its own "visual" (never omit it; {"type": "flow"} counts: the lesson's flowchart with the nodes the beats name). Pick the picture first, then write the words around it.
- The voice comments the picture, it never reads the text on screen: each beat names what is in the picture at that moment (the node, the message, the line, the symbol, the branch) and says what it means or does, as if pointing at it.
- Each part of the picture appears when the voice names it; one idea and one picture per piece.
- "text" is a short caption for who reads instead of listening: at most 40 words, no repetition of the beats word for word.`;

/** The drawing rules (adapted from diagram-design v2.6, MIT): for every visual, in both modes. */
export const DIAGRAM_RULES = `How to draw (every visual):
- Before drawing, ask «would a paragraph do?»: a picture only when it shows a shape (who talks to whom, what moves where, what changes); otherwise a short "code", "formula" or "chart", or the flowchart.
- Delete first: keep only the parts this piece needs, about 4 out of 10 in density, never a wall of boxes. At most 9 nodes and 12 arrows.
- One or two accents at most: the part the piece is about stands out, the rest is quiet. No decoration.
- Straight, orthogonal flow: one main direction, few crossings, short labels (2 to 4 words).`;

/** The before/after picture (diagram-design's architecture delta, MIT): one more visual type, in both modes. */
export const COMPARE_VISUAL = `  - {"type": "compare", "before": "<mermaid>", "after": "<mermaid>"}: before and after side by side (a change, a fix, a migration, a PR): the same kind of diagram twice (flowchart, sequenceDiagram, stateDiagram-v2), the same names for what stays, only what changed is new. The first beats speak about "before", the last about "after".`;
