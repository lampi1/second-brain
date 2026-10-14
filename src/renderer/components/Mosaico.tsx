// Mosaico view in two zones: the chat tiles in a grid on the left (creation order, so tiles never jump) and the browser
// tiles in their own grid on the right, in the same order as the chats that drive them (the pair color ties them,
// lib/pairs.ts), with a splitter between the zones. "Nascondi browser" (Ctrl+Shift+B, remembered) drops the browser
// zone and the chats take the room; the tabs keep working parked off screen (main/browser/tabs.ts), and a tab with an
// open hand-off stays visible. Splitters between columns and rows (drag, double-click resets, arrows when focused;
// sizes remembered per zone and column/row count) and ⤢ to maximize one tile (Esc restores). A finished chat stays
// until it closes by itself (AutoCloser.tsx); closed chats leave the grid and are found with Ctrl+K (CommandPalette.tsx).
// Why (zones, toggle): the user, 2026-10-12, "vorrei vedere i browser e le chat separati un pelo più in ordine, e un
// toggle per nascondere i browser e concentrarsi sulle chat". Used by App.tsx.
import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { cellsFor, COMPACT_TILE_H, dragSplit, fractions, gridFor, mosaicTiles, splitZones, tileKey, type Cell, type TileRef } from '../lib/grid';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { useHandoffTabs } from '../store/handoffs';
import { defaultPrefs, openModal, setPrefs, toggleBrowsers, ui } from '../store/ui';
import { BrowserTile } from './BrowserTile';
import { ChatTile } from './ChatTile';
import { IconPlus } from './Icons';
import { Keys, useSize } from './ui';

const GAP = 8;
const sameTiles = (a: TileRef[], b: TileRef[]) => sameList(a.map(tileKey), b.map(tileKey));

function useMosaicTiles(): TileRef[] {
  const hidden = ui.use(s => s.hidden, sameList);
  const hiddenTabs = ui.use(s => s.hiddenTabs, sameList);
  return useApp(s => {
    const visibleOrder = s.order.filter(id => !hidden.includes(id));
    return mosaicTiles(visibleOrder, s.chats, s.tabs.filter(t => !hiddenTabs.includes(t.id) && (!t.ownerChatId || !hidden.includes(t.ownerChatId))));
  }, sameTiles);
}

