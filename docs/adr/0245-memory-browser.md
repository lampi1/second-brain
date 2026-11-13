# ADR 0245 · Memoria shows the memory outside skills as one searchable shelf

Date: 2026-11-09 · Status: accepted (owner, issue #368, «risolvi tutte le issue aperte») · Builds on: ADR 0122
(Memoria, one place), ADR 0241 (skill library), ADR 0243 (rules gone), ADR 0244 (sections move into skills)

## Context
With rules for every role gone (ADR 0243) and procedures moved into skills (ADR 0244), the brain's memory outside
skills is `now.md`, the journal, `ideas.md`, `ai-errors.md` and the knowledge notes. Memoria's «File» tab showed them as
cards with a few preview lines: nothing could be searched or read in full without leaving the app for the viewer.
Davide wants all of it browsable in Memoria, in the same easy, good-looking UI as the skills.

## Decision
- The «File» tab becomes **«Diario e note»** (`components/brain-model/MemoryBrowser.tsx`), in the skill library's
  two-column shell: shelves (Tutto, Diario, Idee, Errori, Note), a list (Adesso first, the journal newest first, then
  ideas, errors and notes) and the chosen document rendered as Markdown.
- **Search** across every document: a document matches when it holds every word, accents and case ignored; each row
  says how many lines match and shows the first one; the words are highlighted in the text with the CSS Custom
  Highlight API, so the Markdown stays as rendered (`lib/memory-browse.ts`, pure and tested).
- **Read-only.** Changes still go through the memory writers and the viewer («Apri nel visore»). The main process reads
  the documents (`brainmodel/memory-docs.ts`, IPC `memory:docs`): masked like every read of the brain, 200 KB per
  file (longer ones say so), 4 MB in all, the newest 400 journal days.
- The old memory cards, sections and error log of that tab are removed.

## Consequences
- One place to find what the brain remembers outside skills, without the file viewer.
- A journal longer than 400 days shows its newest 400 here; the viewer still opens any file.
