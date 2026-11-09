// Memoria → Diario e note (#368): the brain's memory outside skills, browsable like the skill library (same shell,
// skill-library.css sl-*): on the left a search over every document and the shelves (Tutto, Diario, Idee, Errori,
// Note), a dense list with the matching line as a snippet; on the right the chosen document rendered, the words of the
// search highlighted (CSS Custom Highlight API: no DOM rewritten) and the first one scrolled into view, with «Apri nel
// visore». Read-only; data from 'memory:docs' (main brainmodel/memory-docs.ts), reloaded on 'brainmodel:changed'. The
// pure parts are in lib/memory-browse.ts. Rendered by MemoryPage.tsx for the 'file' tab. Styles: memory-browser.css.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { MemoryDoc, MemoryDocs } from '@shared/brain-model';
import { openFileViewer } from '../../actions';
import { locale, t } from '../../i18n';
import { brainFile } from '../../lib/memory-view';
import { SHELVES, ordered, ranges, search, shelfOf, words, type Shelf } from '../../lib/memory-browse';
import { Markdown } from '../../brain/components/Markdown';
import { IconFile, IconSearch, IconX } from '../Icons';
import { HubIntro } from './HubIntro';
import '../../styles/skill-library.css';
import '../../styles/memory-browser.css';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
let last: { shelf: Shelf; q: string; pick: string | null } = { shelf: 'all', q: '', pick: null };

function dayTitle(doc: MemoryDoc): string {
  if (doc.kind !== 'journal' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.title)) return doc.title;
  const d = new Date(`${doc.title}T12:00:00`);
  return Number.isNaN(d.getTime()) ? doc.title : d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/** The search words highlighted in the rendered document, without touching its DOM; the first one scrolled to. */
function useHighlight(box: React.RefObject<HTMLElement | null>, ws: readonly string[], key: string): void {
  useEffect(() => {
    const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const Hl = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    const el = box.current;
    if (!reg || !Hl || !el) return;
    reg.delete('mb-hit');
    if (!ws.length) return;
    const all: Range[] = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n && all.length < 400; n = walk.nextNode()) {
      for (const [a, b] of ranges(n.textContent ?? '', ws)) { const r = document.createRange(); r.setStart(n, a); r.setEnd(n, b); all.push(r); }
    }
    if (!all.length) return;
    reg.set('mb-hit', new Hl(...all));
    const rect = all[0]!.getBoundingClientRect(), scroller = el.closest('.sl-main');
    if (scroller) {
      const top = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop - 120;
      scroller.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    return () => { reg.delete('mb-hit'); };
  }, [box, ws, key]);
}

function Detail({ doc, root, ws }: { doc: MemoryDoc; root: string | null; ws: readonly string[] }) {
  const body = useRef<HTMLDivElement>(null);
  useHighlight(body, ws, doc.id);
  const lines = doc.text.split(/\r?\n/).filter(l => l.trim()).length;
  return <article className="sl-detail mb-detail" data-testid="mb-detail" data-kind={doc.kind}>
    <header className="sl-head">
      <div className="sl-head-title">
        <span className="mb-kind" data-kind={doc.kind}>{t(`mb.kind.${doc.kind}`)}</span>
        <h2 title={doc.title}>{dayTitle(doc)}</h2>
        <span className="sp" />
        <div className="sl-head-actions">
          <button type="button" className="btn btn-ghost btn-s" onClick={() => openFileViewer(brainFile(root, doc.file))} data-testid="mb-open"><IconFile /> {t('mb.open')}</button>
        </div>
      </div>
      <p className="sl-facts small"><span className="mono" title={doc.file}>{doc.file}</span><span>{t('bm.lines', { n: lines })}</span>{doc.changedAt ? <span>{t('bm.changed', { at: when(doc.changedAt) })}</span> : null}</p>
    </header>
    <div className="sl-panel">
      {doc.truncated && <p className="sl-note">{t('mb.truncated')}</p>}
      <div className="sl-prose mb-prose" ref={body} data-testid="mb-text"><Markdown text={doc.text} root={root ?? undefined} onOpenFile={rel => openFileViewer(brainFile(root, rel))} /></div>
    </div>
  </article>;
}

