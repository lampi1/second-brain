# Engine parity audit (main 7baeca9)

What works only with Claude (the Claude Code CLI or the Anthropic API) and does nothing, or breaks, for a user who has
only Codex, only Cursor or only another API key. Read-only audit, no code changes. Each item gives what happens with
Codex only and with Cursor only (file:line, paths under `src/` unless stated), the impact for the user and a proposed
fix. Sorted by impact.

**Caveat:** the Codex adapter has never run against a real CLI. `chats/codex.ts:4-7` and `brain/adapters/codex.ts:5-7`
mark several `-c` keys (`mcp_servers.<n>.url`, `approval_policy`, `sandbox_mode`) and message shapes UNVERIFIED, and
`test/fixtures/cli/codex` was built from the schema, not recorded. If `mcp_servers.*.url` is wrong, Codex chats lose
every app tool with no error. The Codex rows below assume the adapter works as written.

## Summary

| # | Impact | Feature | Codex only | Cursor only |
|---|--------|---------|------------|-------------|
| 1 | High | Default engine everywhere, starter agents | chats start on Claude and fail | same, except task kinds with a Cursor row |
| 2 | High | Chats about the app itself | refused | refused |
| 3 | High | App MCP tools pre-approved | a click per app or browser tool | a click per call, no "always" |
| 4 | High | Cost, usage, budgets | no cost, "Oggi" 0 $, no budget | run cost always unknown |
| 5 | High | Brain hooks (correction log, limits, guards, auto-commit) | none | partial |
| 6 | Medium | Model calls outside chats (headline, agent builder, judge) | never run | never run |
| 7 | Medium | Brain rules at launch | instructions and skills only | nothing from the app |
| 8 | Medium | History and search of closed chats | empty after restart | empty after restart |
| 9 | Medium | Skills page and "/" menu | invisible, empty | listed |
| 10 | Medium | API-key engines: models | (API: Claude model refused; OpenAI-compatible has none) | — |
| 11 | Medium | Orchestrator on an engine without tools | (API engines: silent chat-only Orchestrator) | — |
| 12 | Medium | ACP without http MCP | — | no app tools, silently |
| 13 | Low | Agent tool policy and ceiling | partly enforced, not reported | partly enforced, not reported |
| 14 | Low | Mid-turn messages ("Al prossimo passo", live mail) | gated off although Codex can steer | gated off |
| 15 | Low | Permission modes, continuity, warm engine, fork, worktree | Claude-only caps | Claude-only caps |
| 16 | Low | Login readiness, setup, doctor | "non verificato", Codex gets no hooks setup | "non verificato" |
| 17 | Low | Analytics provenance, skill-use detection | model unknown, skills not counted | model unknown, skills not counted |

---

## High

### 1. Claude is the default everywhere and is never checked for login
- **Where:**
  - Claude is built in, trusted and on by default; Codex is off by default (`main/engines/registry.ts:63-66,152`).
  - `engineOn`/`agentsMayOpen` look only at the switches, never at login (`main/engines/policy.ts:15-18`), although
    Claude's login is readable (`main/cli.ts:45-52`).
  - Defaults:
    - Nuova chat: `renderer/store/ui.ts:105`.
    - Chats the Orchestrator opens: `regiaChats.harness`, `main/brain/settings-schema.ts:210`.
    - Routed fallback: `main/chats/routed.ts:47-48`.
    - The standalone brain-page Discuss: `renderer/brain/components/Discuss.tsx:204`, which hard-codes
      `defaults: { harness: 'claude' }`.
  - The template routing table has Claude and Cursor rows only (`brain-template/harness/models.json`).
  - The six starter agents are seeded once with the first engine that is on, trusted and has a default model
    (`main/agents/catalog.ts:198-204`). That is Claude, because the embedded Claude Code always counts as installed
    (`cli.ts:43-52`). The CLI status is not known yet at seeding time (`main/wiring.ts:303`).
- **Codex only:** Nuova chat, «Apri una chat», DevOps «Apri chat», `app_create_chat` and every starter agent start on
  Claude and stop at «Accedi a Claude». To recover the user must turn Codex on (both switches), turn Claude off, change
  `regiaChats.harness` and edit six agents by hand. Nothing guides them. **Breaks.**
