// Durable work threads independent of chat lifetime. Gates are decided only through renderer IPC.
// Stage reports are agent evidence, not execution authority: this service never runs a command or grants permissions.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { decisionFeedback } from '../../shared/decision-feedback';
import { readLocal } from '../agents/local-store';
import type { ChatSummary, PendingRequest } from '../../shared/contract';
import { CoordinationStore, proposalHash } from '../coordination/store';
import { projectAssignment, projectRequestJob, projectWork, type ProjectedWork } from '../coordination/projection';
import type { RequestKey, RequestRecord } from '../coordination/model';
import { WORK_ROUTES, WORK_STAGES, WORK_PRIORITY, orderWork, type WorkCreate, type WorkDecision, type WorkReport, type WorkThread, type WorkEvent } from '../../shared/workflows';
const gates = new Set(['mockup', 'plan', 'deploy']);
function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Testo richiesto o troppo lungo.');
  return value.trim();
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 40 || value.some(v => typeof v !== 'string' || !v || v.length > 160)) throw new Error('Chat non valide.');
  return [...new Set(value as string[])];
}
function validThread(x: unknown): x is WorkThread {
  if (!x || typeof x !== 'object') return false;
  const r = x as WorkThread;
  if (typeof r.id !== 'string' || !r.id || !Number.isSafeInteger(r.version) || r.version < 1
    || !Object.hasOwn(WORK_ROUTES, r.profile) || !Object.hasOwn(WORK_PRIORITY, r.priority)
    || !WORK_ROUTES[r.profile].includes(r.stage) || !['active', 'approval', 'blocked', 'done'].includes(r.status)
    || ![r.createdAt, r.updatedAt].every(Number.isFinite) || !Number.isSafeInteger(r.cycles) || r.cycles < 0
    || ![r.title, r.summary, r.waitingOn, r.nextAction, r.evidence].every(v => typeof v === 'string')
    || !Array.isArray(r.events) || r.events.length > 200 || r.events.some(e => !e || !Number.isFinite(e.at) || !WORK_STAGES.includes(e.stage) || typeof e.text !== 'string' || !['created','updated','completed','proposed','approved','rejected','rework','blocked'].includes(e.kind))) return false;
  try { ids(r.chatIds); } catch { return false; }
  for (const p of [r.proposal, r.approvedProposal]) if (p !== undefined && (!p || typeof p.id !== 'string' || !p.id || typeof p.text !== 'string' || !p.text)) return false;
  return (r.status === 'approval') === !!r.proposal;
}
export class Workflows {
  private records: WorkThread[];
  readonly coordination: CoordinationStore;
  constructor(file: string, private changed: (rows: WorkThread[]) => void = () => {}, private now = Date.now, private planState?: (row: WorkThread) => { pending: boolean; approved: string }, private live?: { store: CoordinationStore; chats: () => ChatSummary[]; pending: () => PendingRequest[] }) {
    this.coordination = live?.store ?? new CoordinationStore(path.join(path.dirname(file), 'app.db'), now);
    if (!this.coordination.imported(file)) {
      const raw = readLocal(file);
      if (raw !== undefined && (!Array.isArray(raw) || raw.length > 2000 || raw.some(x => !validThread(x)))) throw new Error('Archivio dei fili non valido: originale conservato.');
      this.coordination.importJobs(file, (raw ?? []) as WorkThread[]);
    }
    this.records = this.coordination.works();
    // A pre-migration proposal remains pending. Past approvals stay historical; no synthetic consent is minted.
    for (const row of this.records) if (row.proposal && !this.coordination.original(`work:${row.id}`, row.proposal.id)) this.coordination.register(this.proposalRequest(row));
  }
  priorityFor(chatId: string): number { return Math.min(2, ...this.records.filter(r => r.status !== 'done' && r.chatIds.includes(chatId)).map(r => WORK_PRIORITY[r.priority])); }
  list(): WorkThread[] { return this.projection(); }
  projection(): ProjectedWork[] {
    const chats = this.live?.chats() ?? [], pending = this.live?.pending() ?? [], requests = this.coordination.projectionRequests();
    const linked = new Set(this.records.flatMap(row => row.chatIds));
    const assignments = this.coordination.assignments().filter(a => !a.parentRunId && !linked.has(a.chatId));
    const jobs = [...this.records.map(row => projectWork(row, chats, pending, requests)), ...assignments.map(a => projectAssignment(a, chats, pending, requests))];
    const known = new Set(jobs.map(j => j.id)), unlinked = new Map<string, RequestRecord[]>();
    for (const request of requests) if (!known.has(request.key.jobId) && (request.state === 'pending' || (request.state === 'accepted' && request.delivery?.state !== 'delivered'))) {
      const group = unlinked.get(request.key.jobId) ?? []; group.push(request); unlinked.set(request.key.jobId, group);
    }
    return [...jobs, ...[...unlinked.values()].map(rs => projectRequestJob(rs, chats, pending))].sort(orderWork);
  }
  private proposalRequest(row: WorkThread): Omit<RequestRecord, 'id' | 'state'> {
    const assignments = (this.live?.chats() ?? []).filter(c => row.chatIds.includes(c.id)).map(c => ({ chatId: c.id, runId: c.run?.runId ?? null, taskVersion: c.run?.taskVersion ?? 1 })).sort((a, b) => a.chatId.localeCompare(b.chatId));
    const first = assignments[0];
    const key: RequestKey = { originalRequestId: row.proposal!.id, jobId: row.id, chatId: `work:${row.id}`, runId: first?.runId ?? null, taskVersion: first?.taskVersion ?? 1,
      proposalRevision: row.version, proposalHash: proposalHash({ proposal: row.proposal, assignments, stage: row.stage }) };
    return { key, kind: 'workflow', at: row.updatedAt, payload: row.proposal };
  }
  private save(row: WorkThread): WorkThread {
    const next = [...this.records.filter(x => x.id !== row.id), row];
    this.coordination.saveWork(row, this.records.find(x => x.id === row.id)?.version ?? null, row.proposal ? this.proposalRequest(row) : undefined);
    this.records = next;
    const projection = this.list();
    this.changed(projection);
    return projection.find(x => x.id === row.id)!;
  }
  create(input: WorkCreate): WorkThread {
    if (!Object.hasOwn(WORK_ROUTES, input.profile) || !Object.hasOwn(WORK_PRIORITY, input.priority)) throw new Error('Profilo o priorità non valido.');
    if (this.records.length >= 2000) throw new Error('Archivio pieno: esporta e archivia i fili completati prima di crearne altri.');
    const title = text(input.title, 160), chatIds = ids(input.chatIds);
    if (chatIds.some(id => this.records.some(r => r.status !== 'done' && r.chatIds.includes(id)))) throw new Error('Chat già collegata a un filo: riusa quel filo.');
    const at = this.now();
    return this.save({ id: randomUUID(), version: 1, title, profile: input.profile, priority: input.priority, chatIds,
      stage: 'analysis', status: 'active', summary: title, waitingOn: '', nextAction: 'Analizzare requisiti e repository', evidence: '', cycles: 0,
      createdAt: at, updatedAt: at, events: [{ at, stage: 'analysis', kind: 'created', text: title }] });
  }
  private current(id: string, version: number): WorkThread {
    const row = this.coordination.work(id);
    if (!row && this.coordination.assignments().some(a => a.taskId === id)) throw new Error('Questo è un incarico, non un filo a fasi: usa app_work_create per collegarne la chat a un filo.');
    if (!row || row.version !== version) throw new Error('Il filo è cambiato: rileggi lo stato prima di agire.');
    return structuredClone(row);
  }
  private event(row: WorkThread, kind: WorkEvent['kind'], summary: string, by?: WorkEvent['by']): WorkThread {
    row.version++; row.updatedAt = this.now();
    row.events = [...row.events, { at: row.updatedAt, stage: row.stage, kind, text: summary, ...(by ? { by } : {}) }].slice(-200);
    return this.save(row);
  }
  private advance(row: WorkThread): void {
    const route = WORK_ROUTES[row.profile], next = route[route.indexOf(row.stage) + 1];
    row.status = next ? 'active' : 'done';
    if (next) row.stage = next;
    delete row.approvedProposal;
    row.waitingOn = ''; row.nextAction = next ? `Eseguire la fase ${next}` : ''; row.evidence = '';
  }
  report(input: WorkReport): WorkThread {
    const row = this.current(input.id, input.expectedVersion);
    if (row.status === 'done') throw new Error('Filo completato.');
    if (!['update', 'complete', 'propose', 'fail', 'block'].includes(input.action)) throw new Error('Azione non valida.');
    if (row.status === 'blocked' && input.action !== 'propose' && input.action !== 'update') throw new Error('Filo bloccato: prepara una nuova proposta.');
    if (row.proposal) throw new Error('Proposta in attesa: serve la decisione dell’utente.');
    const summary = text(input.summary);
    row.summary = summary;
    if (input.priority !== undefined) {
      if (!Object.hasOwn(WORK_PRIORITY, input.priority)) throw new Error('Priorità non valida.');
      row.priority = input.priority;
    }
    if (['propose', 'fail', 'block'].includes(input.action)) delete row.approvedProposal;
    if (input.chatIds !== undefined) {
      const linked = ids([...row.chatIds, ...ids(input.chatIds)]);
      if (linked.some(id => this.records.some(r => r.id !== row.id && r.status !== 'done' && r.chatIds.includes(id)))) throw new Error('Chat già collegata a un altro filo.');
      row.chatIds = linked;
    }
    if (input.waitingOn !== undefined) row.waitingOn = input.waitingOn ? text(input.waitingOn, 300) : '';
    if (input.nextAction !== undefined) row.nextAction = input.nextAction ? text(input.nextAction, 500) : '';
    if (input.evidence !== undefined) row.evidence = input.evidence ? text(input.evidence, 3000) : '';
    if (input.action === 'propose') {
      if (row.stage === 'plan' && this.planState?.(row).pending) throw new Error('Il piano è già nel pannello dello Strategist: usa quella sola decisione.');
      if (row.stage === 'plan') row.planOverride = true;
      row.proposal = { id: randomUUID(), text: summary }; row.status = 'approval'; row.waitingOn = 'Te';
      return this.event(row, 'proposed', summary);
    }
    if (input.action === 'fail') {
      if (!['review', 'test', 'qa'].includes(row.stage)) throw new Error('Rework ammesso solo dopo review, test o QA.');
      row.cycles++; row.evidence = '';
      if (row.cycles >= 3) { row.status = 'blocked'; row.waitingOn = 'Serve una nuova proposta'; }
      else { row.stage = 'develop'; row.status = 'active'; row.waitingOn = ''; row.nextAction = 'Correggere nello stesso filo, poi review indipendente e test'; }
      return this.event(row, 'rework', summary);
    }
    if (input.action === 'block') { row.status = 'blocked'; return this.event(row, 'blocked', summary); }
    if (input.action === 'complete') {
      const plan = row.stage === 'plan' ? this.planState?.(row) : undefined;
      if (plan?.pending) throw new Error('Ci sono piani collegati ancora da decidere.');
      const inheritedPlan = row.stage === 'plan' && !row.planOverride ? plan?.approved : '';
      if (row.stage === 'develop' && input.implementation) row.implementation = { ...input.implementation };
      if (gates.has(row.stage) && !row.approvedProposal && !inheritedPlan) throw new Error('Questa fase richiede una proposta approvata.');
      if (!input.evidence?.trim()) throw new Error('Servono evidenze della fase (file, commit, esito verifica).');
      const evidence = row.evidence;
      if (inheritedPlan) row.events.push({ at: this.now(), stage: 'plan', kind: 'approved', text: `Decisione già registrata dallo Strategist: ${inheritedPlan}` });
      // Keep the completed stage in history before moving the cursor.
      row.events = [...row.events, { at: this.now(), stage: row.stage, kind: 'completed' as const, text: `${summary} — ${evidence}` }].slice(-199);
      this.advance(row);
      return this.event(row, 'updated', row.nextAction || 'Filo completato');
    }
    return this.event(row, 'updated', summary);
  }
  /** appNote: the app decided for the absent user («Modalità notte», ADR 0191), said in the event so it never reads as theirs */
  decide(input: WorkDecision, appNote?: string): WorkThread {
    if (typeof input.approve !== 'boolean') throw new Error('Decisione non valida.');
    const feedback = decisionFeedback(input.feedback, input.approve);
    const row = this.current(input.id, input.expectedVersion);
    if (!row.proposal || row.proposal.id !== input.proposalId) throw new Error('Proposta scaduta: rileggi il filo.');
    const request = this.proposalRequest(row);
    const proposal = row.proposal.text;
    if (input.approve) row.approvedProposal = { ...row.proposal };
    else delete row.approvedProposal;
    delete row.proposal;
    row.status = input.approve ? 'active' : 'blocked'; row.waitingOn = input.approve ? '' : 'Nuova proposta';
    if (input.approve && row.cycles >= 3 && ['review', 'test', 'qa'].includes(row.stage)) { row.stage = 'develop'; row.cycles = 0; row.evidence = ''; }
    row.nextAction = input.approve ? 'Eseguire la proposta approvata e verificarne l’esito' : 'Preparare una proposta alternativa';
    row.version++; row.updatedAt = this.now();
    row.events = [...row.events, { at: row.updatedAt, stage: row.stage, kind: input.approve ? 'approved' as const : 'rejected' as const, text: feedback
      ? `${proposal}\nRisposta libera dell’utente (${input.proposalId}, versione ${input.expectedVersion}): ${feedback}` : appNote ? `${proposal}\n${appNote}` : proposal, ...(appNote ? { by: 'app-away' as const } : {}) }].slice(-200);
    this.coordination.resolve(request.key, appNote ? { kind: 'policy', policy: 'away' } : { kind: 'user', channel: 'pc' }, input,
      { row, expected: input.expectedVersion });
    this.records = [...this.records.filter(x => x.id !== row.id), row];
    const projection = this.list();
    this.changed(projection);
    return projection.find(x => x.id === row.id)!;
  }
}
