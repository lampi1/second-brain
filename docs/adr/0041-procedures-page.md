# ADR 0041 · Procedure replaces Comunicazione: the brain's procedures, read-only, copy only

Date: 2026-10-13 · Status: accepted

## Context
The owner (2026-10-13): "una sezione visibile delle procedure tipo attivazione [di un progetto], deploy, query con
lookup, attivazione feature, insomma tutte quelle che hai già nel cervello; la parte Comunicazione secondo me è inutile, puoi
toglierla e mettere al suo posto Procedure". The procedures already live in the brain folder (runbooks, routines, rules
with steps), spread over many files and found only by searching. Comunicazione (the mail between chats, its charts and
the agents' messages log) was not used. Procedures hold production commands, DB queries and sometimes connection
strings.

## Decision
- **Comunicazione is removed** with everything only it used: the page, `comm:list` and its types, `brain/comm.ts`
  (agent messages log, `recordAgentMessage`), the renderer's `lib/comm.ts` and `lib/collab.ts`, the `collabora` alias,
  the badge of mail events (they stay in the notification center and the bell), demo data, CSS and tests. The mail
  between chats itself (`chats/mail.ts`) is unchanged.
- **Procedure** takes its place in the nav (key `G L`, the old Comunicazione key; `G R` is Miglioramento). Main finds the procedures by structure, never from a fixed
  list (`brain/procedures.ts`): files under folders named like runbook/procedure/how-to (every leaf section with a
  body of at least 12 characters), `routines.md`-like files, and under playbook/rule folders only sections with a code
  block or two numbered steps; a file with two or more numbered headings is one procedure titled by its H1. Index files
  add the files they link to (inside the brain only). Each procedure has an id (`file#slug`), title, one-line purpose,
  area (from the folder or file), group (the parent heading), tags (passi, comandi, query, produzione), file, line and
  last change. Limits: depth 4, 400 files, 512 KB per file; build and state folders are skipped.
- **Served by main, no new invoke channel**: `/api/procedures` and `/api/procedure?id=` are paths of the brain API
  answered locally (`localApi`, allow-listed in `brain/api.ts`). The list is cached for 60 s; a procedure is re-read
  fresh. Live: the brain watcher (`live.ts`, new `onFile` hook) invalidates the cache on a change to a procedure file
  and sends `procedures:changed` (debounced 500 ms); the renderer refetches what is on screen.
- **Safety (never relaxed)**:
  - The page only copies: a "Copia" button on every code block, click-to-copy on inline code, "Copia il percorso",
    "Apri il file" (opened by the system's viewer, never executed, `app:openPath`). No Esegui, no run, no tokens.
  - Files named like credentials, secrets, passwords, tokens or `.env` are never read.
  - Lines that may hold a credential (password/key/token/secret assignments, connection strings with a password,
    Bearer tokens, JWTs, known token prefixes, signed URLs, `user:pass@` URLs, `-P` flags, private key blocks) are
    replaced in main by "‹riga nascosta: può contenere una credenziale›" before anything crosses IPC; placeholders
    (`<CODICE>`, `$env:X`, `%X%`, `{x}`, `***`) stay. Titles and purposes are masked too. The page says how many lines
    are hidden.
  - "Apri una chat" from a procedure opens a work chat whose first message says that every production command or
    query is proposed to the owner, who runs it, and that secrets are never written in chat.
- **Demo**: `brain/procedures-demo.ts` writes a small generic brain (no real names, a fake connection string, a
  credentials file) into the demo's userData, read by the same scanner; e2e `procedure.spec.ts` uses it.

## Consequences
- New procedures show up by themselves when written in the usual places; a procedure in an unusual folder needs a link
  from an index file or a numbered structure.
- Masking is a heuristic: it hides more than needed rather than less; a credential in an unusual format can still
  show, so procedures keep pointing to secrets by name, never by value (the brain's own rule).
- Mail events have no nav badge any more: only the notification center and, when actionable, the bell.

## Addendum (2026-10-13): Da fare removed, Fatto without the app's work
The owner: "anche il Fatto e il Da fare mi sembrano inutili, mi interessa solo il Fatto, non dell'app che lo vedo già
nella sezione Migliora l'app, ma della Regia del lavoro".
- **Da fare is removed** (page, nav, key `G D`, its view `TodoView`, `isDecision`, tests). The brain's
  `/api/day?kind=brief` stays: the stand-up (Fatto, DevOps) reads it.
- **Fatto shows only the work Regia's work**: `lib/appwork.ts` filters, in the app, the chats of "Migliora l'app"
  (titles «App · …», «Pers · App: …», «Regia dell'app»), diary lines starting with "app:", the brain commits about the
  app ("the app", "app's", "second-brain", "product:") and the lines of the technical report that name them; the
  stand-up drops the app's threads too. The brain's day report is unchanged (other readers may want everything).