- **Cursor only:** the same, except task kinds that have a Cursor row in the table.
- **Fix:**
  - Treat an engine whose status says `loggedIn === false` as unavailable in `canRun`, the defaults and
    `catalog.defaults()`.
  - On first run, set `newChat.harness` and `regiaChats.harness` from the first ready engine.
  - Re-seed untouched presets (`origin.kind === 'preset'`, not `userLocked`) when the status arrives.
  - Make Discuss use the user's defaults.

### 2. Chats about the app itself are locked to Claude
- **Where:** app-area chats must run on the engine of `appChats`' model, `claude-opus-5-5` in the template
  (`main/brain/routing.ts:60`). `resolve` refuses any other engine: `if (isApp(area) && harness !== appEngine(reg))`
  (`routing.ts:225`, also `:113`). «Migliora l'app» (`main/improve/service.ts:253-261`) and «Personalizza l'app»
  (`main/improve/proposal-bridge.ts:63-73`) always go through it.
- **Codex only / Cursor only:** creation fails with «le chat sull'app vanno solo su Claude», even when the user picked
  the engine. **Breaks.**
- **Fix:** when the app engine cannot run (off or logged out), use the engine the user picked; or let an explicit pick
  override `appEngine`.

### 3. The app's own MCP tools are pre-approved only on Claude
- **Claude:** `--allowedTools mcp__second-brain-app,…` when `caps.preAllow`, which only Claude has
  (`main/chats/manager.ts:1872-1877`, `registry.ts:47` vs `:51`).
- **Codex only:** only `send_to_chat`, `list_chats` and 8 read tools are auto-approved (`brain/adapters/codex.ts:43-56`).
  Everything else is `default_tools_approval_mode=prompt`: `app_create_chat`, `app_close_chat`, `app_set_chat_*`,
  `app_ui`, `app_screenshot`, `app_routing_save` and every browser tool. The prompt is an MCP elicitation that refuses
  "always" (`chats/codex.ts:488-490`).
- **Cursor only:** no pre-approval at all. Every MCP call is a `session/request_permission` panel, allow-once only
  (`chats/acp.ts:685-692,902-917`).
- **Impact:** an Orchestrator on Cursor asks for every `app_chats` and `send_to_chat`. On Codex every chat it opens or
  closes needs a click, and driving a browser needs one click per step. Core flows degrade into a stream of clicks.
- **Fix:**
  - Codex: `approval_mode=approve` for the app's own loopback servers, the same trust Claude's wildcard gives.
  - Cursor: write `Mcp(second-brain:*)` and `Mcp(second-brain-app:*)` into `permissions.allow` of the app-owned
    `CURSOR_CONFIG_DIR` snapshot (`acp.ts:154`, `snapshotCursorConfig`). That folder is the app's, not the user's.

### 4. Cost, usage and budgets ignore Codex and the API engines, and Cursor run costs are lost
- **Where:**
  - The top bar shows Claude (cost.mjs), Cursor (ledger or export) and Kimi tokens (`main/brain/usage.ts:133-160`).
  - "Oggi" sums only Claude, Cursor and live Claude chats (`renderer/lib/live-costs.ts:55-60`).
  - The 5h/7d and Cursor groups are always drawn (`renderer/components/UsageBar.tsx:95-109,154-163`).
  - Budgets exist only for `claude` and `cursor` (`main/brain/budget.ts:17-21,34`;
    `main/brain/settings-schema.ts:22-33,247`).
- **Codex only:**
  - Every turn sends `costUsd: 0, costKnown: false` (`chats/codex.ts:466-468`), so the tile says «costo n/d» while the
    cost list shows 0 $ (`live-costs.ts:96`).
  - "Oggi" reads **0 $**, and the Claude windows show "—".
  - Codex's own plan windows (`account/rateLimits/updated`) are thrown away (`codex.ts:135`).
  - No budget alert is possible, even with `CODEX_API_KEY`, which is real money.
  - Agent run cost is always unknown, and the headline digest prints $0.00 per chat (`main/headline.ts:94-95`).
