// Impara's «Giornale» tab (ADR 0265; by editions, ADR 0280; owner 2026-11-13: «un giornale figo, navigabilissimo, con
// notizie poche ma le migliori», on any subject). On top the editions as mastheads (one per subject the user follows)
// and «Nuova edizione» (NewsNewEdition.tsx); below, the owner's three columns: the edition's sections (Prima pagina,
// its own sections, Salvate) with how many stories are unread and its sources; the stories; the open story
// (NewsReader.tsx). The front page holds a few stories only (the edition's cap, 7 by default): the first opens the
// page in large type, the rest of the last days wait under «Altre». The head says the date, when the edition was last
// refreshed, from how many sources, and what that refresh cost in tokens (measured by the engine); «Aggiorna»
// refreshes this edition (with its progress), «Fonti» opens the edition's panel (NewsSources.tsx). A story becomes
// read after a moment open. Keys: J/K move, S saves, U read/unread, E Impara, X meno così, O opens the source, 1-9 the
// sections, [ and ] the editions, R refreshes, «,» the sources. A clean install has no edition: the page offers the
// first one. Used by ImparaPage.tsx; styles news.css.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NewsEdition, NewsItem } from '@shared/news';
import { FRONT, SAVED, lastEdition, lastView, lessLikeThis, markNews, news, refreshNews, rememberEdition, rememberView, startNews, storiesOf, viewsOf, type NewsView } from '../../../lib/news';
import { locale, t } from '../../../i18n';
import { now } from '../../../lib/clock';
import { Button, Kbd } from '../../ui';
import { IconPlus, IconRefresh, IconSettings, IconSpinner, IconStar } from '../../Icons';
import { NewsReader, shortWhen } from './NewsReader';
import { NewsSources } from './NewsSources';
import { NewsNewEdition } from './NewsNewEdition';
import { isTyping } from './keys';
import '../../../styles/news.css';

const READ_AFTER_MS = 1500;
/** a section's colour: by its place in the edition (six tones, then again) */
export const tone = (ed: NewsEdition | undefined, section: string): string => { const i = ed?.sections.findIndex(s => s.id === section) ?? -1; return i < 0 ? '' : `t${i % 6}`; };
export const sectionName = (ed: NewsEdition | undefined, section: string): string => ed?.sections.find(s => s.id === section)?.name ?? '';

function Item({ it, ed, sel, onPick, tagged, lead }: { it: NewsItem; ed: NewsEdition; sel: boolean; onPick: () => void; tagged: boolean; lead?: boolean }) {
  const sec = sectionName(ed, it.section);
  return (
    <div role="option" aria-selected={sel} tabIndex={0} className={`nw-item ${lead ? 'lead' : ''} ${sel ? 'sel' : ''} ${it.read ? 'read' : ''}`} onClick={onPick} onKeyDown={e => { if (e.key === 'Enter') onPick(); }} data-testid="news-item" data-id={it.id}>
      {lead && <span className="nw-kicker">{t('news.lead')}</span>}
      <h3><span className="nw-dot" aria-label={it.read ? t('news.read') : t('news.unread')} />{it.title}</h3>
      <div className="nw-meta">
        {tagged && sec && <span className={`nw-sec ${tone(ed, it.section)}`}>{sec}</span>}
        <span className="nw-src">{it.sourceName}</span>
        <span>{it.undated ? t('news.seen', { when: shortWhen(it.seenAt) }) : shortWhen(it.at)}</span>
        {it.also.length > 0 && <span className="nw-chip dup" data-tip={it.also.map(a => a.name).join(', ')}>{t('news.more', { n: it.also.length })}</span>}
        {it.saved && <span className="nw-star"><IconStar size={11} /></span>}
      </div>
      {(it.summary || it.snippet) && <p className="nw-sum">{it.summary ?? it.snippet}</p>}
    </div>
  );
}

