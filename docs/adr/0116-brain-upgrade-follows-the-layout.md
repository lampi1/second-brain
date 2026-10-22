# ADR 0116 · The brain follows the app's layout by itself, with a log and an undo

Date: 2026-10-22 · Status: accepted (owner, issue #166: decision card «Applica da solo, con log e annulla»; "deve
adattarsi per ogni futuro cambiamento e ottimizzazione, non è che ti devo aprire una issue ogni volta") · Builds on:
ADR 0076 (the Script section), ADR 0077 (maintenance jobs with a change log), ADR 0072 (a fresh brain starts empty)

## Context
A new version that adds a place for some content (the Script section, a future "Queries") leaves an existing brain as
it was: the content stays inline in the notes and the new page is empty. Writing one migration per feature means one
issue per change, and a forgotten one is a page that stays empty forever.

## Decision
- **The layout is data.** `src/shared/brain-layout.ts` lists every place the app keeps a kind of content: id, place,
  what it holds (plain English), the Brain page that shows it and, when the content could live elsewhere, a `receives`
  rule (today: fenced code blocks of given languages, at least N lines; written as a script file with its header or as
  a Markdown note). A unit test fails when a Brain page is neither some entry's page nor listed as holding no content,
  so a new content page cannot ship without its entry. Adding the entry is the whole upgrade for every brain out there.
- **The brain records what it is in line with**: brain.json `layout` = the app version of the last pass and a hash per
  entry (userData keeps it for a brain without brain.json). An entry whose hash is missing or different is pending.
- **The `upgrade` maintenance job** (`src/main/brainmodel/upgrade.ts`) handles every pending entry the same way: a local
  scan finds candidates (zero tokens; journal, changelog, now.md, ai-errors.md, agents/, rules/ and the place itself are
  not scanned; a block that may hold a credential is skipped); only when there are candidates, one or a few one-shot
  calls to Artisan with no tools say which really belong there and give the name and header fields; the app moves the
  candidate's own text byte for byte and leaves a pointer line `→ \`scripts/x.ps1\`` where it was.
- **No approval, one change per entry**: all writes of an entry are one ChangeLog entry (job `upgrade`, Memoria and
  Manutenzione pages), undone with Annulla. The hash is recorded after the pass, so a step never runs twice, also after
  an undo. A failed answer (no engine, invalid JSON) records nothing: the next pass retries.
- **When**: a minute after start when something is pending (right after an update, the first pass), with every full
  Manutenzione, and with the six-hourly passes; a pass the app ran by itself is announced in the feed (ADR 0102).

## Consequences
- A brain that predates the record is checked once against the whole layout; a fresh brain has nothing to scan, so it
  is recorded with no model call.
- Moving scripts does not write `changelog.md`: the app's change log keeps the entry and its undo.
- Only `code-block` candidates exist today; a future place whose content has another shape adds a `receives` kind.
- The hooks' signature reads brain.json, so the first pass after an update refreshes them once.