function Splitters({ cols, rows, colFr, rowFr, cells, size, onCols, onRows, onDone, tid }: {
  cols: number; rows: number; colFr: number[]; rowFr: number[]; cells: Cell[]; size: { width: number; height: number }; tid: string;
  onCols: (fr: number[]) => void; onRows: (fr: number[]) => void; onDone: (which: 'cols' | 'rows', fr: number[]) => void;
}) {
  const W = size.width - (cols - 1) * GAP;
  const H = size.height - (rows - 1) * GAP;
  const rowTop = (r: number) => rowFr.slice(0, r).reduce((a, b) => a + b, 0) * H + r * GAP;
  const drag = (which: 'cols' | 'rows', i: number) => (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = which === 'cols' ? e.clientX : e.clientY;
    const base = which === 'cols' ? colFr : rowFr;
    const total = which === 'cols' ? W : H;
    let last = base;
    const move = (ev: PointerEvent) => {
      last = dragSplit(base, i, ((which === 'cols' ? ev.clientX : ev.clientY) - start) / total);
      (which === 'cols' ? onCols : onRows)(last);
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); onDone(which, last); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const key = (which: 'cols' | 'rows', i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = (which === 'cols' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[e.key];
    if (!dir) return;
    e.preventDefault();
    onDone(which, dragSplit(which === 'cols' ? colFr : rowFr, i, dir * 0.03));
  };
  const out = [];
  for (let i = 0; i < cols - 1; i++) {
    const x = colFr.slice(0, i + 1).reduce((a, b) => a + b, 0) * W + i * GAP;
    const rowsWithGap = Array.from({ length: rows }, (_, r) => r).filter(r => cells.some(c => c.row === r && c.col + c.span - 1 === i));
    if (!rowsWithGap.length) continue;
    const top = rowTop(Math.min(...rowsWithGap));
    const last = Math.max(...rowsWithGap);
    const bottom = rowTop(last) + (rowFr[last] ?? 0) * H;
    out.push(
      <div key={`c${i}`} className="splitter v" role="separator" aria-orientation="vertical" aria-label="Ridimensiona le colonne" tabIndex={0} data-testid={`${tid}col-${i}`}
        style={{ left: x, top, height: bottom - top, width: GAP }} onPointerDown={drag('cols', i)} onKeyDown={key('cols', i)}
        onDoubleClick={() => onDone('cols', fractions(undefined, cols))} />,
    );
  }
  for (let r = 0; r < rows - 1; r++) {
    const y = rowTop(r) + (rowFr[r] ?? 0) * H;
    out.push(
      <div key={`r${r}`} className="splitter h" role="separator" aria-orientation="horizontal" aria-label="Ridimensiona le righe" tabIndex={0} data-testid={`${tid}row-${r}`}
        style={{ top: y, left: 0, width: size.width, height: GAP }} onPointerDown={drag('rows', r)} onKeyDown={key('rows', r)}
        onDoubleClick={() => onDone('rows', fractions(undefined, rows))} />,
    );
  }
  return <>{out}</>;
}

function Tile({ t, index, maximized }: { t: TileRef; index?: number; maximized?: boolean }) {
  return t.kind === 'chat' ? <ChatTile chatId={t.id} index={index} maximized={maximized} /> : <BrowserTile tabId={t.id} maximized={maximized} />;
}

/** One zone's grid with its splitters; sizes are remembered per zone (`zone` prefixes the column/row count key). */
function TileGrid({ tiles, zone, aspect, minH, testid }: { tiles: TileRef[]; zone: '' | 'b'; aspect?: number; minH?: number; testid: string }) {
  const prefCols = ui.use(s => s.prefs.cols);
  const prefRows = ui.use(s => s.prefs.rows);
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const [live, setLive] = useState<{ cols?: number[]; rows?: number[] } | null>(null);
  const { cols, rows } = gridFor(tiles.length, size.width || 800, size.height || 800, aspect, minH);
  const colFr = live?.cols ?? fractions(prefCols[zone + cols], cols);
  const rowFr = live?.rows ?? fractions(prefRows[zone + rows], rows);
  const cells = cellsFor(tiles.length, cols);
  let chatN = 0;
  return (
    <div className="mosaic-grid" ref={ref} data-testid={testid} style={{
      gridTemplateColumns: colFr.map(f => `minmax(0, ${f}fr)`).join(' '),
      gridTemplateRows: rowFr.map(f => `minmax(0, ${f}fr)`).join(' '),
      gap: GAP,
    }}>
      {tiles.map((t, i) => {
        const c = cells[i]!;
        const index = t.kind === 'chat' ? ++chatN : undefined;
        return (
          <div className="cell" key={tileKey(t)} style={{ gridColumn: `${c.col + 1} / span ${c.span}`, gridRow: c.row + 1 }}>
            <Tile t={t} index={index} />
          </div>
        );
      })}
      {size.width > 0 && (
        <Splitters cols={cols} rows={rows} colFr={colFr} rowFr={rowFr} cells={cells} size={size} tid={zone ? 'splitter-b-' : 'splitter-'}
          onCols={fr => setLive(l => ({ ...l, cols: fr }))} onRows={fr => setLive(l => ({ ...l, rows: fr }))}
          onDone={(which, fr) => {
            setLive(null);
            if (which === 'cols') setPrefs({ cols: { ...prefCols, [zone + cols]: fr } });
            else setPrefs({ rows: { ...prefRows, [zone + rows]: fr } });
          }} />
      )}
    </div>
  );
}

const ZONE_DEFAULT = defaultPrefs.browserZone;
const clampZone = (z: number) => Math.min(0.7, Math.max(0.15, z));

/** The splitter between the chat zone and the browser zone (drag, arrows, double-click resets). */
function ZoneSplitter({ box }: { box: RefObject<HTMLDivElement | null> }) {
  const zone = ui.use(s => s.prefs.browserZone);
  return (
    <div className="splitter v static zone-split" role="separator" aria-orientation="vertical" aria-label="Ridimensiona chat e browser" tabIndex={0} data-testid="splitter-zones"
      onPointerDown={e => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const r = box.current?.getBoundingClientRect();
        const move = (ev: PointerEvent) => { if (r) setPrefs({ browserZone: clampZone(1 - (ev.clientX - r.left) / r.width) }); };
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPrefs({ browserZone: clampZone(zone + (e.key === 'ArrowLeft' ? 0.03 : -0.03)) }); } }}
      onDoubleClick={() => setPrefs({ browserZone: ZONE_DEFAULT })} />
  );
}

