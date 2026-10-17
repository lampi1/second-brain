// One workspace for agents and their native browser panels: stable split topology, pointer/keyboard docking and resize.
// Gestures suspend native views through the existing viewport reporter; page/session/ownership stay in main unchanged.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { balancedLayout, dockPane, dropSide, paneKeys, reconcileLayout, resizeSplit, visibleLayout, type DockSide, type LayoutNode } from '../lib/agents-layout';
import { mosaicTiles, tileKey, type TileRef } from '../lib/grid';
import { schedule, suspendViews } from '../lib/viewports';
import { workspace, setWorkspace } from '../store/workspace';
import { useApp } from '../store/store';
import { sameList } from '../store/state';
import { useHandoffTabs } from '../store/handoffs';
import { openModal, toggleBrowsers, setPrefs,ui } from '../store/ui';
import {t as tr}from'../i18n';
import { ChatTile } from './ChatTile';
import { BrowserTile } from './BrowserTile';
import { focusChat, toggleMaximize } from '../actions';
import '../styles/agents-workspace.css';

const equalTiles = (a: TileRef[], b: TileRef[]) => sameList(a.map(tileKey), b.map(tileKey));
interface Drop { target: string; side: DockSide }

export function AgentsWorkspace() {
  const ready = useApp(s => s.ready);
  const expansion=ui.use(s=>s.prefs.chatExpanded),panelsVersion=ui.use(s=>s.prefs.chatPanelsV);
  const hidden = ui.use(s => s.hidden, sameList), hiddenTabs = ui.use(s => s.hiddenTabs, sameList);
  const tiles = useApp(s => mosaicTiles(s.order, s.chats, s.tabs), equalTiles);
  const owners = useApp(s => Object.fromEntries(s.tabs.filter(t => t.ownerChatId).map(t => [`browser:${t.id}`, `chat:${t.ownerChatId}`])), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const titles = useApp(s => Object.fromEntries(tiles.map(t => [tileKey(t), t.kind === 'chat' ? s.chats[t.id]?.agent?.name || s.chats[t.id]?.title || tr('product.unassigned') : s.tabs.find(tab => tab.id === t.id)?.title || 'Browser'])), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const root = workspace.use(s => s.root);
  const maximized = ui.use(s => s.maximized);
  const hide = ui.use(s => s.prefs.browsersHidden);
  const keep = useHandoffTabs();
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [announcement, announce] = useState('');
  const gesture = useRef<(() => void) | null>(null);
  const byKey = useMemo(() => new Map(tiles.map(t => [tileKey(t), t])), [tiles]);
  const keys = tiles.map(tileKey);
  useEffect(()=>{if(ready&&panelsVersion===0){setPrefs({chatPanelsV:1,chatExpanded:{...Object.fromEntries(tiles.filter(tile=>tile.kind==='chat').map(tile=>[tile.id,true])),...ui.get().prefs.chatExpanded}});}},[ready,panelsVersion,keys.join('|')]);
  const compactPane=(key:string)=>panelsVersion===1&&key.startsWith('chat:')&&expansion[key.slice(5)]!==true;
  const compactNode=(node:LayoutNode)=>paneKeys(node).every(compactPane);
  const reconciled = useMemo(() => reconcileLayout(root, keys, owners), [root, keys.join('|'), owners]);
  useEffect(() => { if (ready && JSON.stringify(root) !== JSON.stringify(reconciled)) setWorkspace(reconciled); }, [ready,root, reconciled]);
  useEffect(() => () => gesture.current?.(), []);
  useEffect(() => () => gesture.current?.(), [keys.join('|')]);
  useEffect(() => { schedule(); }, [reconciled, maximized, hide]);
  const visible = new Set(tiles.filter(t => t.kind === 'chat' ? !hidden.includes(t.id) : !hiddenTabs.includes(t.id) && !hidden.includes(owners[tileKey(t)]?.slice(5)??'') && (!hide || keep.includes(t.id))).map(tileKey));
  const visibleRoot = visibleLayout(reconciled, visible);
  const order = paneKeys(visibleRoot);
  const chatIndices = new Map(tiles.filter(t=>t.kind==='chat' && visible.has(tileKey(t))).map((t,index)=>[tileKey(t),index+1]));
  const move = (moving: string, target: string, side: DockSide) => {
    setWorkspace(dockPane(workspace.get().root, moving, target, side));
    announce(`${titles[moving]} affiancato a ${titles[target]}`); schedule();
    requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-testid="workspace-grip-${CSS.escape(moving)}"]`)?.focus());
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, moving: string) => {
    if (event.button !== 0) return;
    gesture.current?.();
    event.preventDefault();
    const handle = event.currentTarget;
    const release = suspendViews();
    try{handle.setPointerCapture(event.pointerId);}catch{release();return;}
    setDragging(moving); setDrop(null);
    let destination: Drop | null = null;
    let finished = false;
    const onMove = (e: PointerEvent) => {
      const pane = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-workspace-pane]');
      const target = pane?.dataset.workspacePane;
      if (!pane || !target || target === moving) { destination = null; setDrop(null); return; }
      const r = pane.getBoundingClientRect();
      destination = { target, side: dropSide(e.clientX - r.left, e.clientY - r.top, r.width, r.height) }; setDrop(destination);
    };
    const finish = (commit: boolean) => {
      if(finished)return;finished=true;
      handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', cancel); window.removeEventListener('keydown', escape, true);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      gesture.current = null; setDragging(null); setDrop(null);
      if (commit && destination) move(moving, destination.target, destination.side);
      requestAnimationFrame(release);
    };
    const up = () => finish(true), cancel = () => finish(false);
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
    handle.addEventListener('pointermove', onMove); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', cancel); window.addEventListener('keydown', escape, true);
    // Remove with the same capture flag; cancellation also runs when a panel disappears during a gesture.
    gesture.current = cancel;
  };

  const renderPane = (key: string, large = false) => {
    const t = byKey.get(key);
    if (!t) return null;
    return <div className={`agent-pane${compactPane(key)&&!large?' strip-pane':''}${drop?.target === key ? ` drop-${drop.side}` : ''}`} data-workspace-pane={key} key={key}>
      <div className="agent-pane-tools">
        <button type="button" className="workspace-grip" aria-label={tr('product.move',{name:titles[key]||tr('product.unassigned')})} title={tr('product.moveHint')} data-testid={`workspace-grip-${key}`}
          onPointerDown={e => startDrag(e, key)} onKeyDown={e => {
            if (!e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            const side: DockSide = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'top' : 'bottom';
            const index = order.indexOf(key), previous = side === 'left' || side === 'top';
            const target = order[index + (previous ? -1 : 1)] ?? order[index + (previous ? 1 : -1)];
            if (target) move(key, target, side);
          }}><span aria-hidden="true">⠿</span></button>
        {owners[key] && <button type="button" className="link-btn" onClick={() => focusChat(owners[key]!.slice(5))}>{titles[owners[key]!] ?? tr('product.unassigned')}</button>}
      </div>
      <div className="agent-pane-content">{t.kind === 'chat' ? <ChatTile chatId={t.id} index={chatIndices.get(key)} maximized={large} /> : <BrowserTile tabId={t.id} maximized={large} />}</div>
    </div>;
  };

  const render = (node: LayoutNode): ReactNode => node.kind === 'pane' ? renderPane(node.key) : <WorkspaceSplit key={node.id} node={node} firstCompact={compactNode(node.first)} secondCompact={compactNode(node.second)} onResize={ratio => {
    const current = workspace.get().root; if (current) setWorkspace(resizeSplit(current, node.id, ratio)); schedule();
  }} gesture={gesture}>{[render(node.first), render(node.second)]}</WorkspaceSplit>;

  const max = maximized && visible.has(maximized) ? maximized : null;
  return <div className={`agents-workspace${dragging ? ' workspace-dragging' : ''}`} data-testid="view-mosaico">
    <div className="workspace-toolbar"><b>Agenti · spazio di lavoro</b><span className="sp" />
      {max && <button type="button" className="btn btn-ghost" onClick={() => toggleMaximize(max)}>Torna alla disposizione</button>}
      <button type="button" className="btn btn-ghost" onClick={toggleBrowsers}>{hide ? 'Mostra browser' : 'Nascondi browser'}</button>
      <button type="button" className="btn btn-ghost" onClick={() => setWorkspace(balancedLayout(keys))}>Disponi automaticamente</button>
    </div>
    <div className="workspace-canvas">{max ? renderPane(max, true) : visibleRoot ? render(visibleRoot) : <div className="view-empty"><p>Nessun agente nello spazio di lavoro.</p><button type="button" className="btn btn-primary" onClick={() => openModal('newChat')}>Nuovo agente</button></div>}</div>
    <p className="sr-only" aria-live="polite">{announcement}</p>
  </div>;
}

function WorkspaceSplit({ node, children, onResize, gesture,firstCompact,secondCompact }: { node: Extract<LayoutNode, { kind: 'split' }>; children: [ReactNode, ReactNode]; onResize: (ratio: number) => void; gesture: RefObject<(() => void) | null>;firstCompact:boolean;secondCompact:boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelResize = useRef<(()=>void)|null>(null);
  useEffect(()=>()=>cancelResize.current?.(),[]);
  const [ratio, setRatio] = useState(node.ratio);
  useEffect(() => { setRatio(node.ratio); }, [node.ratio]);
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    gesture.current?.();
    e.preventDefault(); const handle = e.currentTarget, r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const release = suspendViews();try{handle.setPointerCapture(e.pointerId);}catch{release();return;}
    let last = node.ratio;
    let finished = false;
    const move = (ev: PointerEvent) => { last = Math.min(0.85, Math.max(0.15, node.axis === 'row' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height)); setRatio(last); schedule(); };
    const finish = (commit: boolean) => {
      if(finished)return; finished=true;cancelResize.current=null;
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancel); handle.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('keydown',escape,true);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      gesture.current = null; if (commit) onResize(last); else setRatio(node.ratio); requestAnimationFrame(release);
    };
    const up = () => finish(true), cancel = () => finish(false);
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}};
    window.addEventListener('keydown',escape,true);
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', cancel); handle.addEventListener('lostpointercapture', cancel); gesture.current = cancel;cancelResize.current=cancel;
  };
  return <div ref={ref} className={`workspace-split axis-${node.axis}${firstCompact&&secondCompact?' compact-subtree':''}`} style={{ gridTemplateColumns: node.axis === 'row' ? `minmax(220px,${ratio}fr) 8px minmax(220px,${1 - ratio}fr)` : undefined, gridTemplateRows: node.axis === 'column' ? `${firstCompact?'auto':`minmax(300px,${ratio}fr)`} 8px ${secondCompact?'auto':`minmax(300px,${1-ratio}fr)`}` : undefined }}>
    <div className={`workspace-child${firstCompact?' compact-subtree':''}`}>{children[0]}</div>
    <div className="workspace-sash" role="separator" aria-label="Ridimensiona pannelli" aria-orientation={node.axis === 'row' ? 'vertical' : 'horizontal'} aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(ratio * 100)} tabIndex={0} onPointerDown={start}
      onDoubleClick={() => onResize(0.5)} onKeyDown={e => { const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -0.03 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 0.03 : 0; if (delta) { e.preventDefault(); onResize(node.ratio + delta); } }} />
    <div className={`workspace-child${secondCompact?' compact-subtree':''}`}>{children[1]}</div>
  </div>;
}
