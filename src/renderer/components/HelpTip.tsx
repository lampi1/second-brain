// HelpTip: the app's one "?" explanation mark (the user, 2026-10-13: "mi piacciono i punti di domanda con spiegazioni,
// però un tooltip carino"). A small round "?" next to a concept that is not obvious; hover (after a short delay),
// keyboard focus or a click opens a styled bubble: optional bold first line, 1-3 short sentences, optional example.
// The bubble lives in a portal on <body> (never clipped by a scrolling card), is placed below or above the mark inside
// the window, follows the light/dark tokens, hides the browser views it covers (native views draw above the page) and
// stays open while the pointer is on it. Esc closes it before any dialog sees the key; a click pins it; one at a time.
// Accessible: a real button, aria-describedby points at the bubble (in the DOM, hidden while closed). A "?" that explains
// a concept names its Guida card (`guide`): the bubble ends with «Come funziona →», which opens that card (ADR 0101).
// Used by Settings, Costi, Qualità, Task, Stato, the long-chat notice, the agent cards, the Orchestrator head, the strips,
// the run verdict and the Skill page; other branches import it as
// `import { HelpTip } from '../components/HelpTip'` (from src/renderer/components: './HelpTip').
import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { registerOverlay, report } from '../lib/viewports';
import { t } from '../i18n';
import { placeBubble, type Pos } from '../lib/tips';
import { GuideLink } from './GuideLink';
import '../styles/helptip.css';

export interface HelpTipProps {
  /** The explanation: plain Italian, 1-3 short sentences (paragraphs allowed). */
  children: ReactNode;
  /** Bold first line of the bubble. */
  title?: ReactNode;
  /** A concrete example, shown under a thin line as "Esempio: …". */
  example?: ReactNode;
  /** What the mark explains, for screen readers ("Spiegazione: <label>"); defaults to a string title. */
  label?: string;
  /** Visible words after the "?" (e.g. "Cosa significa?"); without it the mark is the bare "?". */
  text?: string;
  testid?: string;
  className?: string;
  /** A wider bubble (~480 px) for a long explanation of several paragraphs. */
  wide?: boolean;
  /** The Guida card that explains this concept (src/shared/concept-guide.ts id): adds «Come funziona →». */
  guide?: string;
}

const OPEN_DELAY = 250; // hover: a short delay, so crossing the mark does not flash a bubble
const CLOSE_DELAY = 140; // time to move the pointer from the mark into the bubble

// one bubble at a time; Esc closes it before anything else hears the key (registered at import, so before every
// dialog's or page's own window listener)
let current: { close: () => void } | null = null;
// focus opens a bubble only when the user moved there with Tab (a dialog's autofocus or a mouse click does not)
let tabbed = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', e => { tabbed = e.key === 'Tab'; }, true);
  window.addEventListener('pointerdown', () => { tabbed = false; }, true);
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !current) return;
    current.close();
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
}

/** Close the open help bubble, if any (true when one was open). */
export function closeHelpTip(): boolean {
  if (!current) return false;
  current.close();
  return true;
}

export function HelpTip({ children, title, example, label, text, testid, className = '', wide, guide }: HelpTipProps) {
  const id = useId();
  const tipId = `help-${id.replace(/:/g, '')}`;
  const btn = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hover = useRef(false);
  const byKeyboard = useRef(false);
  const self = useRef({ close: () => {} });

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const close = () => { clear(); byKeyboard.current = false; setOpen(false); setPinned(false); setPos(null); if (current === self.current) current = null; };
  self.current.close = close;
  const show = () => {
    clear();
    if (current && current !== self.current) current.close();
    current = self.current;
    setOpen(true);
  };
  // data-hover on the mark: its last pointer enter/leave was handled (a test waits for it, not for time)
  const later = (fn: () => void, ms: number) => { clear(); timer.current = setTimeout(fn, ms); };
  const leave = () => { hover.current = false; btn.current?.removeAttribute('data-hover'); if (!pinned) later(() => { if (!hover.current && !byKeyboard.current) close(); }, CLOSE_DELAY); };
  const enter = () => { hover.current = true; btn.current?.setAttribute('data-hover', ''); if (open) clear(); else later(show, OPEN_DELAY); };

  // placed after it renders (its size depends on the text), before it paints
  useLayoutEffect(() => {
    if (!open || !btn.current || !bubble.current) return;
    const a = btn.current.getBoundingClientRect();
    setPos(placeBubble(a, { width: bubble.current.offsetWidth, height: bubble.current.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);
  useLayoutEffect(() => (open && bubble.current ? registerOverlay(bubble.current) : undefined), [open]);
  useLayoutEffect(() => { if (open && pos) report(); }, [open, pos]);

  // while open: a press elsewhere, a scroll (the mark moved) or a resize closes it
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && (btn.current?.contains(t as Node) || bubble.current?.contains(t as Node));
    const down = (e: PointerEvent) => { if (!inside(e.target)) close(); };
    // only a scroll that moves the mark closes it (a chat streaming elsewhere scrolls its own list every frame; a page
    // container may fire a scroll without moving, e.g. while it settles after a click)
    const at = btn.current?.getBoundingClientRect();
    const scroll = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!at || !r || Math.abs(r.x - at.x) > 1 || Math.abs(r.y - at.y) > 1) close();
    };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open]);
  useEffect(() => () => { clear(); if (current === self.current) current = null; }, []);

  const name = t('costs.helpName',{label:label ?? (typeof title === 'string' ? title : text ?? t('costs.helpFallback'))});
  return (
    <>
      <button ref={btn} type="button" className={`help-tip ${text ? 'with-text' : ''} ${className}`} aria-label={text ? undefined : name}
        aria-describedby={tipId} aria-expanded={open} data-testid={testid}
        onPointerEnter={e => { if (e.pointerType === 'mouse') enter(); }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') leave(); }}
        onFocus={() => { if (tabbed && btn.current?.matches(':focus-visible')) { byKeyboard.current = true; show(); } }}
        onBlur={() => { if (!hover.current) close(); }}
        onClick={e => { e.preventDefault(); e.stopPropagation(); if (pinned) close(); else { show(); setPinned(true); } }}>
        <span className="help-tip-mark" aria-hidden="true" />
        {text && <span className="help-tip-text">{text}</span>}
      </button>
      {/* Server rendering has no tooltip host. The closed button remains readable; browser behavior is unchanged. */}
      {typeof document !== 'undefined' && createPortal(
        <div ref={bubble} id={tipId} role="tooltip" className={`help-bubble ${pos?.side ?? 'below'} ${wide ? 'wide' : ''}`} hidden={!open}
          style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? 'visible' : 'hidden', ['--arrow' as string]: `${pos?.arrow ?? 0}px` }}
          onPointerEnter={() => { hover.current = true; clear(); }} onPointerLeave={leave} data-testid={testid ? `${testid}-bubble` : undefined}>
          {title && <b className="help-title">{title}</b>}
          <div className="help-body">{children}</div>
          {example && <p className="help-ex"><span>{t('costs.helpExample')}</span> {example}</p>}
          {guide && <p className="help-guide"><GuideLink concept={guide} /></p>}
        </div>,
        document.body,
      )}
    </>
  );
}
