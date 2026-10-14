// The Regia widget (ADR 0028, after ADR 0021's floating panel; the user, 2026-10-13: "la regia la vorrei collassabile
// in basso a dx, non che faccia parte del menu ma che sia sempre visibile in basso a destra"): docked in the window's
// bottom-right corner on every place (chat grid, focus mode, brain pages, settings, the map). Collapsed (the default) =
// a small bar with the Regia's mark, its unread replies and the questions/commands that wait; expanded = in place, a tab
// per Regia ("Lavoro", …, and "App" = the app's own Regia of "Migliora l'app", with a badge for what waits there) +
// "+" for a new Regia, the RegiaTile of the tab shown, resized from its top-left corner (double-click on the bar = the
// default size). The workspace leaves it its room (useDockReserve → App.tsx), so it never covers a chat's input or its
// Esegui/Copia; the global layer and the questions window move aside too. Ctrl+R (actions.toggleRegia) expands or
// collapses it, Esc collapses it when its input is empty. Expanded, size, tab and "seen at" are UI prefs; its opacity is
// the setting regiaOpacity (fully opaque while hovered or focused). It registers as an overlay, so a browser view under
// it hides (lib/viewports.ts). RegiaOverlay and useDockReserve are used by App.tsx, StatoButton (opens "Stato") by
// TopBar.tsx.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { regiaLabel } from '@shared/regia';
import { regiaTabsOf } from '../lib/regia-route';
import { registerOverlay, schedule } from '../lib/viewports';
import { isBusy, sameList } from '../store/state';
import { app, useApp } from '../store/store';
import { openModal, openNewRegia, requestFocus, setPrefs, setRegiaOpen, setRegiaTab, ui } from '../store/ui';
import { collapseRegia } from '../actions';
import { scheduleLayer } from '../lib/layer';
import { clampSize, reserveOf, seenAtCollapse, sizeIn, unreadOf, viewport, type DockSize, type Reserve } from '../lib/regia-dock';
import { RegiaTile } from './RegiaTile';
import { HarnessMark, IconArrowUp, IconList, IconMinimize, IconPlus } from './Icons';
import { IconButton } from './ui';

const questions = (n: number) => (n === 1 ? '1 domanda' : `${n} domande`);

/** Per Regia, the questions waiting in its tab: its own only (a work chat's never show in the Regia, 2026-10-13). */
function useWaiting(regie: readonly string[]): number[] {
  return useApp(s => regie.map(id => s.pending.filter(p => p.chatId === id).length), sameList);
}

/** "Stato" in the top bar: chats and PRs at a glance (StatoDialog.tsx). */
export function StatoButton() {
  return (
    <IconButton label="Stato: chat e PR in un colpo d’occhio" shortcut="Ctrl+Shift+S" onClick={() => openModal('stato')} testid="stato-btn"><IconList size={16} /></IconButton>
  );
}

/** The window's measures, live (the expanded size is clamped to them). */
function useViewport() {
  const [v, setV] = useState(viewport);
  useEffect(() => {
    const on = () => setV(viewport());
    window.addEventListener('resize', on);
    const ro = new ResizeObserver(on); // the sidebar collapsing or expanding moves its right edge
    const side = document.querySelector('.sidebar');
    if (side) ro.observe(side);
    return () => { window.removeEventListener('resize', on); ro.disconnect(); };
  }, []);
  return v;
}

/** The expanded size shown now: the saved one kept usable in this window. */
function useDockSize(): DockSize {
  const saved = ui.use(s => s.prefs.regiaSize);
  const v = useViewport();
  return sizeIn(saved, v.W, v.H, v.top, v.left);
}

/** The room the workspace leaves the widget in the bottom-right corner (App.tsx pads by it). */
export function useDockReserve(): Reserve {
  const open = ui.use(s => s.prefs.regiaOpen);
  const r = reserveOf(open, useDockSize());
  useEffect(() => { scheduleLayer(); }, [r.right, r.bottom]); // the global layer moves aside at once
  return r;
}

/** The collapsed bar: the mark, what is new (unread replies) and what waits (questions, permissions, commands). */
function DockBar({ regie, waiting, active }: { regie: readonly string[]; waiting: number[]; active: string | null }) {
  const busy = useApp(s => regie.some(id => { const c = s.chats[id]; return !!c && isBusy(c); }));
  const seenAt = ui.use(s => s.prefs.regiaSeenAt);
  const unread = useApp(s => regie.reduce((n, id) => n + unreadOf(s.items[id], seenAt), 0));
  const total = waiting.reduce((a, b) => a + b, 0);
  const label = ['Regia', unread ? `${unread} ${unread === 1 ? 'risposta nuova' : 'risposte nuove'}` : '', total ? `${questions(total)} ${total === 1 ? 'ti aspetta' : 'ti aspettano'}` : ''].filter(Boolean).join(', ');
  return (
    <button type="button" className={`regia-dock-bar ${total ? 'waits' : ''}`} data-testid="regia-pill" aria-expanded={false} aria-label={`${label}: espandi (Ctrl+R)`}
      data-tip="Espandi la Regia|Ctrl+R" onClick={() => { setRegiaOpen(true); if (active) requestFocus(active); }}>
      <HarnessMark harness="claude" regia size={16} /><span className="regia-btn-label">Regia</span>
      {busy && <span className="regia-pill-busy" aria-hidden="true" />}
      {unread > 0 && <span className="regia-unread" data-testid="regia-pill-unread" aria-hidden="true">{unread} {unread === 1 ? 'nuova' : 'nuove'}</span>}
      {total > 0 && <span className="regia-badge" data-testid="regia-pill-count" aria-hidden="true">{total}</span>}
      <IconArrowUp size={13} />
    </button>
  );
}

