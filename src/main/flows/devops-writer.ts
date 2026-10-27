// Host-enforced Azure DevOps write adapter for automatic flows (ADR 0145). A bound flow step's chat asks for one
// operation; this module checks it against the user-approved grant (organization, projects, ops, fields), allows only
// the run's own work item and the test plans, suites and cases this run created (a durable ledger), and calls a fixed
// set of REST endpoints with the host Azure CLI token. Never production, never Azure resources, no token in files/logs.
// Used by flows/devops-write-tool.ts; tests inject token and fetch.
import type { ReconcileWrites, WriteReconciliation, WriteRequestIdentity } from '../../shared/flow-reconciliation';
import { redact } from '../log';
import { DevOpsWriteError, NoRemoteEffect } from './write-refusal';
import fs from 'node:fs';
import path from 'node:path';
import { renameRetrying } from '../rules/storage';
import { createHash, randomUUID } from 'node:crypto';
import type { DevOpsWriteGrant, DevOpsWriteOp } from '../../shared/flow-automation';
import { devopsToken, armToken } from './devops-detector';
import { type TestDeploymentCoordinator, validateDeployTarget, releaseDefinitionFingerprint, deploymentHash } from './test-deployment';
import { validateAppServiceDefinition, verifyAppService } from './app-service-target';
import { devopsResource, type ResourceLedger } from './devops-resources';
import { prBuildStatus } from './pr-build-status';
import { queuePrValidation, sameArtifact } from './pr-validation';
import { testEnvironmentSnapshot } from './test-environment';
import type { DevOpsRevisions } from './devops-revisions';
import { HostPushPreconditionError, pushRunBranch, runBranch } from './git-push';
import { renderDevOpsComment } from './devops-content';
import { integer, keys, object, text } from './schema';

export const DEVOPS_WRITE_REQUESTS = ['add-tags', 'remove-tags', 'set-fields', 'comment', 'link-pr', 'create-test-plan', 'rename-test-plan', 'create-test-suite', 'create-test-case', 'set-test-outcome', 'upload-image', 'relate-work-item', 'relate-pr', 'create-pr', 'pr-comment', 'publish-pr', 'abandon-pr', 'deploy-test', 'test-deploy-status', 'cancel-test-deploy', 'push-branch', 'test-environment-status', 'queue-pr-validation', 'pr-build-status'] as const;
export type DevOpsWriteRequestOp = typeof DEVOPS_WRITE_REQUESTS[number];
/** Which user-approved category each request needs. */
const CATEGORY: Record<DevOpsWriteRequestOp, DevOpsWriteOp> = {
  'queue-pr-validation': 'pr-validation', 'pr-build-status': 'pr-validation',
  'test-environment-status': 'test-environment',
  'push-branch': 'git-push',
  'upload-image': 'attachments', 'relate-work-item': 'related-links', 'relate-pr': 'related-links', 'create-pr': 'pr-create', 'pr-comment': 'pr-comment', 'publish-pr': 'pr-publish', 'abandon-pr': 'pr-abandon', 'deploy-test': 'test-deploy', 'test-deploy-status': 'test-deploy', 'cancel-test-deploy': 'test-deploy',
  'add-tags': 'tags', 'remove-tags': 'tags', 'set-fields': 'fields', comment: 'comment', 'link-pr': 'pr-links',
  'create-test-plan': 'test-plans', 'rename-test-plan': 'test-plans', 'create-test-suite': 'test-plans', 'create-test-case': 'test-plans', 'set-test-outcome': 'test-results',
};
const OUTCOMES = ['passed', 'failed', 'blocked', 'notApplicable'] as const;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const TIMEOUT_MS = 60_000, MAX_BYTES = 2 * 1024 * 1024, MAX_RUNS = 500, MAX_PER_RUN = 500;
const API = 'api-version=7.1';

/** What the host resolved for the calling chat: never supplied by the agent. */
export interface DevOpsWriteContext { runId: string; retryReconciled?: boolean; branchRunIds?: string[]; grant: DevOpsWriteGrant; workItemId: number; workspace?: string; workspaceInput?: string; evidenceRoot?: string; authorize?: () => void; mentionReason?: 'intake' | 'block' | 'downgrade' | 'final' | 'analysis' }
interface Plan { project: string; id: number; rootSuiteId: number }
interface Suite { project: string; planId: number; id: number }
interface TestCase { project: string; planId: number; suiteId: number; id: number }
interface Ledger { schema: 1; runs: Record<string, ResourceLedger & { plans: Plan[]; suites: Suite[]; testCases: TestCase[] }>; operations?: Record<string, { runId: string; requestKey?: string; request?: WriteRequestIdentity; state: 'pending' | 'done' | 'not-done' | 'reconciled'; reconciliation?: WriteReconciliation; reason?: string; mentionReason?: 'analysis'; op?: string; targetId?: string; buildId?: number; releaseId?: number; pullRequestId?: number; relatedWorkItemId?: number; organization?: string; workItemId?: number; at?: number; completedAt?: number; result?: Record<string, unknown> }> }
export interface DevOpsWriterOptions {
  /** Brain-scoped ledger file of resources each run created. */
  file: string;
  token?: (signal?: AbortSignal) => Promise<string>;
  request?: (url: string, init: RequestInit) => Promise<Response>;
  deployments?: TestDeploymentCoordinator;
  revisions?: DevOpsRevisions;
  push?: typeof pushRunBranch;
  armToken?: (signal?: AbortSignal) => Promise<string>;
  audit?: (entry: { runId: string; op: DevOpsWriteRequestOp; target: string }) => void;
}
export { DevOpsWriteError } from './write-refusal';
const deny = (message: string): never => { throw new DevOpsWriteError(message); };
const lower = (s: string): string => s.toLowerCase();
const safeText = (value: unknown, label: string, max: number): string => { const s = text(value, label, max); if (CONTROL.test(s)) deny(`${label}: control characters are not allowed`); return s; };
const id = (value: unknown, label: string): number => integer(value, label, 1, 2_147_483_647);
const html = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '<br/>');

