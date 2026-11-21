# ADR 0331 · Code Mode: work chats call their tools from one script (run_code), under the same permission chain

Date: 2026-11-21 · Status: accepted (owner, plan approved 2026-11-21: «un interruttore globale in Impostazioni, spento di
default»; «un'azione da Esegui dentro lo script si comporta come oggi: viene rifiutata, lo script si ferma lì e a fine
turno compare il solito bottone Esegui»; later the same day: «anche l'Orchestrator deve essere consapevole della Code Mode
e poterla modificare») · Amends: ADR 0218 (a second global switch next to balanced mode)

## Context

A work chat spends one model turn per tool call: read a file, grep, read again, run a command. Each round trip re-sends
the context. A script that batches those calls and returns only what matters costs far fewer turns and tokens. The
risk is a second path around the app's permission chain (role gate, read-only commands, auto-permit, the chat's own
preToolUse checks, the brain's PreToolUse product hooks, the user's rules in permissions.json).

## Decision

1. **One gate decision, two callers** (`src/main/chats/manager-requests.ts`). `gateDecision` (role gate, then command
   rules, then auto-permit) is the only logic; the native permission path (`answeredByGates`) and `decideFor(chatId,
   tool, input)` both call it. `decideFor` adds the product guard (the brain's PreToolUse hooks, run in process) and,
   for «ask», the usual permission panel (no «always» option, title prefixed «(run_code)»); its wait is reported so it is
   not counted against the script's time limit.
2. **Outcomes inside a script**: deny = an Error thrown in the script (it may catch it); Esegui = the call is refused
   with the native refusal text («write the exact command in a fenced code block»), the script stops there even if it
   catches it, and the turn's fenced block becomes the usual Esegui button (`run/asks.ts`, unchanged); ask = waits for
   the user like a native permission.
3. **Sandbox: QuickJS in WASM** (`src/main/code-mode/sandbox.ts`), not isolated-vm (a native module would need a
   rebuild per Electron version). No fs, net or require; 64 MB memory, 512 KB stack, 10 s CPU, 280 s wall clock without
   the user's waits, 200 calls, 40,000 output characters. A progress notification every few seconds keeps the MCP call
   inside the 300 s transport timeout.
4. **Tools seen by the script** (`natives.ts`, `bridge.ts`): thin Bash (the app's Git Bash), Read, Write, Edit, Grep,
   Glob on Node fs, plus the chat's own app tools and connectors forwarded in process. Each internal call is one compact
   tool row in the chat (name, input, decision, outcome).
5. **Switch**: setting `codeMode`, boolean, off by default, protected (agents only propose; the Orchestrator sets it on
   the user's words through `app_config` area `setting`, with the change log and Annulla). Shown in Impostazioni › Ruoli
   e deleghe; `app_guide` explains what it does, when it pays and whether it is on now. It applies to chats started
   afterwards; the Orchestrator itself keeps its native tools.
6. **Harnesses**: on Claude, run_code is allowed and the native Bash/Read/Edit/Write/Grep/Glob are passed in
   `--disallowedTools`. On Cursor (ACP) natives cannot be hidden: they stay, run_code is allowed and the prompt asks to
   prefer it.
7. **Measured from the logs**: each turn logs tokens, turns, duration and the flag (scope chats, «timing: turn usage»,
   `codeMode`); each script logs «run_code finished» (scope code-mode: calls, CPU, wall, waited).

## Dependencies

- `quickjs-emscripten-core` 0.32.0 and `@jitl/quickjs-wasmfile-release-sync` 0.32.0 (MIT, published 2026-02-16): the
  QuickJS engine compiled to WASM, no native code. The build copies `emscripten-module.wasm` to `out/main/quickjs.wasm`.

## Consequences

- One more global switch; with it off nothing changes (no run_code, no hidden tools).
- Known limit: the wall-clock limit is checked when the script runs or a host call settles, so one host call that hangs
  is bounded by that tool's own timeout, not by the script's.
