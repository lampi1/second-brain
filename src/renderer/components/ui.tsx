// UI primitives of the design system: Button, IconButton (aria-label + tooltip with its shortcut), Kbd, StatePill,
// Segmented, Popover (anchored menu that hides the browser views it covers), Modal (focus trap, Esc, restores focus)
// and the global TooltipLayer (any element with data-tip gets a tooltip; it avoids covering browser views, which are
// native and draw above the page). Used by every component.
import { createPortal } from 'react-dom';
import { inSelectList } from './Select';
import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { ChatSummary } from '@shared/contract';
import { isolateModalKey, modalTabStops } from '../lib/modal-keyboard';
import { stateInfo } from '../lib/format';
import { registerOverlay, report, viewRects } from '../lib/viewports';
import { splitTip } from '../lib/tips';
import { t } from '../i18n';
import { IconX } from './Icons';
import './HelpTip'; // imported early on purpose: its Esc listener must run before every dialog's (components/HelpTip.tsx)

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** "Ctrl+Shift+." → <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>.</kbd> */
export function Keys({ combo }: { combo: string }) {
  return <span className="keys">{combo.split(/\s|\+/).filter(Boolean).map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'amber' | 'plain' | 'subtle'; size?: 's' | 'm'; tip?: string; testid?: string };

export function Button({ variant = 'ghost', size = 'm', tip, testid, className = '', children, ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} data-tip={tip} data-testid={testid} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({ label, shortcut, testid, className = '', children, tone, ...rest }: ComponentProps<'button'> & { label: string; shortcut?: string; testid?: string; tone?: 'danger' }) {
  return (
    <button type="button" className={`icon-btn ${tone === 'danger' ? 'icon-btn-danger' : ''} ${className}`} aria-label={shortcut ? `${label} (${shortcut})` : label}
      data-tip={shortcut ? `${label}|${shortcut}` : label} data-testid={testid} {...rest}>
      {children}
    </button>
  );
}

export function StatePill({ chat, testid }: { chat: Pick<ChatSummary, 'state' | 'isOrchestrator' | 'pending'>; testid?: string }) {
  const s = stateInfo(chat);
  return (
    <span className={`pill pill-${s.tone}`} data-testid={testid} data-state={chat.state}>
      {(s.tone === 'run' || s.tone === 'wait') && <span className="pill-dot" aria-hidden="true" />}
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------- Popover

export function Popover({ anchor, open, onClose, children, align = 'end', testid, width,kind='menu',label }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: ReactNode; align?: 'start' | 'end'; testid?: string; width?: number;kind?:'menu'|'dialog';label?:string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // the latest onClose (callers pass fresh arrows): a new one must not re-run the effect below, which moves the focus
  const close = useRef(onClose);
  close.current = onClose;
  // placed below the anchor, else above, else clamped inside the window (max-height in CSS)
  useLayoutEffect(() => {
    if (!open || !anchor.current || !ref.current) return;
    const a = anchor.current.getBoundingClientRect();
    const r = ref.current.getBoundingClientRect();
    let x = align === 'end' ? a.right - r.width : a.left;
    let y = a.bottom + 6;
    if (y + r.height > window.innerHeight - 8) y = a.top - r.height - 6;
    if (y < 8) y = Math.max(8, window.innerHeight - r.height - 8);
    x = Math.min(Math.max(8, x), window.innerWidth - r.width - 8);
    setPos({ x, y });
  }, [open, anchor, align]);
  useLayoutEffect(() => (open && ref.current ? registerOverlay(ref.current) : undefined), [open]);
  // once placed, hide the browser views it now covers before it paints
  useLayoutEffect(() => { if (open && pos) report(); }, [open, pos]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node) || inSelectList(e.target)) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (inSelectList(e.target)) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close.current(); anchor.current?.focus(); }
      if(kind==='dialog'){
        if(e.key==='Tab'){
          const items=[...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href]')??[])].filter(item=>item.offsetParent!==null);
          const first=items[0],last=items.at(-1);
          if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
          else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
        }
        return;
      }
      // a slider in the menu (the Orchestrator's opacity) keeps its own arrow keys
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !(document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range')) {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    const first = setTimeout(() => ref.current?.querySelector<HTMLElement>(kind==='dialog'?'button:not([disabled]),select:not([disabled]),input:not([disabled])':'[role^="menuitem"][aria-checked="true"], [role^="menuitem"]:not([disabled])')?.focus(), 0);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); clearTimeout(first); };
  }, [open, anchor,kind]);
  if (!open) return null;
  return createPortal(
    <div ref={ref} className="popover" role={kind} aria-label={label} data-testid={testid} style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width }}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ children, onSelect, shortcut, checked, testid, danger, disabled }: { children: ReactNode; onSelect: () => void; shortcut?: string; checked?: boolean; testid?: string; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role={checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={checked} className={`menu-item ${danger ? 'danger' : ''}`} onClick={onSelect} data-testid={testid} disabled={disabled}>
      <span className="menu-check" aria-hidden="true">{checked ? '✓' : ''}</span>
      <span className="menu-label">{children}</span>
      {shortcut && <Keys combo={shortcut} />}
    </button>
  );
}

