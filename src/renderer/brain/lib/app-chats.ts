// The app's chats, live, for the brain pages and their components (Costi, Fatto, Discuss, Stats): chat:list once,
// then chat:updated / chat:removed.
import { useEffect, useState } from 'react';
import type { ChatSummary } from '@shared/contract';

/** The app's chats, live (null while the first list is loading, [] when it failed). */
export function useAppChats(): ChatSummary[] | null {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => window.sb.invoke('chat:list', undefined).then(c => { if (alive) setChats(c); }, () => { if (alive) setChats([]); });
    load();
    const offs = [window.sb.on('chat:updated', c => setChats(x => (x ? (x.some(y => y.id === c.id) ? x.map(y => (y.id === c.id ? c : y)) : [...x, c]) : x))),
      window.sb.on('chat:removed', ({ chatId }) => setChats(x => x?.filter(y => y.id !== chatId) ?? x))];
    return () => { alive = false; for (const off of offs) off(); };
  }, []);
  return chats;
}
