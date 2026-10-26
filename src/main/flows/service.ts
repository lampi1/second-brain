// Durable, fail-closed flow execution; only the host can turn trusted reports and user decisions into receipts.
import { branchLineage } from './branch-lineage';
import fs from 'node:fs';
import { progressFingerprint } from './progress';
import type { FlowAutomationRule } from '../../shared/flow-automation';
import path from 'node:path';
import { renameRetrying } from '../rules/storage';
import { createHash, randomUUID } from 'node:crypto';
import { APP_OWNER } from '../../shared/flows';
import type { FlowAttachment, FlowCommandReceipt, FlowHealEntry, FlowActivate, FlowAgentBinding, FlowCancel, FlowDecision, FlowDefinition, FlowDraft, FlowMatch, FlowPropose, FlowReceipt, FlowReport, FlowRestart, FlowRestartDecision, FlowRestartProposal, FlowRun, FlowScope, FlowSnapshot, FlowStart, FlowStep, FlowTestDbEvidence, FlowStepTierEdit, FlowVerifiedReport, FlowVersion } from '../../shared/flows';
import { adapted, commandStep, testDbAdapted, digest, type RoleTierMax, inScope, integer, keys, normalize, object, text, validateDefinition, validateInputs, validateScope } from './schema';
import { assertPackageBinding } from './binding';
import { HOLD, roleOf, samePrefix } from '../../shared/routine';

