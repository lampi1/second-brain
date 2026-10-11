// Focus mode (Ctrl+Shift+F): one chat full-window with the browsers it drives beside it; everything else reduces to
// a count ("2 ti aspettano · Ctrl+J"), so deep work is protected without losing track. Esc leaves. Used by App.tsx.
import { useRef } from 'react';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { setFocusMode, setPrefs, ui } from '../store/ui';
import { nextThing } from '../actions';
import { BrowserTile } from './BrowserTile';
import { ChatTile } from './ChatTile';
import { IconFocus } from './Icons';
import { Kbd, Keys } from './ui';

export function FocusView({ chatId }: { chatId: string }) {
  const chat = useApp(s => s.chats[chatId]);
  const tabs = useApp(s => s.tabs.filter(t => t.ownerChatId === chatId).map(t => t.id), sameList);
  const others = useApp(s => s.pending.filter(p => p.chatId !== chatId).length);
  const split = ui.use(s => s.prefs.pairSplit);
  const ref = useRef<HTMLDivElement>(null);
  if (!chat) return null;
  return (
    <div className="focus-view" data-testid="focus-view">
      <div className="focus-bar">
        <IconFocus size={14} /><span>Modalità focus</span><span className="focus-title">{chat.title}</span>
        <span className="sp" />
        {others > 0 ? (
          <button type="button" className="btn btn-amber btn-s" onClick={() => nextThing()} data-testid="focus-waiting">{others} ti aspettano <Keys combo="Ctrl+J" /></button>
        ) : <span className="focus-calm">Niente ti aspetta</span>}
        <button type="button" className="btn btn-ghost btn-s" onClick={() => setFocusMode(null)} data-testid="focus-exit">Esci <Kbd>Esc</Kbd></button>
      </div>
      <div className="focus-body" ref={ref} style={{ gridTemplateColumns: tabs.length ? `minmax(0, ${split}fr) 8px minmax(0, ${1 - split}fr)` : '1fr' }}>
        <ChatTile chatId={chatId} focus />
        {tabs.length > 0 && (
          <div className="splitter v static" role="separator" aria-orientation="vertical" aria-label="Ridimensiona" tabIndex={0}
            onPointerDown={e => {
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              const box = ref.current?.getBoundingClientRect();
              const move = (ev: PointerEvent) => { if (box) setPrefs({ pairSplit: Math.min(0.75, Math.max(0.25, (ev.clientX - box.left) / box.width)) }); };
              const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
              el.addEventListener('pointermove', move);
              el.addEventListener('pointerup', up);
            }} />
        )}
        {tabs.length > 0 && <div className="focus-browsers">{tabs.map(t => <BrowserTile key={t} tabId={t} />)}</div>}
      </div>
    </div>
  );
}
