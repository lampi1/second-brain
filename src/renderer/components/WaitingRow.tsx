// «Stai aspettando» (ADR 0367): one quiet row under the Orchestrator's topic pills with the chats the user waits for:
// the root chats the Orchestrator opened or assigned while answering his own message (main's userWaits, mirrored as
// ChatSummary.userWait). Each is a coloured dot and coloured text, no box (owner, 2026-11-27): its plan step or state
// while it works, a green ✓ «finito» for half an hour after its result reached the Orchestrator. A click opens the chat.
// Nothing waited for: no row. Used by OrchestratorTile.tsx; the list and the words come from lib/orch-lines.ts.
import { memo } from 'react';
import type { ChatSummary } from '@shared/contract';
import { useApp } from '../store/store';
import { sameList } from '../store/state';
import { openChatRef } from '../actions';
import { useTick } from '../lib/use-tick';
import { t } from '../i18n';
import { waitedChats, waitStatus, type WaitStatus } from '../lib/orch-lines';

const statusText = (w: WaitStatus): string => w.kind === 'done' ? t('chat.waiting.done') : w.kind === 'step' ? t('chat.waiting.step', { done: w.done, total: w.total }) : t(`chat.waiting.state.${w.state}`);
const tone = (w: WaitStatus): string => w.kind === 'done' ? 'done' : w.kind === 'step' ? 'run' : w.state === 'running' ? 'run' : w.state === 'waiting' ? 'wait' : w.state === 'error' ? 'err' : 'idle';

export function WaitingChips({ chats }: { chats: readonly ChatSummary[] }) {
  if (!chats.length) return null;
  return (
    <div className="oc-waiting" role="group" aria-label={t('chat.waiting.label')} data-testid="orchestrator-waiting">
      <span className="oc-waiting-k">{t('chat.waiting.label')}</span>
      {chats.map(c => {
        const w = waitStatus(c);
        return (
          <button key={c.id} type="button" className={`oc-wchip oc-t-${tone(w)}`} onClick={() => openChatRef(c.id)} data-testid="orchestrator-waiting-chip" data-chat-id={c.id} title={c.title}>
            {w.kind === 'done' ? <span aria-hidden="true">✓</span> : <span className="oc-wdot" aria-hidden="true" />}
            <span className="oc-wt">{c.title}</span><span className="oc-ws">· {statusText(w)}</span>
          </button>
        );
      })}
    </div>
  );
}

export const WaitingRow = memo(function WaitingRow() {
  const now = useTick(60_000);
  const chats = useApp(s => waitedChats(Object.values(s.chats).filter((c): c is ChatSummary => !!c), now), sameList);
  return <WaitingChips chats={chats} />;
});
