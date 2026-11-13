# ADR 0057 · The UI in English and Italian, with a house i18n

Date: 2026-10-15 · Status: accepted · Builds on: ADR 0005/0008 (settings in config.json), ADR 0042 (e2e suite)

## Context
The UI was Italian only, written straight into the JSX (about 1,100 lines in 69 renderer files) and into main's
messages (about 250 lines: adapter errors, notifications, the settings schema, the demo). The product is meant for other
people too, so it needs English. The owner stays in Italian. About 660 e2e assertions read Italian texts.

## Decision
- **Written in house, no package** (rule 3): `src/renderer/i18n/`. `it.ts` is the source dictionary, `en.ts` has the
  type of `it.ts`, so a missing or extra key fails the typecheck. Keys are `area.what`. A value is a string or a
  function of one params object (numbers, names, plurals). Call it with `t('area.what', params?)`. `locale()` gives the
  locale for dates and numbers (`it-IT` / `en-GB`).
- **Setting `language`: system | it | en**, default `system`, not protected. `system` means Windows' first preferred
  language: Italian when it is Italian, English for anything else (`main/lang.ts`, sent as `AppInfo.systemLang`).
  `SB_LANG=it|en` forces it.
- **One language at a time, chosen before the first render.** `main.tsx` reads the setting and `systemLang` before
  mounting (at most 1.5 s). `LangRoot` re-mounts the tree when the language changes. A change is rare (one click), and
  the store lives outside React, so open pages and scroll survive. Because of this, a plain `t()` works everywhere,
  without a hook: components, `actions.ts`, toasts. The global request layer gets the language in `OverlayModel.lang`.
- **Main sends codes, the UI translates them.** Adapter errors (`chats/claude.ts`, `chats/acp.ts`), notifications and
  feed texts move to codes and params. The UI maps them through `t()`. A text main must write itself, like a Windows
  toast, uses a small main-side dictionary with the same rules. The labels and descriptions of the settings schema
  become the keys `settings.<key>.label` and `settings.<key>.description`.
- **`kind: 'system'` ChatItems carry a `code` + `params` (shared/sys.ts), not fixed text.** Every adapter that builds
  one (`chats/claude.ts`, `acp.ts`, `api.ts`, `transcript.ts`, `chats/manager.ts`, `main/demo.ts`) now goes through a
  `sysCode(code, params, level)` helper instead of writing Italian. `src/shared/sys.ts` holds `SYS_IT`/`SYS_EN`, two
  flat dictionaries keyed `sys.<code>` (string or a function of one flat `params` object: strings/numbers only); `en.ts`
  is typed by `SYS_IT` the same way the rest of the UI dictionary is. The item's `text` field is still filled, with
  `sysEn(code, params)`: it is the English rendering agents and logs read, and the fallback the renderer shows for an
  item with no code (an old saved item, pre-conversion history). The renderer renders a system item with
  `sysText(item)` (`renderer/i18n/index.ts`): `t('sys.' + code, params)` when `code` is set, else `item.text`. A value
  that does not fit one flat param (the model-config misses list, the "applied later" settings list, a retry's "n/m"
  attempt count) is encoded as one short language-neutral string and parsed inside the dictionary's own render
  function (`missFragment`/`missIt`/`missEn`, `laterIt`/`laterEn`, `attemptIt`/`attemptEn`), never by the renderer.
  Raw text the engine itself produced (a CLI's own error line, `notification`/`informational`/`local_command_output`,
  an MCP status line) stays a plain passthrough with no code — only a fixed Italian *frame* around such text becomes a
  code, with the engine's text passed in as a param. Errors that only ever reach `sink.exit()` (never a ChatItem) are
  out of scope for this change.
- **Prompts injected into chats stay in English** (the Regia's instructions, mail, hand-offs, the improve stages). One
  version to keep in sync, and models do well in English. The agent still answers the user in the user's language.
  Agent-facing catalogs (the settings catalog for agents) are in English too.
- **Tests:** the e2e helper launches with `SB_LANG=it`, so the existing specs stay green as they are. New specs, and the
  specs of files being converted, find elements by `data-testid`, not by text. A spec reads a text only when the text is
  what it tests (the language spec).
- **The demo data is in English** (the demo is how other people see the product). The brain template is out of scope
  here: whoever creates it writes it in English.

## Consequences
- Every new UI text needs a key in both files, or the typecheck fails.
- Converting is mechanical but touches many files. It goes area by area, in small commits. Files that another chat is
  changing are converted after that chat merges.
- Rejected: English text as the key (a missing translation would show up only at run time); a React context with a
  `useT()` hook (texts outside components, like toasts and actions, would need it passed around); i18next and
  similar packages (a large dependency tree for a small need).