- **Cursor only:**
  - The top bar works as designed: a ledger estimate.
  - But agent runs start with `costKnown: caps.cost` (`manager.ts:478`), which is false for ACP (`registry.ts:49-51`),
    so `costUsd` stays null forever (`main/agents/runs.ts:103,185`).
  - Meanwhile ACP sends a known `turnCostUsd` (`acp.ts:618-628`), which the tile and analytics show. Two surfaces
    disagree.
- **API key only:** each API chat's cost and the month's spend are computed (`chats/api.ts`, `engines/spend.ts`) but
  never reach "Oggi" or a budget.
- **Fix:**
  - Start runs at `costUsd: 0` (a `costKnown: false` turn already nulls it).
  - Add Codex price rows and price its `turnTokens` the way ACP's `priceFallback` does.
  - Parse Codex rate limits into `Usage.codex`.
  - Add the day's API spend to `composeUsage`.
  - Generalize budgets to every engine with a cost.
  - Draw only the groups of engines that are on.

### 5. Brain hooks are Claude-first: Codex gets none, Cursor gets part
- **What each engine gets:**
  - **Claude:** the full set (`brain-template/install.mjs:141-160`, `harness/claude/settings.hooks.json`,
    `.claude/settings.json`): vendor-guard, brain-limits, correction-catch (+ ai-wins), chat-feed, panel-dismissed,
    inbox, compact-now, runbook-reminder, auto-commit.
  - **Cursor:** `harness/cursor/hooks.json` has context-boot, prod-guard, vendor-guard and correction-log. No
    brain-limits, no chat-feed, no auto-commit. Whether Claude's hooks fire under Cursor is "still open"
    (`harness/tools.md:61-66`).
  - **Codex:** nothing. `install.mjs:62` offers only claude/cursor, the template ships no Codex hooks, and the adapter
    passes only instructions, skills and MCP (`brain/adapters/codex.ts:58-78`), although Codex has hooks
    (`codex.ts:136`).
- **Codex only (silent):**
  - No correction reminder, so fewer `ai-errors.md` lines. `aiErrorsPerRun` then counts Codex runs as checked with 0
    errors (`main/agents/run-metrics.ts:77,148`): a misleading "perfect" score.
  - No ai-wins.
  - No brain-limits: the fixed-context budget and the `now.md` rule can be broken.
  - No vendor-guard (repo rule 4: Codex could start `claude` or `agent`).
  - No prod-guard.
  - No auto-commit of a local-only brain: app sync commits only domains with a remote (`main/brain/sync.ts:147`).
- **Cursor only:** brain-limits never runs, and auto-commit runs only where the chat's project is the brain folder
  (unverified).
- **Fix:**
  - Ship `harness/codex` hooks and pass them per launch with `-c` (the adapter never writes `~/.codex`).
  - Or move the correction reminder and auto-commit into the app for engines without hooks.
  - Until then, mark `aiErrors` coverage "unknown" for runs on such engines.

## Medium

### 6. Model calls outside chats need the Anthropic API (or headless Claude Code)
- **Where:**
  - Grindhouse headline: `complete` goes to `engines.text` (`main/index.ts:121`), and `TextModel.ready()` accepts only
    the Anthropic API engine (`main/engines/text.ts:83-96`).
  - AI agent builder («guida AI»): requires the Anthropic API, a key and `/^claude-/` models (`main/wiring.ts:246-268`).
  - The routing judge and the compare report writer fall back to headless Claude Code (`engines/text.ts:1-6`).
- **Codex / Cursor / OpenAI-key only (and also Claude Code without an API key):**
  - The headline never runs. The built-in list shows forever.
  - The tooltip promises the model's line «arriva con il prossimo aggiornamento» (`renderer/i18n/areas/home.it.ts:15`),
    and Costi shows a "$0.00 … 0 requests" line (`HomeHeadline.tsx:24-28`).
  - `headlineModel` is free text and is not checked against `/^claude-/` in `complete()`.
  - The builder is disabled with a clear reason.
  - Judge and report steps fail. Does nothing, partly explained.
- **Fix:** give `TextModel` an OpenAI-protocol path (`/chat/completions`) for any enabled API engine, or a headless
  one-shot on any engine (`compare/headless.ts` already runs on all kinds). When none is available, say why in the
  tooltip and hide the Costi line.

### 7. Brain rules at launch: ACP engines get nothing from the app
- **Claude:** a plugin with skills, agents, styles and hooks (off by default, `brain/adapters/claude-plugin.ts:31-36`),
  plus AGENTS.md.
