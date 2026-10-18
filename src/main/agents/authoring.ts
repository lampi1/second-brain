// Authenticated Orchestrator operations; persistent reservations, proposals and feedback never grant human authority.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentEvidenceRef, AgentProfile, AgentRunOutcome } from '../../shared/agents';
import type { AgentFeedback, AgentProposal, AgentUndo } from '../../shared/agent-authoring';
import type { ChatItem, FeedAction } from '../../shared/contract';
import type { ToolDef } from '../appctl/tools';
import type { RawEvent } from '../brain/live';
import type { AgentCatalogService } from './catalog';
import type { AgentRunStore } from './runs';
import { runMetrics } from './run-metrics';
import { checkCreationRequest, checkPermissionInstructions, protectedAgent } from './author-policy';
import { readLocal, writeLocal } from './local-store';
import { log, errText } from '../log';

interface Store { version: 1; used: string[]; human?: string[]; proposals: AgentProposal[]; feedback: AgentFeedback[] }
interface Deps {
  userData: string; catalog: AgentCatalogService; runs: AgentRunStore;
  items: (chatId: string) => readonly ChatItem[];
  publish: (events: RawEvent[]) => void;
  /** Main-owned ledger value; unknown fails closed. No authoring tool starts a paid job. */
  suggestionSpend: () => number | null;
  send: (chatId: string, text: string) => Promise<unknown>;
  now?: () => number;
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Object required.');
  return v as Record<string, unknown>;
};
const text = (v: unknown, max = 600): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Text required, at most ${max} characters.`);
  return v.trim();
};
function evidence(value: unknown): AgentEvidenceRef[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('At most 20 evidence references required.');
  return value.map(v => {
    const e = object(v);
    if (!['journal', 'chat', 'ai-error', 'cost', 'run', 'feedback'].includes(String(e.kind)) || typeof e.at !== 'number' || !Number.isFinite(e.at) || e.at < 0) throw new Error('Invalid evidence.');
    return { kind: e.kind as AgentEvidenceRef['kind'], ref: text(e.ref, 200), at: e.at };
  });
}
export class AgentAuthoring {
  private readonly file: string;
  private state: Store = { version: 1, used: [], proposals: [], feedback: [] };
  private problem: string | null = null;
  constructor(private readonly d: Deps) {
    this.file = path.join(d.userData, 'agent-authoring.json');
    try {
      const raw = readLocal(this.file);
      if (raw !== undefined) {
        const s = object(raw);
        if (s.version !== 1 || !Array.isArray(s.used) || !s.used.every(x => typeof x === 'string') || !Array.isArray(s.proposals) || !Array.isArray(s.feedback)) throw new Error('Invalid authoring store.');
        if (s.human !== undefined && (!Array.isArray(s.human) || !s.human.every(x => typeof x === 'string'))) throw new Error('Invalid human provenance.');
        for (const value of s.proposals) {
          const p = object(value);
          if (typeof p.id !== 'string' || !['suggestion', 'proposal'].includes(String(p.kind)) || !['pending', 'accepted', 'rejected'].includes(String(p.state)) || typeof p.at !== 'number' || !Number.isFinite(p.at) || typeof p.reason !== 'string' || typeof p.expectedEffect !== 'string') throw new Error('Invalid stored proposal.');
          object(p.draft); evidence(p.evidence);
          if (p.agentId !== undefined && (typeof p.agentId !== 'string' || typeof p.baseRevision !== 'number')) throw new Error('Invalid proposal revision.');
        }
        for (const value of s.feedback) {
          const f = object(value), o = object(f.outcome);
          if (typeof f.id !== 'string' || typeof f.agentId !== 'string' || typeof f.runId !== 'string' || !['orchestrator-opinion', 'reviewed-evidence'].includes(String(o.basis)) || !['success', 'partial', 'fail', 'unknown'].includes(String(o.verdict))) throw new Error('Invalid stored feedback.');
          evidence(f.evidence);
        }
        // The file is never interpreted as authority to execute a proposal without a new user decision.
        this.state = structuredClone(s) as unknown as Store;
      }
    } catch { this.problem = 'Authoring store unreadable; preserved. Writes disabled.'; }
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private write(next: Store): void {
    if (this.problem) throw new Error(this.problem);
    writeLocal(this.file, next); this.state = next;
  }
  private profile(id: unknown): AgentProfile {
    const c = this.d.catalog.list(), p = [...c.profiles, ...c.archived].find(p => p.id === text(id, 80));
    if (!p) throw new Error('Unknown agent.');
    return p;
  }
  private event(kind: string, reason: string, id?: string, action?: FeedAction, refs: AgentEvidenceRef[] = []): void {
    this.d.publish([{ kind, title: reason, detail: JSON.stringify({ agentId: id, evidence: refs }), ...(action ? { action } : {}) }]);
  }
  /** User click only; stale undo buttons cannot overwrite subsequent human edits. */
  undo(input: AgentUndo): AgentProfile {
    const p = this.profile(input.agentId);
    if (p.updatedAt !== input.expectedRevision) throw new Error('Agent changed: review its current definition before undoing.');
    if (input.operation === 'archive') return this.d.catalog.archive(p.id);
    if (input.operation === 'restore') return this.d.catalog.restore(p.id);
    if (input.operation === 'version' && Number.isSafeInteger(input.version)) return this.d.catalog.restoreVersion(p.id, input.version!);
    throw new Error('Invalid undo operation.');
  }
  proposals(): AgentProposal[] {
    if (this.problem) throw new Error(this.problem);
    return structuredClone(this.state.proposals);
  }
  /** Called only after the sender-checked chat:create/chat:send UI handlers. Transcript roles alone are not proof:
   * app resumes and internal messages can also be represented as user items. */
  rememberHumanMessage(chatId: string, typed: string, previousIds: readonly string[] = []): void {
    if (this.problem) return;
    if (typeof typed !== 'string' || !typed.trim()) return;
    // Exactly one new, unattributed row with the typed text: an ambiguous match (an internal message with the same
    // text landing concurrently) records nothing, so creation fails closed.
    const matches = this.d.items(chatId).filter(i => i.kind === 'user' && i.from === undefined && i.text.trim() === typed.trim() && !previousIds.includes(i.id));
    if (matches.length !== 1) return;
    const key = `${chatId}:${matches[0]!.id}`, human = this.state.human ?? [];
    if (!human.includes(key)) {
      try { this.write({ ...this.state, human: [...human.slice(-499), key] }); }
      catch (error) { log.warn('agents', 'Human creation intent not recorded', { cause: errText(error), hint: 'Agent creation stays disabled for this message; check the local authoring store.' }); }
    }
  }
  /** Only the typed, sender-checked UI IPC calls this; never exposed as an MCP tool. */
  decide(id: string, accept: boolean): AgentProfile | null {
    if (typeof accept !== 'boolean') throw new Error('Explicit decision required.');
    const proposal = this.state.proposals.find(p => p.id === id && p.state === 'pending');
    if (!proposal) throw new Error('Pending proposal not found.');
    if (proposal.agentId && this.profile(proposal.agentId).updatedAt !== proposal.baseRevision) throw new Error('Agent changed since this proposal. Request a fresh proposal.');
    if (accept) { this.d.catalog.validateDraft(proposal.draft); checkPermissionInstructions(proposal.draft); }
    // Reserve first: a crash must not create a duplicate on a second click.
    this.write({ ...this.state, proposals: this.state.proposals.map(p => p.id === id ? { ...p, state: accept ? 'accepted' : 'rejected' } : p) });
    const profile = accept ? this.d.catalog.save(proposal.draft, proposal.agentId) : null;
    this.event('agent-proposal', accept ? 'Proposta accettata' : 'Proposta rifiutata', profile?.id);
    return profile;
  }
  async call(name: string, args: Record<string, unknown>, callerId: string): Promise<unknown> {
    if (this.problem) throw new Error(this.problem);
    const a = args, catalog = this.d.catalog;
    for (const key of ['trial', 'probation', 'sendToRun']) if (a[key] !== undefined && typeof a[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
    if (name === 'agent_list') {
      const filter = a.filter === undefined ? {} : object(a.filter), c = catalog.list();
      return { definitions: [...c.profiles, ...c.archived].filter(p => (!filter.category || p.category === filter.category) && (!filter.status || p.status === filter.status) && (!filter.origin || p.origin.kind === filter.origin)), metrics: this.metrics(a) };
    }
    if (name === 'agent_metrics') return this.metrics(a);
    if (name === 'agent_get') {
      const p = this.profile(a.agentId), history = catalog.history(p.id);
      const selected = a.version === undefined ? null : history.find(v => v.version === a.version);
      if (a.version !== undefined && !selected) throw new Error('Unknown version.');
      return { definition: p, selectedVersion: selected, history, feedback: this.state.feedback.filter(f => f.agentId === p.id), metrics: this.metrics({ agentId: p.id }) };
    }
    if (name === 'agent_run_report') {
      const run = this.d.runs.get(text(a.runId, 80));
      if (!run) throw new Error('Unknown run.');
      return structuredClone({ run, reviews: this.d.runs.list().filter(r => r.reviewOf === run.runId), feedback: this.state.feedback.filter(f => f.runId === run.runId) });
    }
    const reason = text(a.reason ?? a.notes);
    if (name === 'agent_create') {
      const id = text(a.requestItemId, 200), key = `${callerId}:${id}`;
      if (!this.state.human?.includes(key)) throw new Error('A message typed through the user interface is required. Suggest it instead.');
      checkCreationRequest(this.d.items(callerId), id, this.state.used.includes(key) ? [id] : [], this.now());
      // Persist before writing the catalog, preventing concurrent calls and restart replay (failure stays consumed).
      this.write({ ...this.state, used: [...this.state.used, key] });
      const p = catalog.author(a.draft, { reason, evidence: evidence(a.evidence ?? []), presetId: text(a.presetId, 80), requestItemId: id, probation: a.probation === true });
      this.event('agent-created', reason, p.id, { kind: 'agent-undo', undo: { agentId: p.id, expectedRevision: p.updatedAt, operation: 'archive' } }, evidence(a.evidence ?? [])); return p;
    }
    if (name === 'agent_suggest' || name === 'agent_propose') {
      const spend = this.d.suggestionSpend();
      if (name === 'agent_suggest' && (spend === null || !Number.isFinite(spend) || spend < 0 || spend >= 0.5)) {
        this.event('budget', 'Suggerimenti sospesi: budget giornaliero esaurito o non verificabile.');
        throw new Error('Daily suggestion budget unavailable or exhausted ($0.50).');
      }
      if (this.state.proposals.filter(p => p.state === 'pending').length >= 128) throw new Error('Too many pending proposals.');
      const before = name === 'agent_propose' ? this.profile(a.agentId) : undefined;
      const draft = catalog.validateDraft(before ? { ...before, ...object(a.patch) } : a.draft);
      checkPermissionInstructions(draft);
      const p: AgentProposal = { id: randomUUID(), at: this.now(), kind: before ? 'proposal' : 'suggestion', ...(before ? { agentId: before.id, baseRevision: before.updatedAt, before } : {}), draft, reason, expectedEffect: text(a.expectedEffect), evidence: evidence(a.evidence ?? []), state: 'pending' };
      this.write({ ...this.state, proposals: [...this.state.proposals, p] });
      this.event(before ? 'agent-proposal' : 'agent-suggested', reason, before?.id, { kind: 'agent-proposals' }, p.evidence); return structuredClone(p);
    }
    if (name === 'agent_feedback') return this.feedback(a, callerId, reason);
    const p = this.profile(a.agentId);
    if (protectedAgent(p)) throw new Error('Protected agent: use agent_propose.');
    let result: AgentProfile;
    if (name === 'agent_update') {
      if (a.trial === false) throw new Error('Automatic behavioural changes require a trial.');
      const baseline = this.d.runs.list().filter(r => r.agentId === p.id && r.version === p.activeVersion && r.endedAt !== undefined && r.outcome && ['human', 'reviewed-evidence'].includes(r.outcome.basis) && r.outcome.verdict !== 'unknown').length;
      result = catalog.author(object(a.patch), { id: p.id, reason, evidence: evidence(a.evidence ?? []), baseline });
    } else {
      if (p.origin.kind !== 'orchestrator') throw new Error('Only Orchestrator-owned agents may be changed.');
      if (name === 'agent_archive') result = catalog.archive(p.id);
      else if (name === 'agent_restore') result = catalog.restore(p.id);
      else if (name === 'agent_rollback') result = catalog.authorRollback(p.id, a.toVersion as number);
      else throw new Error('Unknown authoring operation.');
    }
    const operation = name === 'agent_archive' ? 'restore' : name === 'agent_restore' ? 'archive' : 'version';
    this.event(name === 'agent_update' ? 'agent-updated' : name === 'agent_rollback' ? 'agent-rolledback' : name === 'agent_archive' ? 'agent-archived' : 'agent-restored', reason, p.id,
      { kind: 'agent-undo', undo: { agentId: p.id, expectedRevision: result.updatedAt, operation, ...(operation === 'version' ? { version: p.activeVersion } : {}) } }, evidence(a.evidence ?? [])); return result;
  }
  private metrics(a: Record<string, unknown>): unknown {
    const period = a.period === undefined ? undefined : object(a.period);
    const since = period?.since;
    if (since !== undefined && (typeof since !== 'number' || !Number.isFinite(since) || since < 0)) throw new Error('Invalid period.');
    const filter = Object.fromEntries(['skill', 'app', 'repo'].filter(k => a[k] !== undefined).map(k => [k, text(a[k], 120)]));
    const result = runMetrics(this.d.runs.list(), { ...(since !== undefined ? { since: since as number } : {}), rollups: this.d.runs.rolledUp(), filter });
    return result.filter(m => a.agentId === undefined || m.agentId === a.agentId).map(m => a.version === undefined ? m : { ...m, all: null, versions: m.versions.filter(v => v.version === a.version) });
  }
  private async feedback(a: Record<string, unknown>, callerId: string, notes: string): Promise<AgentFeedback> {
    const run = this.d.runs.get(text(a.runId, 80));
    if (!run) throw new Error('Unknown run.');
    if (!['success', 'partial', 'fail', 'unknown'].includes(String(a.verdict))) throw new Error('Invalid verdict.');
    if (a.sendToRun && run.endedAt !== undefined) throw new Error('Ended runs cannot receive feedback messages.');
    const refs = evidence(a.evidence);
    const verified = refs.some(e => {
      if (e.kind !== 'run') return false;
      const review = this.d.runs.get(e.ref);
      if (!review || review.endedAt === undefined || review.reviewOf !== run.runId || !review.report?.ok || review.report.verified !== 'yes') return false;
      const c = this.d.catalog.list(), p = [...c.profiles, ...c.archived].find(p => p.id === review.agentId);
      return !!p && p.origin.kind === 'preset' && /(?:^|-)reviewer(?:$|-)/.test(p.origin.presetId) && review.version > 0;
    });
    const outcome: AgentRunOutcome = { verdict: a.verdict as AgentRunOutcome['verdict'], basis: verified ? 'reviewed-evidence' : 'orchestrator-opinion', by: callerId, at: this.now(), note: notes };
    const f: AgentFeedback = { id: randomUUID(), at: this.now(), agentId: run.agentId, runId: run.runId, outcome, evidence: refs };
    const own = this.state.feedback.filter(x => x.agentId === run.agentId).slice(-199);
    this.write({ ...this.state, feedback: [...this.state.feedback.filter(x => x.agentId !== run.agentId), ...own, f] });
    // Human decisions always win; an opinion cannot erase a previously verified outcome.
    if (run.outcome?.basis !== 'human' && !(run.outcome?.basis === 'reviewed-evidence' && !verified)) {
      const previous = run.outcome;
      run.outcome = outcome;
      try { this.d.runs.save(); } catch (error) { run.outcome = previous; throw error; }
    }
    this.event('agent-feedback', notes, run.agentId);
    if (a.sendToRun === true) await this.d.send(run.chatId, notes);
    return structuredClone(f);
  }
}

/** The caller check runs on every invocation, so a former coordinator cannot retain write authority. */
export function authoringTools(service: AgentAuthoring, callerId: string, authenticated: () => boolean): ToolDef[] {
  const names = ['agent_list', 'agent_get', 'agent_create', 'agent_suggest', 'agent_update', 'agent_propose', 'agent_archive', 'agent_restore', 'agent_rollback', 'agent_feedback', 'agent_run_report', 'agent_metrics'];
  const required: Record<string, string[]> = {
    agent_create: ['draft', 'presetId', 'requestItemId', 'reason'], agent_suggest: ['draft', 'reason', 'expectedEffect'],
    agent_get: ['agentId'], agent_update: ['agentId', 'patch', 'reason'], agent_propose: ['agentId', 'patch', 'reason', 'expectedEffect'],
    agent_archive: ['agentId', 'reason'], agent_restore: ['agentId', 'reason'], agent_rollback: ['agentId', 'toVersion', 'reason'],
    agent_feedback: ['runId', 'verdict', 'notes', 'evidence'], agent_run_report: ['runId'],
  };
  const string = { type: 'string' }, record = { type: 'object' }, boolean = { type: 'boolean' }, integer = { type: 'integer' };
  return names.map(name => ({
    name, description: `${name}: bounded agent management. Definitions never grant permissions. Protected changes require the user's decision in Agenti. Creation requires an active presetId, full draft with explicit tools/permissionCeiling, and a fresh human requestItemId.`,
    inputSchema: { type: 'object', required: required[name] ?? [], properties: {
      agentId: string, presetId: string, draft: record, patch: record, requestItemId: string, reason: string, expectedEffect: string,
      evidence: { type: 'array', items: record }, runId: string, verdict: { type: 'string', enum: ['success', 'partial', 'fail', 'unknown'] },
      notes: string, toVersion: integer, version: integer, trial: boolean, probation: boolean, sendToRun: boolean,
      filter: record, period: record, skill: string, app: string, repo: string,
    } },
    annotations: { readOnlyHint: ['agent_list', 'agent_get', 'agent_metrics', 'agent_run_report'].includes(name) },
    run: async a => { if (!authenticated()) throw new Error('Authenticated unified Orchestrator required.'); return await service.call(name, a, callerId) as object; },
  }));
}
