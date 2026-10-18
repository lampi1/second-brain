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
- the read is bounded: 1 MB of text (the viewer says "showing the first N of M"), 4 MB for an image (magic bytes and
  dimensions checked, shown as a data URL); a file with NUL bytes is binary and not shown; the file is re-checked
  (device, inode, realpath) around the read;
- the content is inert: markdown goes through marked + DOMPurify without images, highlighted code is highlight.js's
  escaped HTML passed through DOMPurify (spans and classes only), everything else is plain text.

Formats: markdown rendered, code and config highlighted with highlight.js (the core and one lazy chunk per language,
bundled, offline), CSV/TSV and JSONL as tables, JSON pretty-printed, each formatted view with its source a click away.

Next: PDF (pdfjs-dist) and real paging of big text files by line/byte range; then a diff on request (vs HEAD, vs a ref,
two files) with read-only git (argument allow-list, no shell) and jsdiff.