export function RegiaOverlay() {
  const regie = useApp(regiaTabsOf, sameList);
  const labels = useApp(s => regie.map(id => regiaLabel(s.chats[id] ?? {})), sameList);
  const busy = useApp(s => regie.map(id => { const c = s.chats[id]; return !!c && isBusy(c); }), sameList);
  const waiting = useWaiting(regie);
  const tab = ui.use(s => s.prefs.regiaTab);
  const open = ui.use(s => s.prefs.regiaOpen);
  const opacity = useApp(s => s.settings?.regiaOpacity ?? 100);
  const active = tab && regie.includes(tab) ? tab : regie[0] ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const size = useDockSize();
  const [live, setLive] = useState<DockSize | null>(null); // while resizing
  // a browser view under the widget hides while it is there (the reserve keeps tiles out of its corner anyway)
  useLayoutEffect(() => (ref.current ? registerOverlay(ref.current) : undefined), [open]);
  // collapsed while a reply streams: it is not seen yet (setRegiaOpen marked everything up to now)
  useEffect(() => {
    if (open) return;
    const p = ui.get().prefs, s = app.get();
    const seen = seenAtCollapse(regiaTabsOf(s).map(id => s.items[id]), p.regiaSeenAt);
    if (seen < p.regiaSeenAt) setPrefs({ regiaSeenAt: seen });
  }, [open]);

  /** Resize from the top-left corner (the widget stays docked bottom-right); saved once at the end. */
  const track = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const start = { px: e.clientX, py: e.clientY, s: size };
    let last = size;
    const move = (ev: PointerEvent) => {
      const v = viewport();
      last = clampSize({ w: start.s.w - (ev.clientX - start.px), h: start.s.h - (ev.clientY - start.py) }, v.W, v.H, v.top, v.left);
      setLive(last);
      schedule(); // a browser view it now covers hides at once, not at the next safety poll
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLive(null);
      if (last !== size) setPrefs({ regiaSize: last });
      schedule();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  };

  if (!open) {
    return (
      <div ref={ref} className="regia-dock collapsed" data-regia-overlay data-testid="regia-dock">
        <DockBar regie={regie} waiting={waiting} active={active} />
      </div>
    );
  }

  const shown = live ?? size;
  const style = { width: shown.w, height: shown.h, '--regia-op': String(Math.min(100, Math.max(40, opacity)) / 100) } as CSSProperties;
  return (
    <div ref={ref} className={`regia-dock regia-ov ${live ? 'moving' : ''}`} style={style} data-regia-overlay data-testid="regia-overlay"
      onKeyDown={e => {
        // Esc collapses the widget when there is nothing to back out of inside it (an empty input, no menu open)
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        const t = e.target as HTMLElement;
        const typing = (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && (t as HTMLTextAreaElement).value !== '';
        if (typing || t.closest('[role="menu"], .popover')) return;
        e.preventDefault();
        collapseRegia();
      }}>
      <div className="regia-bar" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) setPrefs({ regiaSize: null }); }} data-testid="regia-bar">
        <div className="regia-tabs" role="tablist" aria-label="Regie" onKeyDown={e => {
          // the tab pattern: arrows and Home/End move between the Regie, one Tab stop for the list
          const i = regie.indexOf(active ?? '');
          const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? regie.length - 1 : null;
          if (to === null || !regie.length) return;
          e.preventDefault();
          const id = regie[(to + regie.length) % regie.length]!;
          setRegiaTab(id);
          requestAnimationFrame(() => document.getElementById(`regia-tab-${id}`)?.focus());
        }}>
          {regie.map((id, i) => (
            <button key={id} id={`regia-tab-${id}`} type="button" role="tab" aria-selected={id === active} aria-controls="regia-panel" tabIndex={id === active ? 0 : -1}
              className={`regia-tab ${id === active ? 'on' : ''}`} onClick={() => { setRegiaTab(id); requestFocus(id); }} data-testid={`regia-tab-${id}`}
              data-tip={waiting[i] ? `${labels[i]}: ${questions(waiting[i]!)}` : labels[i]}>
              <span className="regia-tab-label">{labels[i]}</span>
              {busy[i] && <span className="regia-tab-busy" aria-label="al lavoro" />}
              {waiting[i]! > 0 && <span className="regia-badge" aria-label={questions(waiting[i]!)}>{waiting[i]}</span>}
            </button>
          ))}
        </div>
        <IconButton label="Nuova Regia" onClick={openNewRegia} testid="regia-tab-new"><IconPlus size={14} /></IconButton>
        <span className="sp regia-grip" data-tip="Doppio clic: misura di partenza" />
        <IconButton label="Riduci la Regia" shortcut="Ctrl+R" onClick={collapseRegia} testid="regia-collapse"><IconMinimize size={14} /></IconButton>
      </div>
      <div className="regia-body" id="regia-panel" role="tabpanel" aria-labelledby={active ? `regia-tab-${active}` : undefined}>
        <RegiaTile key={active ?? 'none'} chatId={active} />
      </div>
      <div className="regia-resize" onPointerDown={track} onDoubleClick={() => setPrefs({ regiaSize: null })} aria-hidden="true" data-testid="regia-resize"
        data-tip="Trascina per cambiare misura · doppio clic: misura di partenza" />
    </div>
  );
}
