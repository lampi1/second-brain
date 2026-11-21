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
   prefer it. Amended 2026-11-21: Claude defers MCP tools behind ToolSearch, so a chat with its natives hidden saw no
   file or shell tool and nothing pointed it at run_code (an Opus Scout gave up after a keyword search). A Claude Code
   Mode chat gets `--append-system-prompt` naming run_code and its `select:` query, and run_code's description starts
   with the words such a search uses (read file, shell, Bash, grep, glob). Checked on the real CLI by
   `test/live/code-mode.live.test.ts` (SB_LIVE=1); on the real Cursor agent by `test/live/code-mode-cursor.live.test.ts`
   (SB_LIVE_CURSOR=1, a rule-4 exception the owner granted for this check, 2026-11-21).
7. **Measured from the logs**: each turn logs tokens, turns, duration and the flag (scope chats, «timing: turn usage»,
   `codeMode`); each script logs «run_code finished» (scope code-mode: calls, CPU, wall, waited).
8. **What a native call meets, an internal one meets too** (review of 2026-11-21). With Code Mode on, Claude's own
   deny and ask rules no longer see the calls, so `decideFor` reads them itself (`code-mode/claude-rules.ts`): managed,
   user, project and local settings files, the session's `--settings` (the stable app's guard rails included,
   `ClaudeSession.toolContext`). A deny refuses; an ask goes to the user even when the gates would allow; a file that
   exists but cannot be read or parsed refuses every call (fail closed). Read deny rules also filter what Grep and Glob
   return. In plan mode Write, Edit and commands that do not only read are refused, and app tools always ask.
9. **Run-scoped execution**: the wrappers run in the folder the engine reports at init (a `--worktree` chat's
   worktree; before that every call is refused), with the chat's engine environment, never the main process's. Each
   run has its own AbortController, aborted when the script ends: a pending panel goes away, a running command is
   killed, an app or connector call gets its signal. Bash's timeout never passes the run's time left; the sandbox wakes
   at the wall limit even while a host call hangs. Read, Grep and Glob run in a worker thread
   (`out/main/code-mode-fs-worker.js`) with a 30 s limit (it ends the thread: a regex that backtracks cannot block the
   main process), 10 MB per file, 20,000 files per walk, 1,000-character patterns. Each run gets a fresh QuickJS
   instance in a bounded WebAssembly memory (the limit plus 32 MB), since QuickJS's own limit does not count typed
   arrays.

## Dependencies

- `quickjs-emscripten-core` 0.32.0 and `@jitl/quickjs-wasmfile-release-sync` 0.32.0 (MIT, published 2026-02-16): the
  QuickJS engine compiled to WASM, no native code. The build copies `emscripten-module.wasm` to `out/main/quickjs.wasm`.

## Consequences

- One more global switch; with it off nothing changes (no run_code, no hidden tools).
- A fresh QuickJS instance costs about 50-70 ms per run (measured in the unit tests on 2026-11-21).
- Claude's rule matching is the app's reading of its documented syntax (`Tool(prefix:*)`, path globs, `mcp__server`);
  a rule form it does not know never matches, so the gates and the user's panel still apply to that call.
