<!-- Why the browser tools let agents sign in on every host, and where a typed password stays masked; for browser and chat-feed maintainers. -->
# 0237 — Agents type passwords on every host

Date: 2026-11-09. Status: accepted (the owner, yes in a decision panel, 2026-11-09: «voglio togliere quel controllo
del browser dell'app», every host, production included). Partly supersedes ADR 0003 (its password limit).
Amended by ADR 0310 (to sign in an agent names an account of the credentials file and the app types it: it no longer
reads the password).

## Context

Since ADR 0003 the browser tools refused to put a password into a field on a remote host: `type`, `fill_form` and
`key` failed with "Agents never type passwords on remote hosts", and the MCP instructions called it a HARD LIMIT. A
QA chat on a remote Air test environment stopped at the sign-in page and had to wait for the user's hand-off. The
owner wants chats to sign in by themselves.

## Decision

- `type`, `fill_form` and `key` type into any field on any host, password fields included (`browser/actions.ts`; the
  checks `passwordRefusal`, `guardPassword` and `fieldFacts` are gone). The sign-in notice after a navigation tells
  the agent to sign in itself, and to call `handoff_to_user` kind "login" only for MFA, a CAPTCHA or an account with
  no password it knows. The tool descriptions, the MCP instructions and the reply rule say the same.
- A typed password never shows in clear where the app shows, keeps or logs things:
  - the page side, unchanged: `read_page` and an action's result show a password field's value as "•••"
    (`browser/page.ts`); `type` returns only a character count, `key` and the tab's last action show the keys with
    every run that writes text as "•••" (`browser/keys.ts maskKeys`; an unknown key name is never echoed); the MCP
    server logs argument keys only; every screenshot of an agent tab (the `screenshot` tool, `app_screenshot`) first
    hides every field ever seen as a password field, one a "show password" toggle revealed included, in every frame,
    and refuses the capture when a frame cannot be masked (`browser/shot-mask.ts`, `page.ts shotMask`);
  - the chat side, new: the feed item, its summary, a permission panel and the history read back from the transcript
    show every value typed with `type`, `fill_form` or `key` as "•••" (`chats/typed-text.ts`, used by
    `chats/manager-sink.ts`, before the night-mode log too, and `chats/transcript.ts`), Codex's wrapped panel
    included. Auto-permit and refusal rules still decide on the real input; only what is shown and kept is masked;
  - the engine wire recordings (`chats/wire-record.ts`, off unless SB_WIRE_RECORD_DIR is set) mask the same values,
    in every engine's shape, and drop Claude's streamed tool-input fragments.
- Kept, because they protect the same values: URLs with credentials (user:pass@) are still refused on remote hosts
  (they would stay in the history, the tab list and the logs); `javascript` stays refused in a tab where a remote frame
  holds a password field and, on remote hosts, for scripts that change an input's type; pasting stays blocked while
  the user's hand-off password is on the clipboard. The routine runtime keeps its own rule (ADR 0165).

## Consequences

- Agents need the password: they read it where the user keeps test accounts (the brain's credentials file or rules),
  never ask the user for it and never write it in chat.
- Outside the app's control: the engine's own transcript (Claude Code's jsonl) keeps the tool input as the model sent
  it. A page that shows a password as plain text outside an input (not a field) is not masked in a screenshot.
- Tests: `test/unit/browser-passwords.test.ts` (typing on a remote host, the screenshot order),
  `test/unit/chats/typed-text.test.ts` (the feed, panels and history), `test/unit/browser-shot-mask.test.ts`,
  `test/unit/chats/wire-record.test.ts`, `test/unit/chats/away.test.ts` (night mode), `test/e2e/browser-envs.spec.ts`.
