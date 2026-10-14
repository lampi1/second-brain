// Corsie view: two columns by state, "Ti aspettano" (oldest request first) and "Al lavoro" (the busy chats, then the
// finished ones until they close by themselves: AutoCloser.tsx; closed chats are found with Ctrl+K), as many full
// tiles as fit and the rest as rows (click = expand), then a strip of live browser thumbnails; the selected chat is always a full tile in its column; a click shows that browser big next to its chat (Esc returns). "Nascondi browser"
// (Ctrl+Shift+B) drops the strip and the big browser, except a tab waiting for the user (hand-off).
// Used by App.tsx.
import { memo, useRef, type ReactNode } from 'react';
import type { ChatSummary } from '@shared/contract';
import { corsie, sameList } from '../store/state';
import { useApp } from '../store/store';
import { useHandoffTabs } from '../store/handoffs';
import { openInColumn, setMaximized, setPair, setPrefs, ui } from '../store/ui';
import { BrowserTile } from './BrowserTile';
import { pairOf, pairStyle } from '../lib/pairs';
import { ChatTile } from './ChatTile';
import { HarnessMark, IconArrowLeft, IconGlobe } from './Icons';
import { Kbd, StatePill, useSize } from './ui';

type Col = 'waiting' | 'working';

const ChatMini = memo(function ChatMini({ c, col }: { c: ChatSummary; col: Col }) {
  return (
    <button type="button" className="mini" onClick={() => openInColumn(col, c.id)} data-testid={`mini-${c.id}`} aria-label={`${c.title}: apri`}>
      <HarnessMark harness={c.harness} size={16} />
      <span className="mini-title">{c.title}</span>
      <span className="sp" />
      <StatePill chat={c} />
    </button>
  );
});

function Column({ col, title, hint, chats, maxOpen, empty, indexBase }: { col: Col; title: string; hint?: string; chats: ChatSummary[]; maxOpen: number; empty: ReactNode; indexBase: number }) {
  const opened = ui.use(s => s.open[col]);
  const selected = ui.use(s => (s.focused?.startsWith('chat:') ? s.focused.slice(5) : null));
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const fit = Math.max(1, Math.min(maxOpen, Math.floor((size.height || 700) / 300)));
  let open = chats.slice(0, fit).map(c => c.id);
  if (opened && chats.some(c => c.id === opened) && !open.includes(opened)) open = [opened, ...open].slice(0, fit);
  // the selected chat stays a full tile when it changes column (it starts waiting while the user types in it: its
  // input must still be there for the focus keeper, lib/focusKeeper.ts)
  // a chat the user opened in this column by a click comes first (with room for one tile, the click wins)
  if (selected && chats.some(c => c.id === selected) && !open.includes(selected)) {
    const pin = opened && open.includes(opened) ? [opened] : [];
    open = [...pin, selected, ...open.filter(id => id !== opened)].slice(0, fit);
  }
  let idx = indexBase;
  return (
    <section className={`col col-${col}`} aria-label={`${title}: ${chats.length}`} data-testid={`col-${col}`}>
      <div className="col-head">
        <span className="col-title">{title}</span><span className="col-count">{chats.length}</span>
        <span className="sp" />{hint && <span className="col-hint">{hint}</span>}
      </div>
      <div className="col-body" ref={ref}>
        {chats.length === 0 && <div className="col-empty">{empty}</div>}
        {chats.map(c => (open.includes(c.id)
          ? <div className="col-tile" key={c.id}><ChatTile chatId={c.id} index={++idx} /></div>
          : <ChatMini key={c.id} c={c} col={col} />))}
      </div>
    </section>
  );
}

