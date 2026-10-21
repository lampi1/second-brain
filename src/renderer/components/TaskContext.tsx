// Compact task authority and explicit conversation links. Used by expanded work tiles; drafts preserve user intent.
import type { ChatSummary } from '@shared/contract';
import { useApp } from '../store/store';
import { requestFocus, setChatExpanded } from '../store/ui';
import { setDraft } from './ChatInput';
import { t } from '../i18n';

export function TaskContext({ chat, onContinue }: { chat: ChatSummary; onContinue(): void }) {
  const orchestratorId = useApp(s => Object.values(s.chats).find(c => c.isOrchestrator && !c.closedAt)?.id);
  const run = chat.run;
  if (!run || chat.isOrchestrator) return null;
  const reference = `[Task ${run.taskId ?? run.runId} · v${run.taskVersion ?? 1} · run ${run.runId} · chat ${chat.id}]`;
  return <details className="task-context" data-testid="task-context">
    <summary>{t('chat.taskContext')} · v{run.taskVersion ?? 1} · {chat.agent?.name ?? chat.title}</summary>
    <p>{run.taskContract?.goal ?? run.goal}</p>
    {!!run.taskContract?.doneWhen.length && <ul>{run.taskContract.doneWhen.map((criterion, i) => <li key={i}>{criterion}</li>)}</ul>}
    {run.report && <p>{t('chat.taskLastResult')}: {run.report.summary}</p>}
    <div className="task-context-actions">
      <button type="button" onClick={onContinue}>{t('chat.taskContinue')}</button>
      {orchestratorId && <button type="button" onClick={() => {
        setDraft(orchestratorId, `${reference}\n${t('chat.taskAskDraft')}`);
        setChatExpanded(orchestratorId, true); requestFocus(orchestratorId);
      }}>{t('chat.taskAskOrchestrator')}</button>}
    </div>
  </details>;
}
