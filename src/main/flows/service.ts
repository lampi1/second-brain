// Durable, fail-closed flow execution; only the host can turn trusted reports and user decisions into receipts.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FlowActivate, FlowAgentBinding, FlowDecision, FlowDraft, FlowMatch, FlowPropose, FlowReceipt, FlowReport, FlowRun, FlowScope, FlowSnapshot, FlowStart, FlowStep, FlowVerifiedReport, FlowVersion } from '../../shared/flows';
import { adapted, digest, inScope, integer, keys, normalize, object, text, validateDefinition, validateInputs, validateScope } from './schema';

export interface FlowServiceOptions {
  file: string; contextKey: string; now?: () => number; changed?: (snapshot: FlowSnapshot) => void;
  resolveReport?: (binding: FlowAgentBinding, reportId: string) => FlowVerifiedReport | null;
  /** True only while the user-approved automatic rule that started this run grants the DevOps write adapter (ADR 0145). */
  adapterGranted?: (run: FlowRun) => boolean;
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
        if (step?.status === 'running') { this.block(run, 'Interrupted: inspect the linked agent before an explicit user retry.'); run.revision++; interrupted = true; }
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
    const definition = validateDefinition(input.definition), expected = integer(input.expectedRevision, 'expectedRevision');
    return this.change(() => {
      const previous = this.data.drafts.find(d => d.definition.id === definition.id);
      if ((previous?.revision ?? 0) !== expected) throw new Error('Draft changed; review its current revision');
      const draft: FlowDraft = { definition, revision: expected + 1, updatedAt: this.now(), status: 'proposed' };
      this.data.drafts = [...this.data.drafts.filter(d => d.definition.id !== definition.id), draft]; return draft;
    });
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
  start(input: FlowStart, ownerId: string): FlowRun {
    keys(object(input, 'start'), ['flowId', 'flowVersion', 'subjectKey', 'scope', 'inputs'], 'start');
    const subjectKey = text(input.subjectKey, 'subjectKey', 500), owner = text(ownerId, 'owner', 200), scope = validateScope(input.scope), inputs = validateInputs(input.inputs);
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
      this.data.bindings.push(bindingKey);
      step.chatId = binding.chatId; step.chatRunId = binding.chatRunId; step.taskVersion = binding.taskVersion; step.status = 'running'; step.startedAt = this.now(); step.attempts++;
      this.touch(run); return run;
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
      if (input.answer !== 'yes') { this.block(run, feedback || 'User declined this step.'); step.decisionPending = false; this.touch(run); return run; }
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
      return step?.status === 'running' && now - (step.startedAt ?? 0) > this.version(run.flowId, run.flowVersion).definition.steps[run.currentStep]!.timeoutMs;
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
    if (spec.effect !== 'external-write') return false;
    if (!adapted(spec)) return true;
    try { return this.options.adapterGranted?.(run) !== true; } catch { return true; }
  }
  private finish(run: FlowRun, receipt: FlowReceipt): void { const step = run.steps[run.currentStep]!; step.status = 'completed'; delete step.reason; delete step.decisionPending; step.receipt = receipt; run.currentStep++; }
  private block(run: FlowRun, reason: string): void { run.status = 'blocked'; run.steps[run.currentStep]!.status = 'blocked'; run.steps[run.currentStep]!.decisionPending = true; run.steps[run.currentStep]!.reason = reason; run.updatedAt = this.now(); }
  private touch(run: FlowRun): void { run.revision++; run.updatedAt = this.now(); }
  private feedback(answer: unknown, value: unknown): string { if (!['yes', 'no', 'other'].includes(answer as string)) throw new Error('Invalid decision'); const result = value === undefined ? '' : text(value, 'feedback', 16000, true); if (answer === 'other' && !result) throw new Error('A different answer requires feedback'); return result; }
  private version(id: string, version: number): FlowVersion { const result = this.data.versions.find(v => v.definition.id === id && v.version === version); if (!result) throw new Error('Flow version not found'); return result; }
  private run(id: string): FlowRun { const run = this.data.runs.find(r => r.id === id); if (!run) throw new Error('Flow run not found'); return run; }
  private owner(run: FlowRun, ownerId: string): void { if (run.ownerOrchestratorId !== ownerId) throw new Error('Flow belongs to another Orchestrator'); }
  private guarded(id: string, revision: number, stepId: string): FlowRun { const run = this.run(id); if (run.revision !== revision || run.steps[run.currentStep]?.stepId !== stepId) throw new Error('Flow changed; review the current step'); return run; }
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
    try { const fd = fs.openSync(temp, 'wx', 0o600); try { fs.writeFileSync(fd, serialized); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp, this.options.file); }
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
      keys(object(run, 'run'), ['id', 'revision', 'flowId', 'flowVersion', 'definitionDigest', 'ownerOrchestratorId', 'subjectKey', 'scope', 'inputs', 'status', 'currentStep', 'steps', 'createdAt', 'updatedAt'], 'run');
      text(run.id, 'run id', 200); integer(run.revision, 'revision', 1); text(run.ownerOrchestratorId, 'owner', 200); text(run.subjectKey, 'subjectKey', 500);
      validateScope(run.scope); validateInputs(run.inputs); integer(run.createdAt, 'createdAt'); integer(run.updatedAt, 'updatedAt');
      const version = data.versions.find(v => v.definition.id === run.flowId && v.version === run.flowVersion);
      if (!version || version.digest !== run.definitionDigest || !inScope(version.definition.scope, run.scope) || runIds.has(run.id) || !Array.isArray(run.steps) || run.steps.length !== version.definition.steps.length) throw new Error('Invalid pinned flow run'); runIds.add(run.id);
      integer(run.currentStep, 'currentStep', 0, run.steps.length);
      if (!['active', 'approval', 'blocked', 'completed'].includes(run.status) || (run.status === 'completed') !== (run.currentStep === run.steps.length)) throw new Error('Invalid run status');
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
        if (unsupported && !['pending', 'blocked'].includes(step.status)) throw new Error('Unsupported action cannot progress');
        if (step.status !== 'completed' && step.receipt) throw new Error('Unfinished step cannot have a receipt');
        if (step.decisionPending !== undefined && typeof step.decisionPending !== 'boolean') throw new Error('Invalid decision state');
        if (step.stepId !== spec.id || !['pending', 'ready', 'running', 'approval', 'blocked', 'completed'].includes(step.status)) throw new Error('Invalid step');
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
        if (step.chatRunId) { const key = JSON.stringify([step.chatRunId, step.taskVersion]); if (observedBindings.has(key)) throw new Error('Replayed binding in storage'); observedBindings.add(key); }
        if (step.chatRunId && (!step.taskVersion || !data.bindings.includes(JSON.stringify([step.chatRunId, step.taskVersion])))) throw new Error('Missing binding ledger entry');
        if (step.status === 'running' && (spec.kind !== 'agent' || !step.chatId || !step.chatRunId || !Number.isSafeInteger(step.taskVersion) || !Number.isSafeInteger(step.startedAt))) throw new Error('Invalid agent binding');
      });
      const current = run.steps[run.currentStep]!;
      if (current && ((run.status === 'blocked') !== (current.status === 'blocked') || (run.status === 'approval') !== (current.status === 'approval') || current.status === 'pending')) throw new Error('Invalid current step state');
    }
    return data;
  }
}
