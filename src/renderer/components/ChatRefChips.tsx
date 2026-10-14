// "Apri" chips for the chats a Regia opened, wrote to or named (lib/chatrefs.ts, ADR 0034): under an app_create_chat
// row "Chat aperta «titolo» · Apri", under an app_send_to_chat row "Scritto a «titolo» · Apri", under an assistant
// message one chip per chat it names. A click brings that chat on screen from wherever the user is (actions.ts
// openChatRef: page, map, focus mode; a closed chat is reopened first); nothing moves by itself. Used by ChatItems.tsx.
import { memo } from 'react';
import { openChatRef } from '../actions';
import { useApp } from '../store/store';
import { IconArrowRight } from './Icons';

type How = 'created' | 'sent' | 'named';
const LEAD: Record<How, string | null> = { created: 'Chat aperta', sent: 'Scritto a', named: null };

/** One chat: its live title (the one the tool gave while the store has not got the chat yet), and Apri / Riapri. */
const ChatRefChip = memo(function ChatRefChip({ chatId, title }: { chatId: string; title?: string }) {
  const c = useApp(s => s.chats[chatId]);
  const name = c?.title ?? title ?? 'chat';
  const verb = c?.closedAt ? 'Riapri' : 'Apri';
  return (
    <button type="button" className="chatref-btn" onClick={() => openChatRef(chatId)} disabled={!c} data-testid="chatref-open" data-chat-id={chatId}
      data-tip={c ? `${verb} «${name}» da qui, ovunque tu sia` : 'Questa chat non c’è più'} aria-label={`${verb} la chat ${name}`}>
      <span className="chatref-t">{name}</span>
      <span className="chatref-go">{verb}<IconArrowRight size={11} /></span>
    </button>
  );
});

/** A tool row's line: what the Regia did with which chat. */
export const ToolChatRef = memo(function ToolChatRef({ chatId, title, how }: { chatId: string; title?: string; how: 'created' | 'sent' }) {
  return (
    <div className={`chatref chatref-${how}`} data-testid={`chatref-${how}`}>
      <span className="chatref-k">{LEAD[how]}</span>
      <ChatRefChip chatId={chatId} title={title} />
    </div>
  );
});

/** Under an assistant message: the chats it names. */
export const NamedChatRefs = memo(function NamedChatRefs({ ids }: { ids: readonly string[] }) {
  return (
    <div className="chatref chatref-named" data-testid="chatref-named">
      {ids.map(id => <ChatRefChip key={id} chatId={id} />)}
    </div>
  );
});