- **Codex only:** AGENTS.md as developer instructions and skill roots `.agents/skills`, `.claude/skills`
  (`brain/adapters/codex.ts:76-77`). No subagents, no output style, no hooks.
- **Cursor / Kimi only:** `main/engines/sessions.ts:65-77` never applies launch rules. Cursor depends on the user-level
  install or AGENTS.md in the working folder; Kimi outside the brain folder gets no brain rules. Silent.
- **Fix:** in the `acp` case, add `instructionsOf(domains)` as a first-turn prefix (like the agent profile,
  `manager.ts:629`), behind a launch-rules toggle.

### 8. History and search of non-Claude chats disappear after a restart
- **Where:** `chats.json` stores no messages (`chats/store.ts:1-5`), `ensureHistory` needs `caps.transcript`, which
  only Claude has (`manager.ts:1773`), and search reads only Claude transcripts (`main/index.ts:85`).
- **Codex / Cursor / API only:** a closed chat shows nothing until resumed. Ctrl+K finds only titles, and
  `app_chat_items` gives the Orchestrator `[]`.
- **Fix:** read `api-chats/<id>.json` for API chats (it exists). Keep a capped item cache per chat without a
  transcript, or read Codex's rollout files read-only.

### 9. Skills page and the "/" menu: Codex is invisible
- **Where:** `HOME_DIR` = `{ claude: '.claude', cursor: '.cursor' }` (`main/skills/service.ts:27`), `commandsFor('codex')`
  returns `[]` (`service.ts:187-196`), and codex.ts never sends `sink.commands` (ACP does: `acp.ts:1010`). The save
  guard reads only Claude PreToolUse hooks (`main/skills/guard.ts:30-36`).
- **Codex only:** its skills (`~/.codex/skills`, `.agents/skills`, which the adapter itself loads) are not listed or
  editable, and the "/" menu is empty. Nothing guards a save.
- **Cursor only:** skills are listed, but nothing guards a save.
- **Fix:** add the Codex places, call app-server `skills/list` for commands, and guard saves on every engine.

### 10. API-key engines cannot pick their models
- **Where:**
  - Anthropic API: the model list comes from Claude's rows (`registry.ts` `priceEnginesOf`, `sessions.ts`
    `withApiModels`).
  - But `resolve` refuses them: «claude-opus-5-5 gira solo su claude, non su anthropic» and the `looksClaude` check
    (`main/brain/routing.ts:223-224`). The create button is disabled (`renderer/components/NewChatDialog.tsx:227`).
  - OpenAI-compatible: no rows in the template, so no models and no prices. An agent on it cannot be saved (an API
    engine has no default model: `wiring.ts:259`, `catalog.ts:243`).
- **Impact:** API-only users cannot start a normal chat (only the «Sui crediti API» writing route works) or create an
  agent. **Breaks.**
- **Fix:** accept `priceEnginesOf(harness)` rows in `resolve` and `looksClaude`. List models from the endpoint's
  `GET /models`, or allow a free model id for API engines.

### 11. An Orchestrator can be created on an engine with no tools
- **Where:** RegiaSetup offers every engine that is on and trusted, API engines included
  (`renderer/components/RegiaTile.tsx:42`), and `manager.create` does not refuse it (`manager.ts:411-420`), although
  `caps.tools` is false.
- **Impact:** an Orchestrator that can only chat: it cannot open chats or read mail. Silent. The settings schema
  already filters on `caps.tools` (`settings-schema.ts:145`).
- **Fix:** filter on `caps.tools` in RegiaSetup and throw in `create`.

### 12. ACP engines get the MCP servers only if they advertise http MCP
- **Where:** `mcpServers()` returns `[]` with no message otherwise (`chats/acp.ts:440-445`).
- **Cursor / Kimi only:** a build without `mcpCapabilities.http` has no browser tools, no `send_to_chat`, and an
  Orchestrator with no app tools. Silent.
- **Fix:** a warning line in the chat when MCP URLs are set but http is not advertised.

## Low

### 13. The agent tool policy and ceiling are only partly enforced off Claude, and nobody is told
- **Where:** `unenforced()` computes the gaps (`main/agents/tool-policy.ts:117-137`), but nothing in production calls
  it.