export interface FlowServiceOptions {
  progressEvidence?: (run: FlowRun) => string[];
  file: string; contextKey: string; now?: () => number; changed?: (snapshot: FlowSnapshot) => void;
  resolveReport?: (binding: FlowAgentBinding, reportId: string) => FlowVerifiedReport | null;
  /** Host diagnostics use the persisted report timestamp and canonical identity, never model-supplied receipts. */
  reportFailure?: (binding: FlowAgentBinding, reportId: string, requiredEvidence: readonly string[]) => string | undefined;
  /** True only while the user-approved automatic rule that started this run grants the declared host adapter. */
  adapterGranted?: (run: FlowRun, step: FlowStep) => boolean;
  /** The catalog's tierMax per role, checked when a draft is proposed. */
  tierMax?: RoleTierMax;
  restartBlocker?: (run: FlowRun, index: number) => string | undefined;
  /** The sha256 of a brain script/query now: a proposed step without a hash gets the current one, so the user's
   *  activation approves exactly that content (ADR 0155). */
  validateModels?: (definition: FlowDefinition) => void;
  freezeRole?: (step: FlowStep) => Pick<FlowStep, 'agentPrompt' | 'engine' | 'model' | 'tier' | 'effort'>;
  hashOf?: (kind: 'script' | 'query', ref: string) => string | null;
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
      const beforeRecovery = copy(this.data);
      let interrupted = false;
      for (const run of this.data.runs) {
        const step = run.steps[run.currentStep]!;
        // the app closed mid-step: the step blocks with its attempt counted, so the runner retries it while attempts
        // remain (ADR 0155); an open command receipt ends unknown
        if (run.status === 'active' && step?.status === 'running') {
          for (const receipt of run.receipts ?? []) if (receipt.stepId === step.stepId && receipt.endedAt === undefined) { receipt.endedAt = this.now(); receipt.exitCode = null; receipt.output = `${receipt.output}\n[interrotto: l’app si è chiusa]`.slice(-4000); }
          this.block(run, 'Interrotto: l’app si è chiusa durante questo passaggio.'); this.touch(run); interrupted = true;
        }
      }
      if (interrupted) { this.enqueueHistory(beforeRecovery); this.trace(beforeRecovery); this.save(); }
    } catch { this.storageError = 'Flow storage is invalid or unavailable; mutations are disabled. Restore the original file before restarting.'; this.data = empty(); }
  }
  private approval(run: FlowRun, rule: FlowAutomationRule): void {
    if (rule.approvedRevision !== rule.revision || rule.approvedAt === undefined || run.flowId !== rule.config.flowId || run.flowVersion !== rule.config.flowVersion || run.ownerOrchestratorId !== rule.ownerOrchestratorId) throw new Error('Invalid original automation approval');
    const approval = { ruleId: rule.id, ruleRevision: rule.revision, approvedAt: rule.approvedAt, config: copy(rule.config), sha256: createHash('sha256').update(JSON.stringify(rule.config)).digest('hex') };
    if (run.approval && JSON.stringify(run.approval) !== JSON.stringify(approval)) throw new Error('Original approval is immutable'); run.approval = approval;
  }
  settlementResult(runId: string, error?: string): void {
    const run = this.run(runId), reason = error?.slice(0, 2000); if (run.settlementError === reason) return;
    this.change(() => { if (reason) run.settlementError = reason; else delete run.settlementError; });
  }
  /** Declared outputs are immutable evidence, never automatically learned behavioural instructions. */
  output(runId: string, id: string, content: string, by: 'agent' | 'host' = 'agent'): FlowRun {
    return this.change(() => {
      const run = this.run(runId), declaration = this.version(run.flowId, run.flowVersion).definition.package?.outputs.find(o => o.id === id);
      if (by === 'agent' && this.version(run.flowId, run.flowVersion).definition.package?.intake && run.intake !== 'accepted') throw new Error('Accept intake before declared outputs');
      if (!declaration || ['completed', 'cancelled'].includes(run.status)) throw new Error('This output is not declared for an active run');
      if (by !== 'host' && this.version(run.flowId, run.flowVersion).definition.package?.downgrade?.lessonOutput === id) throw new Error('The downgrade lesson is reserved for the host; use flow_downgrade');
      const body = text(content, 'output content', 16000), sha256 = createHash('sha256').update(body).digest('hex');
      const previous = run.outputs?.find(o => o.id === id);
      if (previous) { if (by === 'host' && run.disposition) return run; /* Retain earlier evidence; the immutable disposition records the host correction. */ if (previous.sha256 !== sha256) throw new Error('Run output already exists with different content'); return run; }
      (run.outputs ??= []).push({ id, content: body, sha256, at: this.now(), ...(declaration.brainPath ? { brainPath: declaration.brainPath } : {}) });
      return run;
    });
  }
  projected(runId: string, id: string): void { this.change(() => { const output = this.run(runId).outputs?.find(o => o.id === id); if (output) output.projectedAt = this.now(); }); }
  historyResult(runId: string, id: string, error?: string): void { this.change(() => { const entry = this.run(runId).history?.find(h => h.id === id); if (!entry || entry.status === 'sent') return; if (error) entry.reason = text(error, 'history failure', 2000); else { entry.status = 'sent'; delete entry.reason; } }); }
  intake(runId: string, outcome: 'accept' | 'skip', reason: string): FlowRun {
    return this.change(() => {
      const run = this.run(runId), pack = this.version(run.flowId, run.flowVersion).definition.package;
      if (!pack?.intake || run.currentStep !== 0 || run.status !== 'active' || run.steps[0]?.status !== 'running' || run.intake) throw new Error('Intake is available once, on the first running step before writes');
      if (!['accept', 'skip'].includes(outcome)) throw new Error('Unknown intake outcome');
      const why = text(reason, 'intake reason', 2000);
      run.intake = outcome === 'accept' ? 'accepted' : 'skipped';
      if (outcome === 'skip') { run.disposition = { kind: 'skipped', reason: why, at: this.now(), cleanup: 'complete', phase: 6 }; this.cancelRun(run, why, 'routine'); }
      else this.touch(run);
      return run;
    });
  }
  fixable(runId: string): FlowRun {
    return this.change(() => { const run = this.run(runId);
      if (run.status !== 'active' || run.steps[run.currentStep]?.status !== 'running' || run.intake !== 'accepted') throw new Error('Accept intake before recording the ai-fixable verdict');
      run.verdict ??= { kind: 'ai-fixable', at: this.now(), stepId: run.steps[run.currentStep]!.stepId }; this.touch(run); return run;
    });
  }
  stepHistory(runId: string, body: string): FlowRun {
    return this.change(() => { const run = this.run(runId);
      if (run.status !== 'active' || run.steps[run.currentStep]?.status !== 'running' || !this.version(run.flowId, run.flowVersion).definition.package?.history) throw new Error('A running history-enabled step is required');
      run.steps[run.currentStep]!.historyText = text(body, 'step history', 4000); this.touch(run); return run;
    });
  }
  beginDowngrade(runId: string, reason: string, mode: 'downgrade' | 'needs-human' = 'downgrade'): FlowRun {
    return this.change(() => {
      const run = this.run(runId); if (!this.version(run.flowId, run.flowVersion).definition.package?.downgrade || ['completed', 'cancelled'].includes(run.status)) throw new Error('This run has no approved downgrade policy');
      if (run.disposition) return run;
      const pack = this.version(run.flowId, run.flowVersion).definition.package!;
      if (pack.intake && run.intake !== 'accepted') throw new Error('Accept or skip intake before human handoff');
      if (pack.intake && ((mode === 'downgrade') !== !!run.verdict)) throw new Error('Use needs-human before a fixable verdict; downgrade only after an ai-fixable verdict');
      const why = text(reason, 'downgrade reason', 2000);
      run.disposition = { kind: 'needs-human', lesson: mode === 'downgrade', reason: why, at: this.now(), cleanup: 'pending', phase: 0 };
      this.block(run, `${HOLD}Human handoff: ${why}`); run.steps[run.currentStep]!.decisionPending = false; this.touch(run); return run;
    });
  }
  downgradeProgress(runId: string, phase: number, error?: string): void {
    this.change(() => { const run = this.run(runId), d = run.disposition; if (!d || d.cleanup === 'complete') return;
      d.phase = integer(phase, 'cleanup phase', 0, 6); if (error) d.error = text(error, 'cleanup error', 2000); else delete d.error;
      if (phase === 6) { d.cleanup = 'complete'; this.cancelRun(run, d.reason, 'routine'); }
    });
  }
  snapshot(): FlowSnapshot { this.reconcileDeadlines(); return copy({ contextKey: this.options.contextKey, drafts: this.data.drafts, versions: this.data.versions, active: this.data.active, runs: this.data.runs, ...(this.storageError ? { storageError: this.storageError } : {}) }); }
  outputsSinceActive(flowId: string, ownerId: string, offset = 0): unknown {
    const version = this.version(flowId, this.data.active[flowId] ?? 0), start = integer(offset, 'offset', 0, 100000);
    const rows = this.data.runs.filter(r => r.flowId === flowId && (r.ownerOrchestratorId === ownerId || r.ownerOrchestratorId === APP_OWNER)).flatMap(r => (r.outputs ?? []).filter(o => o.at >= version.activatedAt).map(o => ({ runId: r.id, flowVersion: r.flowVersion, disposition: r.disposition?.kind, ...o }))).sort((a, b) => a.at - b.at || a.runId.localeCompare(b.runId) || a.id.localeCompare(b.id));
    return { flowId, activeVersion: version.version, since: version.activatedAt, outputs: rows.slice(start, start + 20), nextOffset: start + 20 < rows.length ? start + 20 : null, total: rows.length };
  }
  match(query: string, scope?: FlowScope): FlowMatch {
    this.healthy(); const normalized = ` ${normalize(text(query, 'query', 16000))} `, actual = scope === undefined ? undefined : validateScope(scope);
    const candidates = this.data.versions.filter(v => this.data.active[v.definition.id] === v.version && (!actual || inScope(v.definition.scope, actual))
      && [v.definition.id, ...v.definition.aliases].some(alias => normalized.includes(` ${normalize(alias)} `)))
      .sort((a, b) => a.definition.id.localeCompare(b.definition.id));
    return copy({ status: candidates.length === 0 ? 'none' : candidates.length === 1 ? 'match' : 'ambiguous', candidates });
  }
  propose(input: FlowPropose): FlowDraft {
    keys(object(input, 'proposal'), ['definition', 'expectedRevision'], 'proposal');
    const candidate = copy(input.definition);
    if (candidate.package) {
      for (const asset of candidate.package.assets ?? []) if (!asset.sha256 && typeof asset.content === 'string') asset.sha256 = createHash('sha256').update(asset.content).digest('hex');
      for (const step of candidate.steps ?? []) {
        if (step.kind === 'agent' && (!step.agentPrompt || !step.engine || !step.model || !step.tier) && this.options.freezeRole) Object.assign(step, { ...this.options.freezeRole(step), ...step });
        if (step.action && !step.action.hash) step.action.hash = candidate.package.assets?.find(a => a.id === step.action!.ref && a.kind === step.action!.kind)?.sha256;
      }
    }
    const definition = validateDefinition(candidate, this.options.tierMax), expected = integer(input.expectedRevision, 'expectedRevision');
    this.options.validateModels?.(definition);
    for (const step of definition.steps) {
      if (step.kind !== 'check' || !step.action || !['script', 'query'].includes(step.action.kind) || step.action.hash) continue;
      const hash = this.options.hashOf?.(step.action.kind as 'script' | 'query', step.action.ref);
      if (!hash) throw new Error(`${step.action.kind === 'script' ? 'Script' : 'Query'} ${step.action.ref} non trovato nel brain`);
      step.action.hash = hash;
    }
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
        this.options.validateModels?.(draft.definition);
        const version = Math.max(0, ...this.data.versions.filter(v => v.definition.id === input.id).map(v => v.version)) + 1;
        this.data.versions.push({ definition: copy(draft.definition), version, draftRevision: draft.revision, digest: digest(draft.definition), activatedAt: this.now() });
        this.data.active[input.id] = version;
      }
      return draft;
    });
  }
  /** `automatic` is passed only by the automation service: `auto:` subjects are reserved for its event starts (ADR 0145). */
  start(input: FlowStart, ownerId: string, automatic = false, approval?: FlowAutomationRule): FlowRun {
    keys(object(input, 'start'), ['flowId', 'flowVersion', 'subjectKey', 'scope', 'inputs', 'title', 'attachments'], 'start');
    const title = input.title === undefined ? undefined : text(input.title, 'title', 300), attachments = input.attachments === undefined ? undefined : validateAttachments(input.attachments);
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
        steps: version.definition.steps.map(step => ({ stepId: step.id, status: 'pending', attempts: 0 })), createdAt: this.now(), updatedAt: this.now(),
        ...(title ? { title } : {}), ...(attachments?.length ? { attachments } : {}) };
      if (approval) this.approval(run, approval);
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
    // from-step: the run's own version, or the current one when the steps before the restart point are unchanged
    // (the run migrates to it, ADR 0155); from-start: always the current version
    const active = this.data.active[source.flowId]!, migrate = input.mode === 'from-step' && input.targetVersion === active && active !== source.flowVersion;
    const version = this.version(source.flowId, input.mode === 'from-start' || migrate ? active : source.flowVersion);
    if (version.version !== input.targetVersion || version.digest !== input.targetDigest) throw new Error('Restart target changed; review the exact version again');
    const index = input.mode === 'from-start' ? 0 : version.definition.steps.findIndex(step => step.id === input.stepId);
    if (index < 0) throw new Error('Restart step not found');
    if (migrate && !samePrefix(this.version(source.flowId, source.flowVersion).definition, version.definition, index)) throw new Error('The steps before this point changed in the new version: restart from the beginning');
    if (source.steps.slice(0, index).some(step => step.status !== 'completed' || !step.receipt)) throw new Error('Every preceding step needs completed host evidence before restarting here');
    const blocker = this.options.restartBlocker?.(source, index); if (blocker) throw new Error(blocker);
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
  restart(input: FlowRestart, automatic?: Pick<FlowStart, 'subjectKey' | 'scope' | 'inputs'>, approval?: FlowAutomationRule): FlowRun {
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
        createdAt: this.now(), updatedAt: this.now(), restartOf: { runId: source.id, stepId: version.definition.steps[index]!.id, expectedRevision: input.expectedRevision, mode: input.mode, ...(index > 0 ? { branchRunId: branchLineage(source, this.data.runs).at(-1)! } : {}) } };
      if (index > 0 && version.definition.package?.intake && source.intake === 'accepted') run.intake = 'accepted';
      if (index > 0 && version.definition.package?.intake && source.verdict && source.steps.slice(0, index).some(s => s.stepId === source.verdict!.stepId)) run.verdict = copy(source.verdict);
      // Validate/prepare before cancelling the source; a thrown error rolls back the whole state transaction.
      if (approval) this.approval(run, approval);
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
      assertPackageBinding(run, definition, binding);
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
      const binding = { chatId: step.chatId, chatRunId: step.chatRunId, taskVersion: step.taskVersion }, reportId = text(input.reportId, 'reportId', 200);
      const failure = this.options.reportFailure?.(binding, reportId, definition.evidence); if (failure) throw new Error(failure);
      const report = this.options.resolveReport?.(binding, reportId);
      if (!report || !report.completed || report.id !== input.reportId || report.chatId !== step.chatId || report.chatRunId !== step.chatRunId || report.taskVersion !== step.taskVersion) throw new Error('A matching completed host-linked agent report is required');
      assertPackageBinding(run, definition, report);
      if (definition.reviewOf && (report.roleId !== 'sentinel' || report.reviewOf !== run.steps.find(s => s.stepId === definition.reviewOf)?.chatRunId)) throw new Error('Independent review must bind the reviewed agent run and Sentinel role');
      if (!report.summary.trim() || !report.evidence.length || definition.evidence.some(label => !report.evidence.some(value => value.startsWith(`${label}: `) && value.length > label.length + 2))) throw new Error('The linked report is missing required evidence');
      this.finish(run, { id: randomUUID(), stepId: step.stepId, kind: 'agent-report', at: this.now(), summary: report.summary, chatId: step.chatId, reportId: report.id, evidence: copy(report.evidence) });
      this.prepare(run); this.touch(run); return run;
    });
  }
  /** Host-only execution failure: retains binding/evidence and requires an explicit user retry. */
  blockStep(runId: string, expectedRevision: number, stepId: string, reason: string): FlowRun {
    return this.change(() => {
      const run = this.guarded(runId, expectedRevision, stepId), step = run.steps[run.currentStep]!;
      if (run.status !== 'active' || !['ready', 'running'].includes(step.status)) throw new Error('Only an active agent step can fail');
      this.block(run, text(reason, 'failure reason', 16000)); this.touch(run); return run;
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
      if (commandStep(definition) && step.status === 'approval') throw new Error('A prod step completes only through «Esegui» and its receipt');
      if (step.status === 'blocked') {
        if (step.attempts >= definition.maxAttempts) throw new Error('Retry limit reached');
        this.healed(run, { at: this.now(), stepId: step.stepId, action: 'resume', attempt: step.attempts + 1, reason: 'Explicit user retry' });
        this.reset(step); delete run.awaitingUser; this.prepare(run);
      } else {
        if (definition.evidence.some(label => !feedback.split('\n').some(line => line.startsWith(`${label}: `) && line.length > label.length + 2))) throw new Error('User note is missing required evidence labels');
        if (definition.kind === 'manual' && !feedback) throw new Error('Manual completion requires a user evidence note');
        this.finish(run, { id: randomUUID(), stepId: step.stepId, kind: 'user', at: this.now(), summary: feedback || 'Approved by user', evidence: feedback ? [feedback] : [] }); this.prepare(run);
      }
      this.touch(run); return run;
    });
  }
  /** The runner's own retry (ADR 0155): a failed or interrupted step with attempts left goes back to ready, with
   *  the failure kept in the run's heal log. Never for unsupported steps, prod steps or a step without attempts. */
  hostRetry(runId: string, expectedRevision: number, stepId: string, reason: string, action: 'retry' | 'resume' = 'retry'): FlowRun {
    return this.change(() => {
      const run = this.guarded(runId, expectedRevision, stepId), step = run.steps[run.currentStep]!, spec = this.spec(run);
      if (run.status !== 'blocked' || step.status !== 'blocked') throw new Error('Only a blocked step can be retried');
      if (step.attempts >= spec.maxAttempts || this.unsupported(run, spec) || spec.env === 'prod') throw new Error('No automatic attempt left for this step');
      this.healed(run, { at: this.now(), stepId, action, attempt: step.attempts + 1, reason: text(reason, 'reason', 16000) });
      this.reset(step); this.prepare(run); this.touch(run); return run;
    });
  }
  /** A failed check sends the work back to the step its definition names (onFail.goto), with the failure as feedback
   *  for that step's next attempt. The steps between start over; their attempts keep counting (ADR 0155). */
  sendBack(runId: string, expectedRevision: number, stepId: string, reason: string): FlowRun {
    return this.change(() => {
      const run = this.guarded(runId, expectedRevision, stepId), step = run.steps[run.currentStep]!, spec = this.spec(run);
      const definition = this.version(run.flowId, run.flowVersion).definition, target = definition.steps.findIndex(item => item.id === spec.onFail?.goto);
      const carried = run.restartOf ? definition.steps.findIndex(item => item.id === run.restartOf!.stepId) : 0;
      if (run.status !== 'blocked' || step.status !== 'blocked' || target < 0 || target >= run.currentStep || target < carried) throw new Error('This step cannot send work back');
      if (step.attempts >= spec.maxAttempts || run.steps[target]!.attempts >= definition.steps[target]!.maxAttempts) throw new Error('No automatic attempt left');
      this.healed(run, { at: this.now(), stepId, action: 'goto', to: definition.steps[target]!.id, attempt: step.attempts, reason: text(reason, 'reason', 16000) });
      for (let i = target; i <= run.currentStep; i++) { this.reset(run.steps[i]!); delete run.steps[i]!.receipt; }
      run.currentStep = target; this.prepare(run); this.touch(run); return run;
    });
  }
  /** The user's pause and resume (Routine page): a paused run starts nothing new; work already running finishes. */
  setPaused(runId: string, expectedRevision: number, paused: boolean): FlowRun {
    return this.change(() => {
      const run = this.run(text(runId, 'runId', 200));
      if (run.revision !== expectedRevision || ['completed', 'cancelled'].includes(run.status)) throw new Error('Flow changed; review the current run');
      if (paused) run.paused = { at: this.now() }; else delete run.paused;
      this.touch(run); return run;
    });
  }
  /** A newer revision of the same work item updates the active run's input instead of starting a second run. */
  updateItemRevision(runId: string, revision: string): FlowRun | null {
    const run = this.data.runs.find(item => item.id === runId);
    if (!run || ['completed', 'cancelled'].includes(run.status) || run.restartOf?.mode === 'from-step' || !/^[1-9]\d{0,9}$/.test(revision) || run.inputs['work-item-revision'] === revision) return null;
    return this.change(() => { const live = this.run(runId); live.inputs = validateInputs({ ...live.inputs, 'work-item-revision': revision }); this.touch(live); return live; });
  }
  /** Host journal of one script or query run (receipt first, so a crash still shows what started). */
  beginCommand(runId: string, expectedRevision: number, stepId: string, receipt: Omit<FlowCommandReceipt, 'id' | 'startedAt' | 'output'>): FlowCommandReceipt {
    return this.change(() => {
      const run = this.guarded(runId, expectedRevision, stepId), step = run.steps[run.currentStep]!, spec = this.spec(run);
      if (!commandStep(spec) || (receipt.by === 'runner' && (step.status !== 'ready' || spec.env === 'prod')) || (receipt.by === 'user' && step.status !== 'approval')) throw new Error('This step does not run a command now');
      if ((run.receipts?.length ?? 0) >= 500) throw new Error('Receipt limit reached');
      const made: FlowCommandReceipt = { ...receipt, id: randomUUID(), startedAt: this.now(), output: '' };
      validateReceipt(made);
      (run.receipts ??= []).push(made);
      if (receipt.by === 'runner') { step.status = 'running'; step.startedAt = this.now(); step.attempts++; run.status = 'active'; }
      this.touch(run); return made;
    });
  }
  /** The end of a command: exit 0 completes the step with a host receipt, anything else blocks it (the runner may retry). */
  finishCommand(runId: string, receiptId: string, exitCode: number | null, output: string): FlowRun {
    return this.change(() => {
      const run = this.run(runId), receipt = run.receipts?.find(item => item.id === receiptId), step = run.steps[run.currentStep];
      if (!receipt || receipt.endedAt !== undefined) throw new Error('Receipt missing or already finished');
      receipt.endedAt = this.now(); receipt.exitCode = exitCode; receipt.output = output.slice(-4000);
      if (run.status === 'cancelled' || step?.stepId !== receipt.stepId || !['running', 'approval'].includes(step.status)) { this.touch(run); return run; }
      delete run.awaitingUser;
      if (exitCode === 0) {
        if (step.status === 'approval') step.attempts++;
        this.finish(run, { id: randomUUID(), stepId: step.stepId, kind: 'check', at: this.now(), summary: `${receipt.kind} ${receipt.ref} · exit 0`, evidence: [`receipt: ${receipt.id}`, `sha256: ${receipt.sha256}`] });
        this.prepare(run);
      } else this.block(run, `${receipt.kind === 'script' ? 'Lo script' : 'La query'} ${receipt.ref} è finito con exit ${exitCode ?? 'sconosciuto'}: ${output.trim().split('\n').slice(-3).join(' ').slice(0, 600)}`);
      this.touch(run); return run;
    });
  }
  /** A prod step waits for the user's «Esegui»: the exact command they will see, filled in by the host. */
  awaitUser(runId: string, expectedRevision: number, stepId: string, command: string): FlowRun {
    return this.change(() => {
      const run = this.guarded(runId, expectedRevision, stepId), step = run.steps[run.currentStep]!, spec = this.spec(run);
      if (!commandStep(spec) || spec.env !== 'prod' || step.status !== 'approval') throw new Error('Only a prod step waits for the user');
      run.awaitingUser = { stepId, command: text(command, 'command', 16000), at: this.now() }; this.touch(run); return run;
    });
  }
  /** A content hash that no longer matches blocks the step until the user approves the new content (a new version). */
  blockChanged(runId: string, expectedRevision: number, stepId: string, reason: string): FlowRun {
    return this.change(() => { const run = this.guarded(runId, expectedRevision, stepId); this.block(run, text(reason, 'reason', 16000)); this.touch(run); return run; });
  }
  /** The user's engine/model pick on one agent step, applied at once as a new active version: their click is the
   *  approval (ADR 0155). Running runs keep their pinned version; the next runs use the new one. */
  editStepModel(input: { flowId: string; version: number; stepId: string; engine: string | null; model: string | null; effort?: string | null }): FlowVersion {
    keys(object(input, 'step model edit'), ['flowId', 'version', 'stepId', 'engine', 'model', 'effort'], 'step model edit');
    if (this.data.active[input.flowId] !== input.version) throw new Error('Definition changed; review its current version');
    const definition = copy(this.version(input.flowId, input.version).definition), step = definition.steps.find(item => item.id === input.stepId);
    if (!step || step.kind !== 'agent') throw new Error('Only an agent step takes an engine and a model');
    for (const key of ['engine', 'model', 'effort'] as const) { const value = input[key]; if (value === null || value === undefined || value === '') delete step[key]; else (step as unknown as Record<string, unknown>)[key] = value; }
    // a pick on a step without a role pins the role it already ran as, so the pick has a role to belong to
    if (!step.role && (step.engine || step.model || step.effort)) step.role = roleOf(step);
    return this.activateNow(definition);
  }
  /** The user approved a script/query's new content: the step pins the new hash in a new active version. */
  pinHash(input: { flowId: string; version: number; stepId: string; hash: string }): FlowVersion {
    if (this.data.active[input.flowId] !== input.version) throw new Error('Definition changed; review its current version');
    const definition = copy(this.version(input.flowId, input.version).definition), step = definition.steps.find(item => item.id === input.stepId);
    if (!step?.action || !['script', 'query'].includes(step.action.kind) || !/^[a-f0-9]{64}$/.test(input.hash)) throw new Error('Not a script or query step');
    step.action.hash = input.hash; return this.activateNow(definition);
  }
  private activateNow(definition: FlowDefinition): FlowVersion {
    const checked = validateDefinition(definition, this.options.tierMax);
    this.options.validateModels?.(checked);
    return this.change(() => {
      const prior = this.data.drafts.find(d => d.definition.id === checked.id), revision = (prior?.revision ?? 0) + 1;
      const version = Math.max(0, ...this.data.versions.filter(v => v.definition.id === checked.id).map(v => v.version)) + 1;
      this.data.drafts = [...this.data.drafts.filter(d => d.definition.id !== checked.id), { definition: copy(checked), revision, updatedAt: this.now(), status: 'active' }];
      const made: FlowVersion = { definition: copy(checked), version, draftRevision: revision, digest: digest(checked), activatedAt: this.now() };
      this.data.versions.push(made); this.data.active[checked.id] = version; return made;
    });
  }
  private spec(run: FlowRun): FlowStep { return this.version(run.flowId, run.flowVersion).definition.steps[run.currentStep]!; }
  private reset(step: FlowRun['steps'][number]): void { delete step.chatId; delete step.chatRunId; delete step.taskVersion; delete step.startedAt; delete step.historyText; delete step.reason; delete step.decisionPending; step.status = 'pending'; }
  private healed(run: FlowRun, entry: FlowHealEntry): void { run.heal = [...(run.heal ?? []), { ...entry, progress: progressFingerprint(run, this.options.progressEvidence?.(run)) }].slice(-50); }
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
      if (this.unsupported(run, spec)) { this.block(run, `${HOLD}Execution adapter unavailable. No external or production action was performed.`); return; }
      if (spec.inputs.some(key => !run.inputs[key]?.trim())) { this.block(run, 'Required inputs are missing. Revise the definition or start a new subject with complete inputs.'); return; }
      if (spec.kind === 'approval' || spec.kind === 'manual') { step.status = 'approval'; step.decisionPending = true; run.status = 'approval'; return; }
      if (spec.kind === 'agent') {
        if (step.attempts >= spec.maxAttempts) { this.block(run, 'Tentativi esauriti: serve una tua decisione.'); return; }
        step.status = 'ready'; return;
      }
      if (commandStep(spec)) {
        if (spec.env === 'prod') { step.status = 'approval'; step.decisionPending = true; run.status = 'approval'; return; }
        if (step.attempts >= spec.maxAttempts) { this.block(run, 'Tentativi esauriti: serve una tua decisione.'); return; }
        step.status = 'ready'; return;
      }
      step.attempts++;
      if (spec.action?.ref === 'scope-present' && (!run.scope.project || !run.scope.areaPath)) { this.block(run, 'The scope-present metadata check requires project and areaPath.'); return; }
      if (!['scope-present', 'inputs-present'].includes(spec.action?.ref ?? '')) { this.block(run, 'Check adapter unavailable.'); return; }
      this.finish(run, { id: randomUUID(), stepId: step.stepId, kind: 'check', at: this.now(), summary: `Host metadata check: ${spec.action?.ref}`, evidence: ['metadata: Metadata validated only; no test suite or external action was executed.'] });
    }
    run.status = 'completed';
  }
  /** Production and non-builtin actions never run; an external write runs only as a granted DevOps adapter step. */
  private unsupported(run: FlowRun, spec: FlowStep): boolean {
    if (commandStep(spec)) return false;
    if (spec.effect === 'production' || (spec.action && spec.action.kind !== 'builtin')) return true;
    if (spec.effect !== 'external-write' && !testDbAdapted(spec)) return false;
    if (!adapted(spec) && !testDbAdapted(spec)) return true;
    try { return this.options.adapterGranted?.(run, spec) !== true; } catch { return true; }
  }
  private finish(run: FlowRun, receipt: FlowReceipt): void { if (this.version(run.flowId, run.flowVersion).definition.package?.intake && run.currentStep === 0 && run.intake !== 'accepted') throw new Error('First call flow_intake accept or skip'); const step = run.steps[run.currentStep]!; step.status = 'completed'; delete step.reason; delete step.decisionPending; step.receipt = receipt; run.currentStep++; }
  private cancelRun(run: FlowRun, reason: string, by: 'user' | 'orchestrator' | 'routine'): void {
    run.cancellation = { at: this.now(), reason, by, expectedRevision: run.revision, interruption: run.steps[run.currentStep]?.chatId ? 'pending' : 'confirmed' }; run.status = 'cancelled';
    const step = run.steps[run.currentStep]!; step.status = 'cancelled'; step.reason = reason; step.decisionPending = false; this.touch(run);
  }
  private block(run: FlowRun, reason: string): void { run.status = 'blocked'; run.steps[run.currentStep]!.status = 'blocked'; run.steps[run.currentStep]!.decisionPending = true; run.steps[run.currentStep]!.reason = reason; run.updatedAt = this.now(); }
  private touch(run: FlowRun): void { delete run.pendingRecovery; delete run.pendingCancellation; run.revision++; run.updatedAt = this.now(); }
  private feedback(answer: unknown, value: unknown): string { if (!['yes', 'no', 'other'].includes(answer as string)) throw new Error('Invalid decision'); const result = value === undefined ? '' : text(value, 'feedback', 16000, true); if (answer === 'other' && !result) throw new Error('A different answer requires feedback'); return result; }
  private version(id: string, version: number): FlowVersion { const result = this.data.versions.find(v => v.definition.id === id && v.version === version); if (!result) throw new Error('Flow version not found'); return result; }
  private run(id: string): FlowRun { const run = this.data.runs.find(r => r.id === id); if (!run) throw new Error('Flow run not found'); return run; }
  /** App-owned runs (the runner's) are shared: any Orchestrator may read and steer them; the host still checks every step. */
  private owner(run: FlowRun, ownerId: string): void { if (run.ownerOrchestratorId !== ownerId && run.ownerOrchestratorId !== APP_OWNER) throw new Error('Flow belongs to another Orchestrator'); }
  private guarded(id: string, revision: number, stepId: string): FlowRun { const run = this.run(id); if (['completed', 'cancelled'].includes(run.status) || run.revision !== revision || run.steps[run.currentStep]?.stepId !== stepId) throw new Error('Flow changed; review the current step'); return run; }
  private healthy(): void { if (this.storageError) throw new Error(this.storageError); }
  private change<T>(mutate: () => T): T {
    this.healthy(); const before = copy(this.data);
    try { const value = mutate(); this.enqueueHistory(before); this.trace(before); this.save(); try { this.options.changed?.(this.snapshot()); } catch { /* observer failure must not undo a durable commit */ } return copy(value); }
    catch (error) { this.data = before; throw error; }
  }
  private trace(before: Stored): void {
    for (const run of this.data.runs) {
      const old = before.runs.find(r => r.id === run.id), events: NonNullable<FlowRun['trace']> = [];
      const add = (kind: NonNullable<FlowRun['trace']>[number]['kind'], message: string, stepId?: string) => events.push({ id: randomUUID(), at: this.now(), kind, message: message.slice(0, 4000), ...(stepId ? { stepId } : {}) });
      if (!old) add('transition', `Run started on approved version ${run.flowVersion} (${run.definitionDigest})`);
      if (old && old.status !== run.status) add('transition', `${old.status} → ${run.status}`);
      if (!!old?.paused !== !!run.paused) add('pause', run.paused ? 'User paused the run' : 'User resumed the run');
      for (const [index, step] of run.steps.entries()) {
        const previous = old?.steps[index];
        if (previous?.status !== step.status || previous?.attempts !== step.attempts || previous?.chatRunId !== step.chatRunId || previous?.reason !== step.reason) add(step.receipt?.kind === 'user' ? 'decision' : 'transition', `${previous?.status ?? 'new'} → ${step.status}; attempt ${step.attempts}; ${step.reason ?? step.receipt?.summary ?? ''}`, step.stepId);
      }
      for (const o of run.outputs ?? []) if (!old?.outputs?.some(x => x.id === o.id)) add('output', `Declared output ${o.id} saved with sha256 ${o.sha256}`);
      if (old?.settlementError !== run.settlementError) add('cleanup', run.settlementError ?? 'Settlement recovered');
      if (JSON.stringify(old?.disposition) !== JSON.stringify(run.disposition)) add('cleanup', JSON.stringify(run.disposition));
      if (events.length) { if ((run.trace?.length ?? 0) + events.length > 2000) throw new Error('Routine timeline limit reached; stop and inspect the run'); (run.trace ??= []).push(...events); }
    }
  }
  private enqueueHistory(before: Stored): void {
    for (const run of this.data.runs) {
      const definition = this.version(run.flowId, run.flowVersion).definition; if (!definition.package?.history || (definition.package.intake && run.intake !== 'accepted') || run.disposition?.kind === 'skipped') continue;
      const old = before.runs.find(r => r.id === run.id), entries: NonNullable<FlowRun['history']> = [];
      if (!old && !definition.package.intake) entries.push({ id: `intake:${run.id}`, stepId: run.steps[0]!.stepId, at: this.now(), status: 'pending', text: `${definition.title} v${run.flowVersion} · intake. Run ${run.id}. Next: ${definition.steps[0]!.title}.`, mentionReason: 'intake' });
      for (const [index, step] of run.steps.entries()) {
        const previous = old?.steps[index]; if (!['completed', 'blocked', 'cancelled'].includes(step.status) || (previous?.status === step.status && previous.reason === step.reason && previous.receipt?.id === step.receipt?.id)) continue;
        if (run.disposition?.cleanup === 'complete' && old?.disposition) continue;
        const summary = [step.reason ?? step.receipt?.summary ?? step.status, step.historyText].filter(Boolean).join(' · ').slice(0, 5000), evidence = (step.receipt?.evidence ?? []).slice(0, 4).map(e => e.slice(0, 350)).join(' · ');
        const id = createHash('sha256').update(JSON.stringify([run.id, step.stepId, step.attempts, step.status, step.receipt?.id, step.reason])).digest('hex');
        const next = run.disposition ? 'human handoff and cleanup' : definition.steps[run.currentStep]?.title ?? 'routine complete';
        entries.push({ id, stepId: step.stepId, at: this.now(), status: 'pending', text: `${definition.steps[index]!.title} · attempt ${step.attempts} · ${step.status}. ${summary}${evidence ? ` Evidence: ${evidence}` : ''} Next: ${next}. Run ${run.id}.`, ...(run.disposition ? { mentionReason: run.disposition.lesson === false ? 'final' as const : 'downgrade' as const } : step.status === 'blocked' ? { mentionReason: 'block' as const } : run.status === 'completed' ? { mentionReason: 'final' as const } : index === 0 && definition.package.intake ? { mentionReason: 'intake' as const } : {}) });
      }
      for (const entry of entries) if (!run.history?.some(h => h.id === entry.id)) { if ((run.history?.length ?? 0) >= 500) throw new Error('Run history limit reached'); (run.history ??= []).push(entry); }
    }
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
      keys(object(run, 'run'), ['id', 'revision', 'flowId', 'flowVersion', 'definitionDigest', 'ownerOrchestratorId', 'subjectKey', 'scope', 'inputs', 'status', 'currentStep', 'steps', 'createdAt', 'updatedAt', 'testDbEvidence', 'cancellation', 'restartOf', 'pendingRecovery', 'pendingCancellation', 'recoveryFeedback', 'paused', 'attachments', 'receipts', 'heal', 'awaitingUser', 'title', 'outputs', 'disposition', 'history', 'trace', 'approval', 'settlementError', 'intake', 'verdict'], 'run');
      if (run.paused !== undefined) { keys(object(run.paused, 'paused'), ['at'], 'paused'); integer(run.paused.at, 'paused time'); }
      if (run.attachments !== undefined) validateAttachments(run.attachments);
      if (run.receipts !== undefined) { if (!Array.isArray(run.receipts) || run.receipts.length > 500) throw new Error('Invalid receipts'); run.receipts.forEach(validateReceipt); }
      if (run.heal !== undefined) validateHeal(run.heal);
      if (run.awaitingUser !== undefined) { keys(object(run.awaitingUser, 'awaiting'), ['stepId', 'command', 'at'], 'awaiting'); text(run.awaitingUser.stepId, 'awaiting step', 80); text(run.awaitingUser.command, 'awaiting command', 16000); integer(run.awaitingUser.at, 'awaiting time'); }
      if (run.settlementError !== undefined) text(run.settlementError, 'settlement error', 2000);
      if (run.title !== undefined) text(run.title, 'title', 300);
      text(run.id, 'run id', 200); integer(run.revision, 'revision', 1); text(run.ownerOrchestratorId, 'owner', 200); text(run.subjectKey, 'subjectKey', 500);
      validateScope(run.scope); validateInputs(run.inputs); integer(run.createdAt, 'createdAt'); integer(run.updatedAt, 'updatedAt');
      const version = data.versions.find(v => v.definition.id === run.flowId && v.version === run.flowVersion);
      if (!version || version.digest !== run.definitionDigest || !inScope(version.definition.scope, run.scope) || runIds.has(run.id) || !Array.isArray(run.steps) || run.steps.length !== version.definition.steps.length) throw new Error('Invalid pinned flow run'); runIds.add(run.id);
      if (run.approval) { const a = run.approval; keys(object(a, 'approval'), ['ruleId', 'ruleRevision', 'approvedAt', 'config', 'sha256'], 'approval'); integer(a.ruleRevision, 'approval revision', 1); integer(a.approvedAt, 'approval time'); text(a.ruleId, 'approval rule', 200); if (a.config.flowId !== run.flowId || a.config.flowVersion !== run.flowVersion || createHash('sha256').update(JSON.stringify(a.config)).digest('hex') !== a.sha256) throw new Error('Invalid original approval fingerprint'); }
      if (run.trace) { if (!Array.isArray(run.trace) || run.trace.length > 2000) throw new Error('Invalid routine timeline'); for (const e of run.trace) { keys(object(e, 'trace'), ['id', 'at', 'kind', 'stepId', 'message'], 'trace'); text(e.id, 'event id', 200); integer(e.at, 'event time'); text(e.message, 'event message', 4000, true); if (!['transition', 'output', 'cleanup', 'pause', 'decision'].includes(e.kind) || (e.stepId && !run.steps.some(s => s.stepId === e.stepId))) throw new Error('Invalid trace event'); } }
      if (run.outputs) {
        if (!Array.isArray(run.outputs) || run.outputs.length > 50 || new Set(run.outputs.map(o => o.id)).size !== run.outputs.length) throw new Error('Invalid outputs');
        for (const o of run.outputs) { keys(object(o, 'output'), ['id', 'at', 'content', 'sha256', 'brainPath', 'projectedAt'], 'output'); const declared = version.definition.package?.outputs.find(d => d.id === o.id);
          if (!declared || declared.brainPath !== o.brainPath || createHash('sha256').update(text(o.content, 'output', 16000)).digest('hex') !== o.sha256) throw new Error('Invalid output provenance'); integer(o.at, 'output time'); if (o.projectedAt !== undefined) integer(o.projectedAt, 'projected time'); }
      }
      if (run.intake !== undefined && (!version.definition.package?.intake || !['accepted', 'skipped'].includes(run.intake))) throw new Error('Invalid intake outcome');
      if (run.verdict) { keys(object(run.verdict, 'verdict'), ['kind', 'at', 'stepId'], 'verdict'); if (run.verdict.kind !== 'ai-fixable' || run.intake !== 'accepted' || !run.steps.some(s => s.stepId === run.verdict!.stepId)) throw new Error('Invalid fixable verdict'); integer(run.verdict.at, 'verdict time'); }
      if (run.disposition) { const d = run.disposition; keys(object(d, 'disposition'), ['kind', 'reason', 'at', 'cleanup', 'phase', 'error', 'lesson'], 'disposition');
        if (!version.definition.package || !['needs-human', 'skipped'].includes(d.kind) || (d.kind === 'needs-human' && !version.definition.package.downgrade) || (d.kind === 'skipped' && (!version.definition.package.intake || run.intake !== 'skipped' || run.status !== 'cancelled' || d.cleanup !== 'complete')) || (d.lesson !== undefined && typeof d.lesson !== 'boolean') || !['pending', 'complete'].includes(d.cleanup)) throw new Error('Invalid disposition'); text(d.reason, 'handoff reason', 2000); integer(d.at, 'handoff time'); integer(d.phase, 'handoff phase', 0, 6); if (d.error) text(d.error, 'handoff error', 2000); }
      if (run.history) { if (!version.definition.package?.history || !Array.isArray(run.history) || run.history.length > 500) throw new Error('Invalid run history');
        for (const h of run.history) { keys(object(h, 'history'), ['id', 'stepId', 'at', 'text', 'status', 'reason', 'mentionReason'], 'history'); text(h.id, 'history id', 200); integer(h.at, 'history time'); text(h.text, 'history text', 10000); if (!run.steps.some(s => s.stepId === h.stepId) || !['pending', 'sent'].includes(h.status)) throw new Error('Invalid history entry'); if (h.reason) text(h.reason, 'history error', 2000); if (h.mentionReason && !['intake', 'block', 'downgrade', 'final'].includes(h.mentionReason)) throw new Error('Invalid mention reason'); }
      }
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
        if (!['user', 'orchestrator', 'routine'].includes(run.cancellation.by)) throw new Error('Invalid cancellation authority');
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
        const origin = run.restartOf; keys(object(origin, 'restart origin'), ['runId', 'branchRunId', 'stepId', 'expectedRevision', 'mode'], 'restart origin');
        restartSource = data.runs.find(item => item.id === origin.runId);
        integer(origin.expectedRevision, 'restart source revision', 1);
        inherited = version.definition.steps.findIndex(step => step.id === origin.stepId);
        if (!restartSource || restartSource.id === run.id || !runIds.has(restartSource.id) || restartSource.flowId !== run.flowId || restartSource.ownerOrchestratorId !== run.ownerOrchestratorId || inherited < 0 || !['from-start', 'from-step'].includes(origin.mode)
          || (origin.mode === 'from-start' && inherited !== 0) || (origin.mode === 'from-step' && ((restartSource.flowVersion !== run.flowVersion && !samePrefix(data.versions.find(v => v.definition.id === run.flowId && v.version === restartSource!.flowVersion)?.definition, version.definition, inherited)) || JSON.stringify(restartSource.scope) !== JSON.stringify(run.scope) || JSON.stringify(restartSource.inputs) !== JSON.stringify(run.inputs)))) throw new Error('Invalid inherited flow evidence');
        branchLineage(run, data.runs);
      }
      run.steps.forEach((step, i) => {
        keys(object(step, 'step run'), ['stepId', 'status', 'attempts', 'startedAt', 'chatId', 'chatRunId', 'taskVersion', 'reason', 'receipt', 'decisionPending', 'historyText'], 'step run');
        if (step.historyText !== undefined) text(step.historyText, 'step history', 4000);
        const spec = version.definition.steps[i]!;
        if (step.reason !== undefined) text(step.reason, 'step reason', 16000, true);
        if (step.chatId !== undefined) text(step.chatId, 'step chat', 200);
        if (step.chatRunId !== undefined) text(step.chatRunId, 'step chat run', 200);
        if (step.taskVersion !== undefined) integer(step.taskVersion, 'step task', 1);
        if (step.startedAt !== undefined) integer(step.startedAt, 'step start');
        const command = commandStep(spec);
        if (step.status === 'ready' && ((spec.kind !== 'agent' && !command) || step.attempts >= spec.maxAttempts) || step.status === 'approval' && !['manual', 'approval'].includes(spec.kind) && !(command && spec.env === 'prod')) throw new Error('Invalid step kind state');
        // A declared adapter step may progress on disk; its grant is re-checked live at prepare, bind, retry and every write.
        const unsupported = !command && ((spec.effect === 'external-write' && !adapted(spec)) || spec.effect === 'production' || spec.action && spec.action.kind !== 'builtin');
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
          if ((spec.kind === 'agent' && receipt.kind !== 'agent-report') || (spec.kind === 'check' && receipt.kind !== 'check') || (['approval', 'manual'].includes(spec.kind) && receipt.kind !== 'user') || (!command && ((spec.effect === 'external-write' && !adapted(spec)) || spec.effect === 'production'))) throw new Error('Invalid receipt authority');
        }
        const carried = i < inherited;
        if (carried && (!restartSource || step.status !== 'completed' || JSON.stringify(step) !== JSON.stringify(restartSource.steps[i]))) throw new Error('Inherited prefix evidence changed');
        if (step.chatRunId) { const key = JSON.stringify([step.chatRunId, step.taskVersion]); if (observedBindings.has(key) && !carried) throw new Error('Replayed binding in storage'); observedBindings.add(key); }
        if (step.chatRunId && (!step.taskVersion || !data.bindings.includes(JSON.stringify([step.chatRunId, step.taskVersion])))) throw new Error('Missing binding ledger entry');
        if (step.status === 'running' && !command && (spec.kind !== 'agent' || !step.chatId || !step.chatRunId || !Number.isSafeInteger(step.taskVersion) || !Number.isSafeInteger(step.startedAt))) throw new Error('Invalid agent binding');
      });
      const current = run.steps[run.currentStep]!;
      if (current && ((run.status === 'blocked') !== (current.status === 'blocked') || (run.status === 'approval') !== (current.status === 'approval') || (run.status === 'cancelled') !== (current.status === 'cancelled') || current.status === 'pending')) throw new Error('Invalid current step state');
    }
    return data;
  }
}

