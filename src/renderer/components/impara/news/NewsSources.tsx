// An edition's panel of the «Giornale» (ADR 0265, 0279). First the edition itself: its name, the sentence on what the
// user wants from it (the AI pass reads it), how many stories the front page holds, its sections (one per line,
// «Nome: parola, parola») and «Elimina edizione» (asked twice). Then every source with how it is read (RSS/Atom,
// GitHub, API, page), its last reading (ok with how many stories and how many new, or the error), a switch to pause
// it and «Togli»; a field to add one by pasting its link: the link is tried first («Prova» shows what it holds now),
// the app recognises a GitHub repository, a feed or a page. «Ripristina» brings back a ready-made edition's list.
// Below, the daily refresh of every edition (off by default because it costs tokens) with its hour and the estimated
// cost. The Orchestrator does the same through its tools. Used by NewsPage.tsx; styles news.css (.nws-*).
import { useState } from 'react';
import type { NewsEdition, NewsSourceTest } from '@shared/news';
import { editEdition, editSources, news, setSchedule, testSource } from '../../../lib/news';
import { locale, t } from '../../../i18n';
import { Button, Modal } from '../../ui';
import { ImparaSwitch } from '../ImparaSwitch';
import { shortWhen } from './NewsReader';

const sectionsText = (ed: NewsEdition) => ed.sections.map(s => `${s.name}: ${s.words.join(', ')}`).join('\n');
const parseSections = (text: string, ed: NewsEdition) => text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const [name = '', words = ''] = l.split(/:(.*)/s);
  const had = ed.sections.find(s => s.name.toLowerCase() === name.trim().toLowerCase());
  return { ...(had ? { id: had.id } : {}), name: name.trim(), words: words.split(',').map(w => w.trim()).filter(Boolean) };
});

export function NewsSources({ edition, onClose }: { edition: NewsEdition; onClose: () => void }) {
  const state = news.use(s => s.state);
  const ed = state?.editions.find(e => e.id === edition.id) ?? edition;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState<NewsSourceTest | null>(null);
  const [name, setName] = useState(ed.name);
  const [interest, setInterest] = useState(ed.interest);
  const [secs, setSecs] = useState(() => sectionsText(ed));
  const [sure, setSure] = useState(false);
  const dirty = name.trim() !== ed.name || interest.trim() !== ed.interest || secs.trim() !== sectionsText(ed);
  const tryIt = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setTried(await testSource(url.trim()));
    setBusy(false);
  };
  const add = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    const ok = await editSources({ op: 'add', edition: ed.id, url: url.trim() });
    setBusy(false);
    if (ok) { setUrl(''); setTried(null); }
  };
  const saveEdition = async () => {
    const s = await editEdition({ op: 'update', id: ed.id, name: name.trim(), interest: interest.trim(), sections: parseSections(secs, ed) });
    const now = s?.editions.find(e => e.id === ed.id);
    if (now) { setName(now.name); setInterest(now.interest); setSecs(sectionsText(now)); }
  };
  const remove = async () => { if (await editEdition({ op: 'delete', id: ed.id })) onClose(); };
  const mine = state?.sources.filter(s => s.edition === ed.id) ?? [];
  const est = state?.estimate;
  const sc = state?.schedule ?? { on: false, hour: 7 };
  const usd = (n: number) => n.toLocaleString(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 });
  return (
    <Modal onClose={onClose} label={t('news.src.title')} title={ed.name} subtitle={t('news.src.lead')} size="side" className="nws-modal" closeButton testid="news-sources">
      <div className="nws">
        <section className="nws-box" data-testid="news-edition-box">
          <label className="nwn-f">{t('news.new.name')}<input value={name} onChange={e => setName(e.target.value)} maxLength={60} data-testid="news-ed-name" /></label>
          <label className="nwn-f">{t('news.new.interest')}<textarea value={interest} onChange={e => setInterest(e.target.value)} maxLength={400} rows={3} data-testid="news-ed-interest" /></label>
          <label className="nwn-f">{t('news.ed.sections')}<textarea value={secs} onChange={e => setSecs(e.target.value)} rows={Math.max(3, ed.sections.length + 1)} placeholder={t('news.ed.sectionsPh')} data-testid="news-ed-sections" /></label>
          <p className="nws-note">{t('news.ed.sectionsHint')}</p>
          <div className="nws-row">
            <Button variant="primary" size="s" onClick={() => void saveEdition()} disabled={!dirty || !name.trim()} testid="news-ed-save">{t('news.ed.save')}</Button>
            <label className="nws-hour">{t('news.ed.cap')}
              <select value={ed.cap} onChange={e => void editEdition({ op: 'update', id: ed.id, cap: Number(e.target.value) })} data-testid="news-ed-cap">
                {[3, 5, 7, 10, 12].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <span className="sp" />
            {sure
              ? <Button size="s" variant="danger" onClick={() => void remove()} testid="news-ed-delete-sure">{t('news.ed.deleteSure')}</Button>
              : <Button size="s" variant="ghost" onClick={() => setSure(true)} testid="news-ed-delete">{t('news.ed.delete')}</Button>}
          </div>
        </section>

        <form className="nws-add" onSubmit={e => { e.preventDefault(); void add(); }}>
          <input value={url} onChange={e => { setUrl(e.target.value); setTried(null); }} placeholder={t('news.src.addPh')} aria-label={t('news.src.addLabel')} data-testid="news-src-url" />
          <Button onClick={() => void tryIt()} disabled={!url.trim() || busy} testid="news-src-test">{t('news.src.test')}</Button>
          <Button variant="primary" type="submit" disabled={!url.trim() || busy} testid="news-src-add">{t('news.src.add')}</Button>
        </form>
        {tried && (
          <p className={`nws-tried ${tried.ok ? 'ok' : 'err'}`} data-testid="news-src-tried" role="status">
            {tried.ok ? t('news.src.tried', { how: t(`news.how.${tried.read}`), found: tried.found, sample: tried.sample.join(' · ') }) : t('news.src.triedBad', { why: tried.error ?? '' })}
          </p>
        )}
        {mine.length === 0 && <p className="nws-note" data-testid="news-src-none">{t('news.src.none')}</p>}
        {mine.length > 0 && (
          <ul className="nws-list" aria-label={t('news.src.title')}>
            {mine.map(s => (
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
        )}
        {ed.template && <div className="nws-row"><Button size="s" onClick={() => void editSources({ op: 'reset', edition: ed.id })} testid="news-src-reset">{t('news.src.reset')}</Button><span className="nws-note">{t('news.src.resetHint')}</span></div>}
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
