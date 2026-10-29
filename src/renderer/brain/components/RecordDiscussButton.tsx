// The "Discuti" button of a DevOps record (work item, PR, test plan, test case): one click opens the Orchestrator next to
// the page with a ready draft about the record (lib/record-discuss.ts: title, type, state, link, numbers, area, folder
// hint), not sent: the user edits it and sends it with Enter. It never creates a work chat: the Orchestrator decides and
// delegates (owner, 2026-10-19). Once sent, a small "Discusso" mark beside the button leads back to the Orchestrator.
// Beside it on a PR or a work item, «Capiscila» (ADR 0190): Impara's start opens filled in with it (lib/impara.ts
// learnAbout), the user starts the lesson with one click.
// Hidden without the app (the brain's standalone test route). Used by pages/Task.tsx and pages/TaskQa.tsx.
import { useContext, type MouseEvent } from 'react';
import { useTasks } from '../../store/tasks';
import { t } from '../../i18n';
import { fmt } from '../lib/format';
import { recordDiscussText, recordId, recordKey, recordTitle, type DevopsRecord } from '../lib/record-discuss';
import { DiscussContext, IconChat, IconCheck, localDay, markDiscussed, useDiscussed } from './Discuss';
import { toast } from './ui';
import { learnAbout } from '../../lib/impara';
import { IconLearn } from '../../components/Icons';

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
  const learn = (e: MouseEvent) => {
    stop(e);
    if (rec.kind === 'pr') learnAbout({ kind: 'pr', ask: '', prUrl: rec.pr.url, from: t('impara.fromTask') });
    else if (rec.kind === 'workitem') learnAbout({ kind: 'topic', ask: t('impara.askWorkItem', { id: rec.item.id, title: rec.item.title, type: rec.item.type, project: rec.item.project }).slice(0, 600), from: t('impara.fromTask') });
  };
  return (
    <span className="dv-chat">
      {(rec.kind === 'pr' || rec.kind === 'workitem') && (
        <button type="button" className="bx-btn s" onClick={learn} title={t('impara.learnRecordTip')} aria-label={`${t('impara.learnRecord')}: ${recordTitle(rec)}`} data-testid={`task-learn-${rec.kind}-${recordId(rec)}`}>
          <IconLearn size={12} /> {t('impara.learnRecord')}
        </button>
      )}
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
