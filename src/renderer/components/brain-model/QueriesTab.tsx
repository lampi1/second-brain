// The brain's saved queries (ADR 0124), the Query half of Memoria → «Script & Query» (the hub, MemoryPage.tsx, renders
// it under the scripts). The Script page's look (brain/pages/Script.tsx: cards in a grid, language chip, search and
// chips): one card per query with its language, title, what it answers, where it runs (the data source), tags and the
// file; «Copia» copies the query itself, «Apri il file» opens it in the file viewer, «Elimina» removes it through the
// brain model's ChangeLog with «Annulla» in the toast (brainmodel:rollback). A card opens in place with the code
// (credential-looking lines already masked by main). Nothing here runs a query. Data: typed IPC queries:list / get /
// delete (main brain/queries.ts), refreshed on 'queries:changed' and 'brainmodel:changed'.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { BrainQuery, BrainQueryList, BrainQuerySummary } from '@shared/contract';
import { sb } from '../../sb';
import { openFileViewer } from '../../actions';
import { toast } from '../../store/ui';
import { copyText } from '../../brain/components/ui';
import { brainFile } from '../../lib/memory-view';
import { locale, t } from '../../i18n';
import { IconCopy, IconFile, IconSearch } from '../Icons';
import '../../dashboard/dashboard.css';
import '../../styles/brain-sections.css';
import '../../styles/queries.css';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '');
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
/** the language chip's colour family */
const tone = (language: string): string => {
  const l = language.toLowerCase();
  return l === 'kql' ? 'violet' : /sql/.test(l) ? 'blue' : l === 'graphql' ? 'pink' : /promql|logql|flux/.test(l) ? 'amber' : l === 'spl' ? 'green' : 'neutral';
};

/** Every word in title, description, data source, tags, language or file name (accents and case folded). */
export function filterQueries(list: readonly BrainQuerySummary[], q: string, language: string | null): BrainQuerySummary[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return list.filter(x => (!language || x.language === language)
    && words.every(w => fold(`${x.title} ${x.description} ${x.source} ${x.tags.join(' ')} ${x.language} ${x.file}`).includes(w)));
}

const IconTrash = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4.5 7h15M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.8 11.3c.1 1 .9 1.7 1.9 1.7h5.6c1 0 1.8-.7 1.9-1.7L17.5 7M10.2 11v5.5M13.8 11v5.5" /></svg>;
const IconDb = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><ellipse cx="12" cy="5.5" rx="7" ry="2.8" /><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></svg>;

function useQueries(): { data: BrainQueryList | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<BrainQueryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => { sb.invoke('queries:list', undefined).then(d => { setData(d); setError(null); }, e => setError(err(e))); }, []);
  useEffect(() => {
    reload();
    const offs = [sb.on('queries:changed', reload), sb.on('brainmodel:changed', reload)];
    return () => { for (const off of offs) off(); };
  }, [reload]);
  return { data, error, reload };
}

async function copyQuery(id: string, code?: string): Promise<void> {
  try {
    const text = code ?? (await sb.invoke('queries:get', { id })).code;
    toast((await copyText(text)) ? t('queries.copied') : t('queries.copyFailed'), 'ok');
  } catch (e) { toast(t('queries.failed', { error: err(e) }), 'err'); }
}