function BrowserStrip({ only }: { only: string[] | null }) {
  const hidden = ui.use(s => s.hidden, sameList);
  const tabs = useApp(s => s.tabs.filter(t => (!t.ownerChatId || (!hidden.includes(t.ownerChatId) && s.chats[t.ownerChatId]?.space !== 'app')) && (!only || only.includes(t.id))), sameList);
  const owners = useApp(s => tabs.map(t => (t.ownerChatId ? s.chats[t.ownerChatId]?.title ?? '' : '')), sameList);
  const colors = useApp(s => tabs.map(t => pairOf(s, t.ownerChatId) ?? -1), sameList);
  if (!tabs.length) return null;
  return (
    <section className="strip" aria-label="Browser al lavoro" data-testid="browser-strip">
      <div className="col-head"><span className="col-title">Browser al lavoro</span><span className="col-count">{tabs.length}</span><span className="sp" /><span className="col-hint">clic = grande accanto alla sua chat</span></div>
      <div className="thumbs">
        {tabs.map((t, i) => (
          <button key={t.id} type="button" className="thumb" onClick={() => (only ? setMaximized(`browser:${t.id}`) : setPair(t.id))} data-testid={`thumb-${t.id}`} aria-label={`${t.title}${owners[i] ? `, guidato da ${owners[i]}` : ''}: ingrandisci`}>
            <span className="thumb-img">{t.thumb ? <img src={t.thumb} alt="" draggable={false} />
              : t.loading ? <span className="thumb-empty"><IconGlobe size={18} /></span>
              : <span className="thumb-info" data-testid={`thumb-info-${t.id}`}><b>{t.title || 'Pagina'}</b><span>{t.url}</span></span>}</span>
            <span className="thumb-cap"><span className="thumb-title">{t.lastAction ?? t.title}</span><span className="thumb-owner">{colors[i]! >= 0 && <span className="pair-dot" style={pairStyle(colors[i]!)} aria-hidden="true" />}{owners[i] || 'tua'}</span></span>
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
  const hidden = ui.use(s => s.hidden, sameList);
  const pair = ui.use(s => s.pair);
  const maximized = ui.use(s => s.maximized);
  const hideBrowsers = ui.use(s => s.prefs.browsersHidden);
  const closeMin = useApp(s => s.settings?.autoCloseMin ?? 2);
  const waitingTabs = useHandoffTabs();
  const cols = useApp(s => {
    const c = corsie(s);
    const f = (l: ChatSummary[]) => l.filter(x => !hidden.includes(x.id));
    return { waiting: f(c.waiting), working: f(c.working) };
  }, (a, b) => sameList(a.waiting, b.waiting) && sameList(a.working, b.working));

  if (maximized && maximized !== 'regia') {
    const [kind, id] = [maximized.slice(0, maximized.indexOf(':')), maximized.slice(maximized.indexOf(':') + 1)];
    return <div className="corsie" data-testid="view-corsie"><div className="mosaic-max" data-testid="maximized" data-key={maximized}>{kind === 'chat' ? <ChatTile chatId={id} maximized /> : <BrowserTile tabId={id} maximized />}</div></div>;
  }
  if (pair && (!hideBrowsers || waitingTabs.includes(pair))) return <div className="corsie" data-testid="view-corsie"><Pair tabId={pair} /></div>;
  const nWait = Math.min(cols.waiting.length, 3);
  return (
    <div className="corsie" data-testid="view-corsie">
      <div className="corsie-cols">
        <Column col="waiting" title="Ti aspettano" hint="più vecchia prima" chats={cols.waiting} maxOpen={3} indexBase={0}
          empty={<><b>Nessuno ti aspetta</b><span>Le domande e i permessi arrivano qui, la più vecchia in alto.</span></>} />
        <Column col="working" title="Al lavoro" hint={closeMin > 0 ? `le finite si chiudono dopo ${closeMin} min` : undefined} chats={cols.working} maxOpen={3} indexBase={nWait}
          empty={<><b>Nessuna chat al lavoro</b><span>Avviane una con <Kbd>Ctrl</Kbd><Kbd>N</Kbd>.</span></>} />
      </div>
      <BrowserStrip only={hideBrowsers ? waitingTabs : null} />
    </div>
  );
}