export const MenuLabel = ({ children }: { children: ReactNode }) => <div className="menu-label-row" role="presentation">{children}</div>;
export const MenuSep = () => <div className="menu-sep" role="separator" />;

// ---------------------------------------------------------------- Modal

/** The three sizes every dialog uses: `s` a confirmation (440 px), `m` a dialog (640 px) and `side` a panel down the
 *  right edge (560 px, full height); a dialog with a size of its own (the Stato, the palette) sets it in its class. */
export type ModalSize = 's' | 'm' | 'side';

/** A dialog: Esc and a click on the backdrop call onClose; `backdropCloses={false}` keeps it open on a stray click outside
 *  (the setup wizard: coming back from a sign-in window, the first click must not end it). With `title` it draws the
 *  standard parts (one look for every dialog, the questions window's too: styles/app.css «Dialogs»): a head with the
 *  icon, the title, a short subtitle, `aside` (a hint, a count, buttons) and a close button (`closeButton`, on by
 *  default for a side panel); the children in the scrolling body; `footer` fixed at the bottom, the primary action last
 *  (on the right), a `.sp` in it pushes what comes before to the left. `onSubmit` wraps the three in a form (Enter in a
 *  field submits). Without `title` the children are the whole dialog (the palette, the image viewers, the setup wizard). */
