# ADR 0010 · A monolith with two engines: Claude embedded, Cursor CLI the only external piece

Date: 2026-10-11 · Status: accepted (supersedes the coexistence parts of ADR 0002 and phases.md)

## Context
The user: "se costa tanta complessità mantenere la retrocompatibilità con claude desktop o cursor al posto della cli lascia
perdere, io voglio un'app monolite che posso fare tutto da lì ben fatta"; then: "voglio che la versione 1 sia
utilizzabile anche con la cli di cursor però, anzi sarà proprio con quella che la proverò all'inizio".

## Decision
- **No coexistence features in v1**: no read-only view of Claude desktop / Cursor IDE chats, no "open in the desktop
  app", no external-session fork handling. The only thing shared with the outside is the brain folder (plain files).
- **Claude engine embedded**: the official Claude Code binary that the Agent SDK ships for Windows
  (`@anthropic-ai/claude-agent-sdk-win32-x64`, exact version, ≥ 14 days old; today 0.3.283 = Claude Code 2.1.283) is
  a dependency of the app, packaged with it (copied once per version to `%LOCALAPPDATA%/second-brain/engines/claude/`
  by the release script). The app speaks to it with the SDK's stream-json control protocol (ADR 0002), so no SDK JS
  runtime and none of its peers are needed. Login: the binary uses the user's own Claude config folder
  (`~/.claude`, i.e. the claude.ai subscription login; verified 2026-10-11: `auth status` → loggedIn, claude.ai);
  when not logged in, the app opens the embedded binary's official `auth login` in a visible terminal. Override for
  tests: `SB_CLAUDE_PATH`.
- **Cursor engine**: the user's installed Cursor CLI (`agent`), spoken to over ACP (`agent acp`: JSON-RPC on stdio,
  `session/request_permission` and `cursor/ask_question` become panels, `session/cancel` = stop). It is the only
  external program the app depends on, because Cursor ships no embeddable engine; its chats spend only Cursor credits.
  It is started directly through the CLI's own `node.exe index.js` of the newest version (no PowerShell launcher).
- **Cost**: Claude from each `result` (list-price USD on a subscription). Cursor: ACP reports no tokens today (a bug
  confirmed by Cursor): usage when present in the prompt response, otherwise "stima senza dati"; the CSV correction is
  backlog.
- **Process inventory** (each one justified): Electron main + renderer; one engine process per running chat; the brain
  tools run on demand as Electron-node children (chats.mjs, cost.mjs) and the brain data server child (to be folded
  in-process later, backlog). Nothing else.

## Consequences
- The user installs nothing for Claude besides the app; Cursor needs its CLI installed and logged in once.
- Developers and agents of this repo never run the real Cursor engine: tests use a fake ACP server
  (`test/fixtures/fake-cursor-acp.mjs`); the first real Cursor run is the user's, with short instructions.
- The ~245 MB engine binary is a dev dependency of the repo and an asset of each release, never committed to git.
