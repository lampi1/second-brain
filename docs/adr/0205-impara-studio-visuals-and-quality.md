# 0205 — Impara: the «Studio» column, a visual for each piece, and a quality gate

Status: accepted. Builds on ADR 0185, ADR 0188, ADR 0189 and ADR 0190.

2026-10-30.

## Context

The Impara v3 report (`impara-v3/report.html`, Parte 3: I3, I4, I7) found three gaps in the lesson screen. Every piece
was a flowchart, even when the idea is a conversation between two parts, a formula or a few lines of code. The bottom
bar had five buttons of equal weight. Nothing was made from a finished lesson except the review cards. The plan and rest
prompts asked for "short pieces" but no structure, and nothing checked a draft before the learner saw it. The owner
wants lessons "fatte come i migliori" and a UI copied from the best (NotebookLM's Studio, Brilliant, Code Hike,
Quantum Country).

## Decision

**A fixed structure (I7).** The plan and rest prompts (`main/learn/prompt.ts` RULES) give every lesson the same
thread. It starts with the problem, then a concrete case with real names and values, then the rule (concreteness
fading). After that comes a worked example, a half-done one, then the learner's turn (worked-example fading), with a
recall check after every second piece. A misconception is added only if a verified fact states it. The lesson ends
with a recap piece that has a mind map, then «Spiegalo tu». Each piece declares its `role` (`problem`, `example`,
`rule`, `worked`, `faded`, `practice`, `misconception`, `recap`), which the rail shows as a small tag.

**A quality gate (I7).** After the plan, and again after the rest, one short hidden run at low effort
(`impara-quality`) scores the draft against a fixed checklist: `one-idea`, `example`, `cites`, `diagram` (at most 12
parts) and `questions` (not trivial). The app first checks what it can alone (`pieceIssues`, `checkIssues` in
`shared/lesson-studio.ts`) and passes those findings to the run as `appFound`. The run rewrites only the pieces and
questions that fail. A rewrite goes through the same parsers (`parseStep`, `parseCheck`), and the app takes it only
if it is no worse on its own checks. There is one retry and no loop. If the gate run fails, the draft is kept as it is
and the rail says «Controllo qualità non riuscito» (`quality.none`). The lesson keeps a short report (`Lesson.quality`: pieces
checked, fixed, fails by rule), and the rail shows it.

**A visual for each piece (I4).** A piece may declare `visual`. With no visual, or with `flow`, the piece uses the
lesson's flowchart and the animated stage (camera, «Guarda qui») is unchanged. The other kinds are:

- `sequence`, `state`, `timeline` and `mindmap` are mermaid 12 sources. They are drawn by `LessonDiagram` (strict,
  rendered as an image) and grow one part per beat (`revealMermaid`). A cut sequence block or state composite is closed,
  so every step still parses.
- `code` is up to 30 lines, highlighted with highlight.js. Each beat names its `lines`, a band glides to them and the
  other lines dim.
- `formula` is TeX drawn with KaTeX as MathML and sanitized by DOMPurify's MathML profile. A legend explains each
  symbol, and each beat marks one of them.
- `chart` is a small Chart.js chart. Each beat marks a label.

`parseVisual` (`shared/lesson-visual.ts`) checks the header and refuses mermaid directives (`%%{`), click, href,
classDef and style lines, `javascript:`, TeX `\href`/`\url`/`\html*`, more than 16 parts, and bad chart data. A beat
may point only at a line, symbol or label that exists (`beatMark`).

**The «Studio» column (I3).** The column beside the lesson has two tabs, «Tutor» and «Studio». The Studio shows
tiles: Mappa mentale, Riassunto (with fact citations), Glossario, Flashcard, Quiz, Linea del tempo, Mettimi alla prova
and Podcast. Each tile is one short hidden run at low effort (`impara-studio`) over the lesson's verified facts only,
with no search (`studioPrompt`). Its output is checked by `parseStudio` and saved with the lesson (`Lesson.studio`),
so it reopens without a new run. «Rifai» makes it again.

- Flashcards go into the FSRS review as `<lesson>:s:f<n>` cards with origin `studio`. Making them again replaces the
  set, and a card asked the same way keeps its memory.
- The quiz plays in the existing review session (page argument `quiz:<lesson>`). A question becomes a review card
  (`<lesson>:sq<n>`) the first time it is answered.
- «Mettimi alla prova» is the tutor in a new `quiz` mode: one question at a time, with no card line.
- The podcast is a two-voice script, read by the app's local Piper voices: two different Italian voices when two are
  installed (`VoiceState.voices`), otherwise one.
- The timeline may answer that the lesson has none.

A tile is refused when the lesson has no verified fact. A tile still being made when the app closes is marked failed
at the next start.

**One primary button (I3).** The bottom bar has one primary button, «Ho capito, avanti». «Non mi è chiaro» opens a
menu with «Spiegamelo meglio» (M), «Fammi un esempio» (E), «Mostrami il codice» (C) and «Domanda» (D). The keys work
without the menu too.

**Dependencies.** `katex` 0.16.47 (MIT, published 2026-05-16, more than 14 days ago as rule 3 asks; it ships its own types) becomes a direct dependency. It was
already installed as a dependency of mermaid, so `package.json` and the lock's root entry change and `node_modules`
does not. Not added:

- `@mermaid-js/layout-elk`: its output could break `parseFlowLayout`, which the animated stage reads.
- Shiki: highlight.js already highlights the code.
- Rough.js: the hand-drawn style is optional.
- Motion: CSS transitions are enough for the reveals.

## Consequences

A lesson costs two more short runs (the gates), and each Studio tile costs one when the learner asks for it. The plan
gate runs before the first pieces are shown, so a lesson takes a few more seconds to open. The gate can only make a
piece better by the app's own checks. A rewrite that a model judges better but the app judges worse is not taken.
The structure and the checklist are asked of the model in the prompt. Only the citations, sizes, and option counts are
enforced. The visuals, the Studio and the gate were tried on the demo, not yet on a real model.
