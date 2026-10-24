// Durable, fail-closed flow execution; only the host can turn trusted reports and user decisions into receipts.
import fs from 'node:fs';
import path from 'node:path';
import { renameRetrying } from '../rules/storage';
import { createHash, randomUUID } from 'node:crypto';
import type { FlowActivate, FlowAgentBinding, FlowCancel, FlowDecision, FlowDefinition, FlowDraft, FlowMatch, FlowPropose, FlowReceipt, FlowReport, FlowRestart, FlowRestartDecision, FlowRestartProposal, FlowRun, FlowScope, FlowSnapshot, FlowStart, FlowStep, FlowTestDbEvidence, FlowStepTierEdit, FlowVerifiedReport, FlowVersion } from '../../shared/flows';
import { adapted, testDbAdapted, digest, type RoleTierMax, inScope, integer, keys, normalize, object, text, validateDefinition, validateInputs, validateScope } from './schema';

export interface FlowServiceOptions {
  file: string; contextKey: string; now?: () => number; changed?: (snapshot: FlowSnapshot) => void;
  resolveReport?: (binding: FlowAgentBinding, reportId: string) => FlowVerifiedReport | null;
  /** True only while the user-approved automatic rule that started this run grants the declared host adapter. */
  adapterGranted?: (run: FlowRun, step: FlowStep) => boolean;
  /** The catalog's tierMax per role, checked when a draft is proposed. */
  tierMax?: RoleTierMax;
}
type Stored = Omit<FlowSnapshot, 'contextKey' | 'storageError'> & { schema: 1; bindings: string[] };
const empty = (): Stored => ({ schema: 1, bindings: [], drafts: [], versions: [], active: {}, runs: [] });
const copy = <T>(value: T): T => structuredClone(value);
export class FlowService {
  private data: Stored = empty();
  private storageError?: string;
  private reconciling = false;
  private readonly now: () => number;
  constructor(private readonly options: FlowServiceOptions) {
    this.now = options.now ?? Date.now;
    if (!options.contextKey.trim()) throw new Error('Flow brain context is required');
    try {
      if (fs.existsSync(options.file)) { if (fs.statSync(options.file).size > 20 * 1024 * 1024) throw new Error('Flow storage exceeds limit'); this.data = this.read(fs.readFileSync(options.file, 'utf8')); }
      let interrupted = false;
      for (const run of this.data.runs) {
        const step = run.steps[run.currentStep]!;
        if (run.status === 'active' && step?.status === 'running') { this.block(run, 'Interrupted: inspect the linked agent before an explicit user retry.'); this.touch(run); interrupted = true; }
      }
      if (interrupted) this.save();
    } catch { this.storageError = 'Flow storage is invalid or unavailable; mutations are disabled. Restore the original file before restarting.'; this.data = empty(); }
  }
  snapshot(): FlowSnapshot { this.reconcileDeadlines(); return copy({ contextKey: this.options.contextKey, drafts: this.data.drafts, versions: this.data.versions, active: this.data.active, runs: this.data.runs, ...(this.storageError ? { storageError: this.storageError } : {}) }); }
  match(query: string, scope?: FlowScope): FlowMatch {
    this.healthy(); const normalized = ` ${normalize(text(query, 'query', 16000))} `, actual = scope === undefined ? undefined : validateScope(scope);
    const candidates = this.data.versions.filter(v => this.data.active[v.definition.id] === v.version && (!actual || inScope(v.definition.scope, actual))
      && [v.definition.id, ...v.definition.aliases].some(alias => normalized.includes(` ${normalize(alias)} `)))
      .sort((a, b) => a.definition.id.localeCompare(b.definition.id));
    return copy({ status: candidates.length === 0 ? 'none' : candidates.length === 1 ? 'match' : 'ambiguous', candidates });
  }
  propose(input: FlowPropose): FlowDraft {
    keys(object(input, 'proposal'), ['definition', 'expectedRevision'], 'proposal');
    const definition = validateDefinition(input.definition, this.options.tierMax), expected = integer(input.expectedRevision, 'expectedRevision');
    return this.change(() => {
      const previous = this.data.drafts.find(d => d.definition.id === definition.id);
      if ((previous?.revision ?? 0) !== expected) throw new Error('Draft changed; review its current revision');
      const draft: FlowDraft = { definition, revision: expected + 1, updatedAt: this.now(), status: 'proposed' };
      this.data.drafts = [...this.data.drafts.filter(d => d.definition.id !== definition.id), draft]; return draft;
    });
  }
  /** The user's tier pick on one agent step, from the exact definition shown: the pending proposal when there is one,
   * otherwise the active version. Never activates: it only proposes the next draft revision for decideDefinition.
   * Renderer IPC only, like decideDefinition; propose() re-validates the tier against the role's tierMax. */
  editStepTier(input: FlowStepTierEdit): FlowDraft {
    keys(object(input, 'step edit'), ['flowId', 'base', 'stepId', 'tier'], 'step edit');
    const base = object(input.base, 'base') as Record<string, unknown>;
    const draft = this.data.drafts.find(d => d.definition.id === input.flowId);
    const pending = draft?.status === 'proposed' ? draft : undefined;
    let source: FlowDefinition | undefined;
    if ('draftRevision' in base) { keys(base, ['draftRevision'], 'base'); if (pending && pending.revision === base.draftRevision) source = pending.definition; }
    else { keys(base, ['version'], 'base'); if (!pending && this.data.active[input.flowId] === base.version) source = this.data.versions.find(v => v.definition.id === input.flowId && v.version === base.version)?.definition; }
    if (!source) throw new Error('Definition changed; review its current revision');
    const definition = copy(source), step = definition.steps.find(s => s.id === input.stepId);
    if (!step || step.kind !== 'agent' || !step.role) throw new Error('Only an agent step with a declared role takes a tier');
    if (input.tier === null) delete step.tier; else step.tier = input.tier;
    return this.propose({ definition, expectedRevision: draft?.revision ?? 0 });
  }
  /** Deliberately absent from agent tools. Exact-revision decisions originate only in authenticated renderer IPC. */
  decideDefinition(input: FlowActivate): FlowDraft {
    keys(object(input, 'definition decision'), ['id', 'expectedRevision', 'answer', 'feedback'], 'definition decision');
    const feedback = this.feedback(input.answer, input.feedback);
    return this.change(() => {
      const draft = this.data.drafts.find(d => d.definition.id === input.id);
      if (!draft || draft.revision !== input.expectedRevision || draft.status !== 'proposed') throw new Error('Definition decision is stale');
      draft.updatedAt = this.now(); draft.status = input.answer === 'yes' ? 'active' : 'rejected';
      if (feedback) draft.feedback = feedback;
      if (input.answer === 'yes') {
        const version = Math.max(0, ...this.data.versions.filter(v => v.definition.id === input.id).map(v => v.version)) + 1;
        this.data.versions.push({ definition: copy(draft.definition), version, draftRevision: draft.revision, digest: digest(draft.definition), activatedAt: this.now() });
        this.data.active[input.id] = version;
      }
      return draft;
    });
  }
  /** `automatic` is passed only by the automation service: `auto:` subjects are reserved for its event starts (ADR 0145). */
  start(input: FlowStart, ownerId: string, automatic = false): FlowRun {
    keys(object(input, 'start'), ['flowId', 'flowVersion', 'subjectKey', 'scope', 'inputs'], 'start');
    const subjectKey = text(input.subjectKey, 'subjectKey', 500), owner = text(ownerId, 'owner', 200), scope = validateScope(input.scope), inputs = validateInputs(input.inputs);
    if (!automatic && subjectKey.startsWith('auto:')) throw new Error('Subjects starting with auto: are reserved for automatic flow events');
    return this.change(() => {
      const version = this.version(input.flowId, input.flowVersion);
      if (this.data.active[input.flowId] !== input.flowVersion) throw new Error('Only the current user-activated flow version can start');
      if (!inScope(version.definition.scope, scope)) throw new Error('Flow scope does not match');
      const existing = this.data.runs.find(r => r.flowId === input.flowId && r.flowVersion === input.flowVersion && r.subjectKey === subjectKey);
      if (existing) { this.owner(existing, owner); if (JSON.stringify(existing.scope) !== JSON.stringify(scope) || JSON.stringify(existing.inputs) !== JSON.stringify(inputs)) throw new Error('Subject already has a run with different scope or inputs'); return existing; }
      const run: FlowRun = { id: randomUUID(), revision: 1, flowId: input.flowId, flowVersion: input.flowVersion, definitionDigest: version.digest,
        ownerOrchestratorId: owner, subjectKey, scope, inputs, status: 'active', currentStep: 0,
        steps: version.definition.steps.map(step => ({ stepId: step.id, status: 'pending', attempts: 0 })), createdAt: this.now(), updatedAt: this.now() };
      this.data.runs.push(run); this.prepare(run); return run;
    });
  }
  status(runId: string, ownerId: string): FlowRun { this.healthy(); this.reconcileDeadlines(); const run = this.run(runId); this.owner(run, ownerId); return copy(run); }
  /** User IPC or an authenticated owner command, never inferred from an agent report. Idempotent on exact retries. */
  cancel(input: FlowCancel, ownerId?: string): FlowRun {
    keys(object(input, 'cancel'), ['runId', 'expectedRevision', 'reason'], 'cancel');
    const reason = input.reason === undefined ? 'Run cancelled by explicit request.' : text(input.reason, 'reason', 2000);
    integer(input.expectedRevision, 'expectedRevision', 1);
    return this.change(() => {
      const run = this.run(text(input.runId, 'runId', 200)); if (ownerId !== undefined) this.owner(run, ownerId);
      if (run.status === 'cancelled' && (input.expectedRevision === run.revision || input.expectedRevision === run.cancellation?.expectedRevision)) return run;
      if (run.revision !== input.expectedRevision) throw new Error('Flow changed; review the current run');
      if (run.status === 'completed') throw new Error('Completed runs remain in history; restart creates a new run');
      this.cancelRun(run, reason, ownerId === undefined ? 'user' : 'orchestrator'); return run;
    });
  }
  /** Cancellation requested by an agent always becomes a native user decision first. */
  proposeCancel(input: FlowCancel, ownerId: string): FlowRun {
    keys(object(input, 'cancel proposal'), ['runId', 'expectedRevision', 'reason'], 'cancel proposal');
    return this.change(() => {
      const run = this.run(text(input.runId, 'runId', 200)); this.owner(run, ownerId);
      if (run.revision !== input.expectedRevision || ['cancelled', 'completed'].includes(run.status)) throw new Error('Flow changed; review the current run');
      const reason = input.reason === undefined ? undefined : text(input.reason, 'reason', 2000);
      this.touch(run); delete run.recoveryFeedback; run.pendingCancellation = { revision: run.revision, requestedAt: this.now(), ...(reason ? { reason } : {}) }; return run;
    });
  }
  cancellationRequest(input: FlowRestartDecision): FlowCancel {
    const run = this.run(text(input.runId, 'runId', 200)), pending = run.pendingCancellation;
    if (!pending || run.revision !== input.expectedRevision || pending.revision !== input.expectedRevision) throw new Error('Cancellation proposal changed; review it again');
    return { runId: run.id, expectedRevision: run.revision, ...(pending.reason ? { reason: pending.reason } : {}) };
  }
  dismissCancel(input: FlowRestartDecision): FlowRun {
    keys(object(input, 'cancel decision'), ['runId', 'expectedRevision', 'answer', 'feedback'], 'cancel decision');
    this.feedback(input.answer, input.feedback); if (input.answer === 'yes') throw new Error('Approval must cancel through the host');
    return this.change(() => { this.cancellationRequest(input); const run = this.run(input.runId); this.touch(run); if (input.answer === 'other') run.recoveryFeedback = { kind: 'cancel', at: this.now(), message: input.feedback!.trim() }; return run; });
  }
  /** Host-only acknowledgement after interrupting the exact bound task; terminal status alone is not a free slot. */
  confirmInterruption(runId: string, cancellationRevision: number): FlowRun {
    return this.change(() => {
      const run = this.run(runId);
      if (run.status !== 'cancelled' || run.cancellation?.expectedRevision !== cancellationRevision) throw new Error('Cancellation changed before interruption confirmation');
      if (run.cancellation.interruption !== 'confirmed') { run.cancellation.interruption = 'confirmed'; this.touch(run); }
      return run;
    });
  }
  /** Exact replay lookup before touching either source or automation grants. */
  restarted(input: FlowRestart): FlowRun | undefined {
    this.healthy();
    const existing = this.data.runs.find(run => run.restartOf?.runId === input.runId && run.restartOf.expectedRevision === input.expectedRevision
      && run.restartOf.mode === input.mode && run.flowVersion === input.targetVersion && run.definitionDigest === input.targetDigest
      && (input.mode === 'from-start' || run.restartOf.stepId === input.stepId));
    return existing ? copy(existing) : undefined;
  }
  /** Read-only prerequisite validation, reused before an automatic event is created and at the durable commit. */
  restartTarget(input: Omit<FlowRestart, 'acknowledgeEffects'>): { source: FlowRun; version: FlowVersion; index: number } {
    this.healthy(); integer(input.expectedRevision, 'expectedRevision', 1);
    const source = this.run(text(input.runId, 'runId', 200));
    if (source.revision !== input.expectedRevision) throw new Error('Flow changed; review the current run');
    if (!['from-start', 'from-step'].includes(input.mode)) throw new Error('Invalid restart mode');
    if (input.mode === 'from-start' && input.stepId !== undefined) throw new Error('Restart from the beginning does not take a step');
    const version = this.version(source.flowId, input.mode === 'from-start' ? this.data.active[source.flowId]! : source.flowVersion);
    if (version.version !== input.targetVersion || version.digest !== input.targetDigest) throw new Error('Restart target changed; review the exact version again');
    const index = input.mode === 'from-start' ? 0 : version.definition.steps.findIndex(step => step.id === input.stepId);
    if (index < 0) throw new Error('Restart step not found');
    if (source.steps.slice(0, index).some(step => step.status !== 'completed' || !step.receipt)) throw new Error('Every preceding step needs completed host evidence before restarting here');
    return copy({ source, version, index });
  }
  /** A model can request a recovery decision, never execute it. Any source mutation invalidates the proposal. */
  proposeRestart(input: FlowRestartProposal, ownerId: string): FlowRun {
    keys(object(input, 'restart proposal'), ['runId', 'expectedRevision', 'mode', 'stepId', 'targetVersion', 'targetDigest', 'automationRule'], 'restart proposal');
    return this.change(() => {
      const { source } = this.restartTarget(input); this.owner(source, ownerId);
      const run = this.run(source.id); this.touch(run); delete run.recoveryFeedback;
      run.pendingRecovery = { mode: input.mode, ...(input.stepId ? { stepId: input.stepId } : {}), revision: run.revision, requestedAt: this.now(), targetVersion: input.targetVersion, targetDigest: input.targetDigest, ...(input.automationRule ? { automationRule: copy(input.automationRule) } : {}) };
      return run;
    });
  }
  recovery(input: FlowRestartDecision): FlowRestart {
    const run = this.run(text(input.runId, 'runId', 200)), pending = run.pendingRecovery;
    if (!pending || run.revision !== input.expectedRevision || pending.revision !== input.expectedRevision) throw new Error('Restart proposal changed; review it again');
    return { runId: run.id, expectedRevision: run.revision, mode: pending.mode, ...(pending.stepId ? { stepId: pending.stepId } : {}), targetVersion: pending.targetVersion, targetDigest: pending.targetDigest, ...(pending.automationRule ? { automationRule: copy(pending.automationRule) } : {}), acknowledgeEffects: true };
  }
  dismissRestart(input: FlowRestartDecision): FlowRun {
    keys(object(input, 'restart decision'), ['runId', 'expectedRevision', 'answer', 'feedback'], 'restart decision');
    this.feedback(input.answer, input.feedback); if (input.answer === 'yes') throw new Error('Approval must execute the exact recovery through the host');
    return this.change(() => { this.recovery(input); const run = this.run(input.runId); this.touch(run); if (input.answer === 'other') run.recoveryFeedback = { kind: 'restart', at: this.now(), message: input.feedback!.trim() }; return run; });
  }
  /** Delivery metadata cannot invalidate a later execution decision. The Orchestrator chat now retains the note. */
  acknowledgeRecoveryFeedback(runId: string, at: number, message: string, kind: 'cancel' | 'restart'): void {
    this.change(() => { const run = this.run(runId); if (run.recoveryFeedback?.at === at && run.recoveryFeedback.message === message && run.recoveryFeedback.kind === kind) run.recoveryFeedback.deliveredAt = this.now(); });
  }
  /** Renderer-approved recovery creates a new identity. A carried prefix is evidence from the same pinned version,
   * never newly executed work. Automatic overrides are supplied only by the approved event ledger. */
  restart(input: FlowRestart, automatic?: Pick<FlowStart, 'subjectKey' | 'scope' | 'inputs'>): FlowRun {
    keys(object(input, 'restart'), ['runId', 'expectedRevision', 'mode', 'stepId', 'acknowledgeEffects', 'targetVersion', 'targetDigest', 'automationRule'], 'restart');
    if (input.acknowledgeEffects !== true) throw new Error('Restart requires explicit acknowledgement of repeated effects');
    const existing = this.restarted(input); if (existing) return existing;
    return this.change(() => {
      const { version, index } = this.restartTarget(input), source = this.run(input.runId);
      if (source.subjectKey.startsWith('auto:') && !automatic) throw new Error('Automatic runs restart only through a currently approved automatic rule');
      const scope = validateScope(automatic?.scope ?? source.scope), inputs = validateInputs(automatic?.inputs ?? source.inputs);
      if (!inScope(version.definition.scope, scope)) throw new Error('Restart scope does not match the selected flow version');
      if (index && (JSON.stringify(scope) !== JSON.stringify(source.scope) || JSON.stringify(inputs) !== JSON.stringify(source.inputs))) throw new Error('Carried evidence requires the same scope and inputs');
      const run: FlowRun = { id: randomUUID(), revision: 1, flowId: source.flowId, flowVersion: version.version, definitionDigest: version.digest,
        ownerOrchestratorId: source.ownerOrchestratorId, subjectKey: automatic?.subjectKey ?? `restart:${source.id}:${randomUUID()}`, scope, inputs,
        status: 'active', currentStep: index, steps: version.definition.steps.map((step, i) => i < index ? copy(source.steps[i]!) : { stepId: step.id, status: 'pending', attempts: 0 }),
        createdAt: this.now(), updatedAt: this.now(), restartOf: { runId: source.id, stepId: version.definition.steps[index]!.id, expectedRevision: input.expectedRevision, mode: input.mode } };
      // Validate/prepare before cancelling the source; a thrown error rolls back the whole state transaction.
      this.prepare(run);
      if (!['completed', 'cancelled'].includes(source.status)) this.cancelRun(source, `Restarted as ${run.id}.`, 'user');
      else this.touch(source);
      this.data.runs.push(run); return run;
    });
  }
  /** Host resolves chat eligibility, workspace and immutable run identity before calling; no arbitrary agent-supplied bindings. */
  bindAgent(runId: string, expectedRevision: number, stepId: string, binding: FlowAgentBinding, ownerId: string): FlowRun {
    return this.change(() => {
      const run = this.guarded(runId, expectedRevision, stepId); this.owner(run, ownerId);
      const definition = this.version(run.flowId, run.flowVersion).definition.steps[run.currentStep]!, step = run.steps[run.currentStep]!;
      if (definition.kind !== 'agent' || step.status !== 'ready' || step.attempts >= definition.maxAttempts || this.unsupported(run, definition) || definition.action) throw new Error('Current step is not available for delegation');
      text(binding.chatId, 'chatId', 200); text(binding.chatRunId, 'chatRunId', 200); integer(binding.taskVersion, 'taskVersion', 1);
      const bindingKey = JSON.stringify([binding.chatRunId, binding.taskVersion]);
      if (this.data.bindings.includes(bindingKey)) throw new Error('Agent run/task identity was already bound to a flow step');
      if (definition.reviewOf && run.steps.find(s => s.stepId === definition.reviewOf)?.chatId === binding.chatId) throw new Error('Independent review requires a different chat');
      if (binding.chatId === ownerId) throw new Error('The Orchestrator cannot certify its own flow step');
      // a declared role and tier are what the chat really runs: open it with that role and tier (app_create_chat tier)
      if (definition.role && binding.launched?.roleId !== definition.role) throw new Error(`This step runs as ${definition.role}: open the chat with that role`);
      if (definition.tier && (binding.launched?.tier !== definition.tier || binding.launched.fromTable)) throw new Error(`This step runs on tier ${definition.tier}: open the chat with tier ${definition.tier}`);
      this.data.bindings.push(bindingKey);
      step.chatId = binding.chatId; step.chatRunId = binding.chatRunId; step.taskVersion = binding.taskVersion; step.status = 'running'; step.startedAt = this.now(); step.attempts++;
      this.touch(run); return run;
    });
  }
  /** Host-only journal: persist the query hash and trusted configured database before the executor is allowed to touch a test database. */
  beginTestDbQuery(runId: string, binding: FlowAgentBinding, targetId: string, database: string, query: string): FlowTestDbEvidence {
    return this.change(() => {
      const run = this.run(runId), step = run.steps[run.currentStep];
      const spec = this.version(run.flowId, run.flowVersion).definition.steps[run.currentStep];
      if (run.status !== 'active' || step?.status !== 'running' || !spec || !testDbAdapted(spec) || this.unsupported(run, spec)
        || step.chatId !== binding.chatId || step.chatRunId !== binding.chatRunId || step.taskVersion !== binding.taskVersion) throw new Error('Test DB query binding is stale');
      if ((run.testDbEvidence?.length ?? 0) >= 500) throw new Error('Test DB query evidence limit reached');
      text(query, 'query', 16384);
      const evidence: FlowTestDbEvidence = { id: randomUUID(), runId: run.id, stepId: step.stepId, chatRunId: binding.chatRunId, taskVersion: binding.taskVersion,
        targetId: text(targetId, 'targetId', 64), database: text(database, 'database', 128), queryHash: createHash('sha256').update(query, 'utf8').digest('hex'), at: this.now(), status: 'pending' };
      (run.testDbEvidence ??= []).push(evidence); this.touch(run); return evidence;
    });
  }
  /** Completion metadata only: raw driver errors and result rows never enter durable flow storage. */
  finishTestDbQuery(runId: string, evidenceId: string, result?: { rowCount: number; truncated: boolean }): void {
    this.change(() => {
      const run = this.run(runId), evidence = run.testDbEvidence?.find(item => item.id === evidenceId);
      if (!evidence || evidence.status !== 'pending') throw new Error('Test DB evidence is missing or already completed');
      if (run.status === 'cancelled' && result) throw new Error('Cancelled runs cannot accept successful late query results');
      evidence.status = result ? 'ok' : 'error'; evidence.finishedAt = this.now();
      if (result) { evidence.rowCount = integer(result.rowCount, 'rowCount'); evidence.truncated = result.truncated; }
      this.touch(run);
    });
  }
  report(input: FlowReport, ownerId: string): FlowRun {
    keys(object(input, 'report'), ['runId', 'expectedRevision', 'stepId', 'reportId'], 'report');
    return this.change(() => {
      const run = this.guarded(input.runId, input.expectedRevision, input.stepId); this.owner(run, ownerId);
      const step = run.steps[run.currentStep]!, definition = this.version(run.flowId, run.flowVersion).definition.steps[run.currentStep]!;
      if (definition.kind !== 'agent' || step.status !== 'running' || !step.chatId || !step.chatRunId || !step.taskVersion) throw new Error('No bound running agent step');
      if (this.now() - (step.startedAt ?? 0) > definition.timeoutMs) { this.block(run, 'Step timed out; inspect evidence before retry.'); this.touch(run); return run; }
      const report = this.options.resolveReport?.({ chatId: step.chatId, chatRunId: step.chatRunId, taskVersion: step.taskVersion }, text(input.reportId, 'reportId', 200));
      if (!report || !report.completed || report.id !== input.reportId || report.chatId !== step.chatId || report.chatRunId !== step.chatRunId || report.taskVersion !== step.taskVersion) throw new Error('A matching completed host-linked agent report is required');
      if (definition.reviewOf && (report.roleId !== 'sentinel' || report.reviewOf !== run.steps.find(s => s.stepId === definition.reviewOf)?.chatRunId)) throw new Error('Independent review must bind the reviewed agent run and Sentinel role');
      if (!report.summary.trim() || !report.evidence.length || definition.evidence.some(label => !report.evidence.some(value => value.startsWith(`${label}: `) && value.length > label.length + 2))) throw new Error('The linked report is missing required evidence');
      this.finish(run, { id: randomUUID(), stepId: step.stepId, kind: 'agent-report', at: this.now(), summary: report.summary, chatId: step.chatId, reportId: report.id, evidence: copy(report.evidence) });
      this.prepare(run); this.touch(run); return run;
    });
  }
  /** A user can approve a gate or request a bounded retry, but cannot certify unsupported external actions. */
  decide(input: FlowDecision): FlowRun {
    keys(object(input, 'run decision'), ['runId', 'expectedRevision', 'stepId', 'answer', 'feedback'], 'run decision');
    const feedback = this.feedback(input.answer, input.feedback);
    return this.change(() => {
      const run = this.guarded(input.runId, input.expectedRevision, input.stepId), step = run.steps[run.currentStep]!, definition = this.version(run.flowId, run.flowVersion).definition.steps[run.currentStep]!;
      if (!['approval', 'blocked'].includes(step.status)) throw new Error('Step does not have a pending user decision');
      if (input.answer === 'no') { this.cancelRun(run, feedback || 'User declined this step or retry.', 'user'); return run; }
      if (input.answer === 'other') { this.block(run, feedback); step.decisionPending = false; this.touch(run); return run; }
      if (this.unsupported(run, definition)) throw new Error('No configured execution adapter; approval cannot bypass this blocker');
      if (step.status === 'blocked') {
        if (step.attempts >= definition.maxAttempts) throw new Error('Retry limit reached');
        delete step.chatId; delete step.chatRunId; delete step.taskVersion; delete step.startedAt; delete step.reason; step.status = 'pending'; this.prepare(run);
      } else {
        if (definition.evidence.some(label => !feedback.split('\n').some(line => line.startsWith(`${label}: `) && line.length > label.length + 2))) throw new Error('User note is missing required evidence labels');
        if (definition.kind === 'manual' && !feedback) throw new Error('Manual completion requires a user evidence note');
        this.finish(run, { id: randomUUID(), stepId: step.stepId, kind: 'user', at: this.now(), summary: feedback || 'Approved by user', evidence: feedback ? [feedback] : [] }); this.prepare(run);
      }
      this.touch(run); return run;
    });
  }
  private reconcileDeadlines(): void {
    if (this.reconciling || this.storageError) return;
    const now = this.now(), expired = this.data.runs.filter(run => {
      const step = run.steps[run.currentStep];
      return run.status === 'active' && step?.status === 'running' && now - (step.startedAt ?? 0) > this.version(run.flowId, run.flowVersion).definition.steps[run.currentStep]!.timeoutMs;
    });
    if (!expired.length) return;
    this.reconciling = true;
    try { this.change(() => { for (const run of expired) { this.block(run, 'Step timed out; inspect evidence before retry.'); this.touch(run); } }); }
    finally { this.reconciling = false; }
  }
  private prepare(run: FlowRun): void {
    const definition = this.version(run.flowId, run.flowVersion).definition;
    while (run.currentStep < definition.steps.length) {
      const spec = definition.steps[run.currentStep]!, step = run.steps[run.currentStep]!;
      run.status = 'active';
      if (this.unsupported(run, spec)) { this.block(run, 'Execution adapter unavailable. No external or production action was performed.'); return; }
      if (spec.inputs.some(key => !run.inputs[key]?.trim())) { this.block(run, 'Required inputs are missing. Revise the definition or start a new subject with complete inputs.'); return; }
      if (spec.kind === 'approval' || spec.kind === 'manual') { step.status = 'approval'; step.decisionPending = true; run.status = 'approval'; return; }
      if (spec.kind === 'agent') { step.status = 'ready'; return; }
      step.attempts++;
      if (spec.action?.ref === 'scope-present' && (!run.scope.project || !run.scope.areaPath)) { this.block(run, 'The scope-present metadata check requires project and areaPath.'); return; }
      if (!['scope-present', 'inputs-present'].includes(spec.action?.ref ?? '')) { this.block(run, 'Check adapter unavailable.'); return; }
      this.finish(run, { id: randomUUID(), stepId: step.stepId, kind: 'check', at: this.now(), summary: `Host metadata check: ${spec.action?.ref}`, evidence: ['metadata: Metadata validated only; no test suite or external action was executed.'] });
    }
    run.status = 'completed';
  }
  /** Production and non-builtin actions never run; an external write runs only as a granted DevOps adapter step. */
  private unsupported(run: FlowRun, spec: FlowStep): boolean {
    if (spec.effect === 'production' || (spec.action && spec.action.kind !== 'builtin')) return true;
    if (spec.effect !== 'external-write' && !testDbAdapted(spec)) return false;
    if (!adapted(spec) && !testDbAdapted(spec)) return true;
    try { return this.options.adapterGranted?.(run, spec) !== true; } catch { return true; }
  }
  private finish(run: FlowRun, receipt: FlowReceipt): void { const step = run.steps[run.currentStep]!; step.status = 'completed'; delete step.reason; delete step.decisionPending; step.receipt = receipt; run.currentStep++; }
  private cancelRun(run: FlowRun, reason: string, by: 'user' | 'orchestrator'): void {
    run.cancellation = { at: this.now(), reason, by, expectedRevision: run.revision, interruption: run.steps[run.currentStep]?.chatId ? 'pending' : 'confirmed' }; run.status = 'cancelled';
    const step = run.steps[run.currentStep]!; step.status = 'cancelled'; step.reason = reason; step.decisionPending = false; this.touch(run);
  }
  private block(run: FlowRun, reason: string): void { run.status = 'blocked'; run.steps[run.currentStep]!.status = 'blocked'; run.steps[run.currentStep]!.decisionPending = true; run.steps[run.currentStep]!.reason = reason; run.updatedAt = this.now(); }
  private touch(run: FlowRun): void { delete run.pendingRecovery; delete run.pendingCancellation; run.revision++; run.updatedAt = this.now(); }
  private feedback(answer: unknown, value: unknown): string { if (!['yes', 'no', 'other'].includes(answer as string)) throw new Error('Invalid decision'); const result = value === undefined ? '' : text(value, 'feedback', 16000, true); if (answer === 'other' && !result) throw new Error('A different answer requires feedback'); return result; }
  private version(id: string, version: number): FlowVersion { const result = this.data.versions.find(v => v.definition.id === id && v.version === version); if (!result) throw new Error('Flow version not found'); return result; }
  private run(id: string): FlowRun { const run = this.data.runs.find(r => r.id === id); if (!run) throw new Error('Flow run not found'); return run; }
  private owner(run: FlowRun, ownerId: string): void { if (run.ownerOrchestratorId !== ownerId) throw new Error('Flow belongs to another Orchestrator'); }
  private guarded(id: string, revision: number, stepId: string): FlowRun { const run = this.run(id); if (['completed', 'cancelled'].includes(run.status) || run.revision !== revision || run.steps[run.currentStep]?.stepId !== stepId) throw new Error('Flow changed; review the current step'); return run; }
  private healthy(): void { if (this.storageError) throw new Error(this.storageError); }
  private change<T>(mutate: () => T): T {
    this.healthy(); const before = copy(this.data);
    try { const value = mutate(); this.save(); try { this.options.changed?.(this.snapshot()); } catch { /* observer failure must not undo a durable commit */ } return copy(value); }
    catch (error) { this.data = before; throw error; }
  }
  private save(): void {
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
    const serialized = JSON.stringify(this.data, null, 2);
    if (Buffer.byteLength(serialized) > 20 * 1024 * 1024) throw new Error('Flow storage exceeds limit');
    const temp = `${this.options.file}.${randomUUID()}.tmp`;
    try { const fd = fs.openSync(temp, 'wx', 0o600); try { fs.writeFileSync(fd, serialized); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } renameRetrying(temp, this.options.file); }
    finally { try { fs.rmSync(temp, { force: true }); } catch { /* cleanup must not undo an already renamed durable commit */ } }
  }
  private read(source: string): Stored {
    const raw = object(JSON.parse(source) as unknown, 'storage'); keys(raw, ['schema', 'bindings', 'drafts', 'versions', 'active', 'runs'], 'storage');
    if (raw.schema !== 1 || !Array.isArray(raw.bindings) || !Array.isArray(raw.drafts) || !Array.isArray(raw.versions) || !Array.isArray(raw.runs)) throw new Error('Invalid flow storage');
    const data = raw as unknown as Stored;
    if (new Set(data.bindings).size !== data.bindings.length) throw new Error('Duplicate binding ledger');
    for (const key of data.bindings) { const parts = JSON.parse(text(key, 'binding key', 500)) as unknown; if (!Array.isArray(parts) || parts.length !== 2) throw new Error('Invalid binding ledger'); text(parts[0], 'binding run', 200); integer(parts[1], 'binding task', 1); }
    const draftIds = new Set<string>(), versionIds = new Set<string>(), runIds = new Set<string>(), observedBindings = new Set<string>();
    for (const draft of data.drafts) {
      keys(object(draft, 'draft'), ['definition', 'revision', 'updatedAt', 'status', 'feedback'], 'draft');
      if (draft.feedback !== undefined) text(draft.feedback, 'draft feedback', 16000, true);
      validateDefinition(draft.definition); integer(draft.revision, 'revision', 1); integer(draft.updatedAt, 'updatedAt');
      if (!['proposed', 'rejected', 'active'].includes(draft.status) || draftIds.has(draft.definition.id)) throw new Error('Invalid draft'); draftIds.add(draft.definition.id);
    }
    for (const version of data.versions) {
      keys(object(version, 'version'), ['definition', 'version', 'draftRevision', 'digest', 'activatedAt'], 'version');
      validateDefinition(version.definition); integer(version.version, 'version', 1); integer(version.draftRevision, 'draftRevision', 1); integer(version.activatedAt, 'activatedAt');
      const key = `${version.definition.id}:${version.version}`;
      if (digest(version.definition) !== version.digest || versionIds.has(key)) throw new Error('Invalid immutable flow version'); versionIds.add(key);
    }
    object(data.active, 'active');
    for (const [id, version] of Object.entries(data.active)) { integer(version, 'active version', 1); if (!versionIds.has(`${id}:${version}`)) throw new Error('Invalid active version'); }
    for (const run of data.runs) {
      keys(object(run, 'run'), ['id', 'revision', 'flowId', 'flowVersion', 'definitionDigest', 'ownerOrchestratorId', 'subjectKey', 'scope', 'inputs', 'status', 'currentStep', 'steps', 'createdAt', 'updatedAt', 'testDbEvidence', 'cancellation', 'restartOf', 'pendingRecovery', 'pendingCancellation', 'recoveryFeedback'], 'run');
      text(run.id, 'run id', 200); integer(run.revision, 'revision', 1); text(run.ownerOrchestratorId, 'owner', 200); text(run.subjectKey, 'subjectKey', 500);
      validateScope(run.scope); validateInputs(run.inputs); integer(run.createdAt, 'createdAt'); integer(run.updatedAt, 'updatedAt');
      const version = data.versions.find(v => v.definition.id === run.flowId && v.version === run.flowVersion);
      if (!version || version.digest !== run.definitionDigest || !inScope(version.definition.scope, run.scope) || runIds.has(run.id) || !Array.isArray(run.steps) || run.steps.length !== version.definition.steps.length) throw new Error('Invalid pinned flow run'); runIds.add(run.id);
      if (run.testDbEvidence !== undefined) {
        if (!Array.isArray(run.testDbEvidence) || run.testDbEvidence.length > 500) throw new Error('Invalid test DB evidence');
        const ids = new Set<string>();
        for (const evidence of run.testDbEvidence) {
          keys(object(evidence, 'test DB evidence'), ['id', 'runId', 'stepId', 'chatRunId', 'taskVersion', 'targetId', 'database', 'queryHash', 'at', 'status', 'finishedAt', 'rowCount', 'truncated'], 'test DB evidence');
          text(evidence.id, 'evidence id', 200); text(evidence.targetId, 'targetId', 64); text(evidence.database, 'database', 128);
          if (evidence.runId !== run.id || typeof evidence.queryHash !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.queryHash)) throw new Error('Invalid test DB query hash or run');
          integer(evidence.at, 'evidence time'); integer(evidence.taskVersion, 'evidence task', 1);
          const index = run.steps.findIndex(step => step.stepId === evidence.stepId), step = run.steps[index], spec = version.definition.steps[index];
          if (!step || !spec || !testDbAdapted(spec) || !data.bindings.includes(JSON.stringify([evidence.chatRunId, evidence.taskVersion])) || ids.has(evidence.id)
            || !['pending', 'ok', 'error'].includes(evidence.status)) throw new Error('Invalid test DB evidence binding');
          ids.add(evidence.id);
          if (evidence.status !== 'pending') integer(evidence.finishedAt, 'evidence finish');
          if (evidence.status === 'ok') { integer(evidence.rowCount, 'row count'); if (typeof evidence.truncated !== 'boolean') throw new Error('Invalid test DB truncation'); }
        }
      }
      integer(run.currentStep, 'currentStep', 0, run.steps.length);
      if (!['active', 'approval', 'blocked', 'completed', 'cancelled'].includes(run.status) || (run.status === 'completed') !== (run.currentStep === run.steps.length)) throw new Error('Invalid run status');
      if ((run.status === 'cancelled') !== !!run.cancellation) throw new Error('Invalid cancellation record');
      if (run.cancellation) {
        keys(object(run.cancellation, 'cancellation'), ['at', 'reason', 'by', 'expectedRevision', 'interruption'], 'cancellation');
        integer(run.cancellation.at, 'cancellation time'); integer(run.cancellation.expectedRevision, 'cancellation revision', 1, run.revision - 1); text(run.cancellation.reason, 'cancellation reason', 2000);
        if (!['user', 'orchestrator'].includes(run.cancellation.by)) throw new Error('Invalid cancellation authority');
        if (run.cancellation.interruption !== undefined && !['pending', 'confirmed'].includes(run.cancellation.interruption)) throw new Error('Invalid cancellation interruption');
      }
      if (run.pendingRecovery) {
        const pending = run.pendingRecovery; keys(object(pending, 'recovery proposal'), ['mode', 'stepId', 'revision', 'requestedAt', 'targetVersion', 'targetDigest', 'automationRule'], 'recovery proposal');
        integer(pending.requestedAt, 'recovery time'); integer(pending.targetVersion, 'recovery version', 1);
        if (pending.revision !== run.revision || !['from-start', 'from-step'].includes(pending.mode) || !data.versions.some(v => v.definition.id === run.flowId && v.version === pending.targetVersion && v.digest === pending.targetDigest)) throw new Error('Invalid recovery proposal');
        if (pending.automationRule) { keys(object(pending.automationRule, 'recovery automatic rule'), ['id', 'revision'], 'recovery automatic rule'); text(pending.automationRule.id, 'recovery rule id', 200); integer(pending.automationRule.revision, 'recovery rule revision', 1); }
      }
      if (run.pendingCancellation) {
        const pending = run.pendingCancellation; keys(object(pending, 'cancel proposal'), ['revision', 'requestedAt', 'reason'], 'cancel proposal'); integer(pending.requestedAt, 'cancel proposal time');
        if (pending.reason !== undefined) text(pending.reason, 'cancel proposal reason', 2000);
        if (pending.revision !== run.revision || run.pendingRecovery || ['cancelled', 'completed'].includes(run.status)) throw new Error('Invalid cancellation proposal');
      }
      if (run.recoveryFeedback) { keys(object(run.recoveryFeedback, 'recovery feedback'), ['kind', 'at', 'message', 'deliveredAt'], 'recovery feedback'); integer(run.recoveryFeedback.at, 'recovery feedback time'); if (run.recoveryFeedback.deliveredAt !== undefined) integer(run.recoveryFeedback.deliveredAt, 'recovery delivery time'); text(run.recoveryFeedback.message, 'recovery feedback', 16000); if (!['cancel', 'restart'].includes(run.recoveryFeedback.kind)) throw new Error('Invalid recovery feedback'); }
      let inherited = 0, restartSource: FlowRun | undefined;
      if (run.restartOf) {
        const origin = run.restartOf; keys(object(origin, 'restart origin'), ['runId', 'stepId', 'expectedRevision', 'mode'], 'restart origin');
        restartSource = data.runs.find(item => item.id === origin.runId);
        integer(origin.expectedRevision, 'restart source revision', 1);
        inherited = version.definition.steps.findIndex(step => step.id === origin.stepId);
        if (!restartSource || restartSource.id === run.id || !runIds.has(restartSource.id) || restartSource.flowId !== run.flowId || restartSource.ownerOrchestratorId !== run.ownerOrchestratorId || inherited < 0 || !['from-start', 'from-step'].includes(origin.mode)
          || (origin.mode === 'from-start' && inherited !== 0) || (origin.mode === 'from-step' && (restartSource.flowVersion !== run.flowVersion || JSON.stringify(restartSource.scope) !== JSON.stringify(run.scope) || JSON.stringify(restartSource.inputs) !== JSON.stringify(run.inputs)))) throw new Error('Invalid inherited flow evidence');
      }
      run.steps.forEach((step, i) => {
        keys(object(step, 'step run'), ['stepId', 'status', 'attempts', 'startedAt', 'chatId', 'chatRunId', 'taskVersion', 'reason', 'receipt', 'decisionPending'], 'step run');
        const spec = version.definition.steps[i]!;
        if (step.reason !== undefined) text(step.reason, 'step reason', 16000, true);
        if (step.chatId !== undefined) text(step.chatId, 'step chat', 200);
        if (step.chatRunId !== undefined) text(step.chatRunId, 'step chat run', 200);
        if (step.taskVersion !== undefined) integer(step.taskVersion, 'step task', 1);
        if (step.startedAt !== undefined) integer(step.startedAt, 'step start');
        if (step.status === 'ready' && (spec.kind !== 'agent' || step.attempts >= spec.maxAttempts) || step.status === 'approval' && !['manual', 'approval'].includes(spec.kind)) throw new Error('Invalid step kind state');
        // A declared adapter step may progress on disk; its grant is re-checked live at prepare, bind, retry and every write.
        const unsupported = (spec.effect === 'external-write' && !adapted(spec)) || spec.effect === 'production' || spec.action && spec.action.kind !== 'builtin';
        if (unsupported && !['pending', 'blocked', 'cancelled'].includes(step.status)) throw new Error('Unsupported action cannot progress');
        if (step.status !== 'completed' && step.receipt) throw new Error('Unfinished step cannot have a receipt');
        if (step.decisionPending !== undefined && typeof step.decisionPending !== 'boolean') throw new Error('Invalid decision state');
        if (step.stepId !== spec.id || !['pending', 'ready', 'running', 'approval', 'blocked', 'completed', 'cancelled'].includes(step.status)) throw new Error('Invalid step');
        integer(step.attempts, 'attempts', 0, spec.maxAttempts);
        if ((i < run.currentStep) !== (step.status === 'completed') || (i > run.currentStep && step.status !== 'pending')) throw new Error('Invalid step sequence');
        if (step.status === 'completed') {
          const receipt = step.receipt;
          if (!receipt || receipt.stepId !== step.stepId || !['check', 'agent-report', 'user'].includes(receipt.kind) || !Array.isArray(receipt.evidence) || receipt.evidence.some(v => typeof v !== 'string') || !receipt.summary) throw new Error('Missing host receipt');
          keys(object(receipt, 'receipt'), ['id', 'stepId', 'kind', 'at', 'summary', 'chatId', 'reportId', 'evidence'], 'receipt');
          text(receipt.id, 'receipt id', 200); integer(receipt.at, 'receipt time');
          if (spec.kind === 'agent' && (receipt.chatId !== step.chatId || !receipt.reportId || !step.chatRunId || !step.taskVersion || spec.evidence.some(label => !receipt.evidence.some(value => value.startsWith(`${label}: `))))) throw new Error('Invalid agent receipt binding');
          if (spec.reviewOf && run.steps.find(s => s.stepId === spec.reviewOf)?.chatId === step.chatId) throw new Error('Invalid independent reviewer');
          if ((spec.kind === 'agent' && receipt.kind !== 'agent-report') || (spec.kind === 'check' && receipt.kind !== 'check') || (['approval', 'manual'].includes(spec.kind) && receipt.kind !== 'user') || (spec.effect === 'external-write' && !adapted(spec)) || spec.effect === 'production') throw new Error('Invalid receipt authority');
        }
        const carried = i < inherited;
        if (carried && (!restartSource || step.status !== 'completed' || JSON.stringify(step) !== JSON.stringify(restartSource.steps[i]))) throw new Error('Inherited prefix evidence changed');
        if (step.chatRunId) { const key = JSON.stringify([step.chatRunId, step.taskVersion]); if (observedBindings.has(key) && !carried) throw new Error('Replayed binding in storage'); observedBindings.add(key); }
        if (step.chatRunId && (!step.taskVersion || !data.bindings.includes(JSON.stringify([step.chatRunId, step.taskVersion])))) throw new Error('Missing binding ledger entry');
        if (step.status === 'running' && (spec.kind !== 'agent' || !step.chatId || !step.chatRunId || !Number.isSafeInteger(step.taskVersion) || !Number.isSafeInteger(step.startedAt))) throw new Error('Invalid agent binding');
      });
      const current = run.steps[run.currentStep]!;
      if (current && ((run.status === 'blocked') !== (current.status === 'blocked') || (run.status === 'approval') !== (current.status === 'approval') || (run.status === 'cancelled') !== (current.status === 'cancelled') || current.status === 'pending')) throw new Error('Invalid current step state');
    }
    return data;
  }
}
