# 0188 — Impara: research and verification before teaching, the animated board, the user's teacher

Status: accepted. Builds on ADR 0185.

2026-10-29.

## Context

The owner, 2026-10-29, after using Impara (ADR 0185): the section is hard to use. The diagram was cut and its labels huge,
it was not full screen, and the model taught from what it knew, unchecked. He asked for a lesson that can explain anything (IT
concepts, work things, PRs, the user's brain and the app itself), a model that "researches hard first and makes sure it
understood", a diagram with «guarda qui» animations, full screen by default, a clean UI, and the teaching model chosen by
the user.

## Decision

**Research before the lesson.** A start now runs, before the plan:

1. a **web run** (only on Claude) that sees only the user's own ask, never their files or the material, and has only
   `WebSearch` and `WebFetch` (no file tool at all). It returns facts, each with the page it was read on and a short quote.
   No web run for a PR (its ask says nothing a search could use, and its material is private), nor for a pasted text the
   user asked nothing about.
2. a **files run** (the user's teacher, read tools only, no web) over the lesson's material, the user's brain, the app's
   guide (the Guida page's concept cards, written next to the material as `guida-app.md`) and the app's source when the app
   runs from a clone with `src/`. It returns facts with `path:line`, and, only when the ask can mean clearly different
   things, at most two questions with 2 to 4 options.
3. a **verification run per side**, which did not write the facts it checks (Chain-of-Verification, Dhuliawala et al.
   2023): the web side re-reads each page of the web facts and nothing else, the files side re-reads each file (and
   checks the model-knowledge facts as well as it can, which exist only when there is no web run; with one, a files fact
   without a file is left out, since it may carry what the run read). Each fact becomes `ok`, `fixed` (corrected, with its source) or `unsure`; a wrong fact with no fix is dropped.
4. the **questions**, shown on the Preparing screen while the facts are checked; the plan waits for the answers or «Salta,
   decidi tu».

The plan and the rest are written from the verified facts (listed by id, the unconfirmed ones marked) and each piece
cites the facts it stands on; the player shows them as the piece's «Fonti», with each check's outcome. **All the sources
in one place** (owner, 2026-10-29: «che siano visibili da qualche parte le fonti che ha trovato, sia file del mio pc che
link web»): the head's «Fonti» opens a drawer with every source the lesson kept, grouped as web pages (opened in the
user's browser), files of this PC (opened in the app's read-only viewer at the cited line; a path the files run wrote
relative to its folder is stored as a full path), the model's own knowledge and the lesson's material, each with its
facts, their check and the pieces that use them. The Preparing screen lists the sources found as soon as they are checked. A research run
that fails does not stop the lesson: the Preparing screen says so and the lesson goes on with what the other found.

**Who explains.** The start form's «Chi spiega» picks the engine (any that is on and reads files), its model and its
effort (low to very high; max and Fable are refused by the hidden runs, as in the comparison). No choice = Claude's
strongest model, high effort. The web side always runs on Claude, whatever the teacher.

**The animated board.** The flowchart is laid out by mermaid and drawn by the app (`lib/viz/flow-layout.ts` reads the
SVG in an inert document; `LessonStage.tsx` draws it with React). Each piece is split into **beats**, one sentence each
with its nodes, an optional arrow and an optional «Qui» note. While a beat is said (the voice tells the board when each
sentence starts) or read (reading pace without the voice), the beat's nodes light up, a ring marks them, the arrow lights
and a light runs along it. The nodes of the pieces seen stay calm and the ones still to come are faint, so the picture
grows. The camera shows the whole drawing whenever its labels read at 80% or more of their drawn size, and goes close to
the beat only for a big drawing; labels are never shown past 1.2×. A drawing mermaid cannot lay out, or a piece's own
non-flowchart diagram, stays the still image of ADR 0185.

**Full screen by default.** The lesson fills the window (above the Orchestrator's dock, below the question window, toasts
and dialogs); Esc or the head's button leave it, remembered on this PC.

**Smaller fixes.** The end shows the checks as a count («0/1 domande giuste»), not a percentage next to the grade; the
rail keeps its titles on one line beside the Orchestrator and shows only numbers below 720 px.

## Security

The web run is the only hidden run with a network tool, and it holds nothing private: its prompt is the ask the user
typed for this lesson, its folder is an empty one, every file tool is denied in its session settings (`WEB_ONLY_SETTINGS`)
and refused by the app's own permission answer (`readOnlyAnswer` web mode), and it runs only on Claude, whose tools the
app can restrict to exactly the two web tools; no MCP server (`--strict-mcp-config`), no claude.ai connector
(`disableClaudeAiConnectors`, `ENABLE_CLAUDEAI_MCP_SERVERS=0`, also for every hidden read-only run) and no hook. Its
verification sees only the web facts: nothing the files run wrote reaches a run with the web. One limit remains: the
Claude CLI still loads the user's own `~/.claude/CLAUDE.md` (only `--bare` skips it, and `--bare` drops the user's
sign-in), so instructions the user wrote for Claude can reach the web run; their brain, files and material cannot.
The runs that read the user's files (research, verification, plan, rest,
extras, grade) have no web and no write tool, as in ADR 0185. So untrusted web text and the user's files never meet in a
run that could send anything out (the "lethal trifecta": private data, untrusted content and an outbound channel in one
place). Facts from the web reach the later runs only as data, quoted in their prompts. The model's answers are parsed and
capped (`shared/lesson.ts`: facts, questions, verdicts, beats, citations only of known fact ids, flows only between known
nodes). The board draws only numbers and plain text read from mermaid's SVG; that SVG is never put in the page.

## Consequences

A lesson costs more and takes longer to start (four to six runs before the first piece instead of one); the Preparing
screen shows each phase with what it found, and the user can leave the page. The facts and their checks were tried on the
frozen demo (hand-written, with one fact the check corrects), not yet on a real model. Next phases: quiz reviews per
subject with spaced repetition, and a faster live tutor with entry points from the other pages.
