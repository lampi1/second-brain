# ADR 0058 · "Correggi il pensiero": correct a sentence of a chat's live reasoning

Date: 2026-10-15 · Status: accepted · Source: the owner's request, relayed by "Regia dell'app" (plan 15/10, "fai tutto
quello che ti sembra utile"); real probe allowed by the owner 15/10 22:41 (one run, cheap model)

## Context
In a chat's open "Ragionamento" block the user often sees the wrong turn early ("uso la libreria vecchia") and today
can only stop the chat and write a whole new message explaining which thought was wrong. Claude's transcript keeps no
thinking text (signature only), so after a stop the model cannot see what it thought unless the message quotes it.

## Decision
- **Gesture.** Select a sentence in an open reasoning block → a "No, così" button above it (or Ctrl+Shift+X) → a
  one-line form under the text with the quote and the fix. The block is frozen from the first mouse press until the
  form closes (a streaming block would move the selection). Corrected sentences stay marked (wavy red underline).
- **Two ways to send** (`store.correctThought`):
  - **Correggi** (Invio): the correction goes first in the chat's queue, the turn is interrupted keeping it
    (`chat:stop {keepQueued}`, the same path as "Invia subito"), and it runs as the next turn.
  - **Al prossimo passo** (Maiusc+Invio, **Claude only**): sent into the running turn; Claude reads it after its next
    tool step, nothing is interrupted. Cursor (ACP) takes no message mid-turn, so it gets only Correggi.
  - A chat already idle gets it as a normal message.
- **Refused while the chat waits on the user** (an open question or permission): stopping would cancel it. The form
  says why ("rispondi prima al pannello, poi correggi") and its buttons are disabled.
- **The message is plain user text, no contract change**: `[Reasoning correction]` / `In your reasoning you wrote:` the quote
  in «» (one line, ≤ 400 chars) / `Not like that: <fix>` / `Redo this step taking the correction into account.` In
  English like every prompt the app injects (i18n rule, 16/10); the first, Italian format is still read back. The UI parses it back into a
  "Correzione del ragionamento" bubble (quote struck through) and marks the quoted sentence in the latest earlier
  reasoning that holds it. Code: `lib/correction.ts`, `components/CorrectThought.tsx`.

## Real probe (15/10, one run, Haiku 4.5 via the Claude CLI 2.1.282, MAX_THINKING_TOKENS=3000, ≈ 0.23 $)
- **Mid-turn message: works.** A message written to stdin after the first tool_use was read in the same turn ("Fatto.
  ZEBRA.", one result, nothing queued): "Al prossimo passo" behaves as designed.
- **Interrupt: not exercised.** The CLI streamed **no thinking text**: only `system thinking_tokens` events, thinking
  blocks of 0 characters. With no text there was nothing to select, so the turn ended normally.
- **Next turn after a completed turn:** the model quoted its own last thought and saw the tool result.
- The user's own transcripts of 15/10 agree: Opus 5.5 blocks carry text only sometimes (63 of 1 073 thinking
  blocks in 14 sessions), Haiku none.

## Why no text arrives (CLI code read on 16/10, no tokens spent)
- The CLI (2.1.282, and the embedded engine 0.3.283) has a `--thinking-display <summarized|omitted>` flag and a
  `showThinkingSummaries` setting. In `-p` with `stream-json` and neither of them, the CLI sends no display value and
  the server default decides: in the probe above, that default gave no text.
- The app passes neither (`claude.ts` `args()`), so its Claude chats get the server default.

## Second real probe (16/10, the owner's direct ok, one run, Haiku 4.5, CLI 2.1.282, `--thinking-display summarized`, 0.02 $)
- **Thinking text streams** with the flag: `thinking_delta` from the block's start (4.7 s after the message), 699
  characters in the next turn's block. Without the flag (first probe): 0 characters.
- **Interrupt: works.** Sent after 163 characters of reasoning: `control_response success`, the turn ends as
  `error_during_execution` (the app's "interrupted by you"), cost 0.
- **The model does not see its interrupted reasoning** ("NON LA VEDO"): the quote in the message is the only way it
  knows what was wrong. It took the correction (names in Italian).
- **Decision:** the app passes `--thinking-display summarized` to every Claude chat (`claude.ts` `args()`): the
  Ragionamento block fills (proven on Haiku; Opus and Sonnet take the same API field, not probed). The text is the API's summary of the thinking, not the raw thinking; a CLI
  older than the flag (an explicit `SB_CLAUDE_PATH`, or the global `claude` on PATH that `resolveClaude` falls back to when the embedded engine is missing) would refuse to start; the embedded engine (0.3.283) has it.

## Consequences
- **Risk left:** Opus and Sonnet not probed with the flag; if one streams no text, its Ragionamento block stays empty
  and the gesture has nothing to show there (Cursor's thought chunks are not affected).
- The interrupt with a correction works on the real CLI (second probe); in the app it takes the existing "Invia
  subito" path, covered by its tests and by the fake engines here.
- Tests: `test/unit/correction.test.ts`; `test/e2e/correct-thought.spec.ts` with the fake engines' new `think` mode
  (Claude and Cursor stop, Claude step, blocked by a question).
