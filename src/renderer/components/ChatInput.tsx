// The always-visible input of every tile: Enter sends, Shift+Enter is a new line; while the chat is busy or waiting
// on a request the message is queued (shown as chips with ✕) and sent when the chat goes idle. Drafts survive view
// switches and remounts (kept per chat in memory). Used by ChatTile and RegiaTile.
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { isBusy } from '../store/state';
import { send, unqueue, useApp } from '../store/store';
import { IconSend, IconX } from './Icons';
import { Kbd } from './ui';

const drafts = new Map<string, string>();
const EMPTY: readonly string[] = [];

export interface ChatInputHandle { focus(): void }

export const ChatInput = forwardRef<ChatInputHandle, { chat: ChatSummary; regia?: boolean; testid: string }>(function ChatInput({ chat, regia, testid }, handle) {
  const [text, setText] = useState(() => drafts.get(chat.id) ?? '');
  const ta = useRef<HTMLTextAreaElement>(null);
  const queued = useApp(s => s.queued[chat.id] ?? EMPTY);
  useImperativeHandle(handle, () => ({ focus: () => ta.current?.focus() }), []);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);
  const busy = isBusy(chat) || chat.state === 'waiting' || chat.pending > 0;
  const placeholder = regia ? 'Scrivi alla Regia…' : chat.pending > 0 ? 'Rispondi sopra o scrivi…' : busy ? 'Scrivi: va in coda…' : chat.state === 'closed' ? 'Scrivi per riprendere la chat…' : 'Scrivi a questa chat…';
  const submit = () => {
    const r = send(chat.id, text);
    if (r === 'empty') return;
    setText('');
    drafts.delete(chat.id);
  };
  return (
    <div className={`composer ${regia ? 'composer-regia' : ''}`}>
      {queued.length > 0 && (
        <div className="queued" aria-label="Messaggi in coda">
          {queued.map((q, i) => (
            <span className="queued-chip" key={`${i}-${q}`} data-testid={`${testid}-queued-${i}`}>
              <span className="queued-k">in coda</span><span className="queued-t">{q}</span>
              <button type="button" aria-label="Togli dalla coda" onClick={() => unqueue(chat.id, i)} data-testid={`${testid}-unqueue-${i}`}><IconX size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-box">
        <textarea
          ref={ta} rows={1} value={text} placeholder={placeholder} aria-label={regia ? 'Messaggio alla Regia' : `Messaggio a ${chat.title}`} data-testid={testid} spellCheck={false}
          onChange={e => { setText(e.target.value); drafts.set(chat.id, e.target.value); }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
        />
        {text.trim() ? (
          <button type="button" className="send" onClick={submit} aria-label={busy ? 'Metti in coda' : 'Invia'} data-tip={busy ? 'Metti in coda|Invio' : 'Invia|Invio'} data-testid={`${testid}-send`}><IconSend size={14} /></button>
        ) : (
          <span className="composer-hint" aria-hidden="true">{busy && !regia ? 'in coda' : ''} <Kbd>Invio</Kbd></span>
        )}
      </div>
    </div>
  );
});
