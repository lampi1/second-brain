# ADR 0328 · Artifacts: only what the user asked for, one list, all opened in the app, and a real full screen

Date: 2026-11-19 · Status: accepted (owner, 2026-11-19: «quello che voglio è ripensare la sezione artifact non
dividerli per tipo di file, l'app deve comprendere da sola che quando l'utente chiede un report o un documento o un
piano ecc deve produrre un file che finirà dentro artifact invece delle quantità industriale di file inutili che hai
messo adesso. Solo gli artifact che produce l'app su richiesta dell' utente e non divisi per file e devono potersi
aprire tutti in app e il full screen del file viewer deve prendere davvero tutto lo schermo ora non sembra nemmeno un
full screen») · Supersedes parts of: ADR 0319 (what comes in, kinds and filters), ADR 0323 (the star, the daily cleanup)

## Context

ADR 0319 indexed «every file the chats produce»: every path a chat linked, everything in the brain's `reviews`, `tmp`
and `evidence`, each chat's evidence folder, and once the past chats. On the owner's PC that is thousands of
screenshots, logs and scratch files around the few reports he asked for. ADR 0323 made the list lighter (twenty at a
time, a daily cleanup of old pictures) but did not change what comes in. The list was also cut by file type (chips for
HTML, Markdown, PDF, images, data, documents, media, files) and Word, Excel, PowerPoint, video and «other» files did
not open in the app at all: only «Apri con l'app».

The viewer's «Espandi» left the Orchestrator's column and the bottom bar free and capped the text at 1480 px: it did
not look like a full screen. The page's own `requestFullscreen` is refused by the window's permission handler
(`window.ts` grants only microphone and screen capture), and security rule 2 says never to relax it.

## Decision

1. **An artifact is what the user asked to have, declared by the agent that wrote it.** A new tool on every chat's own
   endpoint, `artifact_save { path, title?, summary? }` (`src/main/library/tools.ts`), is the only way in. Its
   description tells the agent when: the user asked for something to keep and read again (a report, an analysis, a
   document, a plan, a comparison, a summary of a research, a presentation) → write it as one file, HTML or Markdown
   unless the user asks for another format, then call the tool; never for screenshots, evidence, logs, code, notes or
   intermediate files. One short line of it (`ARTIFACT_RULE`) rides on every role's frame, the Orchestrator's included,
   so a request that reaches a worker through a delegation still ends in an artifact. No classifier and no setting: the
   agent that understood the request is the one that knows it produced the thing asked for.
2. **No scans.** Nothing is looked for in folders, in a chat's answers or in past chats any more. `library/walk.ts`,
   the turn-end hook, the start scan, «Aggiorna» and `library:refresh` are gone. Opening the tab only checks that the
   indexed files are still there (`library:list { check: true }`).
3. **Formats, all opened in the app:** `html, md, pdf, png, jpg, webp, gif, csv, tsv, json, txt, docx, xlsx, pptx`.
   Anything else is refused by the tool with the list (so is a missing or empty file, a path outside what the chat can
   name, a file whose name or first lines look like a credential). A declared file rewritten later with a credential
   in it stays listed, but the app keeps no copy of that text. SVG, video, audio and «other» files are no longer
   artifacts: the viewer cannot show them as what they are.
4. **Word, Excel and PowerPoint open in the viewer** as text (`src/main/office-preview.ts`, `FileViewResult` kind
   `office`): a document's headings, paragraphs, lists and tables, a workbook's sheets as tables (shared strings,
   dates, booleans; 300 rows, 40 columns, 12 sheets), a deck's slides in the deck's order with title, points and
   tables, written as Markdown and drawn by the viewer's Markdown. No dependency (rule 3): an Office file is a ZIP of
   XML, read with a bounded reader of its own (central directory, one part inflated at a time, sizes capped, elements
   found with `indexOf` so a file made to hurt is scanned in linear time on main's thread); nothing is run, no link
   followed. It is the content, not the layout: a note above says so and «Apri con l'app» stays for the
   original. A file that is not a readable Office file (old binary format, encrypted, damaged) says so. GIF opens as a
   picture.
5. **One list.** No kind chips, no area, period, chat or sort selects, no star: search (title, summary, path, area,
   chat), the count, grid or list, days as headings, newest first, twenty at a time (ADR 0323's page and light
   pictures stay). A card's ✕ (asked twice) takes the artifact off the list; the file stays on disk, the app's own
   version copies and card picture are deleted.
6. **What an old index keeps.** An index of ADR 0319 (`v: 1`) is read once: it keeps what the user starred and the
   HTML, PDF, Word, Excel and PowerPoint files a chat had reported; everything else leaves the list (the files stay
   where they are) and the copies and pictures the app made for them are deleted the first time the tab is opened
   (owed across restarts: `sweep` in the index). Markdown is not kept: the old index
   held every note and scratch file a chat linked. The Orchestrator can put any file back with `artifact_save`.
7. **The daily cleanup is gone** with what it cleaned: pictures no longer come in. Nothing in
   `<userData>/evidence` is deleted by the library any more.
8. **Full screen is the whole screen.** The viewer's «Schermo intero» (F11) covers the whole window (above the
   Orchestrator's column, no margin, no width cap: text is centred at a readable width, PDFs, pictures and tables take
   the room) and asks main to put the window itself in full screen: `app:fullScreen { on }` →
   `src/main/full-screen.ts` → `BrowserWindow.setFullScreen`. No web permission is granted. Only a full screen the app
   turned on is turned off again (a window the user put in full screen stays so); a hidden or test run never moves its
   window. Esc leaves full screen first, a second Esc closes the viewer; closing the viewer leaves full screen.

## Consequences

- An artifact exists only if the agent calls the tool. A model that forgets leaves the file where it wrote it, linked
  in its answer; the user can ask the Orchestrator to save it. Untried on the owner's PC with real requests.
- A plan drawn on the project map (ADR 0276) is not an artifact; a plan the user asks «as a document» is.
- Old app screenshots stay in `<userData>/evidence` until something else removes them.
- An Office file's preview has no pictures, charts, fonts or formulas' formats beyond dates; cells are text.
- Contract: `library:refresh` and `library:pin` removed, `library:remove` and `app:fullScreen` added; `ArtifactKind`
  loses `svg`, `media`, `file`; `Artifact` loses `origin` and `pinned`.
- Pinned by `test/unit/library-shared.test.ts`, `library-service.test.ts` (declaration only, refusals, versions,
  remove, migration), `office-preview.test.ts`, `full-screen.test.ts`, `file-view.test.ts`, `test/e2e/library.spec.ts`
  and `viewer-overlay.spec.ts`.

## Alternatives

- **Keep the scans and classify each found file** (by folder, name or a small model): the same guessing that filled
  the list, plus tokens. The agent already knows what it was asked.
- **Let the app decide from the user's message** (a kind detector on «report», «documento»…): a second place that
  must understand the request, wrong whenever the words differ; the frame line and the tool description cost nothing.
- **Convert Office files to PDF or HTML with a library or LibreOffice**: a runtime dependency or an installed
  program for a preview; the text is what the user reads in the app, the original opens with its program.
- **Grant the page the `fullscreen` permission**: relaxes the permission handler for every page content; the window's
  own full screen needs no permission.