function validateAttachments(value: unknown): FlowAttachment[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('attachments: up to 20');
  const names = new Set<string>();
  return value.map((v: unknown) => {
    const a = object(v, 'attachment'); keys(a, ['name', 'sha256', 'size', 'lines', 'at'], 'attachment');
    const name = text(a.name, 'attachment name', 120);
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/.test(name) || names.has(name.toLowerCase())) throw new Error('attachment name: letters, digits, space . _ - and unique'); names.add(name.toLowerCase());
    if (typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256)) throw new Error('attachment sha256');
    return { name, sha256: a.sha256, size: integer(a.size, 'attachment size', 0, 10 * 1024 * 1024), lines: integer(a.lines, 'attachment lines'), at: integer(a.at, 'attachment time') };
  });
}
function validateReceipt(r: FlowCommandReceipt): void {
  keys(r as unknown as Record<string, unknown>, ['id', 'stepId', 'kind', 'ref', 'command', 'args', 'sha256', 'env', 'startedAt', 'endedAt', 'exitCode', 'output', 'by'], 'receipt');
  text(r.id, 'receipt id', 200); text(r.stepId, 'receipt step', 80); text(r.ref, 'receipt ref', 80); text(r.command, 'receipt command', 16000); text(r.output, 'receipt output', 4000, true);
  if (!['script', 'query'].includes(r.kind) || !['test', 'prod'].includes(r.env) || !['runner', 'user'].includes(r.by) || !/^[a-f0-9]{64}$/.test(r.sha256)) throw new Error('Invalid receipt');
  const args = object(r.args, 'receipt args');
  if (Object.keys(args).length > 30 || Object.entries(args).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(key) || typeof value !== 'string' || value.length > 16000)) throw new Error('Invalid receipt args');
  integer(r.startedAt, 'receipt start');
  if (r.endedAt !== undefined) integer(r.endedAt, 'receipt end');
  if (r.exitCode !== undefined && r.exitCode !== null && !Number.isSafeInteger(r.exitCode)) throw new Error('Invalid receipt exit code');
}
function validateHeal(value: unknown): void {
  if (!Array.isArray(value) || value.length > 50) throw new Error('Invalid heal log');
  for (const v of value) {
    const e = object(v, 'heal'); keys(e, ['at', 'stepId', 'action', 'to', 'attempt', 'reason', 'progress'], 'heal');
    if (e.progress !== undefined && (typeof e.progress !== 'string' || !/^[a-f0-9]{64}$/.test(e.progress))) throw new Error('Invalid progress fingerprint');
    integer(e.at, 'heal time'); text(e.stepId, 'heal step', 80); integer(e.attempt, 'heal attempt'); text(e.reason, 'heal reason', 16000);
    if (!['retry', 'goto', 'resume'].includes(e.action as string) || (e.to !== undefined && typeof e.to !== 'string')) throw new Error('Invalid heal entry');
  }
}
/** True when the first `count` steps of two versions are the same steps (a run can carry their evidence across). */
