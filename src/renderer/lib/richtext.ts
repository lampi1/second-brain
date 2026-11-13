// A text for colleagues (mail, Teams, DevOps comment) shown formatted in its code block and copied formatted: the user,
// 2026-10-14: "li voglio vedere nell'app con il tasto copia" (formatted, not already on the clipboard). A block tagged
// md / markdown / mail / teams / comment renders its markdown like the message around it (renderMarkdown: sanitized),
// and Copia puts HTML + the markdown source as plain text on the clipboard, so a rich editor keeps bold, lists and
// links and a plain one gets readable text. Blocks tagged text / plain or untagged stay raw (a text to paste as is).
// Used by components/CodeBlock.tsx; pinned by test/unit/richtext.test.ts and test/e2e/codeblocks.spec.ts.
import { renderMarkdown } from './markdown';
import { copyText } from '../brain/components/ui';

const RICH = new Set(['markdown', 'md', 'mail', 'email', 'e-mail', 'teams', 'comment']);

export function isRich(lang: string | null | undefined): boolean {
  return RICH.has((lang ?? '').trim().toLowerCase());
}

/** The block's HTML for the clipboard: the rendered markdown without the app-only attributes (link targets, the
 *  click-to-copy marks of inline code), in a minimal document with UTF-8 declared. */
export function clipboardHtml(code: string): string {
  return forClipboard(renderMarkdown(code));
}

/** Sanitized HTML → clipboard HTML. Only inside start tags: text never holds a raw `<` and a quoted attribute value never
 *  a raw `"` (the serializer escapes them), so a text that reads `target="x"` stays as written. */
export function forClipboard(html: string): string {
  const body = html
    // a remote image never loads in the app (CSP img-src 'self' data:) but would in the mail that gets the paste: a
    // tracking pixel the user never saw; only inline data: images, which they did see, go along
    .replace(/<img\b[^>]*>/gi, tag => (/\ssrc="data:image\//i.test(tag) ? tag : ''))
    .replace(/<[a-z][^>]*>/gi, tag => tag.replace(/\s(?:data-copy|target|rel)="[^"]*"/g, ''));
  return `<meta charset="utf-8">${body}`;
}

/** Copies HTML and plain text together; false if neither way reached the clipboard. */
export async function copyRich(html: string, plain: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    })]);
    return true;
  } catch { /* no permission in the app window: the copy event below */ }
  let done = false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', plain);
    e.preventDefault();
    done = true;
  };
  document.addEventListener('copy', onCopy, true);
  try { document.execCommand('copy'); } catch { /* falls back to plain text */ } finally { document.removeEventListener('copy', onCopy, true); }
  return done || copyText(plain);
}
