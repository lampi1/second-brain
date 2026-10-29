# ADR 0023 · Full-text search in Ctrl+K

Date: 2026-10-13 · Status: accepted

## Context
"Finding where things are" is the user's first time sink. Ctrl+K matched only what the renderer already held: chat
titles, folders and last lines, actions, pages. What was said inside a chat (closed ones too), which branch a piece of
work lives on, and what the brain's files say were not searchable from one place. The app must stay quiet at rest
(feat/lag-app: under 0.1 core).

## Decision
- **One invoke channel, `search:query`** (`{ q }` → `SearchResult`): hits of four kinds, `chat` (title), `message`,
  `branch`, `brain`, each with snippet, mark, date and what Enter opens.
- **Index in main, in memory, no dependency** (`src/main/search/`): `text-index.ts` is pure (fold, match every word,
  rank, snippet); `sources.ts` reads files; `service.ts` keeps the index. A few MB of text scanned with `indexOf`
  answers in milliseconds; a search library would add a package tree for no gain at this size.
- **Lazy and pull-only.** Built on the first query of two letters or more; brought up to date only when the user
  searches, at most every 2 s (brain file list every 30 s, branches every 30 s). No timer, no watcher, no work at rest.
- **Sources, read-only.** Chats of the last 30 days (open ones always): a Claude chat from its transcript, reading only
  the bytes appended since the last read (user and assistant text; tools, thinking and reminders left out); a chat
  without a transcript (Cursor, the demo) from its live items. Not through the chat manager's `items()` for Claude:
  that would load every closed chat's history into the running app. Branches: `.git/HEAD` of each chat's folder
  (worktrees too). Brain: its `*.md` files (hidden folders and build output skipped, at most 4000 files, 1 MB each),
  re-read only when size or mtime changed.
- **Ranking.** Every word must match (accents, case and `-_/.` ignored); a title match beats a phrase, a phrase beats
  loose words; word starts, recency over 30 days and how many messages matched add up; at most 6 hits per kind.
- **UI.** The palette keeps its quick matches on top (8 when the full text found something), then "Chat trovate",
  "Nei messaggi", "Branch", "Nel brain" with headers, excerpt and date. Enter: a chat is focused, a closed one is
  reopened; a branch opens its last chat; a brain file opens in Esplora.

## Consequences
- Memory: at most 2 M characters per chat (the newest) plus the brain's markdown; dropped chats leave the index.
- A first query on a large brain reads every markdown file once (async, the window stays responsive).
- Not covered yet: jumping to the message inside the chat, or to the line in Esplora (the hit shows the line).
- 2026-10-17: the brain half is now the hybrid search of ADR 0094 (words + meaning, typo tolerant) when it runs; the
  in-memory markdown index above stays as its fallback, and chats keep this index.
