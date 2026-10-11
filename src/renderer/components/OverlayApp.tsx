// The global layer page (index.html#overlay, shown by main/overlay.ts in a small top-most view above browser tiles and
// every page). Tier a: the first open question or permission in full (who asks, the context in one line, the options
// right there), a badge with how many wait, and the queue behind it. Tier b: at most two short grouped toasts for
// important events, each with one action ("Apri", "Rispondi") and ✕. It only renders the model the app page sends
// (overlay:model) and relays what the user does (overlay:action): 1-9 / Enter answer, Esc postpones to "Ti aspettano",
// Ctrl+J goes to the next one. It never takes the keyboard by itself: only on a click or Ctrl+J (focusKey). No sounds.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { OverlayAction, OverlayCard, OverlayModel, OverlayToast } from '@shared/contract';
import { sb } from '../sb';
import { ago } from '../lib/format';
import { freezeClock } from '../lib/clock';
import { HarnessMark, IconAlert, IconArrowRight, IconCheck, IconInfo, IconX } from './Icons';
import { RequestPanel } from './RequestPanel';
import { Kbd, Keys } from './ui';

const act = (a: OverlayAction) => { void sb.invoke('overlay:action', a).catch(() => {}); };

// The model arrives by event: subscribe when the bundle loads (before React mounts), so the first one is never lost
// (main sends it on did-finish-load, also after the page reloads from a crash).
let latest: OverlayModel | null = null;
const listeners = new Set<() => void>();
if (location.hash === '#overlay') {
  sb.on('overlay:model', m => { if (m.now) freezeClock(m.now); latest = m; for (const l of [...listeners]) l(); });
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function LayerCard({ card, queue, waiting, now }: { card: OverlayCard; queue: OverlayCard[]; waiting: number; now: number }) {
  return (
    <section className="layer-card" data-testid="layer-card" data-request={card.key} aria-label={`${card.chatTitle} ti chiede qualcosa`}>
      <header className="layer-head">
        <HarnessMark harness={card.harness} regia={card.isRegia} size={18} />
        <span className="layer-who"><b>{card.chatTitle}</b><span>ti chiede · {ago(card.req.at, now)}</span></span>
        <span className="sp" />
        <span className="layer-badge" data-testid="layer-badge" aria-label={`${waiting} ti aspettano`}>{waiting}</span>
      </header>
      <RequestPanel key={`${card.key}#${card.attempt ?? 0}`} req={card.req} variant="tile" chatTitle={card.chatTitle} harness={card.harness} testid={`layer-request-${card.req.chatId}-${card.req.id}`}
        onAnswer={answer => act({ kind: 'answer', key: card.key, answer })} onEscape={() => act({ kind: 'postpone', key: card.key })} />
      <footer className="layer-foot">
        {queue.length > 0 ? (
          <span className="layer-queue" data-testid="layer-queue">poi {queue.slice(0, 2).map(q => q.chatTitle).join(', ')}{queue.length > 2 ? ` e altre ${queue.length - 2}` : ''}</span>
        ) : <span className="layer-queue">nient'altro in coda</span>}
        <span className="sp" />
        <span className="layer-keys"><Kbd>Esc</Kbd> dopo</span>
        <button type="button" className="layer-open" onClick={() => act({ kind: 'open', key: card.key })} data-testid="layer-open">Apri <IconArrowRight size={12} /></button>
      </footer>
    </section>
  );
}

function EventToast({ t }: { t: OverlayToast }) {
  return (
    <div className={`ev-toast tone-${t.tone}`} role="status" data-testid={`ev-toast-${t.kind}`} data-toast={t.id}>
      <span className="ev-icon">{t.tone === 'ok' ? <IconCheck size={14} /> : t.tone === 'err' || t.tone === 'warn' ? <IconAlert size={14} /> : <IconInfo size={14} />}</span>
      <span className="ev-text">
        <span className="ev-label">{t.label}{t.count > 1 ? ` · ${t.count}` : ''}</span>
        <b>{t.title}</b>
        {t.detail && <span className="ev-detail">{t.detail}</span>}
      </span>
      <button type="button" className="ev-act" onClick={() => act({ kind: 'toast', id: t.id, act: 'open' })} data-testid={`ev-toast-open-${t.kind}`}>{t.action}</button>
      <button type="button" className="ev-x" aria-label="Chiudi" onClick={() => act({ kind: 'toast', id: t.id, act: 'dismiss' })} data-testid={`ev-toast-close-${t.kind}`}><IconX size={12} /></button>
    </div>
  );
}

export function OverlayApp() {
  const model = useSyncExternalStore(subscribe, () => latest);
  const ref = useRef<HTMLDivElement>(null);
  // the app page's clock (frozen in the demo) drives every "4 min" label here too

  useEffect(() => {
    const root = document.documentElement;
    const theme = model?.theme ?? 'system';
    if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
    root.dataset.density = model?.density ?? 'comfortable';
  }, [model?.theme, model?.density]);
  // report the size the cards need (main sizes the view; it is transparent around them)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const send = () => { const r = el.getBoundingClientRect(); void sb.invoke('overlay:size', { width: Math.ceil(r.width), height: Math.ceil(r.height) }).catch(() => {}); };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the keyboard comes here only when asked (Ctrl+J in the app, or a click)
  useEffect(() => {
    if (!model?.focusKey) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-request-key]')?.focus());
  }, [model?.focusKey, model?.nonce]);
  // when the shown card changes while the layer has the keyboard, the next one takes it
  const first = model?.cards[0]?.key;
  useEffect(() => {
    if (first && document.hasFocus()) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-request-key]')?.focus());
  }, [first]);
  const firstRef = useRef<string | undefined>(undefined);
  firstRef.current = first;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // a card handled it
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyJ') { e.preventDefault(); act({ kind: 'next', from: firstRef.current }); }
      else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyK' || e.code === 'KeyN')) { e.preventDefault(); act({ kind: 'leave' }); }
      else if (e.key === 'Escape' && firstRef.current) {
        e.preventDefault();
        // not the card just answered (it leaves by itself)
        if (document.querySelector('[data-request-key][aria-busy="true"]')?.getAttribute('data-request-key') !== firstRef.current) act({ kind: 'postpone', key: firstRef.current });
      }
      else if (/^[1-9]$|^Enter$/.test(e.key) && !e.ctrlKey && !e.altKey) {
        // the keyboard is in the layer but on nothing (just after the previous answer): give it to the card. Never when
        // another control has it: Enter on "Apri" or on a toast button must not answer the card.
        const card = document.querySelector<HTMLElement>('[data-request-key]');
        const active = document.activeElement;
        if (card && (!active || active === document.body)) { e.preventDefault(); card.focus(); card.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true })); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const cards = model?.cards ?? [];
  const toasts = model?.toasts ?? [];
  return (
    <div className="layer" ref={ref} data-testid="layer" role="region" aria-label="Richieste e avvisi per te" aria-live="polite">
      {toasts.map(t => <EventToast key={t.id} t={t} />)}
      {cards[0] && <LayerCard card={cards[0]} queue={cards.slice(1)} waiting={model?.waiting ?? cards.length} now={model?.now ?? Date.now()} />}
      {cards[0] && <div className="layer-hint" aria-hidden="true"><Keys combo="Ctrl+J" /> per rispondere da tastiera</div>}
    </div>
  );
}
