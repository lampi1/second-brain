// Durable work threads independent of chat lifetime. Gates are decided only through renderer IPC.
// Stage reports are agent evidence, not execution authority: this service never runs a command or grants permissions.
import { randomUUID } from 'node:crypto';
import { decisionFeedback } from '../../shared/decision-feedback';
import { readLocal, writeLocal } from '../agents/local-store';
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
  constructor(private file: string, private changed: (rows: WorkThread[]) => void = () => {}, private now = Date.now, private planState?: (row: WorkThread) => { pending: boolean; approved: string }) {
    const raw = readLocal(file);
    if (raw !== undefined && (!Array.isArray(raw) || raw.length > 2000 || raw.some(x => !validThread(x)))) throw new Error('Archivio dei fili non valido: originale conservato.');
    this.records = (raw ?? []) as WorkThread[];
  }
  priorityFor(chatId: string): number { return Math.min(2, ...this.records.filter(r => r.status !== 'done' && r.chatIds.includes(chatId)).map(r => WORK_PRIORITY[r.priority])); }
  list(): WorkThread[] { return structuredClone(this.records).sort(orderWork); }
  private save(row: WorkThread): WorkThread {
    const next = [...this.records.filter(x => x.id !== row.id), row];
    writeLocal(this.file, next); // commit disk before memory or notifications
    this.records = next;
    this.changed(this.list());
    return structuredClone(row);
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
    const row = this.records.find(r => r.id === id);
    if (!row || row.version !== version) throw new Error('Il filo è cambiato: rileggi lo stato prima di agire.');
    return structuredClone(row);
  }
  private event(row: WorkThread, kind: WorkEvent['kind'], summary: string): WorkThread {
    row.version++; row.updatedAt = this.now();
    row.events = [...row.events, { at: row.updatedAt, stage: row.stage, kind, text: summary }].slice(-200);
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
    const proposal = row.proposal.text;
    if (input.approve) row.approvedProposal = { ...row.proposal };
    else delete row.approvedProposal;
    delete row.proposal;
    row.status = input.approve ? 'active' : 'blocked'; row.waitingOn = input.approve ? '' : 'Nuova proposta';
    if (input.approve && row.cycles >= 3 && ['review', 'test', 'qa'].includes(row.stage)) { row.stage = 'develop'; row.cycles = 0; row.evidence = ''; }
    row.nextAction = input.approve ? 'Eseguire la proposta approvata e verificarne l’esito' : 'Preparare una proposta alternativa';
    return this.event(row, input.approve ? 'approved' : 'rejected', feedback
      ? `${proposal}\nRisposta libera dell’utente (${input.proposalId}, versione ${input.expectedVersion}): ${feedback}` : appNote ? `${proposal}\n${appNote}` : proposal);
  }
}
