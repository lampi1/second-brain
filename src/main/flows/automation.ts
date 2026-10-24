// Durable token-free automatic-flow detection and notification; authenticated Orchestrators alone start runs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { FlowRun } from '../../shared/flows';
import { DEVOPS_WRITE_OPS, type DevOpsWriteGrant } from '../../shared/flow-automation';
import type { FlowAutomationConfig, FlowAutomationControl, FlowAutomationDecision, FlowAutomationEvent, FlowAutomationPause, FlowAutomationPropose, FlowAutomationRule, FlowAutomationSnapshot, FlowDetectionResult } from '../../shared/flow-automation';
import type { FlowService } from './service';
import { adapted, identifier, inScope, integer, keys, object, text, validateInputs, validateScope } from './schema';

export interface FlowAutomationOptions {
  file: string; flow: () => FlowService;
  detect: (config: FlowAutomationConfig, cursor: Record<string, string>, signal?: AbortSignal) => Promise<FlowDetectionResult>;
  dispatch: (rule: FlowAutomationRule, event: FlowAutomationEvent) => Promise<boolean>;
  now?: () => number; changed?: () => void;
}
type Stored = Omit<FlowAutomationSnapshot, 'storageError'> & { schema: 1; cursors: Record<string, Record<string, string>>; seen: string[] };
const empty = (): Stored => ({ schema: 1, revision: 0, paused: false, background: false, rules: [], events: [], cursors: {}, seen: [] });
const copy = <T>(value: T): T => structuredClone(value);
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pending = (event: FlowAutomationEvent): boolean => ['pending', 'notified', 'blocked'].includes(event.status);
const MAX_EVENTS = 200, MAX_HISTORY = 2000, MAX_SEEN = 20000;
const DEVOPS_INPUTS = ['work-item-id', 'work-item-revision', 'work-item-url'];
/** Detector cursors are opaque state, not flow input names; preserve their strings exactly. */
function validateCursor(value: unknown): Record<string, string> {
  const raw = object(value, 'detector cursor'), entries = Object.entries(raw), prototype = Object.getPrototypeOf(raw);
  if ((prototype !== Object.prototype && prototype !== null) || entries.length > 10001) throw new Error('Invalid or oversized detector cursor');
  for (const [key, value] of entries) {
    text(key, 'cursor key', 200);
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe detector cursor key');
    text(value, 'cursor value', 16000, true);
  }
  if (Buffer.byteLength(JSON.stringify(raw)) > 2 * 1024 * 1024) throw new Error('Detector cursor exceeds byte limit');
  return Object.fromEntries(entries) as Record<string, string>;
}
/** Azure DevOps organization, project and field reference names; values come only from the user-approved rule. */
const ORGANIZATION = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$/, FIELD = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/, PROJECT_UNSAFE = /[/\\\x00-\x1f\x7f]/;
/** Fields no grant may name: identity, revision and project are host-owned. */
const FIXED_FIELDS = ['system.id', 'system.rev', 'system.teamproject', 'system.workitemtype', 'system.tags'];
function validateGrant(value: unknown, trigger: Extract<FlowAutomationConfig['trigger'], { kind: 'devops' }>): DevOpsWriteGrant {
  const raw = object(value, 'devopsWrite'); keys(raw, ['organization', 'projects', 'ops', 'fields'], 'devopsWrite');
  const organization = text(raw.organization, 'devopsWrite organization', 50);
  if (!ORGANIZATION.test(organization) || organization.toLowerCase() !== trigger.organization.toLowerCase()) throw new Error('DevOps write organization must equal the trigger organization');
  const list = (v: unknown, label: string, max: number, itemMax: number): string[] => {
    if (!Array.isArray(v) || v.length > max) throw new Error(`${label}: invalid list`);
    const values = v.map(item => text(item, label, itemMax));
    if (new Set(values.map(item => item.toLowerCase())).size !== values.length) throw new Error(`${label}: duplicate value`);
    return values;
  };
  const projects = list(raw.projects, 'devopsWrite projects', 10, 128), ops = list(raw.ops, 'devopsWrite ops', DEVOPS_WRITE_OPS.length, 40), fields = list(raw.fields, 'devopsWrite fields', 20, 128);
  if (!projects.length || projects.some(p => PROJECT_UNSAFE.test(p) || p === '.' || p === '..')) throw new Error('DevOps write needs at least one valid project');
  if (!projects.some(p => p.toLowerCase() === trigger.project.toLowerCase())) throw new Error('DevOps write projects must include the trigger project');
  if (!ops.length || ops.some(op => !(DEVOPS_WRITE_OPS as readonly string[]).includes(op))) throw new Error('Unknown DevOps write operation');
  if (fields.some(field => !FIELD.test(field) || FIXED_FIELDS.includes(field.toLowerCase()))) throw new Error('Invalid DevOps write field');
  if (fields.length && !ops.includes('fields') || !fields.length && ops.includes('fields')) throw new Error('DevOps write fields and the fields operation go together');
  return { organization, projects, ops: ops as DevOpsWriteGrant['ops'], fields };
}
const errorText = (error: unknown): string => (error instanceof Error ? error.message : 'Automatic flow operation failed').slice(0, 2000);

