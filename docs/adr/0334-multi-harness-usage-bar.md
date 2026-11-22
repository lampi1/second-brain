# ADR 0334: Multi-harness plan usage popover and pinned weekly limits

**Status:** Accepted (2026-11-22)

## Context

The top bar (`src/renderer/components/UsageBar.tsx`) showed today's spend and only Claude's weekly / 5-hour windows, with Cursor's plan usage marked permanently unavailable (`Usage.cursorPlanNote`). Meanwhile the app runs five harnesses (Claude, Cursor, Codex, OpenCode, Antigravity), and the user wants a single, direct one-click popover showing every harness's session and weekly/plan limits with reset times, plus the ability to pin any harness's weekly limit so it stays always visible in the top bar.

## Research: Cloudroom (`davidondrej/cloudroom`, Apache 2.0) and CodexBar

We inspected `davidondrej/cloudroom`'s `provider-usage` plugin and each provider's `provider-maintenance.ts` (plus `steipete/CodexBar` for OpenCode Go):

| Harness | Local auth source (read-only, main process only) | Endpoint / probe | Windows |
|---|---|---|---|
| **Claude** | `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`) + `~/.claude.json` (`oauthAccount.emailAddress`) | `GET https://api.anthropic.com/api/oauth/usage` (`anthropic-beta: oauth-2025-04-20`), merged with live `rate_limit_event` / `get_usage` / `cachedUsageUtilization` | `5h`, `7g`, model-scoped weekly (`limits[]`), `extra_usage` |
| **Cursor** | `%APPDATA%\Cursor\auth.json` (Windows) / `~/.cursor/auth.json` (macOS) / `$XDG_CONFIG_HOME/cursor/auth.json` (Linux), fallback `state.vscdb` `cursorAuth/accessToken` | `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` + `GetPlanInfo` | `Piano` (`autoPercentUsed` / `totalPercentUsed`), `Modelli 3P` (`apiPercentUsed`), `On-demand` (`spendLimitUsage`), reset at `billingCycleEnd` |
| **Codex** | `~/.codex/auth.json` (`CODEX_HOME`, `tokens.access_token` + `account_id` / JWT claim) | `GET https://chatgpt.com/backend-api/wham/usage` + live `account/rateLimits/updated` notification from `codex app-server` | `5h` (`primary_window`), `7g` (`secondary_window`), `credits` |
| **OpenCode** | `OPENCODE_API_KEY` or `~/.local/share/opencode/auth.json` (`opencode` key or `openai` ChatGPT OAuth) + `opencode.log` fallback | `GET https://opencode.ai/zen/go/v1/usage` (OpenCode Go) or `chatgpt.com/backend-api/wham/usage` (OpenAI OAuth) | `5h`, `7g`, monthly (Go) or `5h`/`7g` (OpenAI OAuth) |
| **Antigravity** | `agy --settings <temp>` with a session-only `statusLine` command (`cmd /d /c more > file` on Windows, `tee file` elsewhere), no PTY, stdin closed, `AGY_CLI_DISABLE_AUTO_UPDATE=1`; fallback `agy acp` `session/new` `_meta.antigravity.tier` (plan only) | Like Cloudroom's `antigravity-status.ts`, but without a PTY so it also works on `win32`: agy 1.5.14 sends the quota on its second status (measured 3.1-3.4 s), then the app ends agy's process tree (20 s cap) and removes the temp folder on exit; no prompt, so no conversation is saved (conversation count unchanged). Quota cached 5 min, a failure 10 min. `gemini-5h`, `gemini-weekly`; `3p-*` only once used (<100% left). | `5h`, `7g`, `3P` (when used) |

## Decision

1. **Contract (`src/shared/contract/app.ts`)**: add `HarnessUsageStatus`, `HarnessUsageWindow`, `HarnessUsage`, `Usage.harnesses`, and the `'app:usageRefresh'` IPC channel while keeping all existing `Usage` fields intact for backward compatibility (`BudgetWatcher`, `CreditBook`, `AndamentoPage`).
2. **Main-process collectors (`src/main/brain/provider-usage.ts`)**: read local CLI tokens in memory only in the main process, send them only to each vendor's own HTTPS usage endpoint, never log or persist them, and never send them to the renderer (AGENTS.md rule 2). Disabled under `SB_TEST=1`.
3. **Top-bar UX (`src/renderer/components/UsageBar.tsx`)**:
   - The top bar shows today's spend plus every pinned harness's primary weekly/plan limit (default `['claude']`, persisted in `Prefs.usagePinned`).
   - One click opens a 380 px popover listing all 5 harnesses with Cloudroom-style 12-segment bars, percentages, reset countdowns, one-click pin toggles, an on-demand refresh button, and today's spend + chat cost breakdown below.
   - Unavailable/unauthenticated/expired states are shown honestly and never represented as `0%`.
4. **Cursor**: this reverses the 2026-10-11 finding behind `CURSOR_PLAN_NOTE` (no personal usage API; the dashboard's
   internal endpoints need the user's session token). The owner asked to read each provider the way Cloudroom does; the
   trade-off is an undocumented endpoint that can change or break without notice, so a failed reading keeps the last good
   one and falls back to the cost estimate.
5. **Refresh cadence**: every 3 minutes and on the popover's refresh button; Antigravity's tier probe (`agy acp`
   `session/new`, no prompt, no tokens) runs at most once an hour.
