// The News' «Fonti» panel (ADR 0265): every source with how it is read (RSS/Atom, GitHub, API, page), its last reading
// (ok with how many stories and how many new, or the error), a switch to pause it and «Togli»; a field to add one by
// pasting its link (the app recognises a GitHub repository, a feed or a page); «Ripristina» brings back the default
// list. Below, the daily refresh (off by default because it costs tokens) with its hour and the estimated cost: the
// mean of the measured refreshes, or a guess until one ran. Used by NewsPage.tsx; styles news.css (.nws-*).
import { useState } from 'react';
import { editSources, news, setSchedule } from '../../../lib/news';
import { locale, t } from '../../../i18n';
import { Button, Modal } from '../../ui';
import { ImparaSwitch } from '../ImparaSwitch';
import { shortWhen } from './NewsReader';

export function NewsSources({ onClose }: { onClose: () => void }) {
  const state = news.use(s => s.state);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    const ok = await editSources({ op: 'add', url: url.trim() });
    setBusy(false);
    if (ok) setUrl('');
  };
  const est = state?.estimate;
  const sc = state?.schedule ?? { on: false, hour: 7 };
  const usd = (n: number) => n.toLocaleString(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 });
  return (
    <Modal onClose={onClose} label={t('news.src.title')} title={t('news.src.title')} subtitle={t('news.src.lead')} size="side" className="nws-modal" closeButton testid="news-sources">
      <div className="nws">
        <form className="nws-add" onSubmit={e => { e.preventDefault(); void add(); }}>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder={t('news.src.addPh')} aria-label={t('news.src.addLabel')} data-testid="news-src-url" />
          <Button variant="primary" type="submit" disabled={!url.trim() || busy} testid="news-src-add">{t('news.src.add')}</Button>
        </form>
        <ul className="nws-list" aria-label={t('news.src.title')}>
          {state?.sources.map(s => (
            <li key={s.id} className={s.on ? '' : 'off'} data-testid={`news-src-${s.id}`}>
              <div className="nws-name">
                <b>{s.name}<span className="nws-how">{t(`news.how.${s.read}`)}</span></b>
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.url.replace(/^https:\/\//, '')}</a>
                <span className="nws-st">
                  {!s.on ? <span className="paused">{t('news.src.paused')}</span>
                    : !s.status ? <span className="paused">{t('news.src.notYet')}</span>
                      : s.status.ok ? <span className="ok">● {t('news.src.ok', { when: shortWhen(s.status.at), found: s.status.found, fresh: s.status.fresh })}</span>
                        : <span className="err" data-testid="news-src-error">● {s.status.error}</span>}
                </span>
              </div>
              <ImparaSwitch on={s.on} onChange={on => void editSources({ op: 'toggle', id: s.id, on })} label="" name={`${t('news.src.on')}: ${s.name}`} testid={`news-src-toggle-${s.id}`} />
              <Button size="s" variant="ghost" onClick={() => void editSources({ op: 'remove', id: s.id })} testid={`news-src-remove-${s.id}`}>{t('news.src.remove')}</Button>
            </li>
          ))}
        </ul>
        <div className="nws-row"><Button size="s" onClick={() => void editSources({ op: 'reset' })} testid="news-src-reset">{t('news.src.reset')}</Button><span className="nws-note">{t('news.src.resetHint')}</span></div>
        <section className="nws-box" data-testid="news-schedule">
          <div className="nws-row">
            <ImparaSwitch on={sc.on} onChange={on => void setSchedule({ on })} label={t('news.src.auto')} testid="news-auto" />
            <label className="nws-hour">{t('news.src.at')}
              <select value={sc.hour} onChange={e => void setSchedule({ hour: Number(e.target.value) })} data-testid="news-auto-hour">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
          </div>
          <p className="nws-note">{t('news.src.autoWhy')}</p>
          {est && (
            <p className="nws-est" data-testid="news-estimate">
              {t(est.measured ? 'news.src.estMeasured' : 'news.src.estGuess', { tokens: est.tokens.toLocaleString(locale()) })}
              {est.usd !== null && <> · ≈ {usd(est.usd)} {t('news.src.perRefresh')} · ≈ {usd(est.usd * 30)} {t('news.src.perMonth')}</>}
            </p>
          )}
          <p className="nws-note">{t('news.src.free')}</p>
        </section>
      </div>
    </Modal>
  );
}
