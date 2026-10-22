# ADR 0117 · German as the third UI language: code 'de', locale de-AT

Date: 2026-10-22 · Status: accepted (owner, issues #161 and #162) · Builds on: ADR 0057 (home-made i18n)

## Decision
- The language code is `de` and its locale `de-AT` (dates and numbers as in Austria). `Lang` = it | en | de,
  `LanguageMode` adds de; a system language starting with `de` picks German (renderer and `pickLang`); `SB_LANG=de` forces it.
- Every dictionary has a German twin typed by the Italian source (`areas/*.de.ts`, `de.ts`, `SYS_DE`): a missing key
  fails the typecheck. German uses the informal "du", like the Italian "tu".
- The guide's cards are not written in three columns: `concept-guide.de.ts` maps each English text to its German one
  and falls back to English; a unit test checks none is missing.
- Texts that were hardcoded in Italian moved into the dictionaries (areas `brainText`, `appText`), so they get English
  and German too; a unit test scans the renderer for Italian left outside them.
- Main formats the dates it writes for the user with the UI language's locale (`main/locale.ts`).
- Agent prompts stay in English (ADR 0057); only the language they reply in follows the user.
