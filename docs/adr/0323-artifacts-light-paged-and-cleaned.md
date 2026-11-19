# ADR 0323 · Artifacts: twenty at a time, light pictures, and a daily cleanup of old screenshots

Date: 2026-11-18 · Status: partly superseded by ADR 0328 (points 3 and 4, the star and the daily cleanup, are gone; the page of twenty and the light pictures stay); accepted (owner, 2026-11-18: «la sezione artifact deve essere più essenziale chi se ne
fotte di tutti gli screen di sempre, cioè quanto meno una paginazione perchè se la apro mi impalla l'app e secondo me
ci dovrebbe essere una pulizia periodica che ne pensi?»; to the proposal «solo gli ultimi 20 artifact e carica gli
altri a pagine, con anteprime leggere … una pulizia automatica che archivia o cancella gli screenshot più vecchi di 30
giorni, tenendo quelli che hai fissato» he answered «si veloce») · Amends: ADR 0319 (what the gallery draws, what the
index keeps)

## Context

ADR 0319 drew every indexed artifact at once: up to 4000 cards, each with its own observer, and the ones near the
screen with a picture (HTML reports drawn small from 160 KB of their head, GIF and SVG up to 1.5 MB as they are). With
months of agent screenshots in the evidence folders, opening the tab froze the app. A file's area also compared it with
every chat's folder through a fresh `realpath` each time, on main's thread.

## Decision

1. **Twenty at a time.** The gallery draws the newest `LIBRARY_PAGE` (20) of what the filters let through; «Mostra
   altri (ne restano N)» adds twenty more. Another search, filter or sort starts again from the first page. The day
   headings no longer carry a count (a page shows only part of a day).
2. **Light pictures.** An image card is a 360 px JPEG (quality 72; was 480 px, 80); an HTML card is drawn from the
   report's first 64 KB (was 160 KB); a GIF or SVG is shown as it is only up to 300 KB (was 1.5 MB), a bigger one gets
   its tile.
3. **Keep (star).** Every card has a star: `library:pin` sets `pinned` on the artifact; a kept artifact is never
   cleaned, nor dropped when the index is full (4000). A second click lets it go again.
4. **Daily cleanup.** With a scan (20 s after start, on «Aggiorna», when the tab opens with an index older than a
   minute), at most once a day, every picture (kind `image`) not kept and older than `CLEANUP_DAYS` (30) by its file's
   time leaves the index. It runs after the scan's walk and check, so a file written again under an old name is a new
   version, not an old picture. Its file is **deleted only in the app's own screenshot folder** (`<userData>/evidence`,
   the agents' browser evidence), only when it is still the very file indexed (same time and size, a plain file whose
   real path is inside that folder), and never in a `downloads` folder; a picture in the brain or in a project stays
   where it is and is only no longer shown.
   A scan never takes an old picture back in. The count of cleaned pictures is kept in the index and shown beside the
   gallery's count, with a tip that says which files are deleted and which are only hidden. Reports, documents, data
   and every other kind are never cleaned.
5. **Folders' real paths** are asked once per scan (a small cache cleared at each scan); opening a file still asks
   the disk each time.

## Consequences

- An old chat that showed an app screenshot older than 30 days shows it as gone: the owner asked not to keep «tutti gli
  screen di sempre». A screenshot worth keeping gets the star before it is 30 days old.
- The 30 days and the page of 20 are constants in `src/shared/library.ts`, not settings.
- Pinned by `test/unit/library-service.test.ts` (cleanup, deletion only in the app's folder, once a day, pin across a
  restart) and `test/e2e/library.spec.ts` (the star, no next page under twenty).