export class FlowAutomationService {
  private data: Stored = empty();
  private storageError?: string;
  private stopped = false;
  /** Event whose run flow.start is creating now (synchronous, in memory only). */
  private starting?: string;
  private generation = 0;
  private running?: Promise<void>;
  private controller?: AbortController;
  private readonly now: () => number;
  constructor(private readonly options: FlowAutomationOptions) {
    this.now = options.now ?? Date.now;
    try {
      if (fs.existsSync(options.file)) {
        if (fs.statSync(options.file).size > 8 * 1024 * 1024) throw new Error('Storage exceeds limit');
        this.data = this.read(fs.readFileSync(options.file, 'utf8'));
      }
    } catch { this.data = empty(); this.storageError = 'Automatic flow storage is invalid or unavailable; restore the original file before restarting.'; }
  }
  snapshot(): FlowAutomationSnapshot {
    const { revision, paused, background, rules, events } = this.data;
    return copy({ revision, paused, background, rules, events, ...(this.storageError ? { storageError: this.storageError } : {}) });
  }
  propose(input: FlowAutomationPropose, ownerId: string): FlowAutomationRule {
    keys(object(input, 'automatic flow proposal'), ['config', 'expectedRevision'], 'automatic flow proposal');
    const config = this.config(input.config), owner = text(ownerId, 'owner', 200), expected = integer(input.expectedRevision, 'expectedRevision');
    this.usable(config);
    return this.change(() => {
      const prior = this.data.rules.find(rule => rule.config.flowId === config.flowId);
      if ((prior?.revision ?? 0) !== expected) throw new Error('Automatic flow changed; review its current revision');
      if (!prior && this.data.rules.length >= 100) throw new Error('Automatic flow rule limit reached');
      const rule: FlowAutomationRule = { id: prior?.id ?? randomUUID(), revision: expected + 1, config, ownerOrchestratorId: owner, status: 'proposed', createdAt: prior?.createdAt ?? this.now(), updatedAt: this.now(), failures: 0 };
      this.cancel(rule.id, 'Configuration replaced; exact revision needs user approval');
      delete this.data.cursors[rule.id];
      this.data.rules = [...this.data.rules.filter(item => item.id !== rule.id), rule];
      this.invalidate(); return rule;
    });
  }
  /** Renderer-only exact revision decision; no agent tool exposes this authority. */
  decide(input: FlowAutomationDecision): FlowAutomationRule {
    keys(object(input, 'automatic flow decision'), ['id', 'expectedRevision', 'answer', 'feedback'], 'automatic flow decision');
    if (!['yes', 'no', 'other'].includes(input.answer)) throw new Error('Invalid decision');
    const feedback = input.feedback === undefined ? undefined : text(input.feedback, 'feedback', 16000, true);
    if (input.answer === 'other' && !feedback) throw new Error('A different answer requires feedback');
    return this.change(() => {
      const rule = this.guarded(input.id, input.expectedRevision);
      if (rule.status !== 'proposed') throw new Error('Automatic flow decision is stale');
      if (input.answer === 'yes') this.usable(rule.config);
      rule.status = input.answer === 'yes' ? 'enabled' : 'rejected'; rule.updatedAt = this.now(); rule.feedback = feedback;
      if (input.answer === 'yes') { rule.approvedRevision = rule.revision; rule.approvedAt = this.now(); rule.nextCheckAt = this.now(); }
      else this.cancel(rule.id, 'User declined configuration');
      this.invalidate(); return rule;
    });
  }
  pause(input: FlowAutomationPause): FlowAutomationRule {
    keys(object(input, 'automatic flow pause'), ['id', 'expectedRevision', 'paused'], 'automatic flow pause');
    if (typeof input.paused !== 'boolean') throw new Error('Invalid pause state');
    return this.change(() => {
      const rule = this.guarded(input.id, input.expectedRevision);
      if (rule.approvedRevision !== rule.revision || !['enabled', 'paused'].includes(rule.status)) throw new Error('Exact configuration must be approved first');
      if (!input.paused) this.usable(rule.config);
      rule.status = input.paused ? 'paused' : 'enabled'; rule.updatedAt = this.now();
      if (!input.paused) this.retry(rule.id);
      this.invalidate(); return rule;
    });
  }
  control(input: FlowAutomationControl): FlowAutomationSnapshot {
    keys(object(input, 'automatic flow control'), ['expectedRevision', 'paused', 'background'], 'automatic flow control');
    integer(input.expectedRevision, 'expectedRevision');
    if (input.paused !== undefined && typeof input.paused !== 'boolean' || input.background !== undefined && typeof input.background !== 'boolean') throw new Error('Invalid automatic flow control');
    this.change(() => {
      if (input.expectedRevision !== this.data.revision) throw new Error('Automatic flow settings changed');
      if (input.paused !== undefined) { this.data.paused = input.paused; if (!input.paused) for (const rule of this.data.rules) if (rule.status === 'enabled') this.retry(rule.id); }
      if (input.background !== undefined) this.data.background = input.background;
      this.invalidate();
    });
    return this.snapshot();
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped || this.storageError || this.data.paused) return Promise.resolve();
    let resolve!: () => void, reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    // Publish the flight before observers can reenter tick during a synchronous interval commit.
    this.running = promise;
    void this.poll().then(() => { this.running = undefined; resolve(); }, error => { this.running = undefined; reject(error); });
    return promise;
  }
  /** Called only by the authenticated Orchestrator mount; the event supplies all run identity and inputs. */
  startEvent(eventId: string, ownerId: string): FlowRun {
    this.healthy();
    const event = this.data.events.find(item => item.id === text(eventId, 'eventId', 200));
    if (!event) throw new Error('Automatic flow event not found');
    const rule = this.data.rules.find(item => item.id === event.ruleId);
    if (!rule || rule.ownerOrchestratorId !== ownerId) throw new Error('Automatic flow belongs to another Orchestrator');
    if (event.ruleRevision !== rule.revision || event.status === 'cancelled') throw new Error('Automatic flow event is stale');
    const flow = this.options.flow(), snapshot = flow.snapshot();
    const existing = snapshot.runs.find(run => run.flowId === rule.config.flowId && run.flowVersion === rule.config.flowVersion && run.subjectKey === event.subjectKey);
    // Recover a flow commit even if the process died before the event ledger commit.
    if (existing) {
      if (existing.ownerOrchestratorId !== ownerId || hash(existing.inputs) !== hash(event.inputs) || hash(existing.scope) !== hash(rule.config.scope)) throw new Error('Automatic flow run identity mismatch');
      this.change(() => { event.status = 'started'; event.runId = existing.id; event.updatedAt = this.now(); delete event.reason; }); return existing;
    }
    if (this.data.paused || rule.status !== 'enabled' || rule.approvedRevision !== rule.revision) throw new Error('Automatic flow is paused or not approved');
    if (!['pending', 'notified'].includes(event.status)) throw new Error('Automatic flow event is blocked; resume explicitly to retry');
    try { this.usable(rule.config, event.inputs); } catch (error) { this.blockEvent(event, errorText(error)); throw error; }
    const occupied = snapshot.runs.filter(run => run.status !== 'completed' && this.data.rules.some(item => run.subjectKey.startsWith(`auto:${item.id}:`)));
    if (occupied.length >= 2 || occupied.some(run => run.subjectKey.startsWith(`auto:${rule.id}:`))) throw new Error('Automatic flow concurrency limit reached; event remains queued');
    // While flow.start prepares the first step, grantFor accepts only this event's own start (before runId is recorded).
    this.starting = event.id;
    let run: FlowRun;
    try { run = flow.start({ flowId: rule.config.flowId, flowVersion: rule.config.flowVersion, subjectKey: event.subjectKey, scope: copy(rule.config.scope), inputs: copy(event.inputs) }, ownerId, true); }
    finally { this.starting = undefined; }
    this.change(() => { event.status = 'started'; event.runId = run.id; event.updatedAt = this.now(); delete event.reason; });
    return run;
  }
  /** The DevOps write grant of a run started from this rule's own event, or null: enabled exact revision, same owner,
   *  scope and inputs, the global switch on. Every adapter write re-checks it (ADR 0145). */
  grantFor(run: FlowRun): { grant: DevOpsWriteGrant; workItemId: number } | null {
    if (this.stopped || this.storageError || this.data.paused) return null;
    const match = /^auto:([^:]+):(\d+):[a-f0-9]{64}$/.exec(run.subjectKey);
    const rule = match && this.data.rules.find(item => item.id === match[1]);
    if (!rule || String(rule.revision) !== match![2] || rule.status !== 'enabled' || rule.approvedRevision !== rule.revision || !rule.config.devopsWrite || rule.config.trigger.kind !== 'devops'
      || rule.config.flowId !== run.flowId || rule.config.flowVersion !== run.flowVersion || rule.ownerOrchestratorId !== run.ownerOrchestratorId || hash(rule.config.scope) !== hash(run.scope)) return null;
    const event = this.data.events.find(item => item.ruleId === rule.id && item.subjectKey === run.subjectKey);
    // Only a run the host started from this event: recorded as started with this run id, or being started right now.
    const own = (event?.status === 'started' && event.runId === run.id) || (event !== undefined && this.starting === event.id && event.runId === undefined);
    if (!event || !own || event.ruleRevision !== rule.revision || hash(event.inputs) !== hash(run.inputs)) return null;
    const id = run.inputs['work-item-id'];
    if (!id || !/^[1-9]\d{0,9}$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
    // No flow snapshot here: the flow service may call this inside its own commit; poll re-checks usable() each tick.
    return { grant: copy(rule.config.devopsWrite), workItemId: Number(id) };
  }
  stop(): void { this.stopped = true; this.invalidate(); }
  private async poll(): Promise<void> {
    const generation = this.generation, flow = this.options.flow(), context = flow.snapshot().contextKey;
    const valid = (): boolean => !this.stopped && !this.data.paused && generation === this.generation && this.options.flow() === flow && flow.snapshot().contextKey === context;
    this.controller = new AbortController();
    const ordered = (): FlowAutomationRule[] => this.data.rules.filter(rule => rule.status === 'enabled' && rule.approvedRevision === rule.revision).sort((a, b) => Number(b.config.priority === 'urgent') - Number(a.config.priority === 'urgent') || a.createdAt - b.createdAt);
    for (const candidate of ordered()) {
      const rule = this.data.rules.find(item => item.id === candidate.id)!;
      if (!valid()) return;
      try { this.usable(rule.config); } catch (error) {
        this.change(() => { rule.error = errorText(error); for (const event of this.data.events.filter(item => item.ruleId === rule.id && pending(item))) { event.status = 'blocked'; event.reason = rule.error; event.updatedAt = this.now(); } }); continue;
      }
      if ((rule.nextCheckAt ?? 0) > this.now() || rule.error) continue;
      try {
        const interval = rule.config.trigger.everyMinutes * 60000, at = this.now();
        const cursor = copy(this.data.cursors[rule.id] ?? {});
        const result: FlowDetectionResult = rule.config.trigger.kind === 'interval'
          ? { cursor: { bucket: String(Math.floor(at / interval)) }, items: [{ key: `interval:${Math.floor(at / interval)}`, title: rule.config.flowId, inputs: {} }], summary: 'Interval detected; missed intervals coalesced' }
          : await this.options.detect(copy(rule.config), cursor, this.controller.signal);
        if (!valid()) return;
        this.usable(rule.config);
        const checked = this.result(result);
        const baseline = rule.config.trigger.kind === 'devops' && !rule.config.trigger.includeExisting && this.data.cursors[rule.id] === undefined;
          const fresh = checked.items.filter(item => !this.data.seen.includes(hash([rule.id, rule.revision, item.key])));
          if (this.data.seen.length + fresh.length > MAX_SEEN) throw new Error('Automatic flow deduplication ledger is full; no cursor advanced');
          if (!baseline && this.data.events.filter(pending).length + fresh.length > MAX_EVENTS) throw new Error('Automatic flow backlog exceeds 200; no cursor advanced');
        for (const item of fresh) {
          if (Object.keys(item.inputs).some(key => Object.hasOwn(rule.config.inputs, key))) throw new Error('Detected event inputs conflict with approved configuration');
          validateInputs({ ...rule.config.inputs, ...item.inputs });
        }
        this.change(() => {
          for (const item of fresh) {
            this.data.seen.push(hash([rule.id, rule.revision, item.key]));
            if (!baseline) this.data.events.push({ id: randomUUID(), ruleId: rule.id, ruleRevision: rule.revision, sourceKey: item.key, subjectKey: `auto:${rule.id}:${rule.revision}:${hash(item.key)}`, title: item.title, inputs: validateInputs({ ...rule.config.inputs, ...item.inputs }), createdAt: at, updatedAt: at, status: 'pending', attempts: 0 });
          }
          this.data.cursors[rule.id] = checked.cursor; rule.lastCheckAt = at; rule.nextCheckAt = at + interval; rule.lastResult = baseline ? 'Initial baseline recorded; existing items not queued' : checked.summary; rule.failures = 0; delete rule.error;
          this.trim();
        });
      } catch (error) {
        if (!valid()) return;
        this.change(() => { const current = this.data.rules.find(item => item.id === rule.id)!; current.failures++; current.error = errorText(error); current.lastCheckAt = this.now(); current.nextCheckAt = this.now() + Math.min(3600000, 60000 * 2 ** Math.min(current.failures - 1, 6)); });
      }
    }
    for (const rule of ordered()) {
      if (!valid()) return;
      const expired = this.data.events.filter(event => event.ruleId === rule.id && event.ruleRevision === rule.revision && event.status === 'notified' && (event.nextAttemptAt ?? event.updatedAt + 120000) <= this.now());
      if (expired.length) this.change(() => {
        for (const event of expired) {
          event.status = event.attempts >= 3 ? 'blocked' : 'pending'; event.updatedAt = this.now();
          event.reason = event.attempts >= 3 ? 'Orchestrator acknowledgement timed out after three dispatch attempts; resume explicitly to retry.' : 'Awaiting Orchestrator acknowledgement; retry queued.';
        }
      });
      for (const event of this.data.events.filter(item => item.ruleId === rule.id && item.ruleRevision === rule.revision && item.status === 'pending' && (item.nextAttemptAt ?? 0) <= this.now())) {
        if (!valid()) return;
        if (rule.error) break;
        const runs = flow.snapshot().runs.filter(run => run.status !== 'completed' && this.data.rules.some(item => run.subjectKey.startsWith(`auto:${item.id}:`)));
        if (runs.length >= 2 || runs.some(run => run.subjectKey.startsWith(`auto:${rule.id}:`))) break;
        try {
          const sent = await this.options.dispatch(copy(rule), copy(event));
          if (!valid()) return;
          this.usable(rule.config);
          if (event.status !== 'pending') continue; // Dispatch may synchronously trigger the authenticated start tool.
          if (!sent) break; // A busy owner is not a failed attempt.
          this.change(() => { event.status = 'notified'; event.attempts++; event.updatedAt = this.now(); event.nextAttemptAt = this.now() + 120000; delete event.reason; });
        } catch (error) {
          if (!valid()) return;
          if (event.status !== 'pending') continue;
          this.change(() => { event.attempts++; event.reason = errorText(error); event.updatedAt = this.now(); event.nextAttemptAt = this.now() + 60000 * 2 ** (event.attempts - 1); if (event.attempts >= 3) event.status = 'blocked'; });
        }
      }
    }
  }
  private config(value: unknown): FlowAutomationConfig {
    const raw = object(value, 'automatic flow config'); keys(raw, ['flowId', 'flowVersion', 'trigger', 'scope', 'inputs', 'priority', 'devopsWrite'], 'automatic flow config');
    const trigger = object(raw.trigger, 'trigger');
    if (!['interval', 'devops'].includes(trigger.kind as string)) throw new Error('Unsupported automatic flow trigger');
    keys(trigger, trigger.kind === 'interval' ? ['kind', 'everyMinutes'] : ['kind', 'everyMinutes', 'organization', 'project', 'areaPath', 'workItemType', 'states', 'includeExisting'], 'trigger');
    const everyMinutes = integer(trigger.everyMinutes, 'everyMinutes', 1, 525600), scope = validateScope(raw.scope);
    const config: FlowAutomationConfig = { flowId: identifier(raw.flowId, 'flowId'), flowVersion: integer(raw.flowVersion, 'flowVersion', 1), scope, inputs: validateInputs(raw.inputs), priority: raw.priority as FlowAutomationConfig['priority'], trigger: { kind: 'interval', everyMinutes } };
    if (!['urgent', 'normal'].includes(config.priority)) throw new Error('Invalid automatic flow priority');
    if (trigger.kind === 'devops') {
      if (DEVOPS_INPUTS.some(key => Object.hasOwn(config.inputs, key))) throw new Error('DevOps event input names are reserved');
      if (!Array.isArray(trigger.states) || trigger.states.length < 1 || trigger.states.length > 30 || typeof trigger.includeExisting !== 'boolean') throw new Error('Invalid DevOps trigger');
      config.trigger = { kind: 'devops', everyMinutes, organization: text(trigger.organization, 'organization', 300), project: text(trigger.project, 'project', 300), areaPath: text(trigger.areaPath, 'areaPath', 1000), workItemType: text(trigger.workItemType, 'workItemType', 200), states: [...new Set(trigger.states.map(value => text(value, 'state', 200)))], includeExisting: trigger.includeExisting };
      if (!scope.project || !scope.areaPath || !inScope(scope, config.trigger) || !inScope(config.trigger, scope)) throw new Error('DevOps trigger must exactly match approved project and area scope');
      if (raw.devopsWrite !== undefined) config.devopsWrite = validateGrant(raw.devopsWrite, config.trigger);
    } else if (raw.devopsWrite !== undefined) throw new Error('DevOps write needs a DevOps trigger');
    return config;
  }
  private usable(config: FlowAutomationConfig, eventInputs?: Record<string, string>): void {
    const snapshot = this.options.flow().snapshot();
    if (snapshot.storageError) throw new Error(snapshot.storageError);
    const version = snapshot.versions.find(item => item.definition.id === config.flowId && item.version === config.flowVersion);
    if (!version || snapshot.active[config.flowId] !== config.flowVersion) throw new Error('Automatic flow requires its pinned current user-activated version');
    if (!inScope(version.definition.scope, config.scope)) throw new Error('Automatic flow scope does not match the approved flow');
    if (version.definition.steps.some(step => step.action?.kind === 'builtin' && step.action.ref === 'scope-present') && (!config.scope.project || !config.scope.areaPath)) throw new Error('Automatic flow scope-present check requires project and areaPath');
    const required = new Set(version.definition.steps.flatMap(step => [...step.inputs, ...(step.workspaceInput ? [step.workspaceInput] : [])]));
    const inputs = eventInputs ?? config.inputs;
    if ([...required].some(key => !inputs[key]?.trim() && !(eventInputs === undefined && config.trigger.kind === 'devops' && DEVOPS_INPUTS.includes(key)))) throw new Error('Automatic flow is missing required step inputs or workspace');
    if (version.definition.steps.some(step => step.effect === 'production' || step.action && step.action.kind !== 'builtin')) throw new Error('Automatic flow has an unsupported execution adapter');
    // External writes run only through the DevOps write adapter, and only when this exact rule grants it.
    if (version.definition.steps.some(step => step.effect === 'external-write' && (!adapted(step) || !config.devopsWrite || config.trigger.kind !== 'devops'))) throw new Error('Automatic flow external-write steps need the DevOps write adapter enabled in this configuration');
  }
  private result(value: unknown): FlowDetectionResult {
    const raw = object(value, 'detection'); keys(raw, ['cursor', 'items', 'summary'], 'detection');
    if (!Array.isArray(raw.items) || raw.items.length > MAX_SEEN) throw new Error('Detection result exceeds limit');
    const items = raw.items.map(value => { const item = object(value, 'detected item'); keys(item, ['key', 'title', 'inputs'], 'detected item'); return { key: text(item.key, 'source key', 500), title: text(item.title, 'event title', 500), inputs: validateInputs(item.inputs) }; });
    if (new Set(items.map(item => item.key)).size !== items.length) throw new Error('Detector returned duplicate source keys');
    return { cursor: validateCursor(raw.cursor), items, summary: text(raw.summary, 'detection summary', 2000, true) };
  }
  private guarded(id: string, revision: number): FlowAutomationRule {
    text(id, 'rule id', 200); integer(revision, 'expectedRevision', 1);
    const rule = this.data.rules.find(item => item.id === id);
    if (!rule || rule.revision !== revision) throw new Error('Automatic flow decision is stale'); return rule;
  }
  private retry(id: string): void {
    const rule = this.data.rules.find(item => item.id === id)!;
    rule.failures = 0; rule.nextCheckAt = this.now(); delete rule.error;
    for (const event of this.data.events.filter(item => item.ruleId === id && item.ruleRevision === rule.revision && ['blocked', 'notified'].includes(item.status))) { event.status = 'pending'; event.attempts = 0; event.updatedAt = this.now(); delete event.reason; delete event.nextAttemptAt; }
  }
  private cancel(id: string, reason: string): void { for (const event of this.data.events.filter(item => item.ruleId === id && pending(item))) { event.status = 'cancelled'; event.reason = reason; event.updatedAt = this.now(); } }
  private blockEvent(event: FlowAutomationEvent, reason: string): void { this.change(() => { event.status = 'blocked'; event.reason = reason; event.updatedAt = this.now(); }); }
  private invalidate(): void { this.generation++; this.controller?.abort(); }
  private healthy(): void { if (this.storageError) throw new Error(this.storageError); if (this.stopped) throw new Error('Automatic flow service stopped'); }
  private trim(): void { const history = this.data.events.filter(event => !pending(event)); const remove = new Set(history.slice(0, Math.max(0, history.length - MAX_HISTORY)).map(event => event.id)); this.data.events = this.data.events.filter(event => !remove.has(event.id)); }
  private change<T>(mutate: () => T): T {
    this.healthy(); const before = copy(this.data); let value: T;
    try { value = mutate(); this.data.revision++; }
    catch (error) { this.data = before; this.invalidate(); throw error; }
    try { this.save(); }
    catch (error) {
      this.data = before; this.invalidate(); this.storageError = 'Automatic flow storage is unavailable; mutations are disabled until the file can be restored and reopened.';
      try { this.options.changed?.(); } catch { /* Preserve the storage blocker even if its observer fails. */ }
      throw error;
    }
    try { this.options.changed?.(); } catch { /* Observers cannot undo a durable commit. */ }
    return copy(value);
  }
  private save(): void {
    const serialized = JSON.stringify(this.data);
    if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) throw new Error('Automatic flow storage exceeds limit');
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true }); const temp = `${this.options.file}.${randomUUID()}.tmp`;
    try { const fd = fs.openSync(temp, 'wx', 0o600); try { fs.writeFileSync(fd, serialized); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp, this.options.file); }
    finally { try { fs.rmSync(temp, { force: true }); } catch { /* Cleanup cannot undo the atomic rename. */ } }
  }
  private read(source: string): Stored {
    const raw = object(JSON.parse(source) as unknown, 'automation storage'); keys(raw, ['schema', 'revision', 'paused', 'background', 'rules', 'events', 'cursors', 'seen'], 'automation storage');
    if (raw.schema !== 1 || typeof raw.paused !== 'boolean' || typeof raw.background !== 'boolean' || !Array.isArray(raw.rules) || raw.rules.length > 100 || !Array.isArray(raw.events) || raw.events.length > MAX_EVENTS + MAX_HISTORY || !Array.isArray(raw.seen) || raw.seen.length > MAX_SEEN) throw new Error('Invalid automation storage');
    integer(raw.revision, 'revision'); object(raw.cursors, 'cursors'); const data = raw as unknown as Stored;
    const ids = new Set<string>(), flows = new Set<string>();
    for (const rule of data.rules) {
      keys(object(rule, 'rule'), ['id', 'revision', 'config', 'ownerOrchestratorId', 'status', 'approvedRevision', 'createdAt', 'updatedAt', 'approvedAt', 'feedback', 'nextCheckAt', 'lastCheckAt', 'lastResult', 'error', 'failures'], 'rule');
      text(rule.id, 'rule id', 200); integer(rule.revision, 'rule revision', 1); this.config(rule.config); text(rule.ownerOrchestratorId, 'owner', 200);
      if (ids.has(rule.id) || flows.has(rule.config.flowId) || !['proposed', 'enabled', 'paused', 'rejected'].includes(rule.status)) throw new Error('Invalid rule'); ids.add(rule.id); flows.add(rule.config.flowId);
      for (const value of [rule.createdAt, rule.updatedAt, rule.failures]) integer(value, 'rule counter');
      for (const value of [rule.approvedAt, rule.nextCheckAt, rule.lastCheckAt]) if (value !== undefined) integer(value, 'rule time');
      for (const value of [rule.feedback, rule.lastResult, rule.error]) if (value !== undefined) text(value, 'rule text', 16000, true);
      if (rule.approvedRevision !== undefined) integer(rule.approvedRevision, 'approvedRevision', 1);
      if (['enabled', 'paused'].includes(rule.status) && (rule.approvedRevision !== rule.revision || rule.approvedAt === undefined)) throw new Error('Unapproved automatic rule');
    }
    for (const [id, cursor] of Object.entries(data.cursors)) { if (!ids.has(id)) throw new Error('Unknown cursor owner'); validateCursor(cursor); }
    if (new Set(data.seen).size !== data.seen.length || data.seen.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) throw new Error('Invalid deduplication ledger');
    const eventIds = new Set<string>(), subjects = new Set<string>();
    for (const event of data.events) {
      keys(object(event, 'event'), ['id', 'ruleId', 'ruleRevision', 'sourceKey', 'subjectKey', 'title', 'inputs', 'createdAt', 'updatedAt', 'status', 'attempts', 'nextAttemptAt', 'runId', 'reason'], 'event');
      text(event.id, 'event id', 200); text(event.sourceKey, 'source key', 500); text(event.title, 'event title', 500); validateInputs(event.inputs); integer(event.ruleRevision, 'event revision', 1); integer(event.createdAt, 'event time'); integer(event.updatedAt, 'event time'); integer(event.attempts, 'attempts', 0, 3);
      const rule = data.rules.find(item => item.id === event.ruleId);
      if (!rule || event.ruleRevision > rule.revision || (event.ruleRevision !== rule.revision && pending(event)) || event.subjectKey !== `auto:${event.ruleId}:${event.ruleRevision}:${hash(event.sourceKey)}` || !data.seen.includes(hash([event.ruleId, event.ruleRevision, event.sourceKey])) || eventIds.has(event.id) || subjects.has(event.subjectKey) || !['pending', 'notified', 'started', 'blocked', 'cancelled'].includes(event.status)) throw new Error('Invalid automatic event');
      if (event.ruleRevision === rule.revision && Object.entries(rule.config.inputs).some(([key, value]) => event.inputs[key] !== value)) throw new Error('Event configuration mismatch');
      if (event.nextAttemptAt !== undefined) integer(event.nextAttemptAt, 'next attempt'); if (event.reason !== undefined) text(event.reason, 'event reason', 2000, true); if (event.runId !== undefined) text(event.runId, 'run id', 200); if (event.status === 'started' && !event.runId) throw new Error('Started event missing run');
      eventIds.add(event.id); subjects.add(event.subjectKey);
    }
    if (data.events.filter(pending).length > MAX_EVENTS) throw new Error('Automation backlog exceeds limit');
    return data;
  }
}
