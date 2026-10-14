# ADR 0043 · Texts for colleagues show formatted and copy formatted

Date: 2026-10-14 · Status: accepted

## Context
Agents write mails, Teams messages and DevOps or PR comments for the user in fenced blocks (me.md: a fenced block
tagged `md`). The block showed the raw markdown in a monospace font and Copia put only that text on the clipboard: pasted
in Outlook, Teams or the DevOps editor it read as `**bold**` and `- item`. The user, 2026-10-14: "devi darmelo copiabile e
incollabile sempre ... ben formattato", then "Io in realtà non li voglio già negli appunti li voglio vedere nell'app con
il tasto copia": nothing goes on the clipboard by itself, the text is seen formatted and copied with one click.

## Decision
- **Which blocks** (`renderer/lib/richtext.ts` `isRich`): tagged md, markdown, mail, email, e-mail, teams or comment.
  Untagged and text/plain blocks stay raw (a text to paste exactly as written); code is never formatted.
- **On screen** (CodeBlock.tsx): the block renders its markdown with the same `renderMarkdown` as the message around it
  (marked + DOMPurify, ADR 0001 security baseline: no scripts, handlers, styles, frames, forms; links only http(s),
  mailto, #), in the message font, labelled "testo formattato". Copia and Mandato (ADR 0038) are unchanged.
- **Copia** puts two formats on the clipboard at once: `text/html` (the rendered HTML minus the app-only attributes
  `target`, `rel`, `data-copy` and without remote images (the CSP never loads them in the app, a mail client would: a
  tracking pixel the user never saw; inline `data:` images stay), with `<meta charset="utf-8">` so accents survive) and the markdown source as
  `text/plain` (a plain editor gets readable text). First through the async Clipboard API, else through a `copy` event
  (the app window may lack the permission), else plain text only. Nothing is written without a click.

## Consequences
- Bold, italics, lists, links and inline code survive a paste into a rich editor; the paste target applies its own
  fonts (no inline styles are copied).
- The clipboard HTML is exactly what the user saw: it passed the same sanitizer, and stripping attributes only inside
  start tags never changes the text.
- Pinned by `test/unit/richtext.test.ts` and `test/e2e/codeblocks.spec.ts` (reads the system clipboard back: in the
  e2e EXCLUSIVE group).
