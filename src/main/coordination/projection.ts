// One evidence-backed work projection for Workflows.list and app_digest. Chat closure never completes a job.
import type { ChatSummary, PendingRequest } from '../../shared/contract';
import type { WorkThread } from '../../shared/workflows';
import type { RequestRecord, WorkProjection } from './model';
import type { AssignmentProjection } from './assignments';

export type ProjectedWork = WorkThread & { coordination: WorkProjection };
/** Plain/Orchestrator chats have requests without role runs. Recovery still makes those requests visible as a job. */
export function projectRequestJob(requests: RequestRecord[], chats: readonly ChatSummary[], pending: readonly PendingRequest[]): ProjectedWork {
  const first = requests[0]!;
  const title = (first.payload as { title?: string } | null)?.title || `Richiesta ${first.kind}`;
  const row: WorkThread = { id: first.key.jobId, version: first.key.taskVersion, title, profile: 'investigation', priority: 'normal',
    chatIds: [...new Set(requests.map(r => r.key.chatId))], stage: 'analysis', status: 'active', summary: 'Richieste e ricevute conservate dal sistema',
    waitingOn: '', nextAction: 'Verificare la richiesta originale e la sua ricevuta prima di riprendere', evidence: first.id,
    cycles: 0, createdAt: Math.min(...requests.map(r => r.at)), updatedAt: Math.max(...requests.map(r => r.decision?.at ?? r.at)), events: [] };
  return projectWork(row, chats, pending, requests);
}
/** Unlinked root assignments are durable jobs too. This read model never creates a workflow or fabricates completion. */
export function projectAssignment(a: AssignmentProjection, chats: readonly ChatSummary[], pending: readonly PendingRequest[], requests: readonly RequestRecord[]): ProjectedWork {
  const row: WorkThread = { id: a.taskId, version: a.taskVersion, title: a.title, profile: 'investigation', priority: 'normal', chatIds: [a.chatId],
    stage: 'analysis', status: a.state === 'done' ? 'done' : a.state === 'blocked' ? 'blocked' : 'active', summary: a.evidence, waitingOn: '',
    nextAction: a.state === 'reported' ? 'Verificare il report e decidere il prossimo incarico' : a.state === 'done' ? '' : 'Verificare lo stato dell’incarico prima di riprendere',
    evidence: a.evidence, cycles: 0, createdAt: a.startedAt, updatedAt: a.endedAt ?? a.startedAt, events: [] };
  const out = projectWork(row, chats, pending, requests);
  out.coordination.evidence.unshift({ source: 'run', id: a.runId, detail: a.evidence });
  if (!out.coordination.assignments.length) out.coordination.assignments.push({ chatId: a.chatId, runId: a.runId, taskVersion: a.taskVersion, closed: true });
  if (out.coordination.state === 'active') out.coordination.state = a.state;
  return out;
}
export function projectWork(row: WorkThread, chats: readonly ChatSummary[], pending: readonly PendingRequest[], requests: readonly RequestRecord[]): ProjectedWork {
  const linked = chats.filter(c => row.chatIds.includes(c.id));
  const asks = pending.filter(p => row.chatIds.includes(p.chatId));
  const durable = requests.filter(r => r.key.jobId === row.id);
  const evidence: WorkProjection['evidence'] = [{ source: 'workflow', id: row.id, detail: row.evidence || row.summary }];
  const waiting = asks.map(p => `${p.type}: ${p.title}`);
  for (const r of durable) {
    if (r.state === 'pending' && !asks.some(a => a.id === r.key.originalRequestId)) waiting.push(`Richiesta conservata: ${r.kind} (${r.key.originalRequestId})`);
    if (r.state === 'accepted' && r.kind !== 'workflow' && r.delivery?.state !== 'delivered') {
      evidence.push({ source: 'request', id: r.id, detail: `Decisione registrata; consegna ${r.delivery?.state ?? 'non iniziata'}. Nessuna riesecuzione automatica.` });
    }
  }
  for (const c of linked) {
    if (c.run) evidence.push({ source: 'run', id: c.run.runId, detail: c.run.report ? `Report agente: ${c.run.report.outcome}; ${c.run.report.summary}` : `Incarico v${c.run.taskVersion ?? 1}; ${c.run.endedAt === undefined ? 'aperto' : 'terminato'}` });
    if (c.closedAt || c.state === 'closed') evidence.push({ source: 'chat', id: c.id, detail: 'Chat chiusa: non prova il completamento del lavoro.' });
  }
  const uncertain = durable.some(r => r.state === 'accepted' && r.kind !== 'workflow' && r.delivery?.state !== 'delivered');
  const allClosed = linked.length > 0 && linked.length === row.chatIds.length && linked.every(c => !!c.closedAt || c.state === 'closed');
  const state: WorkProjection['state'] = waiting.length || row.status === 'approval' ? 'waiting-user'
    : row.status === 'done' ? 'done'
    : row.status === 'blocked' || uncertain || allClosed || linked.some(c => c.state === 'error') ? 'blocked'
    : linked.length && linked.every(c => !!c.run?.report) ? 'reported' : 'active';
  const waitingOn = waiting.join(' · ') || row.waitingOn || (uncertain ? 'Consegna da verificare' : allClosed ? 'Nessuna chat attiva' : '');
  const nextAction = uncertain ? 'Verificare la ricevuta di consegna prima di riprendere' : allClosed && row.status !== 'done' ? 'Assegnare esplicitamente la continuazione del lavoro' : row.nextAction;
  return { ...structuredClone(row), status: state === 'waiting-user' ? 'approval' : state === 'reported' ? 'active' : state, waitingOn, nextAction, coordination: {
    state, waitingOn, nextAction,
    evidence, assignments: linked.map(c => ({ chatId: c.id, runId: c.run?.runId ?? null, taskVersion: c.run?.taskVersion ?? 1, closed: !!c.closedAt || c.state === 'closed' })),
    requests: durable.map(({ id, key, state, decision, delivery }) => ({ id, key, state, ...(decision ? { decision } : {}), ...(delivery ? { delivery } : {}) })),
  } };
}
