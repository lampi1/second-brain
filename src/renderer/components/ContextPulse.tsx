// Quiet Battito cards for agent, search and file contexts. All mutations are explicit clicks through typed IPC.
import { useEffect, useRef, useState } from 'react';
import type { PulseCard, PulseList, PulsePlace } from '@shared/pulse';
import { sb } from '../sb';
import { t } from '../i18n';
import { focusChat } from '../actions';
import { closeModal, toast } from '../store/ui';
import { contextCards, filePulsePlace } from '../lib/pulse-context';
import { useApp } from '../store/store';
import '../styles/context-pulse.css';

/** The cards of a file inside the brain; a path outside it shows none. */
export function FilePulse({ path }: { path: string }) {
  const brainRoot = useApp(s => s.info?.brainRoot);
  const place = filePulsePlace(path, brainRoot);
  return place ? <ContextPulse key={place} place={place} /> : null;
}
export function ContextPulse({ place }: { place: PulsePlace }) {
  const [data, setData] = useState<{ place: PulsePlace; value: PulseList } | null>(null);
  const [failed, setFailed] = useState(false), [revision, refresh] = useState(0);
  useEffect(() => {
    let live = true, generation = 0;
    const read = async () => {
      const ticket = ++generation;
      try { const value = await sb.invoke('pulse:list', { place }); if (live && ticket === generation) { setData({ place, value }); setFailed(false); } }
      catch { if (live && ticket === generation) { setData(null); setFailed(true); } }
    };
    void read();
    const off = sb.on('pulse:changed', () => void read());
    const timer = setInterval(() => void read(), 60_000);
    return () => { live = false; off(); clearInterval(timer); };
  }, [place, revision]);
  const value = data?.place === place ? data.value : null;
  const cards = value?.status.on ? contextCards(value.cards, place) : [];
  if (failed) return <p role="status">{t('contextPulse.error')} <button type="button" className="link-btn" onClick={() => refresh(n => n + 1)}>{t('studio.retry')}</button></p>;
  if (!cards.length) return null;
  return <aside className="context-pulse" aria-label={t('contextPulse.title')} data-testid="context-pulse" data-place={place}>
    <h3>{t('contextPulse.title')}</h3>
    {cards.map(card => <ContextCard key={card.id} card={card} canSave={value!.status.canSave} saveReason={value!.status.saveReason} changed={() => refresh(n => n + 1)} />)}
  </aside>;
}

function ContextCard({ card, canSave, saveReason, changed }: { card: PulseCard; canSave: boolean; saveReason?: string; changed: () => void }) {
  const ref = useRef<HTMLElement>(null), working = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (card.state !== 'new' || !ref.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(entries => {
      clearTimeout(timer);
      if (entries[0]?.isIntersecting) timer = setTimeout(() => { void sb.invoke('pulse:seen', { ids: [card.id] }).catch(() => undefined); }, 1000);
    });
    observer.observe(ref.current);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [card.id, card.state]);
  const act = async (action: 'save' | 'act' | 'dismiss') => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try {
      const result = action === 'act' ? await sb.invoke('pulse:act', { id: card.id })
        : action === 'save' ? await sb.invoke('pulse:save', { id: card.id }) : await sb.invoke('pulse:dismiss', { id: card.id });
      if (!result.ok) { setError(result.error); return; }
      if ('chatId' in result && typeof result.chatId === 'string') { closeModal(); focusChat(result.chatId); }
      if (action === 'save') toast(t('contextPulse.saved'), 'ok');
      changed();
    } catch { setError(t('contextPulse.actionError')); }
    finally { working.current = false; setBusy(false); }
  };
  return <article ref={ref} className="context-pulse-card" data-testid={`context-card-${card.id}`}>
    <h4>{card.title}</h4><p>{card.body}</p><p className="muted">{card.why}</p>
    <details><summary>{t('contextPulse.sources')}</summary><ul>{card.refs.map((r, i) => <li key={i}>{r.kind}: {r.ref}</li>)}</ul></details>
    <small>{card.engine ?? t('contextPulse.app')}</small>
    <div className="context-pulse-actions">
      <button type="button" className="btn btn-ghost btn-s" disabled={busy || !canSave} title={!canSave ? saveReason || t('contextPulse.cannotSave') : undefined} onClick={() => void act('save')}>{t('contextPulse.save')}</button>
      {card.action && card.type !== 'agente' && <button type="button" className="btn btn-primary btn-s" disabled={busy} onClick={() => void act('act')}>{t('contextPulse.act')}</button>}
      <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => void act('dismiss')}>{t('contextPulse.dismiss')}</button>
    </div>{error && <p role="alert">{error}</p>}
  </article>;
}
