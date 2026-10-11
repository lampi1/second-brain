// Corsie view: three columns by state, "Ti aspettano" (oldest request first), "Al lavoro", "Finite oggi" (newest
// first, auto-collapsed to one-line rows), as many full tiles as fit and the rest as rows (click = expand), then a
// strip of live browser thumbnails; a click shows that browser big next to its chat (Esc returns).
// Used by App.tsx.
import { memo, useRef, useState, type ReactNode } from 'react';
import type { ChatSummary } from '@shared/contract';
import { ago, chatCost } from '../lib/format';
import { useNow } from '../lib/clock';
import { corsie, sameList } from '../store/state';
import { useApp } from '../store/store';
import { openInColumn, setPair, setPrefs, ui } from '../store/ui';
import { BrowserTile } from './BrowserTile';
import { ChatTile } from './ChatTile';
import { HarnessMark, IconArrowLeft, IconChevronDown, IconGlobe } from './Icons';
import { Kbd, StatePill, useSize } from './ui';

type Col = 'waiting' | 'working' | 'done';

const ChatMini = memo(function ChatMini({ c, col, now }: { c: ChatSummary; col: Col; now: number }) {
  return (
    <button type="button" className="mini" onClick={() => openInColumn(col, c.id)} data-testid={`mini-${c.id}`} aria-label={`${c.title}: apri`}>
      <HarnessMark harness={c.harness} size={16} />
      <span className="mini-title">{c.title}</span>
      <span className="sp" />
      {col === 'done' ? <span className="mini-meta">{chatCost(c)} · {ago(c.updatedAt, now)}</span> : <StatePill chat={c} />}
    </button>
  );
});

