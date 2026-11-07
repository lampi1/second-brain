# 0221. An ACP agent catalog, a record/replay harness for the engine wires, a turn-start watchdog

Date: 2026-11-07. Status: accepted.

## Context

Stage 4 of the cloudroom speed plan (proposals 8 and 10). cloudroom (Apache License 2.0) ships a list of known Agent
Client Protocol CLIs (`gui/plugins/provider-acp/src/known-agents.ts:36-356`, commit becdfa79) and a record mode of its
provider protocols with a replay/parity check and a watchdog on a turn's first event. Here:
- adding an ACP CLI meant writing a `harness/models.json` entry by hand;
- the adapters (Claude stream-json, Codex app-server, ACP) were tested against hand-written fakes; the CLI contracts
  (ADR 0055) replay recorded engine message shapes through the parsers one by one, but never a whole session in both
  directions (the app's requests, its answers to permissions, their order);
- a turn the engine took and never started looked like a busy chat: no sign on screen, no line in the log.

## Decision

**ACP catalog** (`src/main/engines/acp-catalog/catalog.ts`):
- Nine known ACP CLIs (omp, Grok Build, fx, Hermes Agent, OpenClaw, Devin, Droid, Kilo Code, Cline) are registry
  entries of kind `acp` with `source: 'catalog'`, `defaultOn: false` and never trusted by default.
- Settings → Account e strumenti lists them under «Altri agenti ACP (proposte)», with their start command, install page
  and sign-in command. «Attiva» is the user's click: it records the start definition (`engines:trust`, the same path as a
  brain engine) and lets agents use it. Until then no list offers it (renderer `lib/engines.ts` `offered`) and
  `engineOn` refuses it (`trusted` is false), so a switch saved by hand or by an agent starts nothing.
- The app installs nothing and runs no sign-in by itself (company PCs). Left out of the copy:
  - the installer scripts, icons, model lists, permission and reasoning flags and per-agent environment variables;
  - a sign-in that installs a daemon (OpenClaw `onboard --install-daemon`) or that is the bare CLI (Droid): empty;
  - Cursor and OpenCode, which are built in (ADR 0216).
- A brain `models.json` entry with a catalog id overrides it like a preset and is untrusted until turned on again.
- The data is copied with attribution: cloudroom's `LICENSE` (Apache 2.0) and `NOTICE` sit beside `catalog.ts`, whose
  header names the source file, lines and commit.

**Record mode** (`src/main/chats/wire-record.ts`):
- Off unless `SB_WIRE_RECORD_DIR` is set (tests, or the user's own dev run). Each session then writes
  `<dir>/<engine>/<chat>-<run>.ndjson`, one entry per wire line: `{ts, run, seq, dir, line}`.
- Redacted before writing (rule 2):
  - keys named like credentials (`apiKey`, `*token`, `*secret`, `password`, `authorization`, `cookie`);
  - key-, JWT- and bearer-shaped values;
  - the app's MCP url paths (they carry a token);
  - the user's prompt text, replaced by its length unless `SB_WIRE_RECORD_PROMPTS=1`.
- One line after spawn in each adapter (claude.ts, codex.ts, acp.ts). Its stdout listener goes first, so a line is
  recorded before what the adapter writes in answer to it.

**Replay and parity** (`test/fixtures/replay-engine.mjs`, `test/unit/chats/wire-replay.test.ts`):
- A recording is the script of a fake engine: it prints the engine lines up to the next app line, waits for the app's
  line, checks its shape, and maps request ids by position.
- Each adapter is replayed against its recording and must build the same chat (items and pending requests, without ids
  and times) as the recorded run. No model, no network, no tokens.
- The recordings in `test/fixtures/wire/` come from the existing synthetic fakes through the adapters' own record mode
  (`SB_WIRE_FIXTURES_UPDATE=1`). A test checks they hold no secret, no prompt text and no machine path.
- Coverage per engine:
  - Cursor and the ACP catalog engines: synthetic recordings (the fake Cursor's). Rule 4: no agent runs the Cursor CLI.
  - Claude and Codex: recorded from their fakes too. A real recording is the user's own opt-in dev run.
  - The Anthropic API engine (HTTP, no child process): not covered; it has no stdio wire to record.

**Turn-start watchdog** (`src/main/chats/turn-watchdog.ts`, wrapped around every session in `engines/sessions.ts`):
- A message sent to an idle session that gets no first engine event within `SB_TURN_WATCHDOG_MS` (default 120 s) shows
  a warning in the chat («… non ha ancora risposto dopo N s: il messaggio è inviato, la sessione resta aperta») and logs
  a warn line with cause and hint.
- It never restarts, closes or replaces the session.
- A late first event turns the warning into an info line, and every turn logs `timing: turn start` with its
  `firstEventMs`.

## Consequences

- A user who has one of the nine CLIs installed turns it on with one click and its own sign-in in a terminal.
- An adapter change that breaks a recorded protocol shape fails a unit test without spending tokens. A new protocol
  shape is added by recording a fake run, or by the user's opt-in real run after reviewing the redacted file.
- A stalled engine is visible and greppable; what to do about it stays the user's choice (wait, or Stop and resend).
- Not copied from cloudroom: bypassPermissions or disabled questions, cloud VMs, the Agent SDK dependency, Cursor print
  mode, children writing without a worktree.
