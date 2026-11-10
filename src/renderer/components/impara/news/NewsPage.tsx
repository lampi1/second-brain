// Impara's «Giornale» tab (ADR 0264; owner 2026-11-10 picked the «Rassegna a 3 colonne» of the proposals): the AI news
// in three columns. Left the sections (Prima pagina = the best of all, then Modelli e benchmark, Harness e tool, Skill e
// agenti, Ricerca, and Salvate) with how many stories are unread; in the middle the stories, most important first,
// each with its source, when, and how many other sources carried it; on the right the open story (NewsReader.tsx).
// The head says the date, when the paper was last refreshed, from how many sources, and what that refresh cost in
// tokens (measured by the engine); «Aggiorna» refreshes now (with its progress), «Fonti» opens the sources panel
// (NewsSources.tsx). A story becomes read after a moment open. Keys: J/K move, S saves, U read/unread, E Spiegamelo,
// O opens the source, 1-6 the sections, R refreshes, «,» the sources. Used by ImparaPage.tsx; styles news.css.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NewsItem } from '@shared/news';
import { lastView, markNews, news, refreshNews, rememberView, startNews, storiesOf, type NewsView } from '../../../lib/news';
import { locale, t } from '../../../i18n';
import { now } from '../../../lib/clock';
import { Button, Kbd } from '../../ui';
import { IconRefresh, IconSettings, IconSpinner, IconStar } from '../../Icons';
import { NewsReader, shortWhen } from './NewsReader';
import { NewsSources } from './NewsSources';
import { isTyping } from './keys';
import '../../../styles/news.css';

const VIEWS: NewsView[] = ['front', 'models', 'harness', 'skills', 'research', 'saved'];
const READ_AFTER_MS = 1500;

function Item({ it, sel, onPick, front }: { it: NewsItem; sel: boolean; onPick: () => void; front: boolean }) {
  return (
    <div role="option" aria-selected={sel} tabIndex={0} className={`nw-item ${sel ? 'sel' : ''} ${it.read ? 'read' : ''}`} onClick={onPick} onKeyDown={e => { if (e.key === 'Enter') onPick(); }} data-testid="news-item" data-id={it.id}>
      <h3><span className="nw-dot" aria-label={it.read ? t('news.read') : t('news.unread')} />{it.title}</h3>
      <div className="nw-meta">
        {front && <span className={`nw-sec ${it.section}`}>{t(`news.section.${it.section}`)}</span>}
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
  const [view, setView] = useState<NewsView>(lastView);
  const [selId, setSelId] = useState<string | null>(null);
  const [sources, setSources] = useState(false);
  const list = useMemo(() => storiesOf(state, view), [state, view]);
  const idx = Math.max(0, list.findIndex(i => i.id === selId));
  const it = list[idx];
  const pick = (v: NewsView) => { setView(v); rememberView(v); setSelId(null); };

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
      if (k === 'j' || k === 'arrowdown') { e.preventDefault(); move(1); }
      else if (k === 'k' || k === 'arrowup') { e.preventDefault(); move(-1); }
      else if (/^[1-6]$/.test(k)) { e.preventDefault(); pick(VIEWS[Number(k) - 1]!); }
      else if (k === 'r') { e.preventDefault(); void refreshNews(); }
      else if (k === ',') { e.preventDefault(); setSources(true); }
      else if (!it) return;
      else if (k === 's') { e.preventDefault(); void markNews(it.id, { saved: !it.saved }); }
      else if (k === 'u') { e.preventDefault(); void markNews(it.id, { read: !it.read }); }
      else if (k === 'e') { e.preventDefault(); document.querySelector<HTMLButtonElement>('[data-testid="news-explain"]')?.click(); }
      else if (k === 'o') { e.preventDefault(); document.querySelector<HTMLAnchorElement>('[data-testid="news-open"]')?.click(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const unread = (v: NewsView) => storiesOf(state, v).filter(i => !i.read).length;
  const last = state?.last;
  const on = state?.sources.filter(s => s.on).length ?? 0;
  const prog = state?.progress;
  const today = new Date(now()).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="nw" data-testid="news-page">
      <header className="nw-head">
        <div className="nw-title">
          <h1>{t('news.title')}</h1>
          <p className="nw-line">
            <span className="nw-today">{today}</span>
            {last ? <span>{t('news.lastAt', { when: shortWhen(last.at) })}</span> : <span>{t('news.never')}</span>}
            <span>{t('news.counts', { n: state?.items.length ?? 0, sources: on })}</span>
          </p>
        </div>
        <div className="nw-tools">
          {last && (
            <span className="nw-cost" data-tip={t('news.costTip')} data-testid="news-cost">
              {last.tokens === null ? t('news.tokensUnknown') : t('news.tokensN', { n: last.tokens.toLocaleString(locale()) })}
              {last.costUsd !== null && <> · ≈ {last.costUsd.toLocaleString(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 })}</>}
            </span>
          )}
          <Button onClick={() => setSources(true)} testid="news-sources-btn"><IconSettings size={13} />{t('news.sources')} <Kbd>,</Kbd></Button>
          <Button variant="primary" onClick={() => void refreshNews()} disabled={!!prog} testid="news-refresh">
            {prog ? <IconSpinner size={13} /> : <IconRefresh size={13} />}{t('news.refresh')} <Kbd>R</Kbd>
          </Button>
        </div>
      </header>
      {prog && (
        <div className="nw-progress" data-testid="news-progress" role="status">
          <span>{t(`news.phase.${prog.phase}`, { done: prog.done, total: prog.total })}</span>
          <span className="ip-bar"><i style={{ width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }} className="half" /></span>
        </div>
      )}
      {!prog && last?.aiError && <p className="nw-warn" data-testid="news-ai-error">{t('news.aiError', { why: last.aiError })}</p>}

      {!state?.items.length ? (
        <div className="nw-empty" data-testid="news-empty">
          <h2>{t('news.emptyTitle')}</h2>
          <p>{t('news.emptyBody', { n: on })}</p>
          <Button variant="primary" onClick={() => void refreshNews()} disabled={!!prog} testid="news-refresh-empty">{prog ? <IconSpinner size={13} /> : <IconRefresh size={13} />}{t('news.refreshFirst')}</Button>
        </div>
      ) : (
        <div className="nw-cols">
          <nav className="nw-nav" aria-label={t('news.sections')}>
            <div className="nw-lbl">{t('news.sections')}</div>
            {VIEWS.map((v, i) => (
              <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => pick(v)} data-testid={`news-view-${v}`}>
                <span className={`nw-dotsec ${v}`} />{t(`news.view.${v}`)}<span className="n">{unread(v) || ''}</span><Kbd>{String(i + 1)}</Kbd>
              </button>
            ))}
          </nav>
          <div className="nw-list" role="listbox" aria-label={t(`news.view.${view}`)} data-testid="news-list">
            {list.length === 0 && <div className="nw-empty-list">{view === 'saved' ? t('news.noSaved') : t('news.noneHere')}</div>}
            {list.map(x => <Item key={x.id} it={x} sel={x === it} front={view === 'front' || view === 'saved'} onPick={() => setSelId(x.id)} />)}
          </div>
          <article className="nw-reader">{it ? <NewsReader key={it.id} it={it} /> : <div className="nw-empty-read">{t('news.pick')}</div>}</article>
        </div>
      )}
      {sources && <NewsSources onClose={() => setSources(false)} />}
    </div>
  );
}
