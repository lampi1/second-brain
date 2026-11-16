# ADR 0317 · Artifacts in Memoria: every file the chats produce, indexed where it is

Date: 2026-11-16 · Status: accepted (owner, 2026-11-16: «Add an "Artifact" sub-tab inside the existing Memoria tab …
right after "Diario" and "Note". Do not add a new main menu entry. It is one place to browse every report, analysis and
document that my chats produce over time, similar to Claude's artifacts … do not move or migrate any file; index them
where they are … A missing file is shown as missing, never silently dropped … versions: the same report regenerated
later shows as one artifact with its history»; then «considera che gli artifact potranno essere sia html che png che
pdf insomma un po' tutto», «che md ovviamente»)

## Decision

1. **A tab, not a page.** Memoria gets a last tab «Artifact» (`HUB_TABS` 'artifact', after «Diario e note»; links
   `memoria/artifact`, also `artefatti`, `report`). It works without a brain too (a chat's evidence folder is enough).
2. **Indexed where it is.** Main keeps an index (`<userData>/library/index.json`, atomic writes, at most 4000
   artifacts, the oldest dropped first and counted). Nothing is moved, renamed or deleted. Sources:
   - a chat's turn: at every turn's end the assistant's text and report-like tools' input since the last user message
     are read for links (absolute paths, `file:` URLs, Markdown links, relative paths resolved in the chat's folder and
     the brain); the chat becomes the artifact's source. A relative link outside the brain counts only for a file
     written during the turn (a coding chat names `index.html` or `docs/*.md` all the time); the links are found in
     linear time, also in a 400 KB report;
   - a bounded walk (no links followed, tool folders skipped) of the brain's `reviews/`, `tmp/`, `evidence/` and each
     chat's evidence folder (`<userData>/evidence/chat-<id>`), real paths (a brain behind a link is walked where it
     really is), at most 200 000 entries, 20 s after start, on «Aggiorna» and when the tab opens with an index older
     than a minute (only then: the viewer's bar and every reload only read); the brain's own folders (journal, memory,
     skills, rules…) stay out. A full index takes no file older than the oldest it keeps;
   - once, the past chats (their live items or their Claude transcript, 4 MB each, 400 chats newest first).
3. **Every kind of file**, by extension: HTML, Markdown, PDF, images (png, jpg, webp, gif, svg, bmp, avif, heic,
   tiff), data (csv, tsv, json, jsonl, xlsx, xls, ods), documents (txt, docx, doc, odt, rtf, pptx, ppt, odp, epub),
   video and audio (mp4, webm, mov, mkv, m4v, avi, mp3, wav, m4a, ogg, flac) and other files (zip, 7z, eml, msg, ics,
   drawio, excalidraw, vsdx). Never code, programs, logs, a project's own files (README, AGENTS, LICENSE,
   package.json, tsconfig, requirements.txt…), hidden files or tool folders: a chat names those all the time and they
   are not outputs. Never a table or text named like a login's state or a secret (`storage-state.json`, `auth.json`,
   `cookies.json`, `token.txt`, `client_secret*.json`…); a text whose head holds a credential is indexed by name only:
   no summary, no card text, no copy.
4. **What is stored**: title (Markdown heading or front matter, HTML `<title>`/`<h1>`, else the file name), kind,
   date (mtime), the chat that produced it, area (the chat's app or repo tag, a brain `projects/<x>` folder, a project
   map's root, the chat's folder, else «Brain»), path, size, a short summary (Markdown's first paragraph, HTML's
   description or first paragraph, a text file's first paragraph, a table's columns).
5. **Versions.** Files with the same key are one artifact with its history, newest first: same kind family, same
   folder (its last name without dates) and the same stem without dates, `v3`/`rev2` tokens and copy marks (`-2`,
   `(1)`, `-final`; `part-2` stays a part). An image or a recording only versions itself. A report's text version (HTML,
   Markdown; a table or text file only when a chat linked it; ≤ 8 MB, 400 MB in all) is copied to
   `<userData>/library/versions` when seen, so a report rewritten in place or deleted still opens as it was; a copy goes
   with its version when the index drops it.
6. **Missing, never dropped.** A file that went stays, marked «File mancante»; it opens from its copy when one was
   kept, and is unmarked when it is back.
7. **The gallery**: search (title, summary, area, chat, name), filters (type, area, period, chat), sort (newest,
   oldest, title, most versions), grid or list, cards grouped by day. A card shows the picture of the file: an image
   scaled by main (nativeImage, header-checked limits, one at a time), a GIF or SVG as it is (≤ 1.5 MB, in an `<img>`, where an SVG
   runs no script), an HTML report drawn small through the viewer's own cleaning (no script, no remote load, inert),
   a table's or text's first lines, a paper for Markdown and PDF, a tile with the extension for the rest.
8. **The viewer.** A click opens the app's viewer (HTML rendered, Markdown formatted, PDF paged, png/jpg/webp
   zoomable, csv as a table, json and text as text). Above the file, the artifact bar: the source chat, the versions
   (another one opens, its copy when changed or gone), «Vedi in Memoria → Artifact» and the related artifacts (same
   chat, then same folder, then the same area within two days). For what the viewer does not render (Word, Excel,
   PowerPoint, video, audio, GIF, archives) «Apri con l'app» comes first: main opens the file with the system's
   program (`shell.openPath`), only when the path is one of the index's versions or kept copies.

## Why

- The chats already write their reports where the work is; moving them would break the chats' links and the user's
  habits. An index costs nothing on disk and survives a file that goes.
- The viewer's renderers stay the only ones: GIF and SVG are not added to it (the report cleaning blocks both on
  purpose), the card shows them small and the system's app opens them.
- Opening with the system's program is limited to indexed files of the allowed extensions, so the page cannot ask main
  to start an arbitrary file.

## Not verified here

The index, the cards and the viewer are tested on the demo (unit tests in `test/unit/library-*.test.ts`, e2e
`test/e2e/library.spec.ts`). Not seen on the owner's PC: the quality of a real scan of `brain-v2/reviews` and `tmp`
(noise from scratch files), the backfill on real transcripts, image thumbnails through nativeImage on Windows, and
«Apri con l'app» with Word, Excel and a video player.