export function MemoryBrowser() {
  const [data, setData] = useState<MemoryDocs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shelf, setShelf] = useState<Shelf>(last.shelf);
  const [q, setQ] = useState(last.q);
  const [pick, setPick] = useState<string | null>(last.pick);
  useEffect(() => { last = { shelf, q, pick }; }, [shelf, q, pick]);
  const load = useCallback(async () => {
    try { setData(await window.sb.invoke('memory:docs', undefined)); setErr(null); } catch (e) { setErr(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => window.sb.on('brainmodel:changed', () => { void load(); }), [load]);

  const docs = useMemo(() => ordered(data?.docs ?? []), [data]);
  const hits = useMemo(() => search(docs, shelf, q), [docs, shelf, q]);
  const ws = useMemo(() => words(q), [q]);
  const current = hits.find(h => h.doc.id === pick)?.doc ?? hits[0]?.doc ?? null;
  const count = (s: Shelf) => (s === 'all' ? docs.length : docs.filter(d => shelfOf(d.kind) === s).length);
  const list = useRef<HTMLUListElement>(null);
  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = hits.findIndex(h => h.doc.id === current?.id), next = hits[Math.max(0, Math.min(hits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) { setPick(next.doc.id); requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(next.doc.id)}"]`)?.focus()); }
  };

  return <div className="sl-page mb-page" data-testid="mb-page">
    <HubIntro lead={data ? (docs.length ? t('mb.lead', { n: docs.length }) : t('mb.lead0')) : '…'} />
    {err && <p className="sl-error" role="alert">{t('mb.loadError')} {err}</p>}
    {data && !data.root ? <p className="sl-empty">{t('mb.noBrain')}</p> : <div className="sl-shell">
      <aside className="sl-rail" aria-label={t('mb.searchLabel')}>
        <div className="sl-search">
          <IconSearch size={14} />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('mb.search')} aria-label={t('mb.searchLabel')} data-testid="mb-search" spellCheck={false} />
          {q && <button type="button" className="sl-clear" onClick={() => setQ('')} aria-label={t('mb.clear')}><IconX size={12} /></button>}
        </div>
        <div className="sl-origins mb-shelves" role="group" aria-label={t('mb.shelfLabel')}>
          {SHELVES.map(s => <button key={s} type="button" aria-pressed={shelf === s} onClick={() => setShelf(s)} data-testid={`mb-shelf-${s}`}>
            {t(`mb.shelf.${s}`)}<span className="sl-n">{count(s)}</span></button>)}
        </div>
        <div className="sl-count small" aria-live="polite">{t('mb.count', { shown: hits.length, n: docs.length })}</div>
        {data && !docs.length ? <p className="sl-empty" data-testid="mb-empty">{t('mb.empty')}</p>
          : data && !hits.length ? <p className="sl-empty" data-testid="mb-empty">{t('mb.emptySearch')}</p>
            : <ul className="sl-list" ref={list} onKeyDown={onListKey} data-testid="mb-list">
              {hits.map(h => <li key={h.doc.id}>
                <button type="button" className="sl-row mb-row" data-id={h.doc.id} data-kind={h.doc.kind} aria-current={h.doc.id === current?.id ? 'true' : undefined} onClick={() => setPick(h.doc.id)} data-testid={`mb-row-${h.doc.file}`}>
                  <span className="sl-row-top"><span className="sl-row-name">{dayTitle(h.doc)}</span><span className="mb-kind" data-kind={h.doc.kind}>{h.doc.kind === 'knowledge' || h.doc.kind === 'agent' ? h.doc.group : t(`mb.kind.${h.doc.kind}`)}</span></span>
                  {h.snippet && <span className="sl-row-desc">{h.snippet}</span>}
                  {ws.length > 0 && <span className="sl-row-meta"><span className="sl-uses">{t('mb.matches', { n: h.lines })}</span></span>}
                </button>
              </li>)}
            </ul>}
      </aside>
      <section className="sl-main" aria-live="polite">
        {current ? <Detail key={current.id} doc={current} root={data?.root ?? null} ws={ws} /> : <p className="sl-empty">{data ? t('mb.empty') : '…'}</p>}
      </section>
    </div>}
  </div>;
}
