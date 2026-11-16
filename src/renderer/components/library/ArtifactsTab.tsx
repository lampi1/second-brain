// Memoria → Artifact (ADR 0319, the owner 2026-11-16: «one place to browse every report, analysis and document that my
// chats produce over time, similar to Claude's artifacts»): a gallery of what the chats produced, newest first and
// grouped by day, with a search, filters (type, area, period, chat), a sort and a grid or list view. Each card shows its
// picture (ArtifactThumb.tsx), title, date, area, a short summary, its versions and the chat it came from; a click opens
// it in the app's viewer (HTML rendered, Markdown formatted, PDF paged, images zoomable, csv as a table, text as text;
// the owner 2026-11-16: «potranno essere sia html che png che pdf, insomma un po' tutto»: Word, Excel, video and the
// rest open from there with the system's app), where the artifact bar
// (ArtifactBar.tsx) links the source chat, the versions and related artifacts. A missing file stays, marked. Data:
// lib/library.ts ('library:list', reloaded on 'library:changed'); the filters: shared/library.ts filterArtifacts.
// Rendered by brain-model/MemoryPage.tsx for the 'artifact' tab. Styles: styles/library.css (lib-*).
import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ARTIFACT_KINDS, NO_FILTER, filterArtifacts, type Artifact, type ArtifactFilter, type ArtifactKind, type ArtifactRange, type ArtifactSort } from '@shared/library';
import { openChatRef } from '../../actions';
import { locale, t } from '../../i18n';
import { badgeOf, openedLibrary, refreshLibrary, useLibrary } from '../../lib/library';
import { now as clockNow } from '../../lib/clock';
import { IconChat, IconGrid, IconList, IconRefresh, IconSearch, IconX } from '../Icons';
import { HubIntro } from '../brain-model/HubIntro';
import { ArtifactThumb } from './ArtifactThumb';
import { openArtifact } from './open';
import '../../styles/skill-library.css';
import '../../styles/library.css';

/** Always on the kind row; the others (data, documents, video and audio, other files) only once one is indexed. */
const CORE_KINDS: ReadonlySet<ArtifactKind | 'all'> = new Set(['all', 'html', 'markdown', 'pdf', 'image']);
const RANGES: readonly ArtifactRange[] = ['all', 'today', 'week', 'month'];
const SORTS: readonly ArtifactSort[] = ['newest', 'oldest', 'title', 'versions'];
type View = 'grid' | 'list';
const VIEW_KEY = 'sb.library.view';
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } };
// the filters stay while the app is open (a tab left and opened again shows the same gallery)
let kept: ArtifactFilter = NO_FILTER;

const DAY = 864e5;
function dayStart(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
/** The day group a date falls in: today, yesterday, this week, this month, then month by month. */
export function dayGroup(at: number, nowMs: number): { key: string; label: string } {
  const today = dayStart(nowMs), day = dayStart(at);
  if (day >= today) return { key: 'today', label: t('lib.day.today') };
  if (day >= today - DAY) return { key: 'yesterday', label: t('lib.day.yesterday') };
  if (day >= today - 6 * DAY) return { key: 'week', label: t('lib.day.week') };
  if (day >= today - 29 * DAY) return { key: 'month', label: t('lib.day.month') };
  const d = new Date(at);
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) };
}
const when = (ms: number, nowMs: number) => {
  const d = new Date(ms), same = dayStart(ms) === dayStart(nowMs);
  return same ? d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(nowMs).getFullYear() ? { year: 'numeric' } : {}) });
};

