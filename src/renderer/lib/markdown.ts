// Markdown of assistant messages → safe HTML: marked (GFM, line breaks) then DOMPurify. The model's text is untrusted:
// no scripts, handlers or styles; no element that navigates or loads by itself (area/map, forms, frames, objects,
// base/meta/link); URLs only http(s), mailto and #anchors (no file:, no protocol-relative //host or \\host UNC paths,
// which would open a remote page in the app window); href survives only on <a>, and http(s) links open outside the
// app through main's window-open handler. Small LRU cache: streaming re-renders the same growing text often.
// Used by ChatItems.tsx; pinned by test/e2e/security-ui.spec.ts.
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const SAFE_URI = /^(?:https?:|mailto:|#)/i;
const FORBID_TAGS = ['area', 'map', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta', 'link', 'style', 'svg', 'math', 'video', 'audio', 'source', 'track', 'portal'];
const FORBID_ATTR = ['style', 'usemap', 'srcset', 'action', 'formaction', 'ping', 'xlink:href', 'background', 'poster', 'longdesc'];

let hooked = false;
function hook(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    const el = node as Element;
    if (!el.getAttribute) return;
    const href = (el.getAttribute('href') ?? '').trim();
    if (el.tagName !== 'A') { if (el.hasAttribute('href')) el.removeAttribute('href'); }
    else if (!SAFE_URI.test(href) || /^[\\/]{2}/.test(href)) el.removeAttribute('href');
    else if (/^https?:/i.test(href)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    const src = (el.getAttribute('src') ?? '').trim();
    if (src && !/^(?:https?:|data:image\/)/i.test(src)) el.removeAttribute('src');
  });
}

const cache = new Map<string, string>();

export function renderMarkdown(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  hook();
  const raw = marked.parse(text, { async: false, gfm: true, breaks: true });
  const html = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS, FORBID_ATTR, ALLOWED_URI_REGEXP: SAFE_URI, ALLOW_UNKNOWN_PROTOCOLS: false });
  cache.set(text, html);
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return html;
}
