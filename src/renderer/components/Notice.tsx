// The one notification card of the app (ADR 0151): the in-app notices (Overlays.tsx Toasts) and the global layer's over
// the browsers (OverlayApp.tsx) render this same component, so every notice has one look: the tone's icon in a tinted
// square, a small upper-case label, the title, a detail line, short chips, one action, ✕ and a time bar in the tone's
// color. «celebrate» (the end of the maintenance) is the big one, with a sparkle burst. Why: the user, 2026-10-24,
// "rivedere le notifiche standardizzarle tutte e renderle iper clean"; before, the app, the layer and the brain pages
// each had their own toast. Styles: styles/notif.css.
import type { NoticeTone } from '@shared/contract';
import type { ReactNode } from 'react';
import { IconAlert, IconCheck, IconInfo, IconQuestion, IconSparkle, IconX } from './Icons';
import '../styles/notif.css';

const ICON: Record<NoticeTone, (p: { size?: number }) => ReactNode> = {
  ok: IconCheck, info: IconInfo, attention: IconQuestion, warn: IconAlert, err: IconAlert, celebrate: IconSparkle,
};

/** Fixed directions of the celebrate burst (no randomness: screenshots stay stable). */
const SPARKS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + 0.3;
  const d = 34 + (i % 3) * 16;
  return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d), delay: (i % 4) * 0.05 };
});

export interface NoticeProps {
  tone: NoticeTone;
  title: ReactNode;
  label?: string | undefined;
  detail?: string | undefined;
  chips?: readonly string[] | undefined;
  count?: number | undefined;
  action?: { label: string; onClick: () => void; testid?: string } | undefined;
  onClose: () => void;
  closeLabel: string;
  closeTestid?: string;
  /** ms: shows the time bar running out */
  ttl?: number | undefined;
  testid?: string;
  /** the layer's group id (e2e) */
  dataToast?: string;
  /** the surface's own class (toast in the app, ev-toast in the layer) */
  className?: string;
}

export function Notice(p: NoticeProps) {
  const Icon = ICON[p.tone];
  const big = p.tone === 'celebrate';
  return (
    <div className={`notif tone-${p.tone}${p.className ? ` ${p.className}` : ''}`} role={p.tone === 'err' ? 'alert' : 'status'} data-testid={p.testid} data-toast={p.dataToast} data-tone={p.tone}>
      {big && <span className="notif-sparks" aria-hidden="true">{SPARKS.map((s, i) => <i key={i} style={{ ['--dx' as string]: `${s.dx}px`, ['--dy' as string]: `${s.dy}px`, animationDelay: `${s.delay}s` }} />)}</span>}
      <span className="notif-badge" aria-hidden="true"><Icon size={big ? 22 : 17} /></span>
      <span className="notif-text">
        {p.label && <span className="notif-label">{p.label}{p.count && p.count > 1 ? ` · ${p.count}` : ''}</span>}
        <span className="notif-title">{p.title}</span>
        {p.detail && <span className="notif-detail">{p.detail}</span>}
        {p.chips && p.chips.length > 0 && <span className="notif-chips">{p.chips.map(c => <span key={c} className="notif-chip">{c}</span>)}</span>}
      </span>
      {p.action && <button type="button" className="notif-act" onClick={p.action.onClick} data-testid={p.action.testid}>{p.action.label}</button>}
      <button type="button" className="notif-x" aria-label={p.closeLabel} onClick={p.onClose} data-testid={p.closeTestid}><IconX size={12} /></button>
      {p.ttl ? <span className="notif-timer" style={{ animationDuration: `${p.ttl}ms` }} aria-hidden="true" /> : null}
    </div>
  );
}
