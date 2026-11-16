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
them).

On the owner's PC (Windows, Claude Code 2.1.322, read on 2026-11-16 from the `stop_hook_summary` lines of his session
transcripts: 149 turn ends of chats in the brain's folder, most of 2026-11-13) every stop ran four hooks, three of
them added by the app's plugin:

| Stop hook | From | Median | p90 | Max |
|-----------|------|--------|-----|-----|
| `inbox.mjs hook claude` | the app's plugin (template hook) | 3.8 s | 9.1 s | 16.0 s |
| `runbook-reminder.mjs`, one copy | the brain's `.claude/settings.json` or the app's plugin | 2.1 s | 5.3 s | 9.4 s |
| `runbook-reminder.mjs`, the other | the app's plugin or the brain's `.claude/settings.json` | 2.0 s | 4.7 s | 9.4 s |
| `product-rules/hooks/runner.mjs` | the app's plugin (rules runner) | 1.6 s | 4.2 s | 8.7 s |
| **last text → end of the hooks** | | **4.0 s** | **11.4 s** | **33.5 s** |

The per-hook rows are the 104 stops of 2026-11-13; the last row is all 149 (in the 30 stops of 2026-11-14…16 single
hooks took up to 33 s, past their own 10-15 s timeouts). The wait is the slowest hook, not their sum. Run alone on
that PC, with the CPU at 100% and dozens of engine processes, an empty `node` start took 0.35-0.4 s and
`runbook-reminder.mjs` 0.7-1.7 s: most of a hook's time is the start of a process on a busy machine.

History. On 2026-10-11 the same symptom («the tile stays "al lavoro"») was fixed for the time *after* the result: a
3 s fallback when the CLI's idle does not come (`claude.ts onResult`). It kept the indicator tied to the end of the
engine's turn. On 2026-10-18 ADR 0062 made the app add its own Stop hooks to every chat of a product brain, as
processes; ADR 0099 (2026-10-20) moved the other hook events into the app but left Stop a process. From then every
turn's result waits for those processes, and the indicator with it. No test tied the indicator to the reply's end.

## Decision

1. **The engine says when the reply is complete.** The Claude session reads the top-level `message_delta`: a
   `stop_reason` of `end_turn`, `stop_sequence` or `refusal` means the model stopped and asks for nothing more (any
   other, known or new, keeps the chat at work until the result, as before). It reports
   `SessionPatch.closing: true`; also at a `result` with no queued turn, until the idle comes (the 3 s fallback
   stays). `closing: false` when it works again: a new `message_start` (a Stop hook sent it back to work), a message
   sent meanwhile, a queued turn, a turn the CLI starts by itself.
2. **The state does not change.** The chat stays `running` until the real end: the queue, Stop, the menus, the
   auto-close, the reports to a parent and «done» keep their rules. The manager shows the fact as
   `ChatSummary.turnClosing`, only with state `running`, never persisted.
3. **What shows work follows it.** `showsWork(chat)` = busy and not `turnClosing` (`renderer/store/state.ts`): the
   working line of the Orchestrator, of an open chat, of a strip and of a delegated card, the person at work at a
   bench, and the state words («al lavoro»). A delegated chat's state (`childState`), a root chat's row in the
   sidebar and the team's dots read a closing turn as ended too. Strips keep their 0.7 s hold (ADR 0312). Counts of
   running chats (top bar, taskbar, tallies) still follow the state.
4. **The «Turno finito» line is the CLI's result, as before**: its cost is the real one, never an estimate shown
   early.
5. **The app's own Stop hooks no longer start a process.** The rules runner's Stop is answered in process like its
   other events (`hook_callback`, `ProductHooks.stop`), unless the brain commits its memory at every stop
   (`rules.autoCommit`): that synchronous git stays in the runner, outside the app (`rules/delivery.ts
   stopInProcess`), and a Stop answered in process never commits, even when the brain turns `autoCommit` on while the
   chat lives (`LaunchFacts.inProcess`). In process a Stop never refuses: a brain the hook cannot read must not send the model back to
   work. The template's inbox hook is no longer added to the plugin (`rules/tools.ts REPLACED_HOOKS`): the plugin
   reaches only the app's own chats, and the app delivers their mail itself within 2 s, mid-turn too
   (`chats/mail.ts`, ADR 0015).
6. **A template hook the chat's own folder runs is not run twice.** A chat in the brain's folder whose
   `.claude/settings.json` (or `settings.local.json`) wires its own copy of a template Stop hook that can run (wired to
   that folder's own file, the file there with every file it imports: a migrated brain keeps its hooks and loses the
   tools they import) gets a plugin without that hook (`claude-plugin.ts` `ownStopHooks`; the owner, 2026-11-16: «se non serve togli»).
   A chat in any other folder, or in a worktree, keeps the plugin's copy, the only one sure to be there. The brain's files are read, never written.
7. **The end of the turn is timed in the log.** `timing: turn` gains `closeMs` (reply complete → result),
   `stopHooks` and `stopHooksMs`: `npm run logs -- --scope chats --grep "timing: turn"` tells how long a brain's
   hooks hold each turn.

## Consequences

- Nothing moves between the last text and the «Turno finito» line. The line still comes when the hooks end, and
  `closeMs` says how long that took. Of the owner's four hooks three are gone (the slowest, the runner and the
  plugin's copy of `runbook-reminder.mjs`); what is left for a chat in his brain's folder is that brain's own
  `runbook-reminder.mjs`, wired in its `.claude/settings.json`. That file is the brain's: the app does not edit it.
- A brain has up to two plugin folders, one for chats in its own folder and one for chats elsewhere, when its own
  settings wire a template Stop hook.
- The plugin's folder name changes once (its signature carries the hooks' layout): the first turn of each chat after
  the update reads its prompt uncached.
- A message typed in that gap waits in the queue and leaves at the idle, as before; the Stop button stays. Nothing
  says «closing the turn»: with hooks that take long the chat reads as ended while its queue waits for them.
- A message the app injected mid-turn that the CLI turns into a queued turn shows the chat as ended for the length of
  the Stop hooks, then at work again.
- Mail of two live chats with the same title waits (the app delivers to neither); the inbox hook gave it to the first
  that stopped.
- When a Stop hook sends the model back to work the indicator returns with the model's next message, not before.
- Codex and the ACP engines report no `closing`: their turn ends with their last message.
- `test/unit/chats/turn-closing.test.ts` feeds the engine the lines the real CLI wrote, with Stop hooks that do not
  answer until the test says so: nothing may show the chat as working in the meantime. No clock, no process.
  `test/unit/brain/rules-tools.test.ts` holds the plugin to a turn's end with no process of the app.
