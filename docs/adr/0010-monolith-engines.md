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
- **Cost**: Claude from each `result` (list-price USD on a subscription); while a turn runs (work chats stay in one
  turn for hours), a live figure (`ChatSummary.costLiveUsd`, shown "≈"): every `assistant` message's `usage` priced
  with `cost.mjs` weights, corrected by `get_usage`'s `session.total_cost_usd` (the CLI's real running total; the
  manager asks it every minute, busy chats in turn), replaced by the result (2026-10-11). Cursor: ACP reports no tokens
  today (a bug confirmed by Cursor): usage when present in the prompt response, or ACP `usage_update.cost` if Cursor
  starts sending it, otherwise "stima senza dati". Cursor's plan usage has no legitimate
  source (no personal usage API, internal endpoints barred by its ToS): the top bar says "n/d" with that reason.
- **Cursor cost ledger** (the user's choice "Stima + correzione CSV", 2026-10-11; research-cursor-cost.md §5.1-5.2):
  a Cursor `stop` hook script the app installs in `%LOCALAPPDATA%/second-brain/hooks/cursor-usage.mjs` appends each
  turn's tokens to `cursor-ledger.jsonl` beside it (shared by the stable and the dev app; an `agent -p` runner can pipe
  its result line into the same script). Priced at list price (+ Cursor Token Rate on third-party models) × a factor
  per model from the newest `team-usage-events-*.csv` in Downloads; the days the CSV covers take its exact $. Shown
  "≈ $ ±x%" (margin = worst day after the factor, ±20% before any CSV) until a CSV confirms it; Cursor chats get their
  session's estimate. `~/.cursor/hooks.json` is the user's: the app never edits it (rule 6), it only ships the script.
  No new dependency.
- **Process inventory** (each one justified): Electron main + renderer; one engine process per running chat; the brain
  tools run on demand as Electron-node children (chats.mjs, cost.mjs) and the brain data server child (to be folded
  in-process later, backlog). Nothing else.

## Consequences
- The user installs nothing for Claude besides the app; Cursor needs its CLI installed and logged in once.
- Developers and agents of this repo never run the real Cursor engine: tests use a fake ACP server
  (`test/fixtures/fake-cursor-acp.mjs`); the first real Cursor run is the user's, with short instructions.
- The ~245 MB engine binary is a dev dependency of the repo and an asset of each release, never committed to git.