function Column({ col, title, hint, chats, maxOpen, empty, indexBase, older = [] }: { col: Col; title: string; hint?: string; chats: ChatSummary[]; maxOpen: number; empty: ReactNode; indexBase: number; older?: ChatSummary[] }) {
  const opened = ui.use(s => s.open[col]);
  const [showOlder, setShowOlder] = useState(false);
  const openedOlder = !!opened && older.some(c => c.id === opened);
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const now = useNow(30_000);
  const fit = Math.max(1, Math.min(maxOpen, Math.floor((size.height || 700) / 300)));
  let open = chats.slice(0, fit).map(c => c.id);
  if (opened && (chats.some(c => c.id === opened) || openedOlder) && !open.includes(opened)) open = [opened, ...open].slice(0, fit);
  const shownMinis = col === 'done' ? 6 : 99;
  let minis = 0;
  let idx = indexBase;
  return (
    <section className={`col col-${col}`} aria-label={`${title}: ${chats.length}`} data-testid={`col-${col}`}>
      <div className="col-head">
        <span className="col-title">{title}</span><span className="col-count">{chats.length}</span>
        <span className="sp" />{hint && <span className="col-hint">{hint}</span>}
      </div>
      <div className="col-body" ref={ref}>
        {chats.length === 0 && !openedOlder && <div className="col-empty">{empty}</div>}
        {openedOlder && <div className="col-tile" key={opened}><ChatTile chatId={opened!} index={++idx} /></div>}
        {chats.map(c => {
          if (open.includes(c.id)) return <div className="col-tile" key={c.id}><ChatTile chatId={c.id} index={++idx} /></div>;
          if (++minis > shownMinis) return null;
          return <ChatMini key={c.id} c={c} col={col} now={now} />;
        })}
        {minis > shownMinis && <div className="mini more">… altre {minis - shownMinis}</div>}
        {older.length > 0 && (
          <div className="older" data-testid={`col-${col}-older`}>
            <button type="button" className="older-head" onClick={() => setShowOlder(o => !o)} aria-expanded={showOlder || openedOlder} data-testid={`col-${col}-older-toggle`}>
              <span>Precedenti</span><span className="count">{older.length}</span><span className="sp" /><IconChevronDown size={13} className={showOlder || openedOlder ? '' : 'closed'} />
            </button>
            {(showOlder || openedOlder) && older.filter(c => c.id !== opened).slice(0, 30).map(c => <ChatMini key={c.id} c={c} col={col} now={now} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function BrowserStrip() {
  const hidden = ui.use(s => s.hidden, sameList);
  const tabs = useApp(s => s.tabs.filter(t => !t.ownerChatId || !hidden.includes(t.ownerChatId)), sameList);
  const owners = useApp(s => tabs.map(t => (t.ownerChatId ? s.chats[t.ownerChatId]?.title ?? '' : '')), sameList);
  if (!tabs.length) return null;
  return (
    <section className="strip" aria-label="Browser al lavoro" data-testid="browser-strip">
      <div className="col-head"><span className="col-title">Browser al lavoro</span><span className="col-count">{tabs.length}</span><span className="sp" /><span className="col-hint">clic = grande accanto alla sua chat</span></div>
      <div className="thumbs">
        {tabs.map((t, i) => (
          <button key={t.id} type="button" className="thumb" onClick={() => setPair(t.id)} data-testid={`thumb-${t.id}`} aria-label={`${t.title}${owners[i] ? `, guidato da ${owners[i]}` : ''}: ingrandisci`}>
            <span className="thumb-img">{t.thumb ? <img src={t.thumb} alt="" draggable={false} />
              : t.loading ? <span className="thumb-empty"><IconGlobe size={18} /></span>
              : <span className="thumb-info" data-testid={`thumb-info-${t.id}`}><b>{t.title || 'Pagina'}</b><span>{t.url}</span></span>}</span>
            <span className="thumb-cap"><span className="thumb-title">{t.lastAction ?? t.title}</span><span className="thumb-owner">{owners[i] || 'tua'}</span></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Pair({ tabId }: { tabId: string }) {
  const tab = useApp(s => s.tabs.find(t => t.id === tabId));
  const split = ui.use(s => s.prefs.pairSplit);
  const ref = useRef<HTMLDivElement>(null);
  if (!tab) return null;
  const owner = tab.ownerChatId;
  return (
    <div className="pair" data-testid="corsie-pair">
      <div className="pair-bar">
        <button type="button" className="btn btn-ghost btn-s" onClick={() => setPair(null)} data-testid="pair-back"><IconArrowLeft size={13} /> Corsie</button>
        <span className="pair-hint"><Kbd>Esc</Kbd> per tornare</span>
      </div>
      <div className="pair-body" ref={ref} style={{ gridTemplateColumns: owner ? `minmax(0, ${split}fr) 8px minmax(0, ${1 - split}fr)` : '1fr' }}>
        {owner && <ChatTile chatId={owner} />}
        {owner && (
          <div className="splitter v static" role="separator" aria-orientation="vertical" aria-label="Ridimensiona" tabIndex={0}
            onPointerDown={e => {
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              const box = ref.current?.getBoundingClientRect();
              const move = (ev: PointerEvent) => { if (box) setPrefs({ pairSplit: Math.min(0.75, Math.max(0.25, (ev.clientX - box.left) / box.width)) }); };
              const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
              el.addEventListener('pointermove', move);
              el.addEventListener('pointerup', up);
            }}
            onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPrefs({ pairSplit: Math.min(0.75, Math.max(0.25, split + (e.key === 'ArrowLeft' ? -0.03 : 0.03))) }); } }} />
        )}
        <BrowserTile tabId={tabId} />
      </div>
    </div>
  );
}

export function Corsie() {
  const now = useNow(60_000);
  const hidden = ui.use(s => s.hidden, sameList);
  const pair = ui.use(s => s.pair);
  const maximized = ui.use(s => s.maximized);
  const cols = useApp(s => {
    const c = corsie(s, now);
    const f = (l: ChatSummary[]) => l.filter(x => !hidden.includes(x.id));
    return { waiting: f(c.waiting), working: f(c.working), done: f(c.done), older: f(c.older) };
  }, (a, b) => sameList(a.waiting, b.waiting) && sameList(a.working, b.working) && sameList(a.done, b.done) && sameList(a.older, b.older));

  if (maximized && maximized !== 'regia') {
    const [kind, id] = [maximized.slice(0, maximized.indexOf(':')), maximized.slice(maximized.indexOf(':') + 1)];
    return <div className="corsie" data-testid="view-corsie"><div className="mosaic-max" data-testid="maximized" data-key={maximized}>{kind === 'chat' ? <ChatTile chatId={id} maximized /> : <BrowserTile tabId={id} maximized />}</div></div>;
  }
  if (pair) return <div className="corsie" data-testid="view-corsie"><Pair tabId={pair} /></div>;
  const nWait = Math.min(cols.waiting.length, 3);
  return (
    <div className="corsie" data-testid="view-corsie">
      <div className="corsie-cols">
        <Column col="waiting" title="Ti aspettano" hint="più vecchia prima" chats={cols.waiting} maxOpen={3} indexBase={0}
          empty={<><b>Nessuno ti aspetta</b><span>Le domande e i permessi arrivano qui, la più vecchia in alto.</span></>} />
        <Column col="working" title="Al lavoro" chats={cols.working} maxOpen={3} indexBase={nWait}
          empty={<><b>Nessuna chat al lavoro</b><span>Avviane una con <Kbd>Ctrl</Kbd><Kbd>N</Kbd>.</span></>} />
        <Column col="done" title="Finite oggi" hint="si archiviano da sole" chats={cols.done} older={cols.older} maxOpen={1} indexBase={nWait + Math.min(cols.working.length, 3)}
          empty={<><b>Ancora niente di finito oggi</b><span>Le chat finite si raccolgono qui.</span></>} />
      </div>
      <BrowserStrip />
    </div>
  );
}
