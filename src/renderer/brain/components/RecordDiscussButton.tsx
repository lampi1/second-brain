// The "Discuti" button of a DevOps record (work item, PR, test plan, test case): one click opens the Orchestrator next to
// the page with a ready draft about the record (lib/record-discuss.ts: title, type, state, link, numbers, area, folder
// hint), not sent: the user edits it and sends it with Enter. It never creates a work chat: the Orchestrator decides and
// delegates (owner, 2026-10-19). Once sent, a small "Discusso" mark beside the button leads back to the Orchestrator.
// Hidden without the app (the brain's standalone test route). Used by pages/Task.tsx and pages/TaskQa.tsx.
import { useContext, type MouseEvent } from 'react';
import { useTasks } from '../../store/tasks';
import { t } from '../../i18n';
import { fmt } from '../lib/format';
import { recordDiscussText, recordId, recordKey, recordTitle, type DevopsRecord } from '../lib/record-discuss';
import { DiscussContext, IconChat, IconCheck, localDay, markDiscussed, useDiscussed } from './Discuss';
import { toast } from './ui';

export function RecordDiscussButton({ rec }: { rec: DevopsRecord }) {
  const bridge = useContext(DiscussContext);
  const repoDirs = useTasks(s => s?.repoDirs);
  const key = recordKey(rec);
  const last = useDiscussed()[key]?.[0];
  if (!bridge) return null;
  const tid = `task-discuss-${rec.kind}-${recordId(rec)}`;
  // inside a <summary>: the row must not open or close
  const stop = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const discuss = (e: MouseEvent) => {
    stop(e);
    const ok = bridge.draftToOrchestrator(recordDiscussText(rec, repoDirs ?? {}),
      chat => markDiscussed(key, { via: 'orchestrator', chatId: chat.id, chatTitle: chat.title, at: Date.now() }));
    if (!ok) toast(t('brainPages.discuss.errorOrchestratorNotOpen'));
  };
  return (
    <span className="dv-chat">
      <button type="button" className="bx-btn s" onClick={discuss} title={t('brainPages.recordDiscuss.title')}
        aria-label={t('brainPages.discuss.discussButtonLabel', { topic: recordTitle(rec) })} data-testid={tid}>
        <IconChat /> {t('brainPages.discuss.discussBtn')}
      </button>
      {last && (
        <button type="button" className="bx-go small dv-discussed" data-testid={`${tid}-mark`}
          title={t('brainPages.recordDiscuss.markTitle', { day: fmt.day(localDay(last.at)) })}
          onClick={e => { stop(e); bridge.showChat(last.chatId); }}>
          <IconCheck /> {t('brainPages.discuss.discussedNeutral')}
        </button>
      )}
    </span>
  );
}
