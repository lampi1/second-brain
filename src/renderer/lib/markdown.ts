// Markdown of assistant messages → safe HTML: marked (GFM, line breaks) then DOMPurify. The model's text is untrusted:
// no scripts, handlers or styles; no element that navigates or loads by itself (area/map, forms, frames, objects,
// base/meta/link); URLs only http(s), mailto and #anchors (no file:, no protocol-relative //host or \\host UNC paths,
// which would open a remote page in the app window); href survives only on <a>, and http(s) links open outside the
// app through main's window-open handler. Small LRU cache: finished messages and finished blocks of a streaming one
// (splitBlocks) are parsed once; a streaming tail is never cached. markdownParts splits out the top-level fenced code
// blocks (their toolbar: CodeBlock.tsx); codeBlocks gives only those blocks (the Orchestrator's card: lib/orchestrator-route.ts).
// Copyable inline code is marked data-copy (lib/copyable.ts) for the click handler of LinkPeek.tsx.
// Used by ChatItems.tsx, lib/orchestrator-route.ts; pinned by test/e2e/security-ui.spec.ts, test/e2e/review.spec.ts (S1) and test/e2e/codeblocks.spec.ts.
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { isCopyable, isFilePath } from './copyable';

// A local citation is an inert internal fragment until the user clicks; it never becomes a navigable file URL.
function localFileLink(token:{type:string;href?:unknown}):void{
  if(token.type==='link'&&typeof token.href==='string'&&isFilePath(token.href))token.href='#sb-file='+encodeURIComponent(token.href);
}

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
    // inline code that is a thing to copy (a path, a URL, an id, a command): a click copies it, a path's click previews it
    // (LinkPeek.tsx); the mark is only a data attribute, read by the chat list's click handler
    // the model never sets the mark itself, and code with child elements (a hidden span) is never marked: what is copied
    // is exactly the text on screen; code inside a link stays the link's (its click opens the link's preview)
    if (el.hasAttribute('data-copy')) el.removeAttribute('data-copy');
    if (el.tagName === 'CODE' && el.parentElement?.tagName !== 'PRE' && el.children.length === 0 && !el.closest('a')) {
      const t = el.textContent ?? '';
      if (isCopyable(t)) el.setAttribute('data-copy', isFilePath(t) ? 'path' : 'text');
    }
    const src = (el.getAttribute('src') ?? '').trim();
    if (src && !/^(?:https?:|data:image\/)/i.test(src)) el.removeAttribute('src');
    // The dedicated preview loads local images through main. Keep a caption here instead of a broken img icon.
    if(el.tagName==='IMG'&&!el.getAttribute('src'))el.replaceWith(el.ownerDocument.createTextNode(el.getAttribute('alt')||'Immagine locale'));
  });
}

const cache = new Map<string, string>();
const sanitize = (raw: string): string => { hook(); return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS, FORBID_ATTR, ALLOWED_URI_REGEXP: SAFE_URI, ALLOW_UNKNOWN_PROTOCOLS: false }); };

/** `cache: false` for a streaming tail: every frame is a new prefix, caching it would only evict useful entries. */
export function renderMarkdown(text: string, useCache = true): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const html = sanitize(marked.parse(text, { async: false, gfm: true, breaks: true, walkTokens:localFileLink }));
  if (!useCache) return html;
  cache.set(text, html);
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return html;
}

/** A message split into markdown HTML and its top-level fenced code blocks, so each block gets its own toolbar (Copia,
 *  Esegui: components/CodeBlock.tsx); the code is plain text, never HTML. Cached like renderMarkdown
 *  (`useCache` false: a streaming tail). */
export type MdPart = { kind: 'html'; html: string } | { kind: 'code'; lang: string; code: string };
type CodePart = Extract<MdPart, { kind: 'code' }>;
/** A top-level fenced block (not an indented one), as markdownParts and codeBlocks give it. */
function fenced(t: ReturnType<typeof marked.lexer>[number]): CodePart | null {
  if (t.type !== 'code' || (t as { codeBlockStyle?: string }).codeBlockStyle === 'indented') return null;
  return { kind: 'code', lang: String((t as { lang?: string }).lang ?? '').trim().split(/\s+/)[0] ?? '', code: String((t as { text?: string }).text ?? '') };
}
/** Only the fenced code blocks of a message, the same ones markdownParts gives (no HTML: no DOM needed). */
export function codeBlocks(text: string): CodePart[] {
  return marked.lexer(text, { gfm: true, breaks: true }).flatMap(t => fenced(t) ?? []);
}
const partsCache = new Map<string, MdPart[]>();
export function markdownParts(text: string, useCache = true): MdPart[] {
  const hit = partsCache.get(text);
  // a real LRU: a streaming message asks for its finished blocks every frame, they must stay
  if (hit) { partsCache.delete(text); partsCache.set(text, hit); return hit; }
  const tokens = marked.lexer(text, { gfm: true, breaks: true });
  marked.walkTokens(tokens,localFileLink);
  const parts: MdPart[] = [];
  let group: typeof tokens[number][] = [];
  const flush = () => {
    if (!group.length) return;
    const list = Object.assign([...group], { links: tokens.links });
    parts.push({ kind: 'html', html: sanitize(marked.parser(list, { gfm: true, breaks: true })) });
    group = [];
  };
  for (const t of tokens) {
    const c = fenced(t);
    if (c) { flush(); parts.push(c); } else group.push(t);
  }
  flush();
  if (!useCache) return parts;
  partsCache.set(text, parts);
  if (partsCache.size > 300) partsCache.delete(partsCache.keys().next().value as string);
  return parts;
}

/** Splits a streaming message into top-level blocks at blank lines, never inside a ``` / ~~~ fence and never before an
 *  indented line (a list item's continuation): the finished blocks keep their text, so they are parsed once. Joined
 *  with "\n\n" they give back the text; the finished message is still rendered whole. */
export function splitBlocks(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  let cur: string[] = [];
  let fence = ''; // the open fence's marker ("```", "~~~~"...): only the same character, at least as long, closes it
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(l);
    if (m && !fence) fence = m[1]!;
    else if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && m[2]!.trim() === '') fence = '';
    const next = lines[i + 1];
    if (!fence && l.trim() === '' && cur.length && next !== undefined && next.trim() !== '' && !/^\s/.test(next)) {
      out.push(cur.join('\n'));
      cur = [];
      continue;
    }
    cur.push(l);
  }
  out.push(cur.join('\n'));
  return out;
}
