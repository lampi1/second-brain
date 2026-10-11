// The Regia: the user's always-on coordinating chat, a fixed violet tile on the left with its own name. Its input has
// the default focus; its open questions show as "decisione" cards; below, a digest of the live brain feed ("Novità",
// with "mentre eri via" first; collapsible, remembered). With no Regia yet it offers to create one.
// Used by App.tsx (the left column of both views).
import { memo, useEffect, useRef } from 'react';
import type { FeedEvent } from '@shared/contract';
import { ago, chatCost, effortLabel, prettyModel } from '../lib/format';
import { useNow } from '../lib/clock';
import { isBusy, sameList } from '../store/state';
import { stop, useApp } from '../store/store';
import { openModal, setFocused, setPrefs, setRegiaDock, ui } from '../store/ui';
import { linkOfEvent } from '../lib/notify';
import { openLink, toggleMaximize } from '../actions';
import { ItemList, turnActivity, Typing } from './ChatItems';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { pendingOf, useFlash } from './ChatTile';
import { RequestPanel } from './RequestPanel';
import { HarnessMark, IconChevronDown, IconMaximize, IconMinimize, IconPlus, IconStop, IconX } from './Icons';
import { IconButton, StatePill } from './ui';

const TONE: Record<string, string> = {
  idea: 'blue', error: 'red', win: 'green', 'chat-done': 'green', 'chat-waiting': 'amber', reflection: 'violet', journal: 'dim',
};

function FeedRow({ e, now }: { e: FeedEvent; now: number }) {
  const open = () => { openLink(linkOfEvent(e)); };
  return (
    <li>
      <button type="button" className={`feed-row tone-${TONE[e.kind] ?? 'dim'} ${e.priority}`} onClick={open} data-testid={`feed-${e.id}`} data-sb-id={`feed-${e.id}`} title={e.detail}>
        <span className="feed-k">{e.label}</span>
        <span className="feed-t">{e.title}</span>
        <span className="feed-age">{ago(e.at, now)}</span>
      </button>
    </li>
  );
}

const EMPTY: readonly FeedEvent[] = [];

export const RegiaTile = memo(function RegiaTile({ maximized, docked }: { maximized?: boolean; docked?: boolean }) {
  const id = useApp(s => s.order.find(x => s.chats[x]?.isRegia) ?? null);
  const chat = useApp(s => (id ? s.chats[id] : undefined));
  const items = useApp(s => (id ? s.items[id] : undefined));
  const reqs = useApp(s => (id ? pendingOf(s.pending, id) : []), sameList);
  const ready = useApp(s => s.ready);
  const feed = useApp(s => s.feed.slice(0, 12), sameList) ?? EMPTY;
  const feedOpen = ui.use(s => s.prefs.feedOpen);
  const isFocused = ui.use(s => s.focused === 'regia');
  const focusReq = ui.use(s => (id && s.focusReq?.chatId === id ? s.focusReq.n : 0));
  const flash = useFlash('regia');
  const input = useRef<ChatInputHandle>(null);
  const now = useNow(15_000);
  // the Regia's input has the default focus (once the chat exists)
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!chat || focusedOnce.current) return;
    focusedOnce.current = true;
    if (!document.activeElement || document.activeElement === document.body) input.current?.focus();
  }, [chat]);
  useEffect(() => { if (focusReq) input.current?.focus(); }, [focusReq]);

  const away = feed.filter(e => e.away);
  const fresh = feed.filter(e => !e.away).slice(0, 8);

  if (!chat) {
    return (
      <section className="tile regia-tile empty" role="region" aria-label="Regia" data-testid="tile-regia">
        <header className="tile-head"><div className="th-row"><HarnessMark harness="claude" regia /><h3 className="th-title regia-name">Regia</h3></div></header>
        <div className="empty-state">
          {ready ? (
            <>
              <p className="empty-title">Nessuna Regia ancora</p>
              <p className="empty-text">La Regia è la chat che coordina le altre: le chiedi «che si fa adesso?» e ti propone una cosa alla volta.</p>
              <button type="button" className="btn btn-regia btn-m" onClick={() => openModal('newChat')} data-testid="regia-create"><IconPlus size={14} /> Crea la Regia</button>
            </>
          ) : (
            <div className="skeleton"><i /><i /><i className="short" /></div>
          )}
        </div>
      </section>
    );
  }

  const busy = isBusy(chat);
  return (
    <section className={`tile regia-tile ${isFocused ? 'focused' : ''} ${flash ? 'flash' : ''} ${docked ? 'docked' : ''}`} role="region" aria-label="Regia" data-testid={docked ? 'regia-dock' : 'tile-regia'} data-chat-id={chat.id} data-sb-id="regia"
      onFocus={() => setFocused('regia')} onPointerDown={() => setFocused('regia')}>
      <header className="tile-head">
        <div className="th-row">
          <HarnessMark harness={chat.harness} regia />
          <h3 className="th-title regia-name">Regia</h3>
          <StatePill chat={chat} testid="regia-state" />
          <span className="sp" />
          {busy && <IconButton label="Ferma" shortcut="Ctrl+." tone="danger" onClick={() => void stop(chat.id)} testid="regia-stop"><IconStop size={14} /></IconButton>}
          {docked ? (
            <IconButton label="Chiudi la Regia" shortcut="Ctrl+R" onClick={() => setRegiaDock(false)} testid="regia-dock-close"><IconX size={14} /></IconButton>
          ) : (
            <IconButton label={maximized ? 'Ripristina' : 'Ingrandisci'} shortcut={maximized ? 'Esc' : 'F11'} onClick={() => toggleMaximize('regia')} testid="regia-max">
              {maximized ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
            </IconButton>
          )}
        </div>
        <div className="th-sub"><span className="th-sub-text">{[prettyModel(chat.model, chat.harness), effortLabel(chat.effort), chatCost(chat)].filter(Boolean).join(' · ')}</span></div>
      </header>
      <ItemList items={items ?? []} empty="Chiedi alla Regia «che si fa adesso?»" footer={isBusy(chat) ? <Typing what={turnActivity(items)} testid="typing-regia" /> : null} />
      {reqs.length > 0 && (
        <div className="tile-requests regia-requests">
          {reqs.map(r => <RequestPanel key={r.id} req={r} variant="regia" chatTitle="Regia" harness={chat.harness} />)}
        </div>
      )}
      <div className={`feed ${feedOpen ? 'open' : ''}`} data-testid="regia-feed">
        <button type="button" className="feed-head" onClick={() => setPrefs({ feedOpen: !feedOpen })} aria-expanded={feedOpen} data-testid="regia-feed-toggle">
          <span>Novità</span><span className="count">{feed.length}</span><span className="sp" /><IconChevronDown size={13} className="feed-chev" />
        </button>
        {feedOpen && (
          feed.length === 0 ? <p className="feed-empty">Qui arrivano idee, errori registrati e chat finite, man mano.</p> : (
            <div className="feed-body">
              {away.length > 0 && <div className="feed-group">Mentre eri via</div>}
              {away.length > 0 && <ul className="feed-list">{away.slice(0, 4).map(e => <FeedRow key={e.id} e={e} now={now} />)}</ul>}
              {away.length > 0 && fresh.length > 0 && <div className="feed-group">Adesso</div>}
              <ul className="feed-list">{fresh.map(e => <FeedRow key={e.id} e={e} now={now} />)}</ul>
            </div>
          )
        )}
      </div>
      <ChatInput ref={input} chat={chat} regia testid={docked ? 'regia-dock-input' : 'regia-input'} />
    </section>
  );
});

