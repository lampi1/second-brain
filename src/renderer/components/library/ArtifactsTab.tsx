// Memoria → Artifact (ADR 0328, the owner 2026-11-19: «solo gli artifact che produce l'app su richiesta dell'utente e
// non divisi per file»): ONE list, newest first, of the reports, documents, plans and analyses the agents made because
// the user asked for one (an agent declares its file with artifact_save: nothing is picked up from folders or chats).
// No tabs or filters by file type: a search, and a grid or a list. Each card shows its picture (ArtifactThumb.tsx),
// title, date, area, a short summary, its versions and the chat it came from; a click opens it in the app's viewer,
// whatever its format (HTML rendered, Markdown formatted, PDF paged, images, csv as a table, Word, Excel and PowerPoint
// as their text and tables), where the artifact bar (ArtifactBar.tsx) links the source chat, the versions and related
// artifacts. A missing file stays, marked, until the user takes the card off (✕: the list only, never the file). Data:
// lib/library.ts ('library:list', reloaded on 'library:changed'); the search: shared/library.ts searchArtifacts.
// Rendered by brain-model/MemoryPage.tsx for the 'artifact' tab. Styles: styles/library.css (lib-*). The list draws
// the newest LIBRARY_PAGE and «Mostra altri» adds as many again (ADR 0323's lightness stays).
import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { LIBRARY_PAGE, searchArtifacts, type Artifact } from '@shared/library';
import { openChatRef } from '../../actions';
import { locale, t } from '../../i18n';
import { badgeOf, openedLibrary, removeArtifact, useLibrary } from '../../lib/library';
import { now as clockNow } from '../../lib/clock';
import { IconChat, IconGrid, IconList, IconSearch, IconX } from '../Icons';
import { HubIntro } from '../brain-model/HubIntro';
import { ArtifactThumb } from './ArtifactThumb';
import { openArtifact } from './open';
import '../../styles/skill-library.css';
import '../../styles/library.css';

type View = 'grid' | 'list';
const VIEW_KEY = 'sb.library.view';
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } };
// the search stays while the app is open (a tab left and opened again shows the same list)
let kept = '';

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
  const chat = a.chatId ? (a.chatTitle ? t('lib.fromChat', { title: a.chatTitle }) : t('lib.fromChatGone')) : '';
  // ✕ asks once on the card itself (no dialog): the second click takes it off
  const [asking, setAsking] = useState(false);
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
    <footer className="lib-card-foot" onMouseLeave={() => setAsking(false)}>
      <span className="lib-area" title={t('lib.area')}>{a.area}</span>
      {a.chatId && <button type="button" className="lib-chat" onClick={() => openChatRef(a.chatId!)} title={t('lib.openChat')} data-testid="lib-card-chat"><IconChat size={12} /><span>{chat}</span></button>}
      <span className="sp" />
      {asking
        ? <button type="button" className="lib-remove is-asking" onClick={() => void removeArtifact(a.id)} onBlur={() => setAsking(false)} title={t('lib.removeTip')} data-testid="lib-card-remove-yes">{t('lib.removeYes')}</button>
        : <button type="button" className="lib-remove" onClick={() => setAsking(true)} title={t('lib.removeTip')} aria-label={t('lib.remove', { title: a.title })} data-testid="lib-card-remove"><IconX size={12} /></button>}
    </footer>
  </article>;
}

export function ArtifactsTab() {
  const { list, loaded, error } = useLibrary();
  const [query, setQuery] = useState(kept);
  useEffect(() => { kept = query; }, [query]);
  // the tab opened: every known file is looked at again (one that went shows as missing)
  useEffect(() => { void openedLibrary(); }, []);
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* this session only */ } };
  const [nowMs, setNow] = useState(() => clockNow());
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) setNow(clockNow()); }, 60_000); return () => clearInterval(id); }, []);
  const q = useDeferredValue(query);
  const all = list.artifacts;
  const shown = useMemo(() => searchArtifacts(all, q), [all, q]);
  // a page at a time: another search starts again from the first page
  const [limit, setLimit] = useState(LIBRARY_PAGE);
  useEffect(() => { setLimit(LIBRARY_PAGE); }, [q]);
  const page = useMemo(() => shown.slice(0, limit), [shown, limit]);
  const left = shown.length - page.length;
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Artifact[] }[] = [];
    for (const a of page) { const g = dayGroup(a.at, nowMs); const last = out[out.length - 1]; if (last?.key === g.key) last.items.push(a); else out.push({ ...g, items: [a] }); }
    return out;
  }, [page, nowMs]);
  let i = 0;

  return <div className="lib-page" data-testid="lib-page" data-view={view}>
    <HubIntro lead={loaded ? (all.length ? t('lib.lead', { n: all.length }) : t('lib.lead0')) : '…'} />
    {error && <p className="sl-error" role="alert">{t('lib.loadError')} {error}</p>}
    {all.length > 0 && <div className="lib-bar" role="search">
      <div className="sl-search lib-search">
        <IconSearch size={14} />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('lib.search')} aria-label={t('lib.searchLabel')} spellCheck={false} data-testid="lib-search" />
        {query && <button type="button" className="sl-clear" onClick={() => setQuery('')} aria-label={t('lib.clear')}><IconX size={12} /></button>}
      </div>
      <span className="lib-count small" aria-live="polite" data-testid="lib-count">{t('lib.count', { shown: shown.length, n: all.length })}</span>
      <div className="lib-views" role="group" aria-label={t('lib.view')}>
        <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')} aria-label={t('lib.view.grid')} title={t('lib.view.grid')} data-testid="lib-view-grid"><IconGrid size={14} /></button>
        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} aria-label={t('lib.view.list')} title={t('lib.view.list')} data-testid="lib-view-list"><IconList size={14} /></button>
      </div>
    </div>}
    {!loaded ? <div className="lib-grid" aria-busy="true">{Array.from({ length: 3 }, (_, k) => <div key={k} className="lib-card lib-skel" />)}</div>
      : !all.length ? <p className="lib-empty" data-testid="lib-empty">{t('lib.empty')}</p>
        : !shown.length ? <p className="lib-empty" data-testid="lib-empty">{t('lib.emptyFilter')}</p>
          : groups.map(g => <section key={g.key} className="lib-group" aria-label={g.label}>
            <h3 className="lib-day"><span>{g.label}</span></h3>
            <div className={view === 'list' ? 'lib-rows' : 'lib-grid'} data-testid="lib-grid">
              {g.items.map(a => <Card key={a.id} a={a} nowMs={nowMs} i={i++} list={view === 'list'} />)}
            </div>
          </section>)}
    {loaded && left > 0 && <button type="button" className="btn btn-ghost lib-more" onClick={() => setLimit(n => n + LIBRARY_PAGE)} data-testid="lib-more">
      {t('lib.more', { n: Math.min(LIBRARY_PAGE, left), left })}</button>}
  </div>;
}
