// Authenticated Orchestrator operations; persistent reservations, proposals and feedback never grant human authority.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentEvidenceRef, AgentProfile, AgentRunOutcome } from '../../shared/agents';
import { AGENT_PROPOSAL_OPS, type AgentProposal, type AgentProposalOp, type AgentUndo } from '../../shared/agent-authoring';
import { AGENT_FEEDBACK_SCHEMA, DEFINITION_GAPS, RUN_ID_DESCRIPTION, parseAgentFeedbackArgs, parseEvidence, type AgentFeedback, type AgentFeedbackArgs } from '../../shared/agent-lifecycle';
import type { ChatItem, FeedAction } from '../../shared/contract';
import type { ToolDef } from '../appctl/tools';
import type { RawEvent } from '../brain/live';
import type { AgentCatalogService } from './catalog';
import { unknownRunError, type AgentRunStore } from './runs';
import { runMetrics } from './run-metrics';
import { checkCreationRequest, checkPermissionInstructions, withoutPackFields } from './author-policy';
import { readLocal, writeLocal } from './local-store';
import { sameBehaviour } from './versions';
import { log, errText } from '../log';

interface Store { version: 1; used: string[]; human?: string[]; proposals: AgentProposal[]; feedback: AgentFeedback[] }
interface Deps {
  userData: string; catalog: AgentCatalogService; runs: AgentRunStore;
  items: (chatId: string) => readonly ChatItem[];
  publish: (events: RawEvent[]) => void;
  /** Main-owned ledger value; unknown fails closed. No authoring tool starts a paid job. */
  suggestionSpend: () => number | null;
  send: (chatId: string, text: string) => Promise<unknown>;
  /** agent_feedback's entry point once the lifecycle is wired (createLifecycleApi(...).feedback): it parses the shared
   *  shape, calls recordFeedback (this store, the only one) and turns repeated gaps into proposals. Absent: recordFeedback. */
  feedback?: (args: Record<string, unknown>, callerId: string) => Promise<AgentFeedback>;
  /** the chat with this id and its run mirror (undefined = no such chat): turns a chat id passed as runId into the run to use */
  chat?: (id: string) => { run?: { runId: string } } | undefined;
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
/** One evidence rule for every tool: the shared parser agent_feedback uses too. */
const evidence = parseEvidence;
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
          if (p.op !== undefined && (!AGENT_PROPOSAL_OPS.includes(p.op as never) || p.agentId === undefined) || p.toVersion !== undefined && (!Number.isSafeInteger(p.toVersion) || Number(p.toVersion) < 1) || p.op === 'rollback' && p.toVersion === undefined) throw new Error('Invalid proposal operation.');
        }
        for (const value of s.feedback) {
          const f = object(value), o = object(f.outcome);
          if (typeof f.id !== 'string' || typeof f.agentId !== 'string' || typeof f.runId !== 'string' || !['orchestrator-opinion', 'reviewed-evidence'].includes(String(o.basis)) || !['success', 'partial', 'fail', 'unknown'].includes(String(o.verdict))) throw new Error('Invalid stored feedback.');
          evidence(f.evidence);
          if (f.version !== undefined && (!Number.isSafeInteger(f.version) || Number(f.version) < 0) || f.gap !== undefined && !DEFINITION_GAPS.includes(f.gap as never)
            || ['worked', 'failed', 'gapKey'].some(k => f[k] !== undefined && typeof f[k] !== 'string')) throw new Error('Invalid stored feedback detail.');
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
    if (input.operation === 'version' && Number.isSafeInteger(input.version)) {
      // an automatic behavioural change is always a trial: undoing it rejects the trial (restoreVersion refuses during one)
      if (p.trial && p.trial.version === p.activeVersion && p.trial.baseline === input.version) return this.d.catalog.rejectTrial(p.id, input.version!);
      return this.d.catalog.restoreVersion(p.id, input.version!);
    }
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
  /** Only the typed, sender-checked UI IPC calls this (agents:proposalDecide); never exposed as an MCP tool. Accepting is
   *  the user's act: a new agent is saved, a behavioural change of an existing one opens a trial against its active
   *  version (catalog.approveTrial), a rollback / archive / restore is applied. A refused application leaves it pending. */
  decide(id: string, accept: boolean): AgentProfile | null {
    if (typeof accept !== 'boolean') throw new Error('Explicit decision required.');
    const proposal = this.state.proposals.find(p => p.id === id && p.state === 'pending');
    if (!proposal) throw new Error('Pending proposal not found.');
    if (proposal.agentId && this.profile(proposal.agentId).updatedAt !== proposal.baseRevision) throw new Error('Agent changed since this proposal. Request a fresh proposal.');
    const op: AgentProposalOp = proposal.op ?? 'update';
    if (accept && op === 'update') { this.d.catalog.validateDraft(proposal.draft); checkPermissionInstructions(proposal.draft); }
    // Reserve first: a crash must not create a duplicate on a second click.
    const before = this.state;
    this.write({ ...this.state, proposals: this.state.proposals.map(p => p.id === id ? { ...p, state: accept ? 'accepted' : 'rejected' } : p) });
    let profile: AgentProfile | null = null;
    if (accept) {
      try { profile = this.apply(proposal, op); }
      catch (error) { this.write({ ...this.state, proposals: before.proposals }); throw error; }
    }
    this.event('agent-proposal', accept ? 'Proposta accettata' : 'Proposta rifiutata', profile?.id ?? proposal.agentId);
    return profile;
  }
  private apply(proposal: AgentProposal, op: AgentProposalOp): AgentProfile {
    const catalog = this.d.catalog;
    if (!proposal.agentId) return catalog.save(proposal.draft);
    const current = this.profile(proposal.agentId);
    if (op === 'archive') return catalog.archive(current.id);
    if (op === 'restore') return catalog.restore(current.id);
    if (op === 'rollback') {
      const to = proposal.toVersion!;
      // the open trial's own baseline: the trial is rejected; any other earlier version is the user's restore
      if (current.trial && current.trial.version === current.activeVersion && current.trial.baseline === to) return catalog.resolveTrial(current.id, 'rollback');
      return catalog.restoreVersion(current.id, to);
    }
    return sameBehaviour(current, proposal.draft) ? catalog.save(proposal.draft, current.id) : catalog.approveTrial(current.id, proposal.draft, proposal.reason);
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
      const id = text(a.runId, 80), run = this.d.runs.get(id);
      if (!run) throw this.unknownRun(id);
      return structuredClone({ run, reviews: this.d.runs.list().filter(r => r.reviewOf === run.runId), feedback: this.state.feedback.filter(f => f.runId === run.runId) });
    }
    // the shared AgentFeedbackArgs shape (parseAgentFeedbackArgs) is the only validation: no `reason` alias here
    if (name === 'agent_feedback') return this.d.feedback ? this.d.feedback(a, callerId) : this.recordFeedback(parseAgentFeedbackArgs(a), callerId);
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
      const draft = catalog.validateDraft(before ? { ...before, ...withoutPackFields(object(a.patch)) } : withoutPackFields(a.draft));
      checkPermissionInstructions(draft);
      const p: AgentProposal = { id: randomUUID(), at: this.now(), kind: before ? 'proposal' : 'suggestion', ...(before ? { agentId: before.id, baseRevision: before.updatedAt, before } : {}), draft, reason, expectedEffect: text(a.expectedEffect), evidence: evidence(a.evidence ?? []), state: 'pending' };
      this.write({ ...this.state, proposals: [...this.state.proposals, p] });
      this.event(before ? 'agent-proposal' : 'agent-suggested', reason, before?.id, { kind: 'agent-proposals' }, p.evidence); return structuredClone(p);
    }
    // agent_update / agent_rollback / agent_archive / agent_restore: never applied by an agent (the owner, 2026-10-18:
    // "sempre sotto approvazione"). Each queues one proposal the user accepts or rejects in Agenti (agents:proposalDecide).
    if (!['agent_update', 'agent_rollback', 'agent_archive', 'agent_restore'].includes(name)) throw new Error('Unknown authoring operation.');
    const p = this.profile(a.agentId);
    if (this.state.proposals.filter(x => x.state === 'pending').length >= 128) throw new Error('Too many pending proposals.');
    if (this.state.proposals.some(x => x.state === 'pending' && x.agentId === p.id && (x.op ?? 'update') === name.slice(6))) throw new Error('A proposal of this kind is already waiting for the user on this agent.');
    let draft: AgentProposal['draft'], toVersion: number | undefined;
    const op = name.slice(6) as AgentProposalOp;
    if (op === 'update') {
      draft = catalog.validateDraft({ ...p, ...withoutPackFields(object(a.patch)) });
      checkPermissionInstructions(draft);
      if (sameBehaviour(p, draft) && JSON.stringify(catalog.validateDraft(p)) === JSON.stringify(draft)) throw new Error('The patch changes nothing.');
    } else if (op === 'rollback') {
      toVersion = a.toVersion as number;
      const entry = Number.isSafeInteger(toVersion) && toVersion >= 1 && toVersion < p.activeVersion ? catalog.history(p.id).find(v => v.version === toVersion) : undefined;
      if (!entry) throw new Error('Choose an earlier version that is still in the history.');
      draft = catalog.validateDraft({ ...p, manifest: undefined, effort: undefined, knowhow: undefined, ...entry.behaviour });
    } else {
      if (op === 'archive' ? p.status !== 'active' : p.status !== 'archived') throw new Error(op === 'archive' ? 'The agent is not active.' : 'The agent is not archived.');
      draft = catalog.validateDraft(p);
    }
    const proposal: AgentProposal = { id: randomUUID(), at: this.now(), kind: 'proposal', agentId: p.id, baseRevision: p.updatedAt, before: catalog.validateDraft(p), draft, op,
      ...(toVersion !== undefined ? { toVersion } : {}), reason, expectedEffect: typeof a.expectedEffect === 'string' && a.expectedEffect.trim() ? text(a.expectedEffect) : reason,
      evidence: evidence(a.evidence ?? []), state: 'pending' };
    this.write({ ...this.state, proposals: [...this.state.proposals, proposal] });
    this.event('agent-proposal', reason, p.id, { kind: 'agent-proposals' }, proposal.evidence);
    return structuredClone(proposal);
  }
  private metrics(a: Record<string, unknown>): unknown {
    const period = a.period === undefined ? undefined : object(a.period);
    const since = period?.since;
    if (since !== undefined && (typeof since !== 'number' || !Number.isFinite(since) || since < 0)) throw new Error('Invalid period.');
    const filter = Object.fromEntries(['skill', 'app', 'repo'].filter(k => a[k] !== undefined).map(k => [k, text(a[k], 120)]));
    const result = runMetrics(this.d.runs.list(), { ...(since !== undefined ? { since: since as number } : {}), rollups: this.d.runs.rolledUp(), filter });
    return result.filter(m => a.agentId === undefined || m.agentId === a.agentId).map(m => a.version === undefined ? m : { ...m, all: null, versions: m.versions.filter(v => v.version === a.version) });
  }
  private unknownRun(id: string): Error { return unknownRunError(id, this.d.runs.list(), this.d.chat); }
  /** The one feedback store's reader (the lifecycle's FeedbackSource): an agent's records, oldest first. */
  feedbackOf(agentId: string): AgentFeedback[] { return structuredClone(this.state.feedback.filter(f => f.agentId === agentId)); }
  get storeProblem(): string | null { return this.problem; }
  /** The one feedback store's writer. Arguments are already parsed (AgentFeedbackArgs); agent and version come from the run,
   *  the basis from the evidence check below. Callers: agent_feedback (directly, or through the lifecycle facade). */
  async recordFeedback(a: AgentFeedbackArgs, callerId: string): Promise<AgentFeedback> {
    if (this.problem) throw new Error(this.problem);
    const run = this.d.runs.get(a.runId), notes = a.notes;
    if (!run) throw this.unknownRun(a.runId);
    if (a.sendToRun && run.endedAt !== undefined) throw new Error('Ended runs cannot receive feedback messages.');
    const refs = a.evidence;
    const verified = refs.some(e => {
      if (e.kind !== 'run') return false;
      const review = this.d.runs.get(e.ref);
      if (!review || review.endedAt === undefined || review.reviewOf !== run.runId || !review.report?.ok || review.report.verified !== 'yes') return false;
      const c = this.d.catalog.list(), p = [...c.profiles, ...c.archived].find(p => p.id === review.agentId);
      return !!p && p.origin.kind === 'preset' && /(?:^|-)reviewer(?:$|-)/.test(p.origin.presetId) && review.version > 0;
    });
    const outcome: AgentRunOutcome = { verdict: a.verdict as AgentRunOutcome['verdict'], basis: verified ? 'reviewed-evidence' : 'orchestrator-opinion', by: callerId, at: this.now(), note: notes };
    const f: AgentFeedback = { id: randomUUID(), at: this.now(), agentId: run.agentId, runId: run.runId, version: run.version, outcome, evidence: refs,
      ...(a.worked !== undefined ? { worked: a.worked } : {}), ...(a.failed !== undefined ? { failed: a.failed } : {}),
      ...(a.gap !== undefined ? { gap: a.gap } : {}), ...(a.gapKey !== undefined ? { gapKey: a.gapKey } : {}) };
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

/** The tools that only queue a proposal for the user's decision (agents:proposalDecide). */
const QUEUED = ['agent_suggest', 'agent_propose', 'agent_update', 'agent_rollback', 'agent_archive', 'agent_restore'];
/** The caller check runs on every invocation, so a former coordinator cannot retain write authority. */
export function authoringTools(service: AgentAuthoring, callerId: string, authenticated: () => boolean): ToolDef[] {
  const names = ['agent_list', 'agent_get', 'agent_create', 'agent_suggest', 'agent_update', 'agent_propose', 'agent_archive', 'agent_restore', 'agent_rollback', 'agent_feedback', 'agent_run_report', 'agent_metrics'];
  const required: Record<string, string[]> = {
    agent_create: ['draft', 'presetId', 'requestItemId', 'reason'], agent_suggest: ['draft', 'reason', 'expectedEffect'],
    agent_get: ['agentId'], agent_update: ['agentId', 'patch', 'reason'], agent_propose: ['agentId', 'patch', 'reason', 'expectedEffect'],
    agent_archive: ['agentId', 'reason'], agent_restore: ['agentId', 'reason'], agent_rollback: ['agentId', 'toVersion', 'reason'],
    agent_run_report: ['runId'], // agent_feedback: AGENT_FEEDBACK_SCHEMA (shared with the lifecycle facade)
  };
  const string = { type: 'string' }, record = { type: 'object' }, boolean = { type: 'boolean' }, integer = { type: 'integer' };
  return names.map(name => name === 'agent_feedback' ? {
    name, description: 'agent_feedback: your opinion of an agent run (verdict, notes, evidence; optionally what worked, what failed and which part of the definition fell short as gap + a short gapKey). It counts as reviewed evidence only when it cites an ended, verified Reviewer run of that run; it never overwrites the user\'s verdict. The agent and its version come from the run.',
    inputSchema: AGENT_FEEDBACK_SCHEMA,
    run: async (a: Record<string, unknown>) => { if (!authenticated()) throw new Error('Authenticated unified Orchestrator required.'); return await service.call(name, a, callerId) as object; },
  } : ({
    name, description: `${name}: bounded agent management. Definitions never grant permissions. ${QUEUED.includes(name) ? 'Queues a proposal for the user (Agenti → Da approvare); nothing changes until the user accepts it, and an accepted behavioural change runs as a trial against the current version.' : name === 'agent_create' ? 'Creation requires an active presetId, full draft with explicit tools/permissionCeiling, and a fresh human requestItemId.' : 'Read only.'}`,
    inputSchema: { type: 'object', required: required[name] ?? [], properties: {
      agentId: string, presetId: string, draft: record, patch: record, requestItemId: string, reason: string, expectedEffect: string,
      evidence: { type: 'array', items: record }, runId: { type: 'string', description: RUN_ID_DESCRIPTION }, verdict: { type: 'string', enum: ['success', 'partial', 'fail', 'unknown'] },
      notes: string, toVersion: integer, version: integer, trial: boolean, probation: boolean, sendToRun: boolean,
      filter: record, period: record, skill: string, app: string, repo: string,
    } },
    annotations: { readOnlyHint: ['agent_list', 'agent_get', 'agent_metrics', 'agent_run_report'].includes(name) },
    run: async (a: Record<string, unknown>) => { if (!authenticated()) throw new Error('Authenticated unified Orchestrator required.'); return await service.call(name, a, callerId) as object; },
  }));
}