export class ReconciledWrite extends Error {
  constructor(readonly outcome: WriteReconciliation['outcome']) { super(`User reconciled this write as ${outcome}; it will not be repeated.`); }
}
export class DevOpsWriter {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: DevOpsWriterOptions) {}

  /** Validate, authorize and perform one request; returns a short receipt the agent can quote as evidence.
   *  One request at a time, so the created-resources ledger never loses an update. */
  execute(context: DevOpsWriteContext, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const next = this.queue.then(() => this.journal(context, request, signal));
    this.queue = next.catch(() => undefined);
    return next;
  }
  /** Read-only authoring inspector. It returns a candidate file, never installs a target or activates a grant. */
  async inspectTarget(value: unknown): Promise<unknown> {
    const raw = object(value, 'target candidate'), signal = AbortSignal.timeout(60000);
    const candidate = validateDeployTarget({ ...raw, definitionRevision: raw.definitionRevision ?? 1, definitionSha256: '0'.repeat(64) });
    if (candidate.kind !== 'app-service') throw new Error('Inspector supports App Service targets; deployment-group targets retain their manual registration');
    const token = await (this.options.token ?? devopsToken)(signal);
    const call = (method: string, url: string) => this.call(token, method, url, undefined, 'application/json', signal);
    const definition = await call('GET', `https://vsrm.dev.azure.com/${encodeURIComponent(candidate.organization)}/${candidate.projectId}/_apis/release/definitions/${candidate.releaseDefinitionId}?${API}`);
    if (definition.id !== candidate.releaseDefinitionId || (raw.definitionRevision !== undefined && definition.revision !== raw.definitionRevision)) throw new Error('Release definition identity/revision differs from the requested target');
    const target = validateDeployTarget({ ...candidate, definitionRevision: id(definition.revision, 'revision'), definitionSha256: releaseDefinitionFingerprint(definition) });
    if (target.kind !== 'app-service') throw new Error('App Service target required');
    validateAppServiceDefinition(definition, target);
    const env = object((definition.environments as unknown[])[0], 'environment');
    if (env.id !== target.environmentId || env.name !== target.environmentName) throw new Error('Environment identity differs');
    const artifacts = Array.isArray(definition.artifacts) ? definition.artifacts : [];
    if (artifacts.length !== 1) throw new Error('Exactly one approved artifact required');
    const artifact = object(artifacts[0], 'artifact'), ref = object(artifact.definitionReference, 'artifact reference');
    if (artifact.alias !== target.artifactAlias || artifact.type !== 'Build' || String(object(ref.definition, 'pipeline').id) !== String(target.buildDefinitionId) || object(ref.project, 'project').id !== target.projectId) throw new Error('Artifact identity differs');
    await verifyAppService(target, call, async resourceId => this.call(await (this.options.armToken ?? armToken)(signal), 'GET', `https://management.azure.com${resourceId}?api-version=2024-04-01`, undefined, 'application/json', signal));
    return { schema: 1, targets: [target] };
  }
  validateHistory(runId: string, grant: DevOpsWriteGrant, body: string): void {
    renderDevOpsComment(body, grant.organization, this.read().runs[runId]?.images ?? []);
  }
  operationsFor(runId: string) { return Object.entries(this.read().operations ?? {}).filter(([, v]) => v.runId === runId).map(([requestHash, v]) => ({ requestHash, ...structuredClone(v) })); }
  /** Replays only local fence cleanup after a crash between the durable user receipt and the revision journal. */
  reconciliationView(runId: string) {
    const operations = this.operationsFor(runId);
    for (const op of operations) if (op.state === 'reconciled' && op.reconciliation) this.options.revisions?.done(op.reconciliation.organization, op.reconciliation.workItemId, op.requestHash);
    return { digest: createHash('sha256').update(JSON.stringify(operations)).digest('hex'), operations: operations.map(o => ({ id: o.requestHash, op: o.op ?? 'unknown-write', state: o.state, at: o.at, reason: o.reason, request: o.request, reconciliation: o.reconciliation,
      target: [o.targetId, o.buildId ? `build ${o.buildId}` : '', o.releaseId ? `release ${o.releaseId}` : '', o.pullRequestId ? `PR #${o.pullRequestId}` : '', o.relatedWorkItemId ? `work item #${o.relatedWorkItemId}` : ''].filter(Boolean).join(' ') || undefined,
      ...(o.organization && o.workItemId ? { scope: { organization: o.organization, workItemId: o.workItemId } } : {}), eligible: ['pending', 'not-done'].includes(o.state) && !['deploy-test', 'cancel-test-deploy'].includes(o.op ?? '') })) };
  }
  /** Local user attestation, never exposed as an agent tool and never a remote write. */
  reconcile(context: Pick<DevOpsWriteContext, 'runId' | 'workItemId' | 'grant' | 'authorize'>, input: Pick<ReconcileWrites, 'digest' | 'decisions'>): Promise<void> {
    const next = this.queue.then(() => {
      context.authorize?.();
      const view = this.reconciliationView(context.runId);
      if (input.digest !== view.digest) throw new Error('Le scritture sono cambiate: riapri la riconciliazione.');
      if (!Array.isArray(input.decisions) || !input.decisions.length || input.decisions.length > 100 || new Set(input.decisions.map(d => d.id)).size !== input.decisions.length) throw new Error('Selezione delle scritture non valida.');
      const decisions = input.decisions.map(d => {
        keys(object(d, 'decision'), ['id', 'outcome', 'note'], 'decision');
        if (!view.operations.some(o => o.id === d.id && o.eligible) || !['done', 'not-done', 'reverted'].includes(d.outcome)) throw new Error('Scrittura non riconciliabile; i deploy richiedono la verifica della release.');
        const note = redact(safeText(d.note, 'evidence note', 2000)); if (note.trim().length < 8) throw new Error('Descrivi la verifica effettuata (almeno 8 caratteri).');
        return { id: d.id, receipt: { outcome: d.outcome, note, by: 'user' as const, at: Date.now(), organization: context.grant.organization, workItemId: context.workItemId } };
      });
      context.authorize?.(); const data = this.read();
      for (const d of decisions) { const op = data.operations![d.id]!; op.state = 'reconciled'; op.reconciliation = d.receipt; op.completedAt = d.receipt.at; }
      this.write(data); // save authority before clearing any detector fence
      for (const d of decisions) this.options.revisions?.done(context.grant.organization, context.workItemId, d.id);
    });
    this.queue = next.catch(() => undefined); return next;
  }
  ownedPrs(runId: string) { return structuredClone(this.read().runs[runId]?.prs ?? []); }
  private async journal(context: DevOpsWriteContext, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    context.authorize?.();
    let raw = object(request, 'request');
    if (!(DEVOPS_WRITE_REQUESTS as readonly string[]).includes(String(raw.op))) deny('Unknown DevOps write operation');
    if (!this.granted(context.grant, raw.op as DevOpsWriteRequestOp)) deny(`DevOps write "${CATEGORY[raw.op as DevOpsWriteRequestOp]}" is not enabled for this flow`);
    if (raw.op === 'test-deploy-status' || raw.op === 'test-environment-status' || raw.op === 'pr-build-status') return this.perform(context, raw, signal);
    // Resolve dynamic requests before hashing: the same input must not replay an earlier PR build/release.
    if (raw.op === 'deploy-test' && raw.buildId === undefined) {
      keys(raw, ['op', 'targetId', 'buildId'], 'request');
      const build = await this.perform(context, { op: 'pr-build-status', targetId: raw.targetId }, signal);
      if (build.status !== 'succeeded') deny(`The run PR build is ${build.status}; use flow_pr_build_status before deploying`);
      raw = { ...raw, buildId: id(build.buildId, 'buildId') };
    }
    if (raw.op === 'cancel-test-deploy' && raw.releaseId === undefined) {
      keys(raw, ['op', 'targetId', 'releaseId'], 'request');
      const receipt = await this.perform(context, { op: 'test-deploy-status', targetId: raw.targetId }, signal);
      if (receipt.terminal === true) return receipt;
      raw = { ...raw, releaseId: id(receipt.releaseId, 'releaseId') };
    }
    const requestKey = createHash('sha256').update(JSON.stringify([context.runId, raw, ...(raw.op === 'push-branch' ? [randomUUID()] : [])])).digest('hex');
    const data = this.read(), matches = Object.entries(data.operations ?? {}).filter(([id, op]) => op.runId === context.runId && (id === requestKey || op.requestKey === requestKey));
    const [lastKey, previous] = matches.at(-1) ?? [requestKey, undefined];
    let key = lastKey;
    if (previous?.state === 'reconciled') {
      if (!context.retryReconciled) throw new ReconciledWrite(previous.reconciliation!.outcome);
      if (previous.reconciliation!.outcome === 'done') return { reconciled: true, applied: true, requestHash: lastKey, workItemId: context.workItemId, ...(previous.request ? { pullRequestId: previous.request.pullRequestId } : {}), note: 'User verified this operation as applied. No request repeated; resource ids not recorded remain unknown.' };
      // A fresh attempt preserves the immutable user receipt and still passes every live scope/grant check.
      key = createHash('sha256').update(`${requestKey}:${randomUUID()}`).digest('hex');
    }
    if (previous?.state === 'done' && raw.op !== 'push-branch') return previous.result!;
    if (!['abandon-pr', 'cancel-test-deploy'].includes(String(raw.op)) && Object.values(data.operations ?? {}).some(op => op.runId === context.runId && op.state === 'pending')) deny('A previous DevOps write has an unknown outcome. Reconcile it in DevOps before retrying; do not duplicate the effect.');
    const analysisMention = raw.op === 'comment' && raw.mentionReason === 'analysis' && Array.isArray(raw.mentions) && raw.mentions.length > 0;
    if (analysisMention && Object.values(data.operations ?? {}).some(op => op.runId === context.runId && op.mentionReason === 'analysis' && op.state !== 'not-done' && !(op.state === 'reconciled' && ['not-done', 'reverted'].includes(op.reconciliation?.outcome ?? '')))) deny('Only one mentioned analysis comment is allowed per run');
    // Persist only validated link routing identifiers before dispatch, never comment bodies or raw tool arguments.
    // relate-pr carries the same routing identity as link-pr (before, only link-pr kept it: a pending relate-pr showed
    // «La richiesta originale non è registrata qui»); a PR-only op keeps its PR id, relate-work-item the related item.
    const identity: WriteRequestIdentity | undefined = (raw.op === 'link-pr' || raw.op === 'relate-pr') && typeof raw.projectId === 'string' && GUID.test(raw.projectId) && typeof raw.repositoryId === 'string' && GUID.test(raw.repositoryId) && Number.isSafeInteger(raw.pullRequestId) && Number(raw.pullRequestId) > 0
      ? { workItemId: context.workItemId, projectId: raw.projectId, repositoryId: raw.repositoryId, pullRequestId: Number(raw.pullRequestId) } : undefined;
    let attempted = false, possibleEffects = 0;
    this.beforeMutation = () => {
      context.authorize?.();
      if (attempted) { possibleEffects++; return; }
      const latest = this.read();
      if (Object.keys(latest.operations ?? {}).length >= 20_000) deny('DevOps operation journal is full; archive reviewed completed runs first');
      this.options.revisions?.pending(context.grant.organization, context.workItemId, key);
      (latest.operations ??= {})[key] = { runId: context.runId, requestKey, ...(identity ? { request: identity } : {}), state: 'pending', ...(analysisMention ? { mentionReason: 'analysis' as const } : {}), op: String(raw.op), ...(typeof raw.targetId === 'string' ? { targetId: raw.targetId } : {}), ...(typeof raw.buildId === 'number' ? { buildId: raw.buildId } : {}), ...(typeof raw.releaseId === 'number' ? { releaseId: raw.releaseId } : {}),
        ...(!identity && Number.isSafeInteger(raw.pullRequestId) && Number(raw.pullRequestId) > 0 ? { pullRequestId: Number(raw.pullRequestId) } : {}), ...(Number.isSafeInteger(raw.relatedWorkItemId) && Number(raw.relatedWorkItemId) > 0 ? { relatedWorkItemId: Number(raw.relatedWorkItemId) } : {}),
        // the scope a user receipt needs, kept with the write: it can be reconciled even after the run's grant is gone
        organization: context.grant.organization, workItemId: context.workItemId, at: Date.now() }; this.write(latest); attempted = true; possibleEffects++;
    };
    this.mutationRefused = () => { possibleEffects--; };
    try {
      const result = await this.perform(context, raw, signal);
      if (attempted || previous?.state === 'pending') { const latest = this.read(); (latest.operations ??= {})[key] = { ...latest.operations?.[key], runId: context.runId, requestKey, ...(identity ? { request: identity } : {}), state: 'done', ...(analysisMention ? { mentionReason: 'analysis' as const } : {}), op: String(raw.op), at: latest.operations?.[key]?.at ?? Date.now(), completedAt: Date.now(), result }; this.write(latest); }
      this.options.revisions?.done(context.grant.organization, context.workItemId, key);
      return result;
    } catch (error) {
      // No dispatch, or an explicit rejection of the only dispatched mutation: safe to retry. A later rejection
      // never erases earlier effects in a compound operation (e.g. a created test case whose linking failed).
      const notDone = possibleEffects === 0 && previous?.state !== 'pending';
      if (notDone) {
        const latest = this.read();
        if (latest.operations?.[key] || Object.keys(latest.operations ?? {}).length < 20_000) {
          const reason = error instanceof DevOpsWriteError || error instanceof HostPushPreconditionError
            ? error.message.slice(0, 2000) : 'Operation refused before any remote effect; correct the reported precondition and retry.';
          (latest.operations ??= {})[key] = { ...latest.operations?.[key], runId: context.runId, requestKey, ...(identity ? { request: identity } : {}), state: 'not-done', op: String(raw.op), at: latest.operations?.[key]?.at ?? Date.now(), completedAt: Date.now(), reason };
          this.write(latest);
        }
        this.options.revisions?.done(context.grant.organization, context.workItemId, key);
      }
      const cause = error instanceof Error ? error.message : 'Host operation failed';
      throw new DevOpsWriteError(notDone
        ? `DevOps write not done: ${cause} Correct the cause and retry this host tool.`
        : `DevOps write outcome unknown: ${cause} Reconcile the remote state before retrying; do not duplicate the effect.`);
    } finally { this.beforeMutation = undefined; this.mutationRefused = undefined; }
  }
  private beforeMutation?: () => void;
  private mutationRefused?: () => void;
  private granted(grant: DevOpsWriteGrant, op: DevOpsWriteRequestOp): boolean { return op === 'pr-build-status' ? grant.ops.includes('test-deploy') || grant.ops.includes('pr-validation') : grant.ops.includes(CATEGORY[op]); }
  private async perform(context: DevOpsWriteContext, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    context.authorize?.();
    const raw = object(request, 'request'), op = raw.op as DevOpsWriteRequestOp;
    if (!(DEVOPS_WRITE_REQUESTS as readonly string[]).includes(op)) deny('Unknown DevOps write operation');
    const { grant } = context;
    if (!this.granted(grant, op)) deny(`DevOps write "${CATEGORY[op]}" is not enabled for this flow`);
    const controller = new AbortController(), abort = () => controller.abort();
    const timer = setTimeout(abort, TIMEOUT_MS); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      let token: string;
      try { token = await (this.options.token ?? devopsToken)(controller.signal); } catch { return deny('DevOps: Azure CLI login unavailable. Run az login.'); }
      if (typeof token !== 'string' || !token || token.length > 32_768 || /\s/.test(token)) deny('DevOps: Azure CLI login unavailable. Run az login.');
      const call = (method: string, url: string, body?: unknown, contentType = 'application/json') => {
        try { context.authorize?.(); if (controller.signal.aborted) throw new Error('DevOps request cancelled'); }
        catch (error) { if (method !== 'GET') throw new NoRemoteEffect(error instanceof Error ? error.message : 'DevOps request refused before dispatch'); throw error; }
        return this.call(token, method, url, body, contentType, controller.signal);
      };
      const org = `https://dev.azure.com/${encodeURIComponent(grant.organization)}`;
      const project = (value: unknown): string => {
        const name = safeText(value, 'project', 128);
        const granted = grant.projects.find(p => lower(p) === lower(name));
        return granted ?? deny('Project is not in the approved DevOps write grant');
      };
      const projectOf = (pathValue: string): string => project(pathValue.replace(/\//g, '\\').split('\\')[0]);
      const ledger = this.read(), mine = ledger.runs[context.runId] ?? { plans: [], suites: [], testCases: [] };
      // Only branch publication evidence crosses a host-validated partial restart; no other resource ownership moves.
      if (!mine.pushes?.length && context.branchRunIds?.[0] === context.runId) {
        const inherited = context.branchRunIds.slice(1).map(runId => ledger.runs[runId]?.pushes).find(pushes => pushes?.length);
        if (inherited) mine.pushes = structuredClone(inherited);
      }
      const plan = (p: string, planId: unknown): Plan => mine.plans.find(item => item.id === id(planId, 'planId') && lower(item.project) === lower(p)) ?? deny('Only test plans created by this run can be changed');
      const suite = (p: string, planId: number, suiteId: unknown): number => {
        const value = id(suiteId, 'suiteId'), owner = plan(p, planId);
        if (owner.rootSuiteId === value || mine.suites.some(item => item.id === value && item.planId === planId)) return value;
        return deny('Only test suites created by this run can be changed');
      };
      /** Refuse before the POST, so a full ledger never leaves an unrecorded resource behind. */
      const room = () => { if (mine.plans.length + mine.suites.length + mine.testCases.length >= MAX_PER_RUN) deny('DevOps write ledger limit reached for this run'); };
      const record = (mutate: (entry: typeof mine) => void) => {
        const fresh = this.read(), entry = fresh.runs[context.runId] ?? { plans: [], suites: [], testCases: [] };
        mutate(entry);
        if (entry.plans.length + entry.suites.length + entry.testCases.length > MAX_PER_RUN) deny('DevOps write ledger limit reached for this run');
        fresh.runs[context.runId] = entry;
        const ids = Object.keys(fresh.runs); for (const old of ids.slice(0, Math.max(0, ids.length - MAX_RUNS))) delete fresh.runs[old];
        this.write(fresh);
      };
      /** The run's own work item, read live: its project must still be in the grant before any write. */
      const workItem = async () => {
        const item = await call('GET', `${org}/_apis/wit/workitems/${context.workItemId}?fields=System.TeamProject,System.Tags&${API}`);
        const fields = object(item.fields, 'work item fields'), rev = item.rev;
        if (item.id !== context.workItemId || !Number.isSafeInteger(rev) || typeof fields['System.TeamProject'] !== 'string') deny('DevOps: unexpected work item response');
        return { project: project(fields['System.TeamProject']), rev: rev as number, tags: typeof fields['System.Tags'] === 'string' ? (fields['System.Tags'] as string).split(';').map(t => t.trim()).filter(Boolean) : [] };
      };
      const patchItem = async (patch: unknown[]) => {
        const result = await call('PATCH', `${org}/_apis/wit/workitems/${context.workItemId}?${API}`, patch, 'application/json-patch+json');
        if (this.options.revisions) { if (result.id !== context.workItemId) deny('Unexpected work-item write receipt'); this.options.revisions.revision(grant.organization, context.workItemId, id(result.rev, 'revision')); }
        return result;
      };
      const audit = (target: string) => { try { this.options.audit?.({ runId: context.runId, op, target }); } catch { /* audit is best effort */ } };

      if (op === 'test-environment-status') {
        keys(raw, ['op', 'targetId'], 'request');
        const target = grant.deployTargets?.find(t => t.id === raw.targetId), local = this.options.deployments?.targets().find(t => t.id === raw.targetId);
        if (!target || !local || JSON.stringify(target) !== JSON.stringify(local)) deny('Exact test environment target unavailable');
        return { targetId: target!.id, snapshot: await testEnvironmentSnapshot(target!, call) };
      }
      if (op === 'push-branch') {
        keys(raw, ['op', 'project', 'repositoryId', 'commit'], 'request');
        if (!context.workspace) deny('Host-bound workspace required for push');
        // Optional: publish an ancestor of the branch HEAD (e.g. a base commit for a deploy without the red test).
        const commit = raw.commit === undefined ? undefined : lower(safeText(raw.commit, 'commit', 64));
        if (commit !== undefined && !/^[a-f0-9]{40,64}$/.test(commit)) deny('commit must be a full commit sha');
        const p = project(raw.project), repositoryId = safeText(raw.repositoryId, 'repositoryId', 36).toLowerCase();
        if (!GUID.test(repositoryId)) deny('Invalid repository identity');
        if (!grant.pushTargets?.some(t => t.repositoryId === repositoryId && lower(t.project) === lower(p) && t.workspaceInput === context.workspaceInput)) deny('Repository and workspace input are outside the exact approved push target');
        const repository = await call('GET', `${org}/${encodeURIComponent(p)}/_apis/git/repositories/${repositoryId}?${API}`);
        if (String(repository.id).toLowerCase() !== repositoryId || lower(String(object(repository.project, 'repository project').name)) !== lower(p)) deny('Repository is outside the exact project');
        const lineage = context.branchRunIds ?? [context.runId];
        if (!lineage.length || lineage[0] !== context.runId) deny('Invalid host branch lineage');
        const branch = runBranch(lineage.at(-1)!), previous = mine.pushes?.find(push => push.repositoryId === repositoryId);
        if (Object.values(ledger.operations ?? {}).some(write => lineage.includes(write.runId) && write.op === 'push-branch' && write.state === 'pending')) deny('An inherited branch push has an unknown outcome; reconcile it before retrying');
        if (mine.pushes?.some(push => push.repositoryId !== repositoryId)) deny('A run can publish only one repository branch');
        const refs = await call('GET', `${org}/${encodeURIComponent(p)}/_apis/git/repositories/${repositoryId}/refs?filter=${encodeURIComponent(branch.slice(5))}&${API}`);
        const live = Array.isArray(refs.value) ? refs.value.map(v => object(v, 'git ref')).find(r => r.name === branch) : deny('Invalid ref response');
        if (live && (!previous || live.objectId !== previous.commit)) deny('The run branch already exists or was changed outside this run');
        const result = await (this.options.push ?? pushRunBranch)({ workspace: context.workspace!, runId: lineage.at(-1)!, ...(commit ? { commit } : {}), organization: grant.organization, project: p, repositoryId, token, beforePush: () => this.beforeMutation?.(), authorize: () => { context.authorize?.(); if (controller.signal.aborted) throw new Error('Push cancelled'); }, signal: controller.signal });
        if (result.branch !== branch || !/^[a-f0-9]{40,64}$/.test(result.commit)) deny('Unexpected host push receipt');
        record(entry => { entry.pushes = [{ project: p, repositoryId, ...result }]; });
        return { repositoryId, ...result };
      }
      if (op === 'deploy-test' || op === 'test-deploy-status' || op === 'cancel-test-deploy' || op === 'queue-pr-validation' || op === 'pr-build-status') {
        keys(raw, op === 'deploy-test' ? ['op', 'targetId', 'buildId'] : op === 'queue-pr-validation' ? ['op', 'targetId', 'mergeCommit'] : op === 'pr-build-status' ? ['op', 'targetId'] : ['op', 'targetId', 'releaseId'], 'request');
        const target = grant.deployTargets?.find(t => t.id === raw.targetId);
        if (!target || !this.options.deployments) deny('No exact test deployment target is approved/configured');
        let verifySource: (() => Promise<void>) | undefined;
        let source: { repositoryId: string; commit: string; branch: string; pullRequestId?: number } | undefined;
        if (op === 'deploy-test' || op === 'queue-pr-validation' || op === 'pr-build-status') {
          const pr = mine.prs?.find(pr => pr.repositoryId === target!.repositoryId);
          if (!pr || pr.projectId !== target!.projectId || lower(pr.project) !== lower(target!.project)) deny('Deployment requires this run’s own PR in the approved target project');
          const live = await call('GET', `${org}/${encodeURIComponent(pr!.project)}/_apis/git/repositories/${pr!.repositoryId}/pullrequests/${pr!.id}?${API}`);
          if (live.pullRequestId !== pr!.id || live.sourceRefName !== pr!.source || live.targetRefName !== pr!.target || String(object(live.repository, 'PR repository').id).toLowerCase() !== pr!.repositoryId || live.status !== 'active') deny('Run PR identity changed');
          if (live.mergeStatus !== 'succeeded') deny('The run PR merge is not ready; wait for merge computation');
          source = { repositoryId: pr!.repositoryId, commit: text(object(live.lastMergeCommit, 'PR merge commit').commitId, 'commit', 64), branch: `refs/pull/${pr!.id}/merge`, pullRequestId: pr!.id };
          verifySource = async () => {
            const refs = await call('GET', `${org}/${encodeURIComponent(pr!.project)}/_apis/git/repositories/${pr!.repositoryId}/refs?filter=${encodeURIComponent(pr!.source.slice(5))}&${API}`);
            const branchRef = Array.isArray(refs.value) ? refs.value.map(v => object(v, 'source ref')).find(r => r.name === pr!.source) : undefined;
            const mergeRefs = await call('GET', `${org}/${encodeURIComponent(pr!.project)}/_apis/git/repositories/${pr!.repositoryId}/refs?filter=${encodeURIComponent(`pull/${pr!.id}/merge`)}&${API}`);
            const mergeRef = Array.isArray(mergeRefs.value) ? mergeRefs.value.map(v => object(v, 'merge ref')).find(r => r.name === source!.branch) : undefined;

            const fresh = await call('GET', `${org}/${encodeURIComponent(pr!.project)}/_apis/git/repositories/${pr!.repositoryId}/pullrequests/${pr!.id}?${API}`);
            const published = mine.pushes?.find(push => push.repositoryId === pr!.repositoryId);
            if (fresh.mergeStatus !== 'succeeded' || !branchRef || !mergeRef || mergeRef.objectId !== source!.commit || object(fresh.lastMergeSourceCommit, 'PR source commit').commitId !== branchRef.objectId || (grant.ops.includes('git-push') && (!published || published.commit !== branchRef.objectId))) deny('The PR merge build is stale relative to the run source branch');
            if (fresh.pullRequestId !== pr!.id || fresh.status !== 'active' || fresh.sourceRefName !== pr!.source || fresh.targetRefName !== pr!.target || String(object(fresh.repository, 'PR repository').id).toLowerCase() !== pr!.repositoryId || object(fresh.lastMergeCommit, 'PR merge commit').commitId !== source!.commit) deny('The run PR merge identity changed before deployment');
          };
          if (op === 'queue-pr-validation' || op === 'pr-build-status') {
            if (op === 'queue-pr-validation' && raw.mergeCommit !== source.commit) deny('mergeCommit must equal this PR live lastMergeCommit');
            const targetCall = (method: string, url: string, body?: unknown) => { const local = this.options.deployments!.targets().find(t => t.id === target!.id); if (!local || deploymentHash(local) !== deploymentHash(target)) deny('Test target changed or was removed; approve it again'); return call(method, url, body); };
            if (op === 'pr-build-status') return prBuildStatus(target!, { commit: source.commit, pullRequestId: pr!.id }, targetCall, verifySource);
            return queuePrValidation(target!, pr!, source.commit, targetCall, verifySource);
          }
        }
        const deploymentResult = await this.options.deployments!.execute(op, target!, op === 'deploy-test' && raw.buildId !== undefined ? id(raw.buildId, 'buildId') : undefined, { runId: context.runId, call, authorize: () => { context.authorize?.(); if (controller.signal.aborted) throw new Error('Deployment request cancelled'); }, source, verifySource, arm: async resourceId => {
          context.authorize?.();
          if (!/^\/subscriptions\/[a-f0-9-]+\/resourceGroups\/[A-Za-z0-9._()-]+\/providers\/Microsoft.Web\/sites\/[A-Za-z0-9-]+$/.test(resourceId)) deny('Invalid ARM resource identity');
          const secret = await (this.options.armToken ?? armToken)(controller.signal);
          context.authorize?.();
          return this.call(secret, 'GET', `https://management.azure.com${resourceId}?api-version=2024-04-01`, undefined, 'application/json', controller.signal);
        } }, raw.releaseId === undefined ? undefined : id(raw.releaseId, 'releaseId'));
        if (op === 'test-deploy-status' && deploymentResult.terminal === true) {
          const journal = this.read();
          for (const [key, pending] of Object.entries(journal.operations ?? {})) if (pending.runId === context.runId && pending.state === 'pending' && ['deploy-test', 'cancel-test-deploy'].includes(String(pending.op)) && pending.targetId === target!.id && deploymentResult.latest === true && (pending.buildId === undefined || pending.buildId === deploymentResult.buildId) && (pending.releaseId === undefined || pending.releaseId === deploymentResult.releaseId)) {
            pending.state = 'done'; pending.completedAt = Date.now(); pending.result = { ...deploymentResult, reconciled: true };
            this.write(journal); this.options.revisions?.done(grant.organization, context.workItemId, key);
          }
        }
        return deploymentResult;
      }
      const resource = await devopsResource(raw, { grant, workItemId: context.workItemId, evidenceRoot: context.evidenceRoot, mine, call, workItem, patchItem, record });
      if (resource) { audit(`run:${context.runId}`); return resource; }
      switch (op) {
        case 'add-tags': case 'remove-tags': {
          keys(raw, ['op', 'tags'], 'request');
          if (!Array.isArray(raw.tags) || !raw.tags.length || raw.tags.length > 10) deny('tags: 1-10 values');
          const tags = (raw.tags as unknown[]).map(t => { const s = safeText(t, 'tag', 100); if (s.includes(';')) deny('tag: ";" is not allowed'); return s; });
          const item = await workItem();
          const next = op === 'add-tags' ? [...item.tags, ...tags.filter(t => !item.tags.some(x => lower(x) === lower(t)))] : item.tags.filter(x => !tags.some(t => lower(t) === lower(x)));
          await patchItem([{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/fields/System.Tags', value: next.join('; ') }]);
          audit(`workitem:${context.workItemId}`); return { workItemId: context.workItemId, tags: next };
        }
        case 'set-fields': {
          keys(raw, ['op', 'fields'], 'request');
          const fields = object(raw.fields, 'fields'), entries = Object.entries(fields);
          if (!entries.length || entries.length > 10) deny('fields: 1-10 values');
          const patch = entries.map(([name, value]) => {
            const granted = grant.fields.find(f => lower(f) === lower(name)) ?? deny(`Field ${name} is not in the approved DevOps write grant`);
            const v = safeText(value, granted, 1000);
            // A move must stay inside the approved projects: area and iteration paths start with their project.
            if (['system.areapath', 'system.iterationpath'].includes(lower(granted))) projectOf(v);
            return { op: 'add', path: `/fields/${granted}`, value: v };
          });
          const item = await workItem();
          await patchItem([{ op: 'test', path: '/rev', value: item.rev }, ...patch]);
          audit(`workitem:${context.workItemId}`); return { workItemId: context.workItemId, fields: patch.map(p => p.path.slice(8)) };
        }
        case 'comment': {
          keys(raw, ['op', 'text', 'mentions', 'mentionReason', 'format'], 'request');
          const body = text(raw.text, 'text', 10_000);
          if (raw.mentions !== undefined && (!Array.isArray(raw.mentions) || raw.mentions.length > 10)) deny('mentions: at most 10 identity ids');
          const ids = ((raw.mentions as unknown[] | undefined) ?? []).map(value => { const s = lower(safeText(value, 'mention', 36)); if (!GUID.test(s)) deny('mentions must be identity GUIDs'); return s; });
          if (new Set(ids).size !== ids.length) deny('mentions: duplicate identity');
          if (ids.some(v => !(grant.mentions ?? []).includes(v))) deny('Mention is not in the approved DevOps write grant');
          if (raw.mentionReason === 'analysis' && context.mentionReason !== 'analysis') deny('Analysis mentions require this step to opt in with mentionReason: analysis');
          if (ids.length && (context.evidenceRoot || context.mentionReason === 'analysis') && !(['intake', 'block', 'downgrade', 'final'].includes(String(context.mentionReason)) || context.mentionReason === 'analysis' && raw.mentionReason === 'analysis')) deny('Mentions are allowed only on intake, blocks, downgrades, final outcome or a step-approved analysis comment');
          if (raw.format !== undefined && !['plain', 'markdown'].includes(String(raw.format))) deny('Unknown comment format');
          const rich = raw.format !== 'plain' && /!?\[[^\]]+\]\(/.test(body);
          if (rich && !grant.ops.includes('rich-comments')) deny('Clickable links and inline images require rich-comments');
          const rendered = rich ? renderDevOpsComment(body, grant.organization, mine.images ?? []) : html(body);
          const item = await workItem();
          // the adapter builds each mention itself, the name read from DevOps; the agent's text stays escaped
          const tags: string[] = [];
          for (const identity of ids) {
            const found = await call('GET', `https://vssps.dev.azure.com/${encodeURIComponent(grant.organization)}/_apis/identities?identityIds=${identity}&${API}`);
            const row = Array.isArray(found.value) && found.value.length === 1 ? object(found.value[0], 'identity') : deny('DevOps: mention identity not found');
            const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
            const name = pick(row.customDisplayName) || pick(row.providerDisplayName);
            if (lower(String(row.id)) !== identity || !name || name.length > 256 || CONTROL.test(name)) deny('DevOps: unexpected identity response');
            tags.push(`<a href="#" data-vss-mention="version:2.0,${identity}">@${html(name)}</a>`);
          }
          const result = await call('POST', `${org}/${encodeURIComponent(item.project)}/_apis/wit/workItems/${context.workItemId}/comments?api-version=7.1-preview.4`, { text: `${tags.length ? `${tags.join(' ')}<br/>` : ''}${rendered}` });
          this.options.revisions?.comment(grant.organization, context.workItemId, id(result.id, 'comment id'));
          audit(`workitem:${context.workItemId}`); return { workItemId: context.workItemId, commentId: result.id, ...(ids.length ? { mentions: ids.length } : {}) };
        }
        case 'link-pr': {
          keys(raw, ['op', 'projectId', 'repositoryId', 'pullRequestId'], 'request');
          const projectId = safeText(raw.projectId, 'projectId', 36), repositoryId = safeText(raw.repositoryId, 'repositoryId', 36), pr = id(raw.pullRequestId, 'pullRequestId');
          if (!GUID.test(projectId) || !GUID.test(repositoryId)) deny('projectId and repositoryId must be GUIDs');
          // The PR's project must be in the grant too: resolve its GUID to a name.
          const prProject = await call('GET', `${org}/_apis/projects/${projectId}?${API}`);
          if (typeof prProject.name !== 'string' || lower(String(prProject.id)) !== lower(projectId)) deny('DevOps: unexpected project response');
          project(prProject.name);
          const item = await workItem();
          // create-pr already links its PR: a read (no journal entry) makes the repeat a no-op instead of an HTTP 400.
          const linked = await call('GET', `${org}/_apis/wit/workitems/${context.workItemId}?$expand=relations&${API}`);
          if (Array.isArray(linked.relations) && linked.relations.some(r => { const rel = object(r, 'relation'); return rel.rel === 'ArtifactLink' && sameArtifact(rel.url, `vstfs:///Git/PullRequestId/${projectId}/${repositoryId}/${pr}`); })) {
            return { workItemId: context.workItemId, pullRequestId: pr, alreadyLinked: true };
          }
          await patchItem([{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/relations/-', value: { rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/${projectId}%2F${repositoryId}%2F${pr}`, attributes: { name: 'Pull Request' } } }]);
          audit(`workitem:${context.workItemId}`); return { workItemId: context.workItemId, pullRequestId: pr };
        }
        case 'create-test-plan': {
          keys(raw, ['op', 'project', 'name', 'areaPath', 'iteration'], 'request'); room();
          const p = project(raw.project), name = safeText(raw.name, 'name', 256);
          const areaPath = raw.areaPath === undefined ? undefined : safeText(raw.areaPath, 'areaPath', 1000), iteration = raw.iteration === undefined ? undefined : safeText(raw.iteration, 'iteration', 1000);
          for (const value of [areaPath, iteration]) if (value && lower(projectOf(value)) !== lower(p)) deny('Test plan paths must be inside its project');
          const created = await call('POST', `${org}/${encodeURIComponent(p)}/_apis/testplan/plans?${API}`, { name, ...(areaPath ? { areaPath } : {}), ...(iteration ? { iteration } : {}) });
          const planId = id(created.id, 'created plan id'), rootSuiteId = id(object(created.rootSuite, 'root suite').id, 'root suite id');
          record(entry => entry.plans.push({ project: p, id: planId, rootSuiteId }));
          audit(`testplan:${planId}`); return { planId, rootSuiteId };
        }
        case 'rename-test-plan': {
          keys(raw, ['op', 'project', 'planId', 'name'], 'request');
          const p = project(raw.project), owned = plan(p, raw.planId), name = safeText(raw.name, 'name', 256);
          await call('PATCH', `${org}/${encodeURIComponent(p)}/_apis/testplan/plans/${owned.id}?${API}`, { name });
          audit(`testplan:${owned.id}`); return { planId: owned.id, name };
        }
        case 'create-test-suite': {
          keys(raw, ['op', 'project', 'planId', 'parentSuiteId', 'name'], 'request'); room();
          const p = project(raw.project), owned = plan(p, raw.planId), parent = suite(p, owned.id, raw.parentSuiteId), name = safeText(raw.name, 'name', 256);
          const created = await call('POST', `${org}/${encodeURIComponent(p)}/_apis/testplan/Plans/${owned.id}/suites?${API}`, { suiteType: 'staticTestSuite', name, parentSuite: { id: parent } });
          const suiteId = id(created.id, 'created suite id');
          record(entry => entry.suites.push({ project: p, planId: owned.id, id: suiteId }));
          audit(`testsuite:${suiteId}`); return { planId: owned.id, suiteId };
        }
        case 'create-test-case': {
          keys(raw, ['op', 'project', 'planId', 'suiteId', 'title', 'steps'], 'request'); room();
          const p = project(raw.project), owned = plan(p, raw.planId), suiteId = suite(p, owned.id, raw.suiteId), title = safeText(raw.title, 'title', 256);
          if (!Array.isArray(raw.steps) || raw.steps.length > 50) deny('steps: at most 50');
          const steps = (raw.steps as unknown[]).map((value, i) => { const s = object(value, `step ${i + 1}`); keys(s, ['action', 'expected'], 'step'); return { action: text(s.action, 'step action', 4000), expected: s.expected === undefined ? '' : text(s.expected, 'step expected', 4000, true) }; });
          const xml = `<steps id="0" last="${steps.length + 1}">${steps.map((s, i) => `<step id="${i + 2}" type="ValidateStep"><parameterizedString isformatted="true">${html(html(s.action))}</parameterizedString><parameterizedString isformatted="true">${html(html(s.expected))}</parameterizedString><description/></step>`).join('')}</steps>`;
          await workItem(); // the linked work item must still be inside the grant
          const created = await call('POST', `${org}/${encodeURIComponent(p)}/_apis/wit/workitems/$Test%20Case?${API}`, [
            { op: 'add', path: '/fields/System.Title', value: title },
            ...(steps.length ? [{ op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: xml }] : []),
            // "Tests" link to the run's own work item, the only one the test case may reference.

          ], 'application/json-patch+json');
          const caseId = id(created.id, 'created test case id');
          record(entry => entry.testCases.push({ project: p, planId: owned.id, suiteId, id: caseId }));
          const linkedItem = await workItem();
          await patchItem([{ op: 'test', path: '/rev', value: linkedItem.rev }, { op: 'add', path: '/relations/-', value: { rel: 'Microsoft.VSTS.Common.TestedBy-Forward', url: `${org}/_apis/wit/workItems/${caseId}` } }]);
          await call('POST', `${org}/${encodeURIComponent(p)}/_apis/testplan/Plans/${owned.id}/Suites/${suiteId}/TestCase?${API}`, [{ workItem: { id: caseId } }]);
          audit(`testcase:${caseId}`); return { planId: owned.id, suiteId, testCaseId: caseId, linkedTo: context.workItemId };
        }
        case 'set-test-outcome': {
          keys(raw, ['op', 'project', 'planId', 'suiteId', 'testCaseId', 'outcome'], 'request');
          const p = project(raw.project), owned = plan(p, raw.planId), suiteId = suite(p, owned.id, raw.suiteId), caseId = id(raw.testCaseId, 'testCaseId');
          if (!mine.testCases.some(c => c.id === caseId && c.planId === owned.id && c.suiteId === suiteId)) deny('Only test cases created by this run can get results');
          if (!(OUTCOMES as readonly string[]).includes(raw.outcome as string)) deny(`outcome: one of ${OUTCOMES.join(', ')}`);
          const points = await call('GET', `${org}/${encodeURIComponent(p)}/_apis/testplan/Plans/${owned.id}/Suites/${suiteId}/TestPoint?testCaseId=${caseId}&${API}`);
          if (!Array.isArray(points.value) || !points.value.length || points.value.length > 50) deny('DevOps: no test point for this test case');
          const ids = (points.value as unknown[]).map(v => id(object(v, 'test point').id, 'test point id'));
          await call('PATCH', `${org}/${encodeURIComponent(p)}/_apis/testplan/Plans/${owned.id}/Suites/${suiteId}/TestPoint?${API}`, ids.map(pointId => ({ id: pointId, results: { outcome: raw.outcome } })));
          audit(`testcase:${caseId}`); return { testCaseId: caseId, outcome: raw.outcome, points: ids.length };
        }
      }
      return deny('Unknown DevOps write operation');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  private async call(token: string, method: string, url: string, body: unknown, contentType: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    let payload: string | Uint8Array<ArrayBuffer> | undefined;
    try {
      payload = body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body);
      if (signal.aborted) deny('DevOps request cancelled before dispatch');
      if (method !== 'GET') this.beforeMutation?.();
    } catch (error) { if (method !== 'GET') throw new NoRemoteEffect(error instanceof Error ? error.message : 'DevOps request refused before dispatch'); throw error; }
    let response: Response;
    try { response = await (this.options.request ?? fetch)(url, { method, redirect: 'error', signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': contentType }) },
      ...(payload === undefined ? {} : { body: payload }) }); }
    catch { throw new DevOpsWriteError('DevOps transport failed; no definitive response was received.'); }
    if (method !== 'GET' && [401, 403, 412].includes(response.status)) {
      this.mutationRefused?.();
      throw new NoRemoteEffect(response.status === 412 ? 'DevOps: the work item changed meanwhile (HTTP 412).' : `DevOps: Azure CLI login unavailable or no permission (HTTP ${response.status}). Run az login and check the required permissions.`);
    }
    if ([203, 401, 403].includes(response.status) || (response.status >= 300 && response.status < 400)) deny(`DevOps: Azure CLI login unavailable or no permission (HTTP ${response.status}). Run az login and check the required permissions.`);
    if (response.headers.get('x-ms-continuationtoken') && !(method === 'GET' && url.includes('/release/deployments?') && new URL(url).searchParams.get('$top') === '1')) deny('DevOps: paginated response requires a narrower target');
    if (response.status === 412) deny('DevOps: the work item changed meanwhile (HTTP 412).');
    if (!response.ok) deny(`DevOps: write refused (HTTP ${response.status}).`);
    const source = await response.text();
    if (Buffer.byteLength(source) > MAX_BYTES) deny('DevOps: response too large');
    if (!source.trim()) return {};
    try { return object(JSON.parse(source) as unknown, 'response'); } catch { return deny('DevOps: invalid response'); }
  }
  private read(): Ledger {
    try {
      if (!fs.existsSync(this.options.file)) return { schema: 1, runs: {} };
      const raw = object(JSON.parse(fs.readFileSync(this.options.file, 'utf8')) as unknown, 'ledger');
      if (raw.schema !== 1) throw new Error('schema');
      return { schema: 1, runs: object(raw.runs, 'ledger runs') as Ledger['runs'], ...(raw.operations ? { operations: object(raw.operations, 'operation journal') as NonNullable<Ledger['operations']> } : {}) };
    } catch { return deny('DevOps write ledger is unreadable; restore it before writing.'); }
  }
  private write(data: Ledger): void {
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
    const temp = `${this.options.file}.${randomUUID()}.tmp`;
    try { const fd = fs.openSync(temp, 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } renameRetrying(temp, this.options.file); }
    finally { try { fs.rmSync(temp, { force: true }); } catch { /* cleanup cannot undo the rename */ } }
  }
}
