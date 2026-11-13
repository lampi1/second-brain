# ADR 0299 · One command, one panel: an identical command never runs twice by accident

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13: «An identical command can never run twice by accident, and a
command already queued by a worker is never offered a second time») · Amends: ADR 0239 (asked once: now in any folder)

## Context

On 2026-11-13 a work chat left an Azure deploy for Esegui (flagged «cambia una risorsa Azure»). The Orchestrator,
presenting the worker's result, repeated the same command in its reply as a ```powershell block, and the app drew a
second runnable command under it. The user clicked Esegui on both: `app_command_runs` showed two runs of the identical
command, both running, 105 s apart, one owned by each chat. Nothing stopped the second run and nothing said the first
was going.

The asks already merged the same command left by two chats (ADR 0239), but only in the same folder, and the
Orchestrator's folder is not the worker's. The runner refused only the same block twice, not the same command from
another block.

## Decision

1. **Same command = same normalized text** (`shared/command-dupes.ts normCommand`): trimmed, every run of whitespace
   (line ends included) one space. Different trailing spaces or CRLF are the same command; a different argument is not.
   The folder no longer matters (the owner's «in any chat»).
2. **One command, one panel.** A command request (`run/asks.ts`) whose command another chat already left waiting, or
   whose identical command runs now, is not offered again: that chat follows the first and gets its result (ADR 0239's
   followers, now in any folder). In the chat view a code block whose command another block already left waiting or
   runs now has no Esegui: it is a reference to that one (`renderer/lib/runs.ts commandRefOf`, `CodeBlock.tsx RefLine`)
   with its state («in attesa», «in corso», «finito, exit N»), «Apri» and the original's live output. The reference is
   remembered for the window's life, so it keeps the state after the request left or the run ended; when what it
   pointed to is gone without a run («Non serve») the block gets its Esegui back.
3. **Guard at run time, in main** (`run/runner.ts start`), so the block, the card, Telegram and Remote Control all meet
   it: an identical command still running in any chat starts no process; `start` returns that run with
   `already: 'running'` and the UI says «Già in corso da N s, avviato da «chat»» with its live output. It is never
   overridden. One that ended in the last 10 minutes (`RERUN_MS`) returns `already: 'done'`; it runs only with
   `confirmRerun`, the user's yes to «Eseguito N min fa, exit X. Rieseguire?» («Riesegui» under the block, a toast on
   the card; away from the PC, a second «sì» to the same request within 30 minutes). A shell that could not even start
   ran nothing and asks no confirmation.
4. **Stricter for flagged commands.** A command the app already classifies as production, a database or Azure
   (`prodRisk`, `chats/ask-text.ts touchesProdDbAzure`, both unchanged) asks the re-run confirmation with no time limit
   within the same app session.
5. **The Orchestrator's rule** (`WAKE_RULE`): a command a worker already left for Esegui is never repeated as a runnable
   block; it points to the existing panel, and when `relay_question` needs it whole it writes it in a ```text block.
   Point 2 is the enforcement, this is the instruction.
6. **Visible to agents.** A run that re-ran a command carries `duplicateOf`, the id of the first run of that command in
   this app session (`app_command_runs`); a command request whose command already ran carries `command.duplicateOf`
   (`app_pending`).

Not changed: how commands are classified, permission prompts, and no running command is ever cancelled by the app.

## Consequences

- The same command left by two chats in different folders (two repositories asking `npm test`) is now one request and
  one run, in the first chat's folder; the second chat gets that result. The owner chose «in any chat»; a folder-aware
  rule can come back if this bites.
- The guard's memory lives in main for the app session (one entry per distinct command, without output); a restart
  forgets it.
- Untried on a real PC: the tests cover the asks, the runner with a fake process, the normalization and the reference.
