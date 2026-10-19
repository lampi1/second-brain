# ADR 0016 · One DevOps page with the content inside; Oggi and Adesso removed

Date: 2026-10-12 · Status: accepted · amended by ADR 0079 (the DevOps page is now "Task": page id task, settings tasks.*, IPC tasks:*)

## Context
The brain had three "what's going on" pages: Oggi (tiles: chats waiting and working, spend, AI ideas; done today;
stand-up), Adesso (every chat's card and a message box) and DevOps (news, PRs, work items, as rows of links). The user
(12/10): "oggi e adesso li trovo ridondanti e poco utili, mentre sezione devops super utile: mergerei quelle 3 in un
unica sezione ... con i contenuti direttamente o il testo dei commenti ... senza che debba premere il link, tranne per
le pr"; then "falla figa e usabile ... con info aggiuntive sempre a costo 0 token". The chats already live in the
workspace tiles and the question panels, spend in Costi, ideas in Idee, the message box in Comunicazione (removed 2026-10-13, ADR 0041).

## Decision
- **One page, DevOps, first in the sidebar.** Oggi and Adesso are removed; their ids (`home`, `oggi`, `adesso`) and
  keys (G H, G A) open DevOps. From Oggi only the stand-up sentences stay (bottom of DevOps). `sync-*` feed events
  lose their badge (they had Oggi's), keeping toast + notification center.
- **Content in the app, PRs by link.** The brain's read-only `ops/tools/devops-me.mjs` gets `--full` (with `--json`):
  `details` by work item id (description or repro steps, last 5 comments, state-change date, linked test cases with the
  outcome of their most recent run), the whole text of mentions and comments (`body`), and per PR its open
  discussions and last human comment. The app always passes `--full`; an older script ignores it (the page then shows
  rows without content) and the old app ignores the new fields: brain and app can be updated in any order.
- **Zero tokens, read-only.** Everything else on the page is computed locally (`renderer/brain/lib/devops.ts`): who a
  PR waits for, "fermo da N giorni" (3+ days without changes), test outcomes in one line, work items by state. No AI
  summary. The script's POST allow-list grows by one read-only query (`_apis/test/points`, points by test case ids).
- **Text, never HTML.** The script turns DevOps HTML into plain text (lines kept, images as "[immagine]"); the page
  renders it as React text with `white-space: pre-wrap`. No `dangerouslySetInnerHTML`, so a comment cannot inject markup.
- **Cost:** about one extra REST call per work item (at most 60) per read; measured on the user's account 12/10: news
  read 30 s → 37 s, PR read unchanged (≈ 21 s).

## Consequences
The page is long; four tiles at the top jump to its sections and the work items open in place (`<details>`). Comments
are the last 5 per item: older ones need DevOps (the "Apri in DevOps" link inside each item).
