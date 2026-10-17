// Simple row-major workspace. Saved split trees supply order only, so existing profiles migrate without data loss.
// Pointer movement writes one GPU transform per frame; React and grid layout change only on drop.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { balancedLayout, paneKeys, reconcileLayout } from '../lib/agents-layout';
import { mosaicGrid, MOSAIC_GAP, reorderPane } from '../lib/mosaic-grid';
import { mosaicTiles, tileKey, type TileRef } from '../lib/grid';
import { schedule, suspendViews } from '../lib/viewports';
import { workspace, setWorkspace } from '../store/workspace';
import { useApp } from '../store/store';
import { sameList } from '../store/state';
import { useHandoffTabs } from '../store/handoffs';
import { openModal, toggleBrowsers, setPrefs, ui } from '../store/ui';
import { t as tr } from '../i18n';
import { ChatTile } from './ChatTile';
import { BrowserTile } from './BrowserTile';
import { toggleMaximize } from '../actions';
import { useSize } from './ui';
import '../styles/agents-workspace.css';

const equalTiles = (a: TileRef[], b: TileRef[]) => sameList(a.map(tileKey), b.map(tileKey));
type Drop = { target: string; after: boolean };
type Snapshot = { bounds: Map<string, DOMRect>; release: () => void };

export function AgentsWorkspace() {
  const ready = useApp(s => s.ready);
  const panelsVersion = ui.use(s => s.prefs.chatPanelsV);
  const expansion = ui.use(s => s.prefs.chatExpanded);
  const hidden = ui.use(s => s.hidden, sameList), hiddenTabs = ui.use(s => s.hiddenTabs, sameList);
  const tiles = useApp(s => mosaicTiles(s.order, s.chats, s.tabs), equalTiles);
  const owners = useApp(s => Object.fromEntries(s.tabs.filter(t => t.ownerChatId).map(t => [`browser:${t.id}`, `chat:${t.ownerChatId}`])), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const titles = useApp(s => Object.fromEntries(tiles.map(t => [tileKey(t), t.kind === 'chat' ? s.chats[t.id]?.agent?.name || s.chats[t.id]?.title || tr('product.unassigned') : s.tabs.find(tab => tab.id === t.id)?.title || 'Browser'])), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const root = workspace.use(s => s.root);
  const maximized = ui.use(s => s.maximized);
  const hide = ui.use(s => s.prefs.browsersHidden);
  const keep = useHandoffTabs();
  const [announcement, announce] = useState('');
  const canvas = useRef<HTMLDivElement>(null);
  const size = useSize(canvas);
  const gesture = useRef<(() => void) | null>(null);
  const snapshot = useRef<Snapshot | null>(null);
  const animations = useRef<Animation[]>([]);
  const byKey = useMemo(() => new Map(tiles.map(t => [tileKey(t), t])), [tiles]);
  const keys = tiles.map(tileKey), keySignature = keys.join('|');
  useEffect(() => {
    if (ready && panelsVersion === 0) setPrefs({ chatPanelsV: 1, chatExpanded: { ...Object.fromEntries(tiles.filter(tile => tile.kind === 'chat').map(tile => [tile.id, true])), ...ui.get().prefs.chatExpanded } });
  }, [ready, panelsVersion, keySignature]);
  const reconciled = useMemo(() => reconcileLayout(root, keys, owners), [root, keySignature, owners]);
  useEffect(() => { if (ready && JSON.stringify(root) !== JSON.stringify(reconciled)) setWorkspace(reconciled); }, [ready, root, reconciled]);
  const visible = new Set(tiles.filter(t => t.kind === 'chat' ? !hidden.includes(t.id) : !hiddenTabs.includes(t.id) && !hidden.includes(owners[tileKey(t)]?.slice(5) ?? '') && (!hide || keep.includes(t.id))).map(tileKey));
  const order = paneKeys(reconciled).filter(key => visible.has(key));
  const max = maximized && visible.has(maximized) ? maximized : null;
  const shown = max ? [max] : order;
  const grid = mosaicGrid(shown.length, size.width, shown.flatMap((key, index) => key.startsWith('chat:') && expansion[key.slice(5)] === true ? [index] : []));
  const chatIndices = new Map(tiles.filter(t => t.kind === 'chat' && visible.has(tileKey(t))).map((t, index) => [tileKey(t), index + 1]));
  const panes = () => Array.from(canvas.current?.querySelectorAll<HTMLElement>('[data-workspace-pane]') ?? []);

  useEffect(() => () => gesture.current?.(), [keySignature, order.join('|'), max, hide, size.width, expansion]);
  useEffect(() => () => {
    gesture.current?.();
    animations.current.forEach(animation => animation.cancel());
    snapshot.current?.release();
  }, []);
  useLayoutEffect(() => {
    schedule();
    const pending = snapshot.current;
    if (!pending) return;
    snapshot.current = null;
    const running: Animation[] = [];
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const pane of panes()) {
        const before = pending.bounds.get(pane.dataset.workspacePane!);
        if (!before) continue;
        const after = pane.getBoundingClientRect();
        const x = before.left - after.left, y = before.top - after.top;
        if (Math.abs(x) + Math.abs(y) > 1) running.push(pane.animate([{ transform: `translate3d(${x}px,${y}px,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }));
      }
    }
    animations.current = running;
    void Promise.allSettled(running.map(animation => animation.finished)).then(() => { pending.release(); schedule(); });
  }, [order.join('|'), max, size.width, expansion]);

  const move = (moving: string, target: string, after: boolean, before?: Snapshot) => {
    const old = paneKeys(reconciled), next = reorderPane(old, moving, target, after);
    if (sameList(old, next)) return false;
    animations.current.forEach(animation => animation.cancel());
    snapshot.current?.release();
    snapshot.current = before ?? { bounds: new Map(panes().map(pane => [pane.dataset.workspacePane!, pane.getBoundingClientRect()])), release: suspendViews() };
    setWorkspace(balancedLayout(next));
    announce(`${titles[moving]} ${after ? 'dopo' : 'prima di'} ${titles[target]}`);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="workspace-grip-${CSS.escape(moving)}"]`)?.focus({ preventScroll: true }));
    return true;
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, moving: string) => {
    if (event.button !== 0 || max) return;
    gesture.current?.();
    animations.current.forEach(animation => animation.cancel());
    event.preventDefault();
    event.stopPropagation(); // The grip starts a gesture, not a tile-focus/selection render.
    const handle = event.currentTarget, pane = handle.closest<HTMLElement>('[data-workspace-pane]');
    if (!pane) return;
    const release = suspendViews();
    try { handle.setPointerCapture(event.pointerId); } catch { release(); return; }
    const entries = panes().map(element => ({ element, key: element.dataset.workspacePane!, rect: element.getBoundingClientRect() }));
    // Drag a small label instead of rasterizing a transcript/native-browser thumbnail into a huge GPU layer.
    const preview = document.createElement('div');
    preview.className = 'workspace-drag-preview'; preview.textContent = titles[moving] || 'Agente';
    preview.style.left = `${event.clientX - 24}px`; preview.style.top = `${event.clientY - 16}px`;
    document.body.append(preview);
    let destination: Drop | null = null, marked: HTMLElement | null = null;
    let frame = 0, finished = false, x = event.clientX, y = event.clientY;
    const startX = x, startY = y;
    const mark = (target: HTMLElement | null, after = false) => {
      if (marked === target && (!marked || marked.dataset.drop === (after ? 'after' : 'before'))) return;
      if (marked !== target) { marked?.removeAttribute('data-drop'); marked = target; }
      if (marked) marked.dataset.drop = after ? 'after' : 'before';
    };
    const paint = () => {
      frame = 0;
      preview.style.transform = `translate3d(${x - startX}px,${y - startY}px,0)`;
      const hit = entries.find(entry => entry.key !== moving && x >= entry.rect.left && x <= entry.rect.right && y >= entry.rect.top && y <= entry.rect.bottom);
      const after = !!hit && x > hit.rect.left + hit.rect.width / 2;
      destination = hit ? { target: hit.key, after } : null;
      mark(hit?.element ?? null, after);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      x = e.clientX; y = e.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    pane.classList.add('pane-dragging'); canvas.current?.classList.add('workspace-dragging');
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      if (commit) paint();
      const bounds = new Map(entries.map(entry => [entry.key, entry.element.getBoundingClientRect()]));
      handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancel); handle.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', cancel); canvas.current?.removeEventListener('scroll', cancel);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      preview.remove(); pane.classList.remove('pane-dragging'); canvas.current?.classList.remove('workspace-dragging'); mark(null);
      gesture.current = null;
      const moved = commit && destination && move(moving, destination.target, destination.after, { bounds, release });
      if (!moved) release();
    };
    const up = (e: PointerEvent) => { if (e.pointerId === event.pointerId) { x = e.clientX; y = e.clientY; finish(true); } };
    const cancel = () => finish(false);
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
    handle.addEventListener('pointermove', onMove); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', cancel); handle.addEventListener('lostpointercapture', cancel);
    window.addEventListener('keydown', escape, true); window.addEventListener('resize', cancel); canvas.current?.addEventListener('scroll', cancel);
    gesture.current = cancel;
  };

  return <div className="agents-workspace" data-testid="view-mosaico">
    <div className="workspace-toolbar"><b>Agenti · spazio di lavoro</b><span className="sp" />
      {max && <button type="button" className="btn btn-ghost" onClick={() => toggleMaximize(max)}>Torna alla disposizione</button>}
      <button type="button" className="btn btn-ghost" onClick={toggleBrowsers}>{hide ? 'Mostra browser' : 'Nascondi browser'}</button>
    </div>
    <div className="workspace-canvas" ref={canvas}>
      {shown.length ? <div className={`workspace-grid${max ? ' workspace-max' : ''}`} style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`, gridTemplateRows: max ? 'minmax(420px, 1fr)' : grid.rows.map(height => `${height}px`).join(' '), gap: MOSAIC_GAP }}>
        {shown.map((key, index) => {
          const tile = byKey.get(key)!;
          const cell = grid.cells[index]!;
          const compact = tile.kind === 'chat' && panelsVersion === 1 && expansion[tile.id] !== true && !max;
          const grip = <button type="button" className="workspace-grip" disabled={!!max} aria-label={tr('product.move', { name: titles[key] || tr('product.unassigned') })} title="Trascina per riordinare · Alt+frecce" data-testid={`workspace-grip-${key}`}
                onPointerDown={e => startDrag(e, key)} onKeyDown={e => {
                  if (!e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                  e.preventDefault(); e.stopPropagation();
                  const previous = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
                  const target = order[order.indexOf(key) + (previous ? -1 : 1)];
                  if (target) move(key, target, !previous);
                }}><span aria-hidden="true">⠿</span></button>;
          return <div className={`agent-pane${compact ? ' strip-pane' : ''}`} data-workspace-pane={key} key={key} style={{ gridColumn: cell.column, gridRow: cell.row }}>
            <div className="agent-pane-content">{tile.kind === 'chat' ? <ChatTile chatId={tile.id} index={chatIndices.get(key)} maximized={!!max} grip={grip} /> : <BrowserTile tabId={tile.id} maximized={!!max} grip={grip} />}</div>
          </div>;
        })}
      </div> : <div className="view-empty"><p>Nessun agente nello spazio di lavoro.</p><button type="button" className="btn btn-primary" onClick={() => openModal('newChat')}>Nuovo agente</button></div>}
    </div>
    <p className="sr-only" aria-live="polite">{announcement}</p>
  </div>;
}
