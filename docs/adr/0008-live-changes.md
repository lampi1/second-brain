# ADR 0008 · Live changes: settings as data, silent updates, a change log; never silent on protected things

Date: 2026-10-11 · Status: accepted

## Context
The user: "se chiedo all'IA di modificare qualche configurazione possa farlo magari con un deploy sotto il culo in modo
che io non me ne accorga nemmeno, fare modifiche deve essere molto figo vederle live". And: never silent changes to
permissions, security, engines or spending limits.

## Decision
1. **Settings are data** with a schema (`src/main/brain/settings-schema.ts`): type, default, label, `protected`.
   Changes apply at once (event `settings:changed`), the UI highlights what changed with an "Annulla". Agents change
   them through the app-control MCP; a **protected** key (engines, budgets, notifications off, anything about
   permissions/security) becomes a proposal that the user confirms with a click.
2. **Historical code-update design, superseded by ADR 0020.** The silent code-update plan below was not retained:
   the implemented promotion path restarts after the user's update click. It does not hot-swap the renderer or
   promise to keep pending requests/browser views alive. Settings in point 1 still apply live.
   The original design was dev → `npm run check` → promotion (ADR 0007), applied silently:
   - renderer-only release: the stable window loads the new renderer in place; main keeps running, so chats,
     browser tabs and pending questions are untouched (state lives in main);
   - release touching main/preload: applied automatically at the first moment when no chat is running a turn and
     no question/permission is open; chats resume their CLI sessions (`--resume`), tabs reopen their URLs (logins kept
     by the persistent partition); the launcher health check rolls back if the new window does not come up.
   A separate long-lived session host process (chats survive any restart) is the future option if the idle wait proves
   too long in practice; not built now (browser views must live in the Electron main process anyway).
3. **"Cosa è cambiato"**: `userData/changes.jsonl` records every settings change and release (who asked: the user, an
   agent/chat; when; before/after; how to undo), shown as an app page with one-click undo.

## Consequences
- Most settings changes are invisible except for a small highlight; the user can see and undo them. Code updates
  follow the explicit update/restart flow in ADR 0020.
- Protected things never change without their click, whoever asks.
