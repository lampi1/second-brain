# 0212 — Remove the personal Browser page

Status: accepted. Supersedes ADR 0133.

2026-10-31.

## Context

ADR 0133 gave the user an everyday browser inside the app (the Browser page: its own partition, bookmarks, sessions,
history, saved passwords, «Affida a un agente» to lend one tab to a chat). On 2026-10-31 the owner wrote: «Il browser è
inutile, toglilo».

## Decision

- The Browser page is gone: its sidebar entry and G W, `BrowserPage.tsx`, `store/personal.ts`, its styles and texts,
  `main/personal/{browser,store,address,page}.ts`, the `personal:*` channels and `personal:changed` event, the lend and
  reclaim path in `browser/tabs.ts`, the app MCP's screenshot and outline guards for it, its Guida card and its e2e and
  unit tests.
- The password vault stays, renamed `main/browser/login-vault.ts`: the agents' site sign-ins (`browser/site-vault.ts`)
  and the routines' secret fill use it.
- The agents' browser tabs on the Grindhouse and «Nuovo browser» are not touched.
- Files the page left in userData (`personal-browser.json`, `personal-passwords.json`, the `persist:personal`
  partition) are never read again; nothing deletes them.

## Consequences

- One less window onto the web inside the app; agents' browsing is unchanged.
