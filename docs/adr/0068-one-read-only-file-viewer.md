# 0068 — One read-only in-app viewer for every file link

Date: 2026-10-17. Status: accepted (UI redesign SPEC point 22, first of three steps).

Every file link (a question's context, an Orchestrator or agent message, a visual's diffList, a procedure, the
Dashboard) opens in the app's own file viewer: read-only, local rendering only, no LLM call. Nothing is handed to the
file's own application any more: `app:openPath` (ADR 0019, 0041), which opened documents and images with their app, is
replaced by `app:showInFolder`, an explicit "Show in folder" button in the viewer that only selects the file in
Explorer, never opens or runs it.

**Access: any local file, no exceptions.** Brother chose it knowingly (19:41): the roots allow-list (brain, app repo,
chat folder), the private-path blocklist (dotfolders, `secrets`/`credentials`/`token` names) and the extension
allow-list are removed, so an agent's link can put a credential file on screen. What stays:

- network shares are not local files: a UNC path, `file://host/…`, or a link (symlink, junction) to a share is refused
  before anything would connect to it (it would send the Windows login to that host, ADR 0054);
- a relative path resolves only inside the chat's folder (or the brain), never with `..`;
- the read is bounded: text one 1 MB page at a time (below), 4 MB for an image (magic bytes and
  dimensions checked, shown as a data URL); a file with NUL bytes is binary and not shown; the file is re-checked
  (device, inode, realpath) around the read;
- the content is inert: markdown goes through marked + DOMPurify without images, highlighted code is highlight.js's
  escaped HTML passed through DOMPurify (spans and classes only), everything else is plain text.

Formats: markdown rendered, code and config highlighted with highlight.js (the core and one lazy chunk per language,
bundled, offline), CSV/TSV and JSONL as tables, JSON pretty-printed, each formatted view with its source a click away.

**Paging (V2).** A text file comes one page of at most 1 MB at a time, cut at its last line end (at its last whole
character when one line fills the page). Next starts exactly where the page ended and Previous ends exactly where it
started, so pages join with nothing lost or repeated, a line longer than a page included; Start and End jump (End to the
line start nearest the last 1 MB). A cited line opens the page that starts up to 100 lines above it, fewer when they are
long, so it stays on the page (from the top when it is in the first half page). Line numbers are counted up to 64 MB
into the file; a page past that shows none, and a cited line past it opens the top. Main reads asynchronously, so a long
count never holds the app up. A UTF-16 file is shown from the top only (no pager). A page other than the first is shown
as source (a table or a document cut from the middle would mislead). A file is binary when its first 1 MB has a NUL
byte; a NUL further on shows as a replacement character, and a page that fails to load keeps the page shown so far and
its pager. Main and the viewer number lines by one rule (`lineCount`): a line ends at `\n` only, a lone `\r` (a
progress redraw in a captured log) stays inside its line.

**PDF (V2).** Up to 32 MB with a `%PDF-` header, read whole by main and handed as bytes to pdf.js (pdfjs-dist, pinned,
loaded only when a PDF opens, its worker bundled, offline). Pages are drawn to canvas when they scroll near, with no
text or annotation layer: a PDF's links, forms and scripts do nothing. Images in JPEG 2000 or JBIG2 (pdf.js decodes
them with WebAssembly files the app does not ship) and fonts neither embedded nor on the system may not show.
pdfjs-dist's optional native `@napi-rs/canvas` (used by pdf.js only under Node, never in the renderer) is pinned to
1.0.10 by `overrides` in package.json, so it too meets the 14-day rule.

Next: a diff on request (vs HEAD, vs a ref, two files) with read-only git (argument allow-list, no shell) and jsdiff.
