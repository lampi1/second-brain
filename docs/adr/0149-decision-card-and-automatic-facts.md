# ADR 0149 · One decision card with the chat's brief; memory facts need no approval

Date: 2026-10-24 · Status: accepted (owner, 2026-10-24: «la ui delle domande fa schifo, a volte poi mi cita contenuto
non direttamente nella modale ma magari nel messaggio che ha scritto prima di aprirla. E poi a volte ho 2 UI diverse con
si no diversi, voglio uniformare»; on the mockups: «la prima, spingi tanto nella generative UI», «l'importante è che sia
sempre chiaro il contesto della domanda»; on memory: «mi propongono troppi fatti per le memorie degli agenti, voglio
vedere solo skill e rule») · Builds on: ADR 0033 (generative UI), 0049 (the questions window), 0129 (memory keeps
reusable knowledge), 0135 (yes/no questions and the recap)

## Context
After ADR 0135 every agent question was yes/no, but what it was about still lived in the chat text before it: the
question said «come sopra» and the card showed that text only folded, or not at all. Four different cards asked for a
yes or a no (agents' questions, the Strategist's plan, durable work and lessons, routines), each with its own buttons
and words. And the memory deck asked the owner to approve facts one by one, though facts are only background
knowledge for the agents.

## Decision
- **The brief.** A new catalog component `brief` (`shared/genui.ts`): `done` (1-5 lines on what was done), `ifYes`,
  `ifNo`, and the evidence the chat has: `checks` (label + status), `images` (screenshot paths), `files` (path, why,
  +/−). Only with `show_ui` target `next-ask`: it is the context of the chat's next question.
- **The rule and the gate.** `QUESTION_RULE` tells every chat to send the brief right before asking and to keep the
  question short and self-contained (never «come sopra»). The engines' question gates (`chats/claude.ts`,
  `chats/acp.ts`) send a yes/no question without a waiting brief (`Artifacts.hasBrief`, through
  `SessionOptions.briefReady`) back once with `BRIEF_REFUSAL`, after `BRIEF_GRACE_MS` (1.5 s) for a `show_ui` called
  in parallel. It shares the `YESNO_RETRIES` counter: the third ask is shown as it is, so a chat never stays stuck.
- **One card.** `DecisionCard.tsx` is the only yes/no card: who asks, the question large, the evidence in a soft panel
  (the brief: ✓ lines, the screenshot beside them, checks as chips, files clickable; other visuals the chat attached),
  «Se Sì / Se No», then always the same answers: Sì, No, «Scrivi una risposta…», «Non voglio rispondere»; Esc = «Ci
  penso dopo». Keys: 1 / S (Y, J) yes, 2 / N no, 3 / T write, Enter the recommended one. Used by agents' yes/no
  questions in every size (questions window, Orchestrator, chat tile, lane, the Strategist's strip), the Strategist's
  plan (steps, done-when and what is known always open), durable work and lessons, and routine decisions. Questions
  that are not yes/no (the gate's third try) and permissions keep their option cards. Routine recovery questions
  (`FlowRestartApproval`) keep their own content for now.
- **The chat's text.** With a brief, the turn's prose stays folded under «Messaggio della chat»; without one (an old
  question, the gate's third try) the card says so and shows it open inside the card.
- **«Non voglio rispondere».** To an agent: a written answer that it should pick the safest way or stop. For a plan,
  a work proposal, a lesson or a routine: the proposal is dropped, like No without a comment.
- **Facts need no approval.** The Proposte deck has no memory cards any more (only skills, rules and the other
  sources). The maintenance job `merge-memory` (`brainmodel/memory-tidy.ts`), after merging and generalizing, saves
  the remaining proposed facts as confirmed (a newer value replaces the confirmed fact it contradicts or supersedes),
  and keeps at most `MEMORY_CAP` (40) confirmed facts per role: the least recently confirmed go first, facts a person
  confirmed last. Each pass is one Log change per role with Annulla (`MemoryTidyUndo.confirmed`, `tidyMemory` confirm /
  prune); a fact whose change the user undid is left as he left it, marked `<tag>:undone` so agents stop reading it.
  Until a pass runs, launch memory also takes proposed facts that are not tied to a single case and do not contradict,
  replace or repeat a confirmed one (`launch-memory.ts`). A fact tied to one case still waits for an engine to make it general.

## Consequences
- The owner reads one card everywhere and never needs the chat to answer.
- A chat that skips the brief costs one more turn (the gate), once per question.
- Facts can be wrong without anyone checking them; the cap, the worth filter and the Log with Annulla bound the damage.
  "Least recently confirmed" stands in for "least used": the app does not count how often a fact is recalled.
- A fact an agent proposes reaches later launches with no person in between, so a prompt injection that gets a chat
  to call `memory_propose` persists across runs. Facts are quoted as evidence, never as policy, and the Log shows each
  saved fact with Annulla.
