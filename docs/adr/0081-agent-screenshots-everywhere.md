# ADR 0081 · Agent screenshots everywhere: a path is enough, nothing remote ever loads

Date: 2026-10-19 · Status: accepted (owner, issue #83: "Screenshots taken by agents ... must be easy to see everywhere
in the app"; comment: "screenshots in questions already work well ... use it as the reference for chat and the report
viewer") · Builds on: the question images (AskImages.tsx, main/ask-image.ts), SPEC 22 (file viewer), AGENTS.md rule 2

## Context
Agents prove a fix with screenshots: PNG files in their evidence folder, a report beside them (HTML or Markdown), often
with the images embedded as base64. Questions already showed local images as thumbnails. The file viewer showed HTML
as source and Markdown without images, and the chat showed only `![](…)` images, not the bare paths agents write.

## Decision
1. **One way to attach a screenshot: its local path.** A PNG, JPG or WebP under the allowed folders of
   `app:askImage` (the profile and its evidence, the brain, the app's repo and its worktrees), written in the message,
   the question or an option, or the report. The text is `SCREENSHOT_HINT` (main/ask-image.ts), quoted in the chat MCP
   instructions, in `show_ui` and in the browser's `screenshot` tool (`save_to` returns the path to write).
2. **Chat** (lib/message-images.ts): images, links to images, path-only inline code and bare absolute paths in the
   prose become thumbnails (the questions' look, AskImages.tsx); never code blocks, HTML or remote URLs. A relative path
   counts only in markdown syntax or code, against the chat's folder.
3. **File viewer**: an HTML report renders as a page: parsed inert (DOMParser), body through its own DOMPurify (no
   script, form, frame, media, base/link/meta, SVG image/use, data attributes), CSS scrubbed of `url()`, `@import`,
   `image-set` and escapes, all inside a **shadow root** on a contained host, so the report neither restyles the app
   nor escapes its box. Markdown keeps its images. In both, `<img src>`: `data:image/png|jpeg|webp;base64` stays (size
   header checked), a local path (relative to the report, absolute, `file:///`) is read by main through `app:askImage`
   and becomes a data: URL, anything else becomes a one-line note. No `file:` or remote URL reaches the DOM; the CSP is
   unchanged (`img-src 'self' data:`).
4. HTML and Markdown reports opened at their top come **whole up to 32 MB** (file-view.ts `REPORT_BYTES`): base64
   screenshots are never cut by the 1 MB page.
5. One large-image viewer (ImageZoom.tsx) for questions, chat and reports: caption, ← →, Esc.

## Consequences
- A report outside the allowed folders still opens, but its local images say why they are not shown.
- Remote images in a report are never loaded, by design: agents embed or save them locally.
- The questions window's question is 16 px (was 22) and its context 14 px: the app's type scale.