function Card({ a, nowMs, i, list }: { a: Artifact; nowMs: number; i: number; list: boolean }) {
  const chat = a.chatId ? (a.chatTitle ? t('lib.fromChat', { title: a.chatTitle }) : t('lib.fromChatGone')) : t('lib.found');
  return <article className="lib-card" data-kind={a.kind} data-missing={a.missing || undefined} style={{ '--i': Math.min(i, 24) } as CSSProperties} data-testid="lib-card" data-id={a.id}>
    <button type="button" className="lib-card-open" onClick={() => openArtifact(a)} aria-label={t('lib.open', { title: a.title })} data-testid="lib-card-open">
      {!list && <ArtifactThumb a={a} />}
      <span className="lib-card-body">
        <span className="lib-card-top">
          <span className="lib-badge" data-kind={a.kind}>{badgeOf(a)}</span>
          {a.versions.length > 1 && <span className="lib-vers" title={t('lib.versions', { n: a.versions.length })}>{t('lib.versions', { n: a.versions.length })}</span>}
          {a.missing && <span className="lib-gone" title={t('lib.missingTip')}>{t('lib.missing')}</span>}
          <span className="sp" />
          <time dateTime={new Date(a.at).toISOString()} title={new Date(a.at).toLocaleString(locale())}>{when(a.at, nowMs)}</time>
        </span>
        <span className="lib-card-title" title={a.title}>{a.title}</span>
        {a.summary ? <span className="lib-card-sum">{a.summary}</span> : <span className="lib-card-sum lib-card-file" title={a.path}>{a.path.split(/[\\/]/).slice(-2).join('/')}</span>}
      </span>
    </button>
    <footer className="lib-card-foot">
      <span className="lib-area" title={t('lib.area')}>{a.area}</span>
      {a.chatId ? <button type="button" className="lib-chat" onClick={() => openChatRef(a.chatId!)} title={t('lib.openChat')} data-testid="lib-card-chat"><IconChat size={12} /><span>{chat}</span></button>
        : <span className="lib-chat lib-chat-none">{chat}</span>}
    </footer>
  </article>;
}