export function Mosaico() {
  const tiles = useMosaicTiles();
  const maximized = ui.use(s => s.maximized);
  const hide = ui.use(s => s.prefs.browsersHidden);
  const zone = ui.use(s => s.prefs.browserZone);
  const waitingTabs = useHandoffTabs();
  const ref = useRef<HTMLDivElement>(null);

  const max = maximized && maximized !== 'regia' ? tiles.find(t => tileKey(t) === maximized) ?? (maximized.startsWith('chat:') ? { kind: 'chat' as const, id: maximized.slice(5) } : null) : null;
  const { chats, browsers } = splitZones(tiles, hide, waitingTabs);
  const parked = tiles.length - chats.length - browsers.length;
  const both = chats.length > 0 && browsers.length > 0;

  return (
    <div className="mosaico" data-testid="view-mosaico" data-browsers={hide ? 'hidden' : 'shown'}>
      <div className="mosaic-area">
      {max ? (
        <div className="mosaic-max" data-testid="maximized" data-key={tileKey(max)}><Tile t={max} maximized /></div>
      ) : tiles.length === 0 ? (
        <div className="view-empty" data-testid="mosaico-empty">
          <p className="empty-title">Nessuna chat al lavoro</p>
          <p className="empty-text">Le chat aperte compaiono qui come tessere; i browser che guidano stanno nella colonna a destra, con lo stesso colore.</p>
          <button type="button" className="btn btn-primary btn-m" onClick={() => openModal('newChat')} data-testid="mosaico-new"><IconPlus size={14} /> Nuova chat <Keys combo="Ctrl+N" /></button>
        </div>
      ) : chats.length + browsers.length === 0 ? (
        <div className="view-empty" data-testid="mosaico-empty">
          <p className="empty-title">Nessuna chat al lavoro</p>
          <p className="empty-text">{parked === 1 ? 'Un browser nascosto continua' : `${parked} browser nascosti continuano`} a lavorare.</p>
          <button type="button" className="btn btn-ghost btn-m" onClick={toggleBrowsers} data-testid="mosaico-show-browsers">Mostra i browser <Keys combo="Ctrl+Shift+B" /></button>
        </div>
      ) : (
        <div className="mosaic-zones" ref={ref} style={{ gridTemplateColumns: both ? `minmax(0, ${1 - zone}fr) ${GAP}px minmax(0, ${zone}fr)` : 'minmax(0, 1fr)' }}>
          {chats.length > 0 && <TileGrid tiles={chats} zone="" minH={COMPACT_TILE_H} testid="zone-chats" />}
          {both && <ZoneSplitter box={ref} />}
          {browsers.length > 0 && <TileGrid tiles={browsers} zone="b" aspect={1.4} testid="zone-browsers" />}
        </div>
      )}
      </div>
    </div>
  );
}
