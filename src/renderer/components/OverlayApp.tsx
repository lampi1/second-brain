// The global layer page (index.html#overlay, shown by main/overlay.ts in a small top-most view above browser tiles and
// every page): at most two short grouped toasts for important events, each with one action ("Apri", "Rispondi") and ✕.
// Requests never show here: every question, permission and command is answered in the questions window (always on since
// 2026-10-22, QuestionsWindow.tsx). It only renders the model the app page sends (overlay:model) and relays what the user
// does (overlay:action): a toast's action or ✕, Ctrl+J (the app opens what waits), Ctrl+K / Ctrl+N (back to the app).
// It never takes the keyboard by itself. No sounds here (the app page rings, lib/layer.ts). Each toast is the app's one
// notice card (Notice.tsx).
import { t as auditText } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { OverlayAction, OverlayModel, OverlayToast } from '@shared/contract';
import { sb } from '../sb';
import { freezeClock } from '../lib/clock';
import { Notice } from './Notice';
import { lang, langLoaded, loadLang, setLang } from '../i18n';

const act = (a: OverlayAction) => { void sb.invoke('overlay:action', a).catch(() => {}); };

// The model arrives by event: subscribe when the bundle loads (before React mounts), so the first one is never lost
// (main sends it on did-finish-load, also after the page reloads from a crash).
let latest: OverlayModel | null = null;
const listeners = new Set<() => void>();
if (location.hash === '#overlay') {
  sb.on('overlay:model', m => { if (m.now) freezeClock(m.now); latest = m; for (const l of [...listeners]) l(); });
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function EventToast({ t }: { t: OverlayToast }) {
  return (
    <Notice className="ev-toast" testid={`ev-toast-${t.kind}`} dataToast={t.id} tone={t.tone} label={t.label} count={t.count} title={t.title}
      detail={t.detail || undefined} closeLabel={auditText('audit.OverlayApp.close')} closeTestid={`ev-toast-close-${t.kind}`}
      onClose={() => act({ kind: 'toast', id: t.id, act: 'dismiss' })}
      action={{ label: t.action, testid: `ev-toast-open-${t.kind}`, onClick: () => act({ kind: 'toast', id: t.id, act: 'open' }) }} />
  );
}

export function OverlayApp() {
  const model = useSyncExternalStore(subscribe, () => latest);
  // the app page's language (ADR 0057): the root below re-mounts when it changes
  const [, loaded] = useState(0);
  useEffect(() => { if (model?.lang && !langLoaded(model.lang)) void loadLang(model.lang).then(() => loaded(n => n + 1), () => {}); }, [model?.lang]);
  if (model?.lang && model.lang !== lang() && langLoaded(model.lang)) setLang(model.lang);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const theme = model?.theme ?? 'system';
    if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
    root.dataset.density = model?.density ?? 'comfortable';
  }, [model?.theme, model?.density]);
  // report the size the toasts need (main sizes the view; it is transparent around them)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const send = () => { const r = el.getBoundingClientRect(); void sb.invoke('overlay:size', { width: Math.ceil(r.width), height: Math.ceil(r.height) }).catch(() => {}); };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyJ') { e.preventDefault(); act({ kind: 'next' }); }
      else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyK' || e.code === 'KeyN')) { e.preventDefault(); act({ kind: 'leave' }); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const toasts = model?.toasts ?? [];
  return (
    <div key={lang()} className="layer" ref={ref} data-testid="layer" role="region" aria-label={auditText('audit.OverlayApp.noticesForYou')} aria-live="polite">
      {toasts.map(t => <EventToast key={t.id} t={t} />)}
    </div>
  );
}