function Select<T extends string>({ label, value, onChange, items, testId }: { label: string; value: T; onChange: (v: T) => void; items: readonly { id: T; label: string }[]; testId: string }) {
  return <label className="lib-select" data-on={value !== 'all' && value !== 'newest' ? 'true' : undefined}>
    <span>{label}</span>
    <select value={value} onChange={e => onChange(e.target.value as T)} data-testid={testId}>
      {items.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  </label>;
}

export function ArtifactsTab() {
  const { list, loaded, error } = useLibrary();
  const [f, setF] = useState<ArtifactFilter>(kept);
  useEffect(() => { kept = f; }, [f]);
  // the tab opened: a look through the folders when the last one is older than a minute
  useEffect(() => { void openedLibrary(); }, []);
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* this session only */ } };
  const [nowMs, setNow] = useState(() => clockNow());
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) setNow(clockNow()); }, 60_000); return () => clearInterval(id); }, []);
  const q = useDeferredValue(f.q);
  const all = list.artifacts;
  const shown = useMemo(() => filterArtifacts(all, { ...f, q }, nowMs), [all, f, q, nowMs]);
  const areas = useMemo(() => [...new Set(all.map(a => a.area))].sort((x, y) => x.localeCompare(y)), [all]);
  const chats = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of all) if (a.chatId && a.chatTitle && !m.has(a.chatId)) m.set(a.chatId, a.chatTitle);
    return [...m].sort((x, y) => x[1].localeCompare(y[1]));
  }, [all]);
  const kindCount = (k: ArtifactKind | 'all') => (k === 'all' ? all.length : all.filter(a => a.kind === k).length);
  const groups = useMemo(() => {
    if (f.sort !== 'newest' && f.sort !== 'oldest') return [{ key: 'all', label: '', items: shown }];
    const out: { key: string; label: string; items: Artifact[] }[] = [];
    for (const a of shown) { const g = dayGroup(a.at, nowMs); const last = out[out.length - 1]; if (last?.key === g.key) last.items.push(a); else out.push({ ...g, items: [a] }); }
    return out;
  }, [shown, f.sort, nowMs]);
  const filtered = f.q || f.kind !== 'all' || f.area !== 'all' || f.chat !== 'all' || f.range !== 'all';
  const set = <K extends keyof ArtifactFilter>(k: K, v: ArtifactFilter[K]) => setF(x => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);
  const refresh = () => { setBusy(true); void refreshLibrary().finally(() => setBusy(false)); };
  const scanning = busy || list.scanning;
  let i = 0;

  return <div className="lib-page" data-testid="lib-page" data-view={view}>
    <HubIntro lead={loaded ? (all.length ? t('lib.lead', { n: all.length }) : t('lib.lead0')) : '…'} actions={
      <button type="button" className="btn btn-ghost btn-s lib-refresh" onClick={refresh} disabled={busy} title={t('lib.refreshTip')} data-busy={scanning || undefined} data-testid="lib-refresh">
        <IconRefresh size={14} /> {scanning ? t('lib.scanning') : t('lib.refresh')}
      </button>} />
    {error && <p className="sl-error" role="alert">{t('lib.loadError')} {error}</p>}
    <div className="lib-bar" role="search">
      <div className="lib-bar-row">
        <div className="sl-search lib-search">
          <IconSearch size={14} />
          <input type="search" value={f.q} onChange={e => set('q', e.target.value)} placeholder={t('lib.search')} aria-label={t('lib.searchLabel')} spellCheck={false} data-testid="lib-search" />
          {f.q && <button type="button" className="sl-clear" onClick={() => set('q', '')} aria-label={t('lib.clear')}><IconX size={12} /></button>}
        </div>
        <div className="lib-views" role="group" aria-label={t('lib.view')}>
          <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')} aria-label={t('lib.view.grid')} title={t('lib.view.grid')} data-testid="lib-view-grid"><IconGrid size={14} /></button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} aria-label={t('lib.view.list')} title={t('lib.view.list')} data-testid="lib-view-list"><IconList size={14} /></button>
        </div>
      </div>
      <div className="lib-bar-row">
        <div className="lib-kinds" role="group" aria-label={t('lib.kindLabel')}>
          {(['all', ...ARTIFACT_KINDS] as const).filter(k => CORE_KINDS.has(k) || f.kind === k || kindCount(k) > 0).map(k => <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => set('kind', k)} data-testid={`lib-kind-${k}`} data-kind={k}>
            {t(`lib.kind.${k}`)}<span className="sl-n">{kindCount(k)}</span></button>)}
        </div>
        <div className="lib-selects">
          <Select label={t('lib.area')} value={f.area} onChange={v => set('area', v)} testId="lib-area" items={[{ id: 'all', label: t('lib.area.all') }, ...areas.map(a => ({ id: a, label: a }))]} />
          <Select label={t('lib.range')} value={f.range} onChange={v => set('range', v)} testId="lib-range" items={RANGES.map(r => ({ id: r, label: t(`lib.range.${r}`) }))} />
          <Select label={t('lib.chat')} value={f.chat} onChange={v => set('chat', v)} testId="lib-chat" items={[{ id: 'all', label: t('lib.chat.all') }, ...chats.map(([id, title]) => ({ id, label: title }))]} />
          <Select label={t('lib.sort')} value={f.sort} onChange={v => set('sort', v)} testId="lib-sort" items={SORTS.map(s => ({ id: s, label: t(`lib.sort.${s}`) }))} />
        </div>
      </div>
    </div>
    <div className="lib-count small" aria-live="polite">
      <span data-testid="lib-count">{t('lib.count', { shown: shown.length, n: all.length })}</span>
      {filtered && <button type="button" className="sl-link" onClick={() => setF({ ...NO_FILTER, sort: f.sort })} data-testid="lib-reset">{t('lib.reset')}</button>}
      {list.dropped > 0 && <span>· {t('lib.dropped', { n: list.dropped })}</span>}
      {!list.backfilled && loaded && <span className="lib-note">· {t('lib.backfilling')}</span>}
    </div>
    {!loaded ? <div className="lib-grid" aria-busy="true">{Array.from({ length: 6 }, (_, k) => <div key={k} className="lib-card lib-skel" />)}</div>
      : !all.length ? <p className="lib-empty" data-testid="lib-empty">{t('lib.empty')}</p>
        : !shown.length ? <p className="lib-empty" data-testid="lib-empty">{t('lib.emptyFilter')}</p>
          : groups.map(g => <section key={g.key} className="lib-group" aria-label={g.label || undefined}>
            {g.label && <h3 className="lib-day"><span>{g.label}</span><span className="sl-n">{g.items.length}</span></h3>}
            <div className={view === 'list' ? 'lib-rows' : 'lib-grid'} data-testid="lib-grid">
              {g.items.map(a => <Card key={a.id} a={a} nowMs={nowMs} i={i++} list={view === 'list'} />)}
            </div>
          </section>)}
  </div>;
}
