# ADR 0013 · "Esegui" on a chat's shell blocks: the user's click, PowerShell 5.1 in the app, the outcome back to the chat

Date: 2026-10-11 · Status: accepted

## Context
The user runs the commands his chats propose ("Commands for him to run: one at a time, … one click", the user's brain rules) and
asked for "Copia + Esegui" on the code blocks: Esegui only on bash/powershell, in a visible PowerShell 5.1 inside the
app with the output under the block; the chat that proposed it reads the outcome; it never starts by itself, and
production commands are his alone.

## Decision
- **Copia** on every fenced block of an assistant message; **Esegui** on shell blocks (bash, sh, powershell, ps1,
  pwsh, cmd) of an app chat, Claude or Cursor alike (`src/shared/runnable.ts`). Bash blocks run in PowerShell too: in
  his chats they carry PowerShell commands.
- **Only the user's click** starts a run: IPC `run:start` from the app page (sender-checked). No MCP tool, no agent
  path, no automatic run. Main (`src/main/run/runner.ts`) re-checks that the code is a block of that chat's own
  assistant message (a page bug cannot run arbitrary text) and caps it at 8000 characters.
- **Production**: a block that looks like production (sqlcmd to `*.database.windows.net`, the ops runner scripts,
  write `az` / `*-Az*` commands, `ro-query`) shows a red "produzione" badge and asks a second click that says why; main
  refuses it without `confirmProd`. The click is the user's own: this is him running it, as me.md wants.
- **How it runs**: `powershell.exe -NoProfile -NonInteractive -Command -` with a one-line bootstrap on stdin (base64 UTF-16 script; `-EncodedCommand` prints errors as CLIXML; no quoting
  issues), UTF-8 output, in the chat's folder, without the app's `SB_*`/`ELECTRON_*` variables. The exit code is the
  native program's, else 1 when the last command failed. Output tail streamed under the block (`run:updated`); Ferma
  kills the process tree; quitting the app kills every run.
- **The outcome back to the chat**: one click "Manda l'esito alla chat" sends exit code + output as the user's message
  (queued while the chat is busy). Agents can also read it with `app_command_runs` on `/mcp/app` (read-only; today the
  Regia and test agents have that endpoint). Not automatic: a message to a chat starts a turn and spends tokens.

## Consequences
- The Regia tile gets Esegui when `RegiaTile.tsx` passes `chatId` to `ItemList` (one prop, left to the Regia's owner).
- Next, if the user wants it: the per-chat browser MCP endpoint exposes "my last runs" so every work chat reads its own
  outcome without the message; an option "manda l'esito da solo" per chat.
- Only top-level fenced blocks get the toolbar: a block inside a numbered list or a quote is still shown as code, without
  Copia/Esegui (marked nests it in the list token); to do if the user meets it.
