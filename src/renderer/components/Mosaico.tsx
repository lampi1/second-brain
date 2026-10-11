// Mosaico view: the chat tiles in a grid (creation order, so tiles never jump), each browser tile right next to the
// chat that drives it, finished chats folded into a "Finite oggi" dock (auto-tidy), splitters between columns and
// rows (drag, double-click resets, arrows when focused; sizes remembered per column/row count) and ⤢ to maximize
// one tile (Esc restores). Used by App.tsx.
import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { ChatSummary } from '@shared/contract';
import { cellsFor, dragSplit, fractions, gridFor, mosaicTiles, tileKey, type Cell, type TileRef } from '../lib/grid';
import { chatCost } from '../lib/format';
import { useNow } from '../lib/clock';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { keepChat, openModal, setPrefs, ui } from '../store/ui';
import { focusChat } from '../actions';
import { BrowserTile } from './BrowserTile';
import { ChatTile } from './ChatTile';
import { HarnessMark, IconPlus } from './Icons';
import { Keys, useSize } from './ui';

const GAP = 8;
type Tiles = { tiles: TileRef[]; folded: ChatSummary[] };
const sameTiles = (a: Tiles, b: Tiles) => sameList(a.tiles.map(tileKey), b.tiles.map(tileKey)) && sameList(a.folded, b.folded);

export function useMosaicTiles(): Tiles {
  const now = useNow(30_000);
  const keep = ui.use(s => s.keep, sameList);
  const hidden = ui.use(s => s.hidden, sameList);
  const focused = ui.use(s => s.focused);
  return useApp(s => {
    const keepSet = new Set(keep);
    if (focused?.startsWith('chat:')) keepSet.add(focused.slice(5));
    const visibleOrder = s.order.filter(id => !hidden.includes(id));
    return mosaicTiles(visibleOrder, s.chats, s.tabs.filter(t => !t.ownerChatId || !hidden.includes(t.ownerChatId)), now, keepSet);
  }, sameTiles);
}

function Splitters({ cols, rows, colFr, rowFr, cells, size, onCols, onRows, onDone }: {
  cols: number; rows: number; colFr: number[]; rowFr: number[]; cells: Cell[]; size: { width: number; height: number };
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
      <div key={`c${i}`} className="splitter v" role="separator" aria-orientation="vertical" aria-label="Ridimensiona le colonne" tabIndex={0} data-testid={`splitter-col-${i}`}
        style={{ left: x, top, height: bottom - top, width: GAP }} onPointerDown={drag('cols', i)} onKeyDown={key('cols', i)}
        onDoubleClick={() => onDone('cols', fractions(undefined, cols))} />,
    );
  }
  for (let r = 0; r < rows - 1; r++) {
    const y = rowTop(r) + (rowFr[r] ?? 0) * H;
    out.push(
      <div key={`r${r}`} className="splitter h" role="separator" aria-orientation="horizontal" aria-label="Ridimensiona le righe" tabIndex={0} data-testid={`splitter-row-${r}`}
        style={{ top: y, left: 0, width: size.width, height: GAP }} onPointerDown={drag('rows', r)} onKeyDown={key('rows', r)}
        onDoubleClick={() => onDone('rows', fractions(undefined, rows))} />,
    );
  }
  return <>{out}</>;
}

function FoldedDock({ folded }: { folded: ChatSummary[] }) {
  const shown = folded.slice(0, 6);
  return (
    <div className="dock" data-testid="folded-dock" aria-label="Chat finite oggi">
      <span className="dock-label">Finite oggi <span className="count">{folded.length}</span></span>
      {shown.map(c => (
        <button key={c.id} type="button" className="dock-chip" onClick={() => { keepChat(c.id); focusChat(c.id); }} data-testid={`folded-${c.id}`} data-tip="Riporta nel mosaico">
          <HarnessMark harness={c.harness} size={14} /><span className="dock-title">{c.title}</span><span className="dock-cost">{chatCost(c)}</span>
        </button>
      ))}
      {folded.length > shown.length && <button type="button" className="dock-chip more" onClick={() => openModal('palette')}>… altre {folded.length - shown.length}</button>}
      <span className="sp" />
      <span className="dock-hint">si tolgono da sole dopo 10 minuti</span>
    </div>
  );
}

function Tile({ t, index, maximized }: { t: TileRef; index?: number; maximized?: boolean }) {
  return t.kind === 'chat' ? <ChatTile chatId={t.id} index={index} maximized={maximized} /> : <BrowserTile tabId={t.id} maximized={maximized} />;
}

export function Mosaico() {
  const { tiles, folded } = useMosaicTiles();
  const maximized = ui.use(s => s.maximized);
  const prefCols = ui.use(s => s.prefs.cols);
  const prefRows = ui.use(s => s.prefs.rows);
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const [live, setLive] = useState<{ cols?: number[]; rows?: number[] } | null>(null);

  const max = maximized && maximized !== 'regia' ? tiles.find(t => tileKey(t) === maximized) ?? (maximized.startsWith('chat:') ? { kind: 'chat' as const, id: maximized.slice(5) } : null) : null;
  const { cols, rows } = gridFor(tiles.length, size.width || 1200, size.height || 800);
  const colFr = live?.cols ?? fractions(prefCols[cols], cols);
  const rowFr = live?.rows ?? fractions(prefRows[rows], rows);
  const cells = cellsFor(tiles.length, cols);
  let chatN = 0;

  return (
    <div className="mosaico" data-testid="view-mosaico">
      <div className="mosaic-area" ref={ref}>
      {max ? (
        <div className="mosaic-max" data-testid="maximized" data-key={tileKey(max)}><Tile t={max} maximized /></div>
      ) : tiles.length === 0 ? (
        <div className="view-empty" data-testid="mosaico-empty">
          <p className="empty-title">Nessuna chat al lavoro</p>
          <p className="empty-text">Le chat aperte compaiono qui come tessere; i browser che guidano stanno accanto a loro.</p>
          <button type="button" className="btn btn-primary btn-m" onClick={() => openModal('newChat')} data-testid="mosaico-new"><IconPlus size={14} /> Nuova chat <Keys combo="Ctrl+N" /></button>
        </div>
      ) : (
        <div className="mosaic-grid" style={{
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
            <Splitters cols={cols} rows={rows} colFr={colFr} rowFr={rowFr} cells={cells} size={size}
              onCols={fr => setLive(l => ({ ...l, cols: fr }))} onRows={fr => setLive(l => ({ ...l, rows: fr }))}
              onDone={(which, fr) => {
                setLive(null);
                if (which === 'cols') setPrefs({ cols: { ...prefCols, [cols]: fr } });
                else setPrefs({ rows: { ...prefRows, [rows]: fr } });
              }} />
          )}
        </div>
      )}
      </div>
      {!max && folded.length > 0 && <FoldedDock folded={folded} />}
    </div>
  );
}
