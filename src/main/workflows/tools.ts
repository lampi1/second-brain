// Authenticated Orchestrator tools for durable threads; there is deliberately no agent approval tool.
import type { ToolDef } from '../appctl/tools';
import type { Workflows } from './service';
import type { ChatSummary } from '../../shared/contract';
import type { WorkCreate, WorkReport } from '../../shared/workflows';
export function workflowTools(service: Workflows, knownChat: (id: string) => boolean, chat?: (id: string) => ChatSummary | undefined): ToolDef[] {
  const string = { type: 'string' }, chats = { type: 'array', items: string, maxItems: 40 };
  const checkChats = (a: Record<string, unknown>) => {
    if (a.chatIds !== undefined && (!Array.isArray(a.chatIds) || a.chatIds.some(id => typeof id !== 'string' || !knownChat(id)))) throw new Error('Collega solo chat visibili già esistenti.');
  };
  return [
    { name: 'app_work_list', description: 'Read persistent feature threads, priorities, stage, proposals and evidence. Threads survive closed chats. No model calls.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, run: () => service.list() },
    { name: 'app_work_create', description: 'Create ONE persistent thread for a feature, bugfix or investigation. Link related root chats across repositories. Reuse an existing thread for review/rework. Production and support priority first.', inputSchema: { type: 'object', properties: { title: string, profile: { enum: ['feature', 'bugfix', 'investigation'] }, priority: { enum: ['production', 'support', 'normal'] }, chatIds: chats }, required: ['title', 'profile', 'priority', 'chatIds'], additionalProperties: false }, run: a => { checkChats(a); return service.create(a as unknown as WorkCreate); } },
    { name: 'app_work_report', description: 'Update the thread using its current version. complete requires concrete evidence; develop completion requires implementationChatId, review completion requires reviewChatId whose reviewOf matches that implementation run/version; mockup/plan/deploy require a user-approved proposal first. propose displays a Sì / No / free-text decision in the shared questions modal (never approve it yourself). Keep summary short but explanatory with the exact action and scope; put detailed evidence in a linked report and include screenshot paths when useful. fail after review/test/QA returns to development in the SAME thread; after 3 failures it blocks for a revised proposal. A blocked thread needs a new proposal before continuing. Link new root review chats with chatIds. These records grant no tool permissions or production authority.', inputSchema: { type: 'object', properties: { id: string, expectedVersion: { type: 'integer' }, action: { enum: ['update', 'complete', 'propose', 'fail', 'block'] }, summary: string, priority: { enum: ['production', 'support', 'normal'] }, reviewChatId: string, implementationChatId: string, waitingOn: string, nextAction: string, evidence: string, chatIds: chats }, required: ['id', 'expectedVersion', 'action', 'summary'], additionalProperties: false }, run: a => {
      checkChats(a);
      if ('implementation' in a) throw new Error('Implementation receipts are host-owned.');
      const row = service.list().find(r => r.id === a.id);
      let implementation: WorkReport['implementation'];
      if (a.action === 'complete' && row?.stage === 'develop') {
        const worker = typeof a.implementationChatId === 'string' && knownChat(a.implementationChatId) ? chat?.(a.implementationChatId) : undefined;
        if (!worker?.run || !row.chatIds.includes(worker.id) || worker.agent?.id === 'sentinel') throw new Error('Indica la chat di implementazione collegata (implementationChatId).');
        implementation = { chatId: worker.id, runId: worker.run.runId, taskVersion: worker.run.taskVersion ?? 1 };
      }
      if (a.action === 'complete' && row?.stage === 'review') {
        const reviewer = typeof a.reviewChatId === 'string' && knownChat(a.reviewChatId) ? chat?.(a.reviewChatId) : undefined;
        const implementation = row.events.filter(e => e.stage === 'develop' && e.kind === 'completed').at(-1);
        const report = reviewer?.run?.report;
        if (!reviewer || !row.chatIds.includes(reviewer.id) || reviewer.agent?.id !== 'sentinel' || !report || report.outcome !== 'done' || report.verified !== 'yes'
          || report.verdict === 'fail' || report.blocking || !implementation || report.at < implementation.at
          || !row.implementation || reviewer.run?.reviewOf !== row.implementation.runId
          || chat?.(row.implementation.chatId)?.run?.runId !== row.implementation.runId
          || (chat?.(row.implementation.chatId)?.run?.taskVersion ?? 1) !== row.implementation.taskVersion)
          throw new Error('Serve una review Sentinel collegata, verificata e successiva all’ultima implementazione (reviewChatId).');
      }
      return service.report({ ...a, ...(implementation ? { implementation } : {}) } as unknown as WorkReport);
    } },
  ];
}