export function Modal({ onClose, children, label, testid, className = '', top, backdropCloses = true, size, title, subtitle, icon, aside, footer, closeButton, onSubmit, bodyClassName = '', style, isolateWorkspace = false }: {
  onClose: () => void; children: ReactNode; label: string; testid?: string; className?: string; top?: boolean; backdropCloses?: boolean;
  size?: ModalSize; title?: ReactNode; subtitle?: ReactNode; icon?: ReactNode; aside?: ReactNode; footer?: ReactNode; closeButton?: boolean;
  onSubmit?: () => void; bodyClassName?: string; style?: CSSProperties; isolateWorkspace?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  // the latest onClose, read at the event: callers often pass a fresh arrow each render, and the focus effect below must
  // run once per opening (re-running it on every keystroke restored the old focus and the typing lost all but one letter)
  const close = useRef(onClose);
  close.current = onClose;
  // Local modals also cover native WebContentsViews, independently of the global ui.modal flag.
  useLayoutEffect(() => backdrop.current ? registerOverlay(backdrop.current) : undefined, []);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const t = setTimeout(() => {
      // React never writes the autofocus attribute: a control that must win marks itself data-autofocus (a dialog opened
      // while another closes gets its focus back after the old one restored the previous element); disabled controls are skipped
      if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>('[data-autofocus]:not([disabled]), [autofocus]:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]):not(.modal-close)') ?? el).focus();
    }, 0);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (inSelectList(e.target)) return; e.preventDefault(); e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const f = modalTabStops(el);
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      // the dialog itself (a click on its text) counts as before the first control
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', key, true);
    return () => { clearTimeout(t); window.removeEventListener('keydown', key, true); if (prev?.isConnected) prev.focus(); };
  }, []);
  const parts = title === undefined ? children : (
    <>
      <header className="modal-head">
        {icon && <span className="modal-icon" aria-hidden="true">{icon}</span>}
        <div className="modal-titles">
          <h2>{title}</h2>
          {subtitle && <p className="modal-sub">{subtitle}</p>}
        </div>
        {aside && <div className="modal-aside">{aside}</div>}
        {(closeButton ?? size === 'side') && (
          <button type="button" className="icon-btn modal-close" onClick={() => close.current()} aria-label={t('ui.close')} data-tip={`${t('ui.close')}|Esc`} data-testid={testid ? `${testid}-close-x` : undefined}><IconX size={14} /></button>
        )}
      </header>
      <div className={`modal-body ${bodyClassName}`}>{children}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </>
  );
  return createPortal(
    <div ref={backdrop} className={`backdrop ${top ? 'backdrop-top' : ''} ${size === 'side' ? 'backdrop-side' : ''}`} onPointerDown={e => { if (backdropCloses && e.target === e.currentTarget) close.current(); }}>
      <div ref={ref} className={`modal ${size ? `modal-${size}` : ''} ${title !== undefined ? 'modal-std' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={label} data-testid={testid} tabIndex={-1} style={style} onKeyDown={isolateWorkspace ? isolateModalKey : undefined} onPaste={isolateWorkspace ? event => event.stopPropagation() : undefined}>
        {onSubmit ? <form onSubmit={e => { e.preventDefault(); onSubmit(); }}>{parts}</form> : parts}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- Tooltips

/** One tooltip for the whole app: `data-tip="Testo"`, `data-tip="Testo|Ctrl+K"` or `data-tip="Testo|Seconda riga"` on
 *  any element; long texts wrap (max ~320 px). */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; keys?: string; more?: string; x: number; y: number; below: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = (el: HTMLElement, delay: number) => {
      if (timer) clearTimeout(timer);
      target.current = el;
      timer = setTimeout(() => {
        if (!el.isConnected || target.current !== el) return;
        const r = el.getBoundingClientRect();
        setTip({ ...splitTip(el.dataset.tip ?? ''), x: r.left + r.width / 2, y: r.bottom, below: true });
        // vertical placement is fixed up after measuring (avoid covering browser views)
        requestAnimationFrame(() => {
          const t = ref.current;
          if (!t) return;
          const tr = t.getBoundingClientRect();
          const below = { left: r.left + r.width / 2 - tr.width / 2, top: r.bottom + 6, right: r.left + r.width / 2 + tr.width / 2, bottom: r.bottom + 6 + tr.height };
          const hitsView = viewRects().some(v => below.left < v.x + v.width && v.x < below.right && below.top < v.y + v.height && v.y < below.bottom);
          const off = below.bottom > window.innerHeight - 4;
          const half = tr.width / 2;
          const x = Math.min(window.innerWidth - half - 6, Math.max(half + 6, r.left + r.width / 2));
          setTip(p => (p ? { ...p, x, y: hitsView || off ? r.top : r.bottom, below: !(hitsView || off) } : p));
        });
      }, delay);
    };
    const hide = () => { if (timer) clearTimeout(timer); target.current = null; setTip(null); };
    const over = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el && el.dataset.tip) { if (el !== target.current) show(el, 420); } else if (target.current) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el?.dataset.tip && el.matches(':focus-visible')) show(el, 250); else hide();
    };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);
  if (!tip) return null;
  return createPortal(
    <div ref={ref} className={`tooltip ${tip.below ? 'below' : 'above'} ${tip.more || tip.text.length > 48 ? 'wrap' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.more ? <span className="tooltip-lines"><span>{tip.text}</span><span className="tooltip-more">{tip.more}</span></span> : <span>{tip.text}</span>}
      {tip.keys && <Keys combo={tip.keys} />}
    </div>,
    document.body,
  );
}

/** Track an element's size (tiles switch to compact rendering when small). */
export function useSize<T extends HTMLElement>(ref: RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const { width, height } = e.contentRect;
      setSize(s => (Math.abs(s.width - width) < 1 && Math.abs(s.height - height) < 1 ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
