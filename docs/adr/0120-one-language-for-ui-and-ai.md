# ADR 0120 · One language for the UI and the AI, switched from the top bar

Date: 2026-10-22 · Status: accepted (owner, issue #163) · Builds on: ADR 0057 (UI language), ADR 0117 (German), ADR 0089 (role text once per context)

## Context
The language could be changed only in Settings → Aspetto, and only for the interface: the agents kept answering in the
language they guessed ("Reply to the user in their language" in the role preamble, the brain profile's `Language:`
line). An open chat got its role text once per context, so even a new rule would not have reached it.

## Decision
- **One setting.** `language` (system | it | en | de) is the user's language for the UI and for the AI's replies.
  "System" is Windows' language for both (main/locale.ts `uiLang`, the same function the UI's texts use).
- **The top bar switch** (renderer/components/LangSwitch.tsx) sits in the bar's end group, which never shrinks, so it
  is always reachable, also in a narrow window. It shows the language in force as a code (IT / EN / DE) with a globe;
  fit step 6 (useFit) drops the globe and keeps the code: a square button, still telling which language is on (a lone
  globe would be a second globe beside «Nuovo browser»). Its menu has the same four options as the Settings select,
  which stays; both write the same setting, so they are always in sync. The UI changes live (LangRoot's remount).
- **The profile follows.** On a `settings:set` that carries `language`, main rewrites me.md's `Language:` value through
  the profile's checked save (revision, temp file + rename, only that line) with the language's own name (italiano,
  English, Deutsch, as a fresh brain writes it). A value that already names that language in any of the app's languages
  ("Italian", "italiano e inglese") is left as it is; a profile the app cannot rewrite (no Who line) is left alone.
- **Chats are told, cheaply.** The engine-only bracket line `[The user's language: <name>. Reply to the user in it.]`
  goes with the role text at the start of each context (and a chat's first message). The language a chat was told is
  stored with it (chats.json `replyLang`); on the first turn after a change one line
  `[The user's language is now <name>: reply in it from this message on.]` (about 20 tokens, once) goes under the
  message, then nothing. The names are headline.ts's LANG_NAME, now in locale.ts: German is "German (as written in
  Austria)".
- Agent prompts stay English; only the reply language changes. No per-chat or per-role override.

## Consequences
- The user's message bubble never shows the line (engine only, like the task hint of #170).
- A language change while the app is closed reaches each chat on its next turn after the restart (`replyLang` is
  persisted). A Windows language change with "System" on is seen at the next turn too (uiLang reads it live).
- Tests: test/unit/brain/profile.test.ts (the profile write), test/unit/chats/reply-lang.test.ts (the per-turn line,
  across a restart), test/e2e/lang-switch.spec.ts (the switch, narrow window, German).
