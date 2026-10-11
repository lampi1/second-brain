// "Ti aspettano · N": every open question and permission, oldest first, as small cards answerable in place with
// 1-9 / Enter / Esc (focus a card with Ctrl+J or a click). Answering here never opens the chat. Hidden when nothing
// waits. A polite live region announces new requests to screen readers. Used by App.tsx (Mosaico, focus-mode peek).
import { memo } from 'react';
import type { PendingRequest } from '@shared/contract';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { ui } from '../store/ui';
import { RequestPanel } from './RequestPanel';
import { Kbd, Keys } from './ui';

const LaneCard = memo(function LaneCard({ req }: { req: PendingRequest }) {
  const chat = useApp(s => s.chats[req.chatId]);
  return (
    <div role="listitem" className="lane-item">
      <RequestPanel req={req} variant="lane" chatTitle={chat?.isRegia ? 'Regia' : (chat?.title ?? 'Chat')} harness={chat?.harness ?? 'claude'} />
    </div>
  );
});

export function NeedsLane({ peek }: { peek?: boolean }) {
  const hidden = ui.use(s => s.hidden, sameList);
  const pending = useApp(s => s.pending.filter(p => !hidden.includes(p.chatId)), sameList);
  if (pending.length === 0) return null;
  return (
    <section className={`lane ${peek ? 'peek' : ''}`} aria-label={`Ti aspettano: ${pending.length}`} data-testid="needs-lane">
      <div className="lane-label">
        <span className="lane-title">Ti aspettano</span>
        <span className="lane-count" data-testid="needs-count">{pending.length}</span>
      </div>
      <div className="lane-cards" role="list">
        {pending.map(p => <LaneCard key={`${p.chatId}/${p.id}`} req={p} />)}
      </div>
      <div className="lane-keys" aria-hidden="true">
        <span><Keys combo="Ctrl+J" /> prossima</span>
        <span><Kbd>1-9</Kbd><Kbd>Invio</Kbd><Kbd>Esc</Kbd> rispondi</span>
      </div>
    </section>
  );
}

/** Screen-reader announcements (new questions, permissions). */
export function LiveRegion() {
  const text = ui.use(s => s.announce);
  return <div className="sr-only" role="status" aria-live="polite" data-testid="live-region">{text}</div>;
}
