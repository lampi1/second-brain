# ADR 0033 · Generative UI, step 1: a catalog of trusted components (show_ui)

Date: 2026-10-13 · Status: accepted

## Context
The user reads visuals far better than walls of text; the owner's decision of 13/10: generative UI, step 1 = a
catalog of trusted components, an HTML viewer later on its own branch. Research: CopilotKit / AG-UI's catalog pattern,
Google A2UI (a JSON tree that names only catalog components), MCP Apps (sandboxed HTML) for later.

## Decision
- **One MCP tool, `show_ui`, on every chat's own endpoint** (`/mcp/chat/:chatId/:token`: the path names the caller):
  `{ id?, title, summary, component, props, target }`. `summary` is required plain text: the fallback when a view cannot
  be drawn and the line under the title. Main checks the props against the component's schema
  (`src/shared/genui.ts`, hand-written combinators, no dependency); a wrong call gets one clear error as the tool result
  (path + what is expected) so the model retries. Unknown keys are dropped; caps: 32 KB of props JSON, rows/items/lengths
  per component, at most 20 visuals per chat (oldest go). The same `id` replaces a visual (a board the chat updates).
- **The catalog** (`src/renderer/components/GenUi.tsx`, no new dependency): `table`, `cards` (decision options with
  pros, cons, effort, risk, one recommended), `board` (lanes of items with status and links: QA cases, chat status),
  `diffList` (changed files by area with a one-line why; a click opens the file through `app:openPath`, relative paths
  inside the chat's folder), `barChart` (one series, inline SVG). Each view sits in an error boundary whose fallback is
  the summary. Links: only http(s) (system browser) and local absolute paths (`app:openPath`, which refuses UNC and
  never runs anything); never HTML, scripts or `javascript:`/`data:` URLs.
- **Stored as a ChatItem** (`kind: 'artifact'`) in `<userData>/artifacts/<chatId>.json` (`src/main/genui/artifacts.ts`),
  merged into `chat:items` by time: it survives a transcript reload and a restart; re-checked on load; deleted with the
  chat (`chat:removed`).
- **Placement**: `chat` = a compact card in the chat's list (click or ⤢ = full width, Esc closes); `regia` = an item of
  the Regia the chat answers to (the "Migliora l'app" chats: the app's Regia), shown in the Regia widget's panel with
  "da «chat»"; `next-ask` = hidden until the chat's next AskUserQuestion, then on that question's panel (and in the
  questions window), or a card in the chat after 60 s. An ```` ```sb-ui {component, props, title?} ```` fence in an
  AskUserQuestion option's `preview` is drawn with the same catalog in the question's context.
- **A visual never answers**: keys 1-9, Enter and Esc of question/permission panels work as before (ADR 0019/0028 focus
  rules); the full view stops its own keys from reaching a panel; nothing takes focus by itself (only the user's click
  on ⤢ moves the keyboard into the full view, and back on close).
- **Told to the chats** through their endpoint's MCP instructions (one line: prefer show_ui for tables, options,
  boards, file lists, charts; keep it short) and the tool's own description (the props of each component).

## Consequences
- The global request layer (`OverlayApp`, a separate page without the data store) shows the question without its
  visuals; the chat's tile, the Regia card and the questions window show them.
- `SB_ASK_WAIT_MS` (only under `SB_TEST`) shortens the next-ask wait for e2e; `__sbDemo.show(chatId, args)` calls the
  same store in the demo (it has no per-chat endpoints).
- Later: an HTML viewer (MCP Apps style, sandboxed) on a separate branch; more components only through this catalog.
