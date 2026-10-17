// Default dashboard: existing map, source-preserving local metrics and an explicit send to the existing app Regia.
import { useEffect, useRef, useState } from 'react';
import { useBrain } from '../api';
import { BrainMapView } from '../map/BrainMap';
import { HOME_CARDS, homeCost, homeTables } from './home-cards';
import { app, send, useApp } from '../../store/store';
import { requestFocus, setRegiaOpen, setRegiaTab } from '../../store/ui';
import { newAppRegia } from '../../store/improve';
import { liveSource } from '../../lib/liveSource';
import { t, locale } from '../../i18n';
import './home.css';

export function Home({ nav }: { nav: (target: string) => void }) {
  const question = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { question.current?.focus({ preventScroll: true }); }, []);
  const cost = useBrain('/api/cost?days=7', homeCost);
  const tables = useBrain('/api/tables', homeTables);
  const regia = useApp(s => s.order.find(id => s.chats[id]?.appRegia && !s.chats[id]?.closedAt) ?? null);
  const info = useApp(s => s.info), settings = useApp(s => s.settings);
  const engines = (info?.engines ?? []).filter(e => e.trusted && settings?.engineOn[e.id]===true && settings.engines[e.id] !== false);
  const [engineId, setEngineId] = useState('');
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const showRegia = (id: string) => { setRegiaTab(id); setRegiaOpen(true); requestFocus(id); };
  const createRegia = async () => {
    const engine = engines.find(e => e.id === engineId);
    if (!engine || creating) return;
    setCreating(true);
    try {
      const chat = await newAppRegia(engine.id);
      if (chat) showRegia(chat.id); else setMessage(t('home.notSent'));
    } finally { setCreating(false); }
  };
  const submit = () => {
    // Resolve again at the gesture boundary: do not send to a closed/replaced Regia captured by an old render.
    const s = app.get(), id = s.order.find(id => s.chats[id]?.appRegia && !s.chats[id]?.closedAt);
    if (!id) { setMessage(t('home.noRegia')); return; }
    const result = send(id, text);
    if (result === 'empty') { setMessage(t('home.notSent')); return; }
    setText(''); setMessage(t(result === 'queued' ? 'home.queued' : 'home.sent')); showRegia(id);
  };
  return <div className="home-page" data-testid="home">
    <section className="home-map" aria-label={t('home.map')}>
      <BrainMapView embedded onClose={() => {}} onNavigate={nav} live={liveSource} onOpenChat={id => nav(`workspace/chat-${id}`)} />
    </section>
    <div className="home-content">
      <header><h1>{t('home.greeting', { name: 'Brother' })}</h1><p>{t('home.lead')}</p></header>
      <section className="home-cards" aria-label={t('home.summary')}>
        {HOME_CARDS.map(card => {
          const source = card.id === 'spend' ? cost : tables;
          const reading = card.read({ cost: cost.data, tables: tables.data });
          return <article className="bx-card home-card" key={card.id} data-testid={`home-card-${card.id}`}>
            <h2>{card.title()}</h2><strong className="home-value">{reading?.value ?? '—'}</strong>
            <p>{reading?.explanation ?? t(source.loading ? 'home.loading' : 'home.unavailable')}</p>
            {reading && <small>{reading.source}</small>}
            {source.at != null && <small>{t('home.updated')} {new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'short' }).format(source.at)}</small>}
            {source.error && <p role="status">{t('home.readFailed')} <button type="button" className="bx-btn s" onClick={() => source.reload()}>{t('home.retry')}</button></p>}
            <button type="button" className="bx-btn" onClick={() => nav(card.target)}>{t('home.details')}</button>
          </article>;
        })}
      </section>
      <section className="bx-card home-conversation" aria-label={t('home.conversation')}>
        <h2>{t('home.conversation')}</h2><p>{regia ? t('home.ask') : t('home.noRegia')}</p>
        {!regia && <div><label htmlFor="home-engine">{t('home.chooseEngine')}</label><select id="home-engine" value={engineId} onChange={e => setEngineId(e.target.value)} disabled={creating}><option value="">{t('home.chooseEngine')}</option>{engines.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select><button type="button" className="bx-btn" disabled={!engineId || creating} onClick={() => void createRegia()}>{t('home.createRegia')}</button></div>}
        <form onSubmit={e => { e.preventDefault(); submit(); }}>
          <label htmlFor="home-question">{t('home.question')}</label>
          <textarea ref={question} id="home-question" value={text} onChange={e => setText(e.target.value)} placeholder={t('home.placeholder')} rows={3} />
          <button type="submit" className="bx-btn" disabled={!regia || !text.trim()}>{t('home.send')}</button>
          {regia && <button type="button" className="bx-btn" onClick={() => showRegia(regia)}>{t('home.openRegia')}</button>}
        </form>
        <p role="status">{message}</p>
        <div className="home-links"><button type="button" className="bx-btn" onClick={() => nav('agenti')}>{t('home.manageAgents')}</button><button type="button" className="bx-btn" onClick={() => nav('migliora')}>{t('home.improve')}</button><button type="button" className="bx-btn" onClick={() => nav('confronto')}>{t('home.compare')}</button></div>
      </section>
    </div>
  </div>;
}
