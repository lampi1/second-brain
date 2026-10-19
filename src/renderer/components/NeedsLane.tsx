// "Ti aspettano · N": every open question and permission, oldest first, as small cards answerable in place with
// 1-9 / Enter / Esc (focus a card with Ctrl+J or a click). Answering here never opens the chat. Hidden when nothing
// waits, and while "Rispondi dopo" is on (they wait in "Da rispondere", lib/later.ts). A polite live region announces new requests to screen readers. Used by App.tsx (focus mode's Ctrl+J peek only: the workspace dropped it on 2026-10-12).
import { memo } from 'react';
import type { PendingRequest } from '@shared/contract';
import { chatName } from '@shared/orchestrator';
import { sameList } from '../store/state';
import { useApp } from '../store/store';
import { ui } from '../store/ui';
import { answerLater } from '../lib/later';
import { t } from '../i18n';
import { RequestPanel } from './RequestPanel';
import { Keys } from './ui';

const LaneCard = memo(function LaneCard({ req }: { req: PendingRequest }) {
  const chat = useApp(s => s.chats[req.chatId]);
  return (
    <div role="listitem" className="lane-item">
      <RequestPanel req={req} variant="lane" chatTitle={chat ? chatName(chat) : 'Chat'} harness={chat?.harness ?? 'claude'} onLater={answerLater} />
    </div>
  );
});

export function NeedsLane({ peek }: { peek?: boolean }) {
  const hidden = ui.use(s => s.hidden, sameList);
  const later = ui.use(s => s.later);
  const pending = useApp(s => s.pending.filter(p => !hidden.includes(p.chatId)), sameList);
  if (pending.length === 0 || later) return null;
  return (
    <section className={`lane ${peek ? 'peek' : ''}`} aria-label={t('dialogs.needsLane.label', { count: pending.length })} data-testid="needs-lane">
      <div className="lane-label">
        <span className="lane-title">{t('dialogs.needsLane.title')}</span>
        <span className="lane-count" data-testid="needs-count">{pending.length}</span>
      </div>
      <div className="lane-cards" role="list">
        {pending.map(p => <LaneCard key={`${p.chatId}/${p.id}`} req={p} />)}
      </div>
      <div className="lane-keys" aria-hidden="true">
        <span><Keys combo="Ctrl+J" /> {t('dialogs.needsLane.nextKey')}</span>
        <span><Keys combo={t('dialogs.needsLane.answerCombo')} /> {t('dialogs.needsLane.respondKeys')}</span>
      </div>
    </section>
  );
}

/** Screen-reader announcements (new questions, permissions). */
export function LiveRegion() {
  const text = ui.use(s => s.announce);
  return <div className="sr-only" role="status" aria-live="polite" data-testid="live-region">{text}</div>;
}
