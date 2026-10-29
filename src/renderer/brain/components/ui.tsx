// Small building blocks of the brain pages: pills (state always in text, never color alone), buttons, sections, KPI
// tiles, tabs and segmented controls, external links (http(s) only: main opens them outside the app), icons, a toast,
// copy to clipboard and file download (both with fallbacks: the app window grants no permissions). Used by every page.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HelpTip } from '../../components/HelpTip';
import { inSelectList } from '../../components/Select';

export type Tone = 'good' | 'warn' | 'bad' | 'blue' | 'violet' | 'outline' | 'neutral' | '';
export function Pill({ tone = '', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`bx-pill ${tone === 'neutral' ? '' : tone}`} title={title}>{children}</span>;
}

export function Section({ title, count, note, actions, children, id, testId, help }: { title: ReactNode; count?: number; note?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string; testId?: string; help?: ReactNode }) {
  return (
    <section className="bx-section" aria-labelledby={id ? `${id}-h` : undefined} data-testid={testId}>
      <div className="bx-section-head">
        <h2 id={id ? `${id}-h` : undefined}>{title}{count !== undefined && <span className="count"> · {count}</span>}</h2>
        {help}
        {note && <p>{note}</p>}
        {actions && <><span className="sp" />{actions}</>}
      </div>
      {children}
    </section>
  );
}

export function Kpi({ k, v, s, tone, testId, help }: { k: string; v: ReactNode; s?: ReactNode; tone?: 'warn'; testId?: string; help?: ReactNode }) {
  return <div className={`bx-kpi ${tone ?? ''}`} data-testid={testId}><span className="k">{k}{help && <HelpTip label={k}>{help}</HelpTip>}</span><span className="v">{v}</span>{s && <span className="s">{s}</span>}</div>;
}

export function Tabs<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string; n?: number }[]; value: T; onChange: (id: T) => void; label: string }) {
  const move = (dir: number) => {
    const i = items.findIndex(x => x.id === value);
    const next = items[(i + dir + items.length) % items.length];
    if (next) onChange(next.id);
  };
  return (
    <div className="bx-tabs" role="tablist" aria-label={label} onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); move(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); } }}>
      {items.map(t => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)} data-testid={`bx-tab-${t.id}`}>
          {t.label}{t.n !== undefined && <span className="n">{t.n}</span>}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string | number>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="bx-seg" role="group" aria-label={label}>
      {items.map(t => <button key={String(t.id)} type="button" aria-pressed={t.id === value} onClick={() => onChange(t.id)}>{t.label}</button>)}
    </div>
  );
}

const safeUrl = (u: string | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);
/** A link that opens outside the app (main turns target=_blank into the system browser); non-http URLs are plain text. */
export function ExtLink({ href, children, title, className, onClick }: { href?: string; children: ReactNode; title?: string; className?: string; onClick?: () => void }) {
  const u = safeUrl(href);
  if (!u) return <span className={className}>{children}</span>;
  return <a href={u} target="_blank" rel="noopener noreferrer" title={title ?? u} className={className} onClick={onClick} onAuxClick={e => { if (e.button === 1) onClick?.(); }}>{children}</a>;
}

// ── icons (16px, stroke = currentColor) ─────────────────────────────────────────────────────────────────────────────
const I = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const IconSearch = () => <I d="M7 12.5A5.5 5.5 0 1 0 7 1.5a5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5" />;
export const IconRefresh = () => <I d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" />;
export const IconDownload = () => <I d="M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />;
export const IconCopy = () => <I d="M5.5 5.5h8v8h-8zM2.5 10.5v-8h8" />;
export const IconClose = () => <I d="M3.5 3.5l9 9M12.5 3.5l-9 9" />;
export const IconColumns = () => <I d="M2.5 2.5h11v11h-11zM6.2 2.5v11M9.8 2.5v11" />;
export const IconExternal = () => <I d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4" />;
export const IconChevL = () => <I d="M10 3 5 8l5 5" />;
export const IconChevR = () => <I d="M6 3l5 5-5 5" />;
export const IconMap = () => <I d="M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM8 1.8c-2 2-2 10.4 0 12.4M8 1.8c2 2 2 10.4 0 12.4M2 8h12" />;

// ── toast ───────────────────────────────────────────────────────────────────────────────────────────────────────
const toasters: ((t: string) => void)[] = [];
/** Show a toast in the most recently mounted Toaster (the map's while it is open, else the page's). */
export function toast(text: string): void { toasters[toasters.length - 1]?.(text); }
/** One toast at a time, 2.6 s, announced to screen readers. Mounted by each page and by the map. */
export function Toaster() {
  const [t, setT] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    const push = (text: string) => setT(x => ({ text, n: (x?.n ?? 0) + 1 }));
    toasters.push(push);
    return () => { const i = toasters.indexOf(push); if (i >= 0) toasters.splice(i, 1); };
  }, []);
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), 2600); return () => clearTimeout(h); }, [t]);
  return <div aria-live="polite" className="sr-host">{t && <div key={t.n} className="bx-toast" role="status">{t.text}</div>}</div>;
}

/** Copy text: the async clipboard first, then the old execCommand path (works without clipboard permission). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* no permission in the app window */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Save a text file (the window shows the system "Save as" dialog). */
export function download(name: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Salvo ${name}`);
}

// ── Esc: one level at a time ────────────────────────────────────────────────────────────────────────────────────
// Every open layer (a table's peek, the map) registers here; Esc closes only the most recent one and stops there, so
// the workspace's own Esc ("back") runs only when no brain layer is open.
const escStack: { fn: () => void }[] = [];
let escBound = false;
export function useEsc(active: boolean, fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const entry = { fn: () => ref.current() };
    escStack.push(entry);
    if (!escBound) {
      escBound = true;
      window.addEventListener('keydown', e => {
        const top = escStack[escStack.length - 1];
        if (e.key !== 'Escape' || !top || inSelectList(e.target)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        top.fn();
      }, true);
    }
    return () => { const i = escStack.indexOf(entry); if (i >= 0) escStack.splice(i, 1); };
  }, [active]);
}

/** `onNavigate` of the pages: a page id plus an optional argument ("esplora/now.md", "costi/30", "mappa"). */
export type Navigate = (target: string) => void;
