# ADR 0317 · A chat stops showing work when its reply is complete

Date: 2026-11-16 · Status: accepted (owner, thread «Fermare subito l'indicatore a fine turno», 2026-11-16: «as soon as
the last assistant text is shown and no tool call follows, the indicator stops at once»)

## Context

In the Orchestrator's chat the working line («sta pensando…») stayed for several seconds after the reply's last text;
only then the «Turno finito» line with the cost appeared. The user read it as the model still working.

What shows a chat as working was keyed on the chat's state, and a Claude chat is `running` until the CLI's `result`
and then its `session_state_changed idle`. Measured on 2026-11-16 with the real CLI (2.1.325, Linux, one haiku turn,
`test/live/turn-closing.live.test.ts` and a probe that timed every stream-json line):

| Between | No hook | A Stop hook sleeping 3 s |
|---------|---------|--------------------------|
| reply complete (`message_delta`, `stop_reason: end_turn`) → `result` | 21 ms | 3091 ms |
| `result` → `session_state_changed idle` | 6 ms | 10 ms |

So the app adds nothing: its own work at the result (cost, the turn's record, the context meter) is synchronous or
runs after the state change. The wait is the CLI's, and it is the Stop hooks: the CLI runs them all together after the
model's last message and writes `result` only when the slowest one ends (`hook_started` / `hook_response` bracket
them). A chat of a product brain has at least one (the rules runner, a `node` process: `rules/delivery.ts`), plus the
template's (`inbox.mjs hook`, `runbook-reminder.mjs`, which reads the whole session transcript and runs `git
ls-files`) and the brain's own `.claude/settings.json`. Each is a process start per turn; ADR 0099 puts the same
runner at 0.2-2 s per start on Windows.

History. On 2026-10-11 the same symptom («the tile stays "al lavoro"») was fixed for the time *after* the result: a
3 s fallback when the CLI's idle does not come (`claude.ts onResult`). It kept the indicator tied to the end of the
engine's turn. On 2026-10-18 ADR 0062 made the app add its own Stop hooks to every chat of a product brain, as
processes; ADR 0099 (2026-10-20) moved the other hook events into the app but left Stop a process. From then every
turn's result waits for those processes, and the indicator with it. No test tied the indicator to the reply's end.

## Decision

1. **The engine says when the reply is complete.** The Claude session reads the top-level `message_delta`: a
   `stop_reason` other than `tool_use` or `pause_turn` means the model stopped and asks for nothing more. It reports
   `SessionPatch.closing: true`; also at a `result` with no queued turn, until the idle comes (the 3 s fallback
   stays). `closing: false` when it works again: a new `message_start` (a Stop hook sent it back to work), a message
   sent meanwhile, a queued turn, a turn the CLI starts by itself.
2. **The state does not change.** The chat stays `running` until the real end: the queue, Stop, the menus, the
   auto-close, the reports to a parent and «done» keep their rules. The manager shows the fact as
   `ChatSummary.turnClosing`, only with state `running`, never persisted.
3. **What shows work follows it.** `showsWork(chat)` = busy and not `turnClosing` (`renderer/store/state.ts`): the
   working line of the Orchestrator, of an open chat, of a strip and of a delegated card, the person at work at a
   bench, and the state words («al lavoro»). Strips keep their 0.7 s hold (ADR 0312).
4. **The «Turno finito» line is the CLI's result, as before**: its cost is the real one, never an estimate shown
   early.
5. **The end of the turn is timed in the log.** `timing: turn` gains `closeMs` (reply complete → result),
   `stopHooks` and `stopHooksMs`: `npm run logs -- --scope chats --grep "timing: turn"` tells how long a brain's
   hooks hold each turn.

## Consequences

- Nothing moves between the last text and the «Turno finito» line. The line still comes when the hooks end: a brain
  with slow Stop hooks sees it late, and `closeMs` says how late. Making those hooks faster is the brain's matter (and
  the template's `runbook-reminder.mjs`, which reads the whole transcript at every stop).
- A message typed in that gap waits in the queue and leaves at the idle, as before.
- When a Stop hook sends the model back to work the indicator returns with the model's next message, not before.
- Codex and the ACP engines report no `closing`: their turn ends with their last message.
- `test/unit/chats/turn-closing.test.ts` feeds the engine the lines the real CLI wrote, with Stop hooks that do not
  answer until the test says so: nothing may show the chat as working in the meantime. No clock, no process.