function Code({ id }: { id: string }) {
  const [q, setQ] = useState<BrainQuery | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; sb.invoke('queries:get', { id }).then(d => { if (live) setQ(d); }, e => { if (live) setError(err(e)); }); return () => { live = false; }; }, [id]);
  if (!q) return <div className="qy-detail"><p className="bs-muted">{error ? t('queries.failed', { error }) : t('queries.loading')}</p></div>;
  return (
    <div className="qy-detail" data-testid="qy-detail">
      <section className="bs-code">
        <header><span className="dash-eyebrow">{t('queries.code')} · {q.language}</span>
          {q.masked > 0 && <span className="bs-masked">{t('queries.hiddenLines', { n: q.masked })}</span>}
          <button type="button" className="btn btn-subtle btn-s" onClick={() => void copyQuery(q.id, q.code)} data-testid="qy-copy-code"><IconCopy size={13} /> {t('queries.copy')}</button></header>
        <pre data-testid="qy-code"><code>{q.code}</code></pre>
      </section>
      {q.from && <p className="qy-from"><span>{t('queries.from')}</span> {q.from.replace(/`/g, '')}</p>}
    </div>
  );
}

function Card({ q, index, open, leaving, onToggle, onDelete }: { q: BrainQuerySummary & { path: string }; index: number; open: boolean; leaving: boolean; onToggle: () => void; onDelete: () => void }) {
  return (
    <article className={`bs-card qy-card${open ? ' open' : ''}${leaving ? ' leaving' : ''}`} data-testid="qy-card" data-id={q.id} data-tone={tone(q.language)} style={{ '--row-index': Math.min(index, 8) } as CSSProperties}>
      <div className="qy-actions">
        <button type="button" className="qy-icon" onClick={() => void copyQuery(q.id)} title={t('queries.copyTitle')} aria-label={t('queries.copyTitle')} data-testid="qy-copy"><IconCopy size={15} /></button>
        <button type="button" className="qy-icon" onClick={() => openFileViewer(q.path)} title={t('queries.open')} aria-label={t('queries.open')} data-testid="qy-open"><IconFile size={15} /></button>
        <button type="button" className="qy-icon qy-danger" onClick={onDelete} title={t('queries.deleteTitle')} aria-label={t('queries.delete')} data-testid="qy-delete"><IconTrash /></button>
      </div>
      <button type="button" className="bs-card-main qy-main" aria-expanded={open} aria-label={`${q.title}: ${open ? t('queries.hide') : t('queries.show')}`} onClick={onToggle}>
        <span className="bs-card-top"><span className={`qy-lang qy-lang-${tone(q.language)}`} data-testid="qy-lang">{q.language}</span></span>
        <h3>{q.title}</h3>
        <p className="bs-desc">{q.description || t('queries.noDescription')}</p>
        <span className={`qy-source${q.source ? '' : ' none'}`} title={q.source || undefined} data-testid="qy-source"><IconDb /><b>{t('queries.runsOn')}</b><span>{q.source || t('queries.noSource')}</span></span>
        {q.tags.length > 0 && <span className="bs-tags">{q.tags.map(x => <span key={x}>{x}</span>)}</span>}
        <span className="bs-card-foot"><code>{q.file}</code>{q.changedAt && <small>{t('queries.changed')} {day(q.changedAt)}</small>}</span>
      </button>
      {open && <Code id={q.id} />}
    </article>
  );
}

export function QueriesTab() {
  const list = useQueries();
  const [q, setQ] = useState('');
  const [lang, setLang] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const all = list.data?.queries ?? [];
  const languages = useMemo(() => [...new Set(all.map(x => x.language))].sort(), [all]);
  const shown = useMemo(() => filterQueries(all, q, lang && languages.includes(lang) ? lang : null), [all, q, lang, languages]);
  const root = list.data?.root ?? null;
  const withPath = (x: BrainQuerySummary) => ({ ...x, path: brainFile(root, x.file) });

  const remove = (x: BrainQuerySummary) => {
    setLeaving(s => new Set(s).add(x.id));
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      sb.invoke('queries:delete', { id: x.id }).then(r => {
        if (open === x.id) setOpen(null);
        list.reload();
        toast(t('queries.deleted', { title: x.title }), 'info', { label: t('queries.undo'), run: () => {
          sb.invoke('brainmodel:rollback', { id: r.changeId }).then(() => { list.reload(); toast(t('queries.restored'), 'ok'); }, e => toast(t('queries.failed', { error: err(e) }), 'err'));
        } }, 8000);
      }, e => toast(t('queries.failed', { error: err(e) }), 'err')).finally(() => setLeaving(s => { const n = new Set(s); n.delete(x.id); return n; }));
    }, reduce ? 0 : 200);
  };

  return (
    <section className="qy-tab" data-testid="queries-tab" aria-labelledby="qy-title">
      <header className="qy-head">
        <div>
          <span className="dash-eyebrow">{t('queries.eyebrow')}</span>
          <h2 id="qy-title">{t('queries.title')}{list.data && <span className="qy-count" data-testid="qy-count">{all.length}</span>}</h2>
          <p>{t('queries.lead')}</p>
        </div>
      </header>
      {all.length > 0 && <div className="bs-toolbar" role="search">
        <label className="dash-search bs-search"><IconSearch size={14} /><input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label={t('queries.searchLabel')} placeholder={t('queries.searchPlaceholder')} data-testid="qy-search" /></label>
        {languages.length > 1 && <div className="bs-chips" role="group" aria-label={t('queries.filterLabel')}>
          <button type="button" className="bs-chip" aria-pressed={!lang} onClick={() => setLang(null)} data-testid="qy-filter-all">{t('queries.all')}</button>
          {languages.map(l => <button key={l} type="button" className="bs-chip qy-chip" aria-pressed={lang === l} onClick={() => setLang(x => x === l ? null : l)} data-testid={`qy-filter-${l.toLowerCase()}`}>
            <i className={`qy-swatch qy-lang-${tone(l)}`} aria-hidden="true" />{l}<b>{all.filter(x => x.language === l).length}</b></button>)}
        </div>}
      </div>}
      {list.error && !list.data ? <div className="dash-empty">{t('queries.cannotRead', { error: list.error })} <button type="button" className="btn btn-subtle btn-s" onClick={list.reload}>{t('queries.retry')}</button></div>
        : !list.data ? <div className="bs-grid">{[0, 1, 2].map(i => <div key={i} className="bs-card bs-skeleton" />)}</div>
        : !all.length ? <div className="bs-empty qy-empty" data-testid="qy-empty"><span className="qy-empty-icon" aria-hidden="true"><IconDb /></span><h2>{t('queries.emptyTitle')}</h2><p>{t('queries.emptyBody')}</p></div>
        : !shown.length ? <div className="dash-empty" data-testid="qy-none">{t('queries.noMatch')}</div>
        : <div className="bs-grid qy-grid" data-testid="qy-grid">{shown.map((x, i) => <Card key={x.id} q={withPath(x)} index={i} open={open === x.id} leaving={leaving.has(x.id)} onToggle={() => setOpen(o => o === x.id ? null : x.id)} onDelete={() => remove(x)} />)}</div>}
    </section>
  );
}