export function NewsPage() {
  startNews();
  const state = news.use(s => s.state);
  const editions = state?.editions ?? [];
  const [edId, setEdId] = useState<string | null>(lastEdition);
  const ed = editions.find(e => e.id === edId) ?? editions[0];
  const [view, setView] = useState<NewsView>(lastView);
  const [selId, setSelId] = useState<string | null>(null);
  const [sources, setSources] = useState(false);
  const [creating, setCreating] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const views = useMemo(() => viewsOf(ed), [ed]);
  const shown = views.includes(view) ? view : FRONT;
  const { list: main, more } = useMemo(() => storiesOf(state, ed, shown), [state, ed, shown]);
  const list = useMemo(() => (moreOpen ? [...main, ...more] : main), [main, more, moreOpen]);
  const idx = Math.max(0, list.findIndex(i => i.id === selId));
  const it = list[idx];
  const pick = (v: NewsView) => { setView(v); rememberView(v); setSelId(null); setMoreOpen(false); };
  const pickEdition = (id: string) => { setEdId(id); rememberEdition(id); setSelId(null); setMoreOpen(false); };

  // read after a moment open (moving through the list with J/K does not mark everything)
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (readTimer.current) clearTimeout(readTimer.current);
    if (it && !it.read) readTimer.current = setTimeout(() => void markNews(it.id, { read: true }), READ_AFTER_MS);
    return () => { if (readTimer.current) clearTimeout(readTimer.current); };
  }, [it?.id, it?.read]);
  useEffect(() => { document.querySelector('.nw-list .nw-item.sel')?.scrollIntoView({ block: 'nearest' }); }, [it?.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('.modal-backdrop, .backdrop')) return;
      const k = e.key.toLowerCase();
      const move = (d: number) => { const n = list[Math.max(0, Math.min(list.length - 1, idx + d))]; if (n) setSelId(n.id); };
      const turn = (d: number) => { const i = editions.findIndex(x => x.id === ed?.id), n = editions[(i + d + editions.length) % editions.length]; if (n) pickEdition(n.id); };
      if (!ed) return;
      if (k === 'j' || k === 'arrowdown') { e.preventDefault(); move(1); }
      else if (k === 'k' || k === 'arrowup') { e.preventDefault(); move(-1); }
      else if (/^[1-9]$/.test(k) && views[Number(k) - 1]) { e.preventDefault(); pick(views[Number(k) - 1]!); }
      else if (k === '[') { e.preventDefault(); turn(-1); }
      else if (k === ']') { e.preventDefault(); turn(1); }
      else if (k === 'r') { e.preventDefault(); void refreshNews(ed.id); }
      else if (k === ',') { e.preventDefault(); setSources(true); }
      else if (!it) return;
      else if (k === 's') { e.preventDefault(); void markNews(it.id, { saved: !it.saved }); }
      else if (k === 'u') { e.preventDefault(); void markNews(it.id, { read: !it.read }); }
      else if (k === 'x') { e.preventDefault(); void lessLikeThis(it); }
      else if (k === 'e') { e.preventDefault(); document.querySelector<HTMLButtonElement>('[data-testid="news-explain"]')?.click(); }
      else if (k === 'o') { e.preventDefault(); document.querySelector<HTMLAnchorElement>('[data-testid="news-open"]')?.click(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const unread = (v: NewsView) => storiesOf(state, ed, v).list.filter(i => !i.read).length;
  const unreadOf = (e: NewsEdition) => storiesOf(state, e, FRONT).list.filter(i => !i.read).length;
  const last = ed ? state?.lastBy[ed.id] : undefined;
  const mine = state?.sources.filter(s => s.edition === ed?.id) ?? [];
  const on = mine.filter(s => s.on).length;
  const count = (state?.items ?? []).filter(i => i.edition === ed?.id && !i.less).length;
  const prog = state?.progress;
  const today = new Date(now()).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const viewName = (v: NewsView) => (v === FRONT ? t('news.view.front') : v === SAVED ? t('news.view.saved') : sectionName(ed, v));

  return (
    <div className="nw" data-testid="news-page">
      <header className="nw-head">
        <div className="nw-title">
          <h1>{t('news.title')}</h1>
          <p className="nw-line">
            <span className="nw-today">{today}</span>
            {ed && (last ? <span>{t('news.lastAt', { when: shortWhen(last.at) })}</span> : <span>{t('news.never')}</span>)}
            {ed && <span>{t('news.counts', { n: count, sources: on })}</span>}
          </p>
        </div>
        {ed && (
          <div className="nw-tools">
            {last && (
              <span className="nw-cost" data-tip={t('news.costTip')} data-testid="news-cost">
                {last.tokens === null ? t('news.tokensUnknown') : t('news.tokensN', { n: last.tokens.toLocaleString(locale()) })}
                {last.costUsd !== null && <> · ≈ {last.costUsd.toLocaleString(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 })}</>}
              </span>
            )}
            <Button onClick={() => setSources(true)} testid="news-sources-btn"><IconSettings size={13} />{t('news.sources')} <Kbd>,</Kbd></Button>
            <Button variant="primary" onClick={() => void refreshNews(ed.id)} disabled={!!prog} testid="news-refresh">
              {prog ? <IconSpinner size={13} /> : <IconRefresh size={13} />}{t('news.refresh')} <Kbd>R</Kbd>
            </Button>
          </div>
        )}
      </header>

      {editions.length > 0 && (
        <nav className="nw-eds" aria-label={t('news.editions')} data-testid="news-editions">
          {editions.map(e => (
            <button key={e.id} type="button" className={e.id === ed?.id ? 'on' : ''} aria-pressed={e.id === ed?.id} onClick={() => pickEdition(e.id)} data-testid={`news-edition-${e.id}`}>
              {e.name}{unreadOf(e) > 0 && <span className="n">{unreadOf(e)}</span>}
            </button>
          ))}
          <button type="button" className="add" onClick={() => setCreating(true)} data-testid="news-edition-new"><IconPlus size={13} />{t('news.new.button')}</button>
        </nav>
      )}

      {prog && (
        <div className="nw-progress" data-testid="news-progress" role="status">
          <span>{t(`news.phase.${prog.phase}`, { done: prog.done, total: prog.total })}</span>
          <span className="ip-bar"><i style={{ width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }} className="half" /></span>
        </div>
      )}
      {!prog && last?.aiError && <p className="nw-warn" data-testid="news-ai-error">{t('news.aiError', { why: last.aiError })}</p>}

      {!ed ? (
        <NewsNewEdition first />
      ) : !count ? (
        <div className="nw-empty" data-testid="news-empty">
          <h2>{on ? t('news.emptyTitle') : t('news.noSourcesTitle')}</h2>
          <p>{on ? t('news.emptyBody', { n: on }) : t('news.noSourcesBody')}</p>
          {on
            ? <Button variant="primary" onClick={() => void refreshNews(ed.id)} disabled={!!prog} testid="news-refresh-empty">{prog ? <IconSpinner size={13} /> : <IconRefresh size={13} />}{t('news.refreshFirst')}</Button>
            : <Button variant="primary" onClick={() => setSources(true)} testid="news-add-sources">{t('news.addSources')}</Button>}
        </div>
      ) : (
        <div className="nw-cols">
          <nav className="nw-nav" aria-label={t('news.sections')}>
            <div className="nw-lbl">{t('news.sections')}</div>
            {views.map((v, i) => (
              <button key={v} type="button" className={shown === v ? 'on' : ''} aria-pressed={shown === v} onClick={() => pick(v)} data-testid={`news-view-${v}`}>
                <span className={`nw-dotsec ${v === FRONT ? 'front' : v === SAVED ? 'saved' : tone(ed, v)}`} />{viewName(v)}<span className="n">{unread(v) || ''}</span>{i < 9 && <Kbd>{String(i + 1)}</Kbd>}
              </button>
            ))}
            <div className="nw-lbl second">{t('news.sources')}</div>
            <button type="button" className="nw-srcline" onClick={() => setSources(true)} data-testid="news-nav-sources">
              {t('news.sourcesOn', { n: on })}{mine.length > on && <span className="n">{t('news.sourcesOff', { n: mine.length - on })}</span>}
            </button>
          </nav>
          <div className="nw-list" role="listbox" aria-label={viewName(shown)} data-testid="news-list">
            {list.length === 0 && <div className="nw-empty-list">{shown === SAVED ? t('news.noSaved') : t('news.noneHere')}</div>}
            {list.map((x, i) => <Item key={x.id} it={x} ed={ed} sel={x === it} lead={shown === FRONT && i === 0} tagged={shown === FRONT || shown === SAVED} onPick={() => setSelId(x.id)} />)}
            {shown === FRONT && more.length > 0 && (
              <button type="button" className="nw-more" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)} data-testid="news-more">
                {moreOpen ? t('news.moreHide') : t('news.moreShow', { n: more.length })}
              </button>
            )}
          </div>
          <article className="nw-reader">{it ? <NewsReader key={it.id} it={it} ed={ed} /> : <div className="nw-empty-read">{t('news.pick')}</div>}</article>
        </div>
      )}
      {sources && ed && <NewsSources edition={ed} onClose={() => setSources(false)} />}
      {creating && <NewsNewEdition onClose={() => setCreating(false)} onCreated={id => { pickEdition(id); setCreating(false); }} />}
    </div>
  );
}