- **Cursor / Kimi:** only the `plan` ceiling and the browser class are enforced (`acp.ts:502`, `browserAllowed`).
- **Codex:** the ceiling maps to a read-only or on-request sandbox (`tool-policy.ts:108-113`); `web` and the user's own
  MCP servers stay reachable.
- **Impact:** small today, because no UI sets `tools` or `permissionCeiling`.
- **Fix:** call `unenforced(kind, policy)` in `validate`/`resolve`. Refuse such a policy for Orchestrator-made agents,
  and show it otherwise.

### 14. Mid-turn messages are Claude-only
- **Where:** «Al prossimo passo» is `harness === 'claude'` (`renderer/lib/correction.ts:90`). A live-only mail to a busy
  non-Claude chat is refused (`manager.ts:616`), and the mail scan skips busy non-Claude chats (`chats/mail.ts:328`).
- **Codex only:** stricter than needed, because Codex steers a running turn (`codex.ts:385-397`) and `manager.midTurn`
  is engine-agnostic (`manager.ts:533`).
- **Cursor only:** correct.
- **Impact:** delays; nothing breaks.
- **Fix:** a `steer` cap (claude, codex).

### 15. Permission modes, continuity, warm engine, fork and worktree are Claude-only caps
- `caps.permissionMode` is Claude-only, so the mode choice is hidden (`renderer/components/ChatMenu.tsx:96`,
  `NewChatDialog.tsx:67`). Cursor's plan mode exists (`acp.ts:747-752`) but is unreachable, and Codex throws on a mode
  change (`codex.ts:556`).
- The cold note and the Orchestrator's daily compaction are `harness === 'claude'` (`chats/continuity.ts:54,84`), and
  `compactWindowTokens` reaches only Claude (`claude.ts:268`). Codex has `thread/compact/start`.
- Warm engine, fork («Duplica») and worktree are Claude caps (`registry.ts:47-50`). Codex and Cursor take 10-25 s
  longer to answer first, have no Duplica, and parallel chats share one checkout.
- **Fix:** a per-kind compaction action; expose Cursor's plan mode; let the app create the worktree for any engine.

### 16. Login readiness, setup and doctor
- Only Claude's login is readable; ACP and Codex report `loggedIn: null` (`cli.ts:70-73`), so readiness says
  «non verificato».
- `install.mjs:140-166` sets up only the Claude and Cursor harnesses.
- The Orchestrator's default model cannot be set for Codex (`main/chats/orchestrator-service.ts:35`).
- `scripts/doctor.mjs` fails on a missing Claude CLI but only informs about Codex.
- **Fix:** read Codex `account/read` at status time. Add Codex to install.mjs and `regiaChats`. Make doctor require at
  least one ready engine instead of Claude.

### 17. Analytics provenance and skill-use detection
- `modelObserved` comes only from Claude and the API engine (`claude.ts:785,933`, `api.ts:263,275`), and
  `effortObserved` only from Claude. Codex and ACP sessions land in the "unknown model" group (`analytics.ts:148`).
- Cohorts are empty for every engine because `taskType` is never set (`collector.ts:50`).
- The only skill-use readers match Claude's `Skill` tool event (`renderer/brain/lib/live.ts:192`, brain `brain-usage.mjs`).
  Codex and Cursor read SKILL.md with ordinary reads, so anything built on this counts only Claude.
- **Fix:** send `modelObserved` from Codex `thread/started` and ACP `models.current`. Detect reads of
  `*/skills/<n>/SKILL.md` on every engine.

## Already at parity (checked)

- Questions: Codex `requestUserInput` and Cursor `cursor/ask_question` open question panels. Cursor `create_plan`
  works; Codex has no plan step.
- Images (ACP blocks/files, Codex `localImage`; API engines warn that they are text-only).
- Stop and interrupt on every adapter.
- Effort (Codex native, Cursor via model variants).
- Context size (Codex reported, Cursor estimated).
- Run counters, `executionMs`, tokens, corrections and the agent profile injection are engine-agnostic
  (`manager.ts:629,828,2091`).
- «Comando da eseguire», «Rispondi dopo» and the long-chat handoff do not depend on the engine.
