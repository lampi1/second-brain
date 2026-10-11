// Markdown viewer of the brain pages: marked (GFM) → DOMPurify (its own instance, so hooks never touch other modules)
// → HTML. After sanitizing: http(s) links open outside the app (target=_blank, main opens the system browser); every
// other link is neutralized (a relative href would navigate the app window) and, when it names a brain file, opens it
// in Esplora; `code` that names a brain file becomes a link too; each table gets a "CSV" button. Used by Fatto,
// Da fare, Idee, Confronto, Esplora.
import { useMemo, type MouseEvent } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { download } from './ui';
import { toCsv, fileSafe } from '../lib/table';

const marked = new Marked({ gfm: true, breaks: false });
let purify: ReturnType<typeof DOMPurify> | null = null;
function sanitizer() {
  if (purify) return purify;
  purify = DOMPurify(window);
  purify.addHook('afterSanitizeAttributes', node => {
    // every element that can carry a link: only A survives (AREA/MAP/BASE are forbidden below), checked anyway
    if (!node.hasAttribute('href') && !node.hasAttribute('xlink:href') && !node.hasAttribute('formaction')) return;
    node.removeAttribute('xlink:href'); node.removeAttribute('formaction');
    if (node.tagName !== 'A') { node.removeAttribute('href'); return; }
    const href = node.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    else if (href.startsWith('#')) { node.setAttribute('data-anchor', href.slice(1)); node.removeAttribute('href'); node.setAttribute('role', 'link'); node.setAttribute('tabindex', '0'); }
    else { node.setAttribute('data-file', href.replace(/^\.\//, '').split('#')[0] ?? ''); node.removeAttribute('href'); node.setAttribute('role', 'link'); node.setAttribute('tabindex', '0'); }
  });
  return purify;
}

/** Markdown → safe HTML string (exported for tests of the page, not used elsewhere). */
export function renderMarkdown(text: string, files?: Set<string>, root = ''): string {
  const html = marked.parse(String(text ?? ''), { async: false }) as string;
  const clean = sanitizer().sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'area', 'map', 'base', 'link', 'meta', 'object', 'embed', 'frame', 'frameset'], FORBID_ATTR: ['style', 'usemap', 'formaction', 'action', 'xlink:href'] }) as unknown as string;
  if (!files?.size) return wrapTables(clean);
  // `ops/tools/mem.mjs` (or with the brain root in front) that is a brain file → a link to it
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const rel = (t: string) => { const f = t.replace(/\\/g, '/').replace(/&amp;/g, '&'); return r && f.toLowerCase().startsWith(`${r}/`) ? f.slice(r.length + 1) : f; };
  return wrapTables(clean.replace(/<code>([^<]{3,200})<\/code>/g, (m, t: string) => {
    const p = rel(t);
    return files.has(p) ? `<a class="file" data-file="${p.replace(/"/g, '&quot;')}" role="link" tabindex="0"><code>${t}</code></a>` : m;
  }));
}
const wrapTables = (html: string) => {
  let i = 0;
  return html.replace(/<table>/g, () => `<div class="bx-mdtable"><table data-i="${i++}">`).replace(/<\/table>/g, '</table></div>');
};

export function Markdown({ text, files, root, onOpenFile, name = 'tabella', testId }: { text: string; files?: Set<string>; root?: string; onOpenFile?: (path: string) => void; name?: string; testId?: string }) {
  const html = useMemo(() => renderMarkdown(text, files, root), [text, files, root]);
  const act = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const a = t.closest('a');
    if (a?.dataset.file !== undefined) {
      e.preventDefault();
      const f = a.dataset.file;
      if (f && files?.has(f) && onOpenFile) onOpenFile(f);
      return;
    }
    if (a?.dataset.anchor) {
      e.preventDefault();
      const slug = a.dataset.anchor.toLowerCase();
      const h = [...e.currentTarget.querySelectorAll('h1,h2,h3,h4')].find(x => x.textContent?.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') === slug);
      h?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };
  const tables = useMemo(() => {
    if (!/<table/.test(html)) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('table')].map(t => [...t.rows].map(r => [...r.cells].map(c => (c.textContent ?? '').trim())));
  }, [html]);
  const csv = (i: number) => {
    const rows = tables[i];
    if (!rows?.length) return;
    const [head = [], ...body] = rows;
    const cols = head.map((label, j) => ({ key: String(j), label }));
    download(`${fileSafe(name)}-tabella-${i + 1}.csv`, toCsv(cols, body.map(r => Object.fromEntries(r.map((v, j) => [String(j), v])))), 'text/csv');
  };
  return (
    <div className="bx-mdwrap" data-testid={testId}>
      <div className="bx-md" onClick={act} onKeyDown={e => { if (e.key === 'Enter') act(e as unknown as MouseEvent<HTMLDivElement>); }} dangerouslySetInnerHTML={{ __html: html }} />
      {tables.length > 0 && (
        <div className="bx-row bx-mdcsv">
          {tables.map((_, i) => <button key={i} type="button" className="bx-btn s" onClick={() => csv(i)}>Tabella {tables.length > 1 ? i + 1 : ''} in CSV</button>)}
        </div>
      )}
    </div>
  );
}
