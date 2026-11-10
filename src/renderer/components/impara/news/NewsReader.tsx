// One story of the News, read in place (ADR 0264): its section, title, source and date, «Perché conta per te», the AI
// summary (or the source's own few words until the next refresh writes it), the actions (Spiegamelo, Salva, letta /
// da leggere, Apri la fonte) and every link to it: the primary first, then the other sources that carried it. A line
// at the bottom says why it is where it is (the four parts of its score). Used by NewsPage.tsx; styles news.css.
import type { NewsItem } from '@shared/news';
import { explainStory, markNews } from '../../../lib/news';
import { go } from '../../../actions';
import { locale, t } from '../../../i18n';
import { now as clockNow } from '../../../lib/clock';
import { Button, Kbd } from '../../ui';
import { IconBook, IconExternal, IconStar } from '../../Icons';
import { useState } from 'react';

export function fullDate(at: number): string {
  return new Date(at).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
/** «oggi 06:12», «ieri», «3 g fa», else the day. */
export function shortWhen(at: number, now = clockNow()): string {
  const day = (x: number) => { const d = new Date(x); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff <= 0) return t('news.today', { time: new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) });
  if (diff === 1) return t('news.yesterday');
  if (diff < 7) return t('news.daysAgo', { n: diff });
  return new Date(at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

const pct = (n: number) => Math.round(n * 100);

export function NewsReader({ it }: { it: NewsItem }) {
  const [busy, setBusy] = useState(false);
  const explain = async () => {
    if (busy) return;
    setBusy(true);
    const id = await explainStory(it);
    setBusy(false);
    if (id) go({ page: 'impara', arg: id });
  };
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  return (
    <div className="nw-story" data-testid="news-reader" data-id={it.id}>
      <span className={`nw-sec ${it.section}`}>{t(`news.section.${it.section}`)}</span>
      <h2 className="nw-h">{it.title}</h2>
      <div className="nw-meta">
        <span className="nw-src">{it.sourceName}</span>
        <span>{it.undated ? t('news.undated', { day: fullDate(it.seenAt) }) : fullDate(it.at)}</span>
        {it.signal !== undefined && <span className="nw-chip">{it.source === 'hf-papers' ? t('news.votes', { n: it.signal }) : t('news.points', { n: it.signal })}</span>}
        {it.saved && <span className="nw-star" aria-label={t('news.saved')}><IconStar size={12} /></span>}
      </div>
      {it.why && <div className="nw-why" data-testid="news-why"><b>{t('news.why')}</b>{it.why}</div>}
      <div className="nw-body">
        {it.summary ? <p>{it.summary}</p> : <><p>{it.snippet || it.title}</p><p className="nw-note">{t('news.noSummary')}</p></>}
      </div>
      <div className="nw-acts">
        <Button variant="primary" onClick={() => void explain()} disabled={busy} testid="news-explain">
          <IconBook size={13} />{it.lesson ? t('news.openLesson') : t('news.explain')} <Kbd>E</Kbd>
        </Button>
        <Button onClick={() => void markNews(it.id, { saved: !it.saved })} testid="news-save">
          <IconStar size={13} />{it.saved ? t('news.savedOn') : t('news.save')} <Kbd>S</Kbd>
        </Button>
        <Button onClick={() => void markNews(it.id, { read: !it.read })} testid="news-read">
          {it.read ? t('news.markUnread') : t('news.markRead')} <Kbd>U</Kbd>
        </Button>
        <a className="btn btn-ghost btn-m nw-open" href={it.url} target="_blank" rel="noopener noreferrer" data-testid="news-open">
          <IconExternal size={13} />{t('news.open')} <Kbd>O</Kbd>
        </a>
      </div>
      <div className="nw-links" data-testid="news-links">
        <a className="primary" href={it.url} target="_blank" rel="noopener noreferrer"><b>{t('news.primary')}</b><span>{host(it.url)}</span></a>
        {it.also.map(a => (
          <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer"><b>{a.name}</b><span>{t('news.sameStory')}</span></a>
        ))}
      </div>
      <div className="nw-rank" data-tip={t('news.rankTip')}>
        <span>{t('news.rank', { n: pct(it.score) })}</span>
        <span>{t('news.rankRecency')} <i>{pct(it.rank.recency)}</i></span>
        <span>{t('news.rankSource')} <i>{pct(it.rank.source)}</i></span>
        <span>{t('news.rankRelevance')} <i>{pct(it.rank.relevance)}</i></span>
        <span>{t('news.rankEcho')} <i>{pct(it.rank.echo)}</i></span>
      </div>
    </div>
  );
}
