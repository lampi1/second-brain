// Explicit test-only release adapter. Local user-managed targets pin one definition revision and one deployment-group
// machine or one hosted App Service. A draft is validated before activation; ambiguous writes retain the lease. No approval or production API.
import { NoRemoteEffect } from './write-refusal';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { renameRetrying } from '../rules/storage';
import { identifier, integer, keys, object, text } from './schema';
import { testEnvironmentSnapshot } from './test-environment';
import { APP_SERVICE_TASK_IDS, validateAppServiceDefinition, validateAppServicePhases, verifyAppService, appServiceResourceId } from './app-service-target';
import type { TestDeployTarget } from '../../shared/flow-automation';

const API = 'api-version=7.1';
const pos = (v: unknown): number => integer(v, 'target id', 1, 2_147_483_647);
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : v;
export const deploymentHash = (v: unknown): string => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function validateDeployTarget(value: unknown): TestDeployTarget {
  const t = object(value, 'test deployment target');
  keys(t, ['id', 'organization', 'project', 'projectId', 'releaseDefinitionId', 'definitionRevision', 'definitionSha256', 'environmentId', 'environmentName', 'deploymentGroupId', 'queueId', 'poolId', 'agentId', 'machineId', 'machineName', 'computerName', 'artifactAlias', 'buildDefinitionId', 'repositoryId', 'confirmedTest', 'kind', 'subscriptionId', 'resourceGroup', 'webAppName', 'serviceConnectionId', 'allowedTaskIds'], 'test deployment target');
  if (t.confirmedTest !== true) throw new Error('Deployment target must be explicitly confirmed test-only by the user');
  const guid = (v: unknown): string => { const s = text(v, 'GUID', 36).toLowerCase(); if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)) throw new Error('Invalid deployment GUID'); return s; };
  const organization = text(t.organization, 'organization', 50), project = text(t.project, 'project', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(organization) || /[\\/\x00-\x1f]/.test(project)) throw new Error('Invalid deployment organization/project');
  const sha = text(t.definitionSha256, 'definitionSha256', 64); if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Invalid deployment definition fingerprint');
  const base = { id: identifier(t.id, 'target id'), organization, project, projectId: guid(t.projectId), releaseDefinitionId: pos(t.releaseDefinitionId), definitionRevision: pos(t.definitionRevision), definitionSha256: sha,
    environmentId: pos(t.environmentId), environmentName: text(t.environmentName, 'environment name', 200), queueId: pos(t.queueId),
    artifactAlias: text(t.artifactAlias, 'artifact alias', 200), buildDefinitionId: pos(t.buildDefinitionId), repositoryId: guid(t.repositoryId), confirmedTest: true as const };
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(base.artifactAlias)) throw new Error('Invalid artifact alias');
  if (t.kind === 'app-service') {
    if (['poolId', 'agentId', 'machineId', 'deploymentGroupId', 'machineName', 'computerName'].some(k => k in t)) throw new Error('App Service has no deployment-group machine');
    const resourceGroup = text(t.resourceGroup, 'resource group', 90), webAppName = text(t.webAppName, 'web app', 60);
    if (!/^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/.test(resourceGroup) || !/^[A-Za-z0-9][A-Za-z0-9-]{0,59}$/.test(webAppName)) throw new Error('Invalid literal Azure resource name');
    if (!Array.isArray(t.allowedTaskIds) || !t.allowedTaskIds.length || t.allowedTaskIds.length > 5) throw new Error('Explicit allowed deploy tasks required');
    const allowedTaskIds = t.allowedTaskIds.map(guid);
    if (new Set(allowedTaskIds).size !== allowedTaskIds.length || allowedTaskIds.some(id => !APP_SERVICE_TASK_IDS.includes(id))) throw new Error('Unsupported deploy task');
    return { ...base, kind: 'app-service', subscriptionId: guid(t.subscriptionId), serviceConnectionId: guid(t.serviceConnectionId), resourceGroup, webAppName, allowedTaskIds };
  }
  if (t.kind !== undefined && t.kind !== 'deployment-group') throw new Error('Unknown deployment target kind');
  if (['subscriptionId', 'resourceGroup', 'webAppName', 'serviceConnectionId', 'allowedTaskIds'].some(k => k in t)) throw new Error('Unexpected App Service fields');
  return { ...base, ...(t.kind ? { kind: 'deployment-group' as const } : {}), deploymentGroupId: pos(t.deploymentGroupId), poolId: pos(t.poolId), agentId: pos(t.agentId), computerName: text(t.computerName, 'computer name', 200), machineId: pos(t.machineId), machineName: text(t.machineName, 'machine name', 200) };
}
export function readDeployTargets(file: string): TestDeployTarget[] {
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 256 * 1024) throw new Error('Unsafe test deployment target configuration');
  const raw = object(JSON.parse(fs.readFileSync(file, 'utf8')), 'test targets'); keys(raw, ['schema', 'targets'], 'test targets');
  if (raw.schema !== 1 || !Array.isArray(raw.targets) || raw.targets.length > 30) throw new Error('Invalid test deployment targets');
  const targets = raw.targets.map(validateDeployTarget); if (new Set(targets.map(t => t.id)).size !== targets.length) throw new Error('Duplicate deployment target'); return targets;
}
/** Stable execution projection: excludes volatile lastRelease, audit dates and service links. */
export function releaseDefinitionFingerprint(value: unknown): string {
  const d = object(value, 'release definition');
  return deploymentHash({ id: d.id, revision: d.revision, environments: (Array.isArray(d.environments) ? d.environments : []).map(value => {
    const e = object(value, 'environment'); return { id: e.id, name: e.name, deployPhases: e.deployPhases, variables: e.variables, variableGroups: e.variableGroups, preDeployApprovals: e.preDeployApprovals, postDeployApprovals: e.postDeployApprovals, preDeploymentGates: e.preDeploymentGates, postDeploymentGates: e.postDeploymentGates, processParameters: e.processParameters, executionPolicy: e.executionPolicy, environmentOptions: e.environmentOptions };
  }), artifacts: d.artifacts, variables: d.variables, variableGroups: d.variableGroups, processParameters: d.processParameters });
}
export const deploymentLeaseKey = (t: TestDeployTarget): string => t.kind === 'app-service' ? appServiceResourceId(t).toLowerCase() : `${t.organization.toLowerCase()}/${t.poolId}/${t.agentId}`;
interface Deployment { runId: string; target: TestDeployTarget; buildId: number; buildNumber?: string; commit: string; state: 'creating' | 'draft' | 'queued' | 'succeeded' | 'failed' | 'canceled'; releaseId?: number; environmentId?: number; token: string; released?: boolean; initiatingLease?: { stepId: string; at: number }; successfulDeploymentId?: number; evidenceConflict?: string }
interface State { schema: 1; deployments: Deployment[]; stepLeases?: { runId: string; stepId: string; target: TestDeployTarget; at: number; remoteSnapshot?: string; releasedAt?: number }[] }
export interface DeploymentPorts {
  runId: string; authorize(): void;
  call(method: string, url: string, body?: unknown): Promise<Record<string, unknown>>;
  /** The host verified this commit against the run-owned PR's live source commit. */
  source?: { repositoryId: string; commit: string; branch: string; pullRequestId?: number };
  verifySource?: () => Promise<void>;
  arm?: (resourceId: string) => Promise<Record<string, unknown>>;
}
export class TestDeploymentCoordinator {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly targetsFile: string, private readonly stateFile: string) {}
  /** Does not pretend aborting an HTTP request stopped a remote release. Unknown/active deployments retain ownership. */
  async settle(runId: string, authorize: () => void): Promise<boolean> {
    const job = this.queue.then(() => { authorize(); const state = this.read(), owned = state.deployments.filter(d => d.runId === runId && !d.released);
      if (owned.some(d => !['succeeded', 'failed', 'canceled'].includes(d.state))) return false;
      for (const d of owned) d.released = true; if (owned.length) this.save(state); return true; }); this.queue = job.catch(() => undefined); return job;
  }
  history(runId: string): unknown[] { const s = this.read(); return structuredClone([...s.deployments.filter(d => d.runId === runId), ...(s.stepLeases ?? []).filter(l => l.runId === runId)]); }
  ownedTargets(runId: string): string[] { return [...new Set(this.read().deployments.filter(d => d.runId === runId && !d.released).map(d => d.target.id))]; }
  targets(): TestDeployTarget[] { return readDeployTargets(this.targetsFile); }
  /** Called only once after acquiring the exclusive runner lock; prior-process step workers are interrupted. */
  async recoverStepLeases(): Promise<void> {
    const job = this.queue.then(() => { const state = this.read(); let changed = false;
      for (const l of state.stepLeases ?? []) if (!l.releasedAt) { l.releasedAt = Date.now(); changed = true; }
      if (changed) this.save(state);
    }); this.queue = job.catch(() => undefined); return job;
  }
  async acquireStep(runId: string, stepId: string, target: TestDeployTarget, authorize: () => void, remoteSnapshot?: string): Promise<void> {
    const job = this.queue.then(() => {
      authorize(); const local = this.targets().find(t => t.id === target.id);
      if (!local || deploymentHash(local) !== deploymentHash(target)) throw new Error('Test environment target changed; approve it again');
      const state = this.read(), key = deploymentLeaseKey(target);
      if (state.stepLeases?.some(l => !l.releasedAt && deploymentLeaseKey(l.target) === key && (l.runId !== runId || l.stepId !== stepId)) || state.deployments.some(d => !d.released && deploymentLeaseKey(d.target) === key && (d.runId !== runId || !['succeeded', 'failed', 'canceled'].includes(d.state)))) throw new Error('Test environment is already leased or a deployment is still active/uncertain');
      if (state.stepLeases?.some(l => !l.releasedAt && l.runId === runId && l.stepId === stepId && deploymentHash(l.target) === deploymentHash(target))) return;
      if ((state.stepLeases?.length ?? 0) >= 10000) throw new Error('Test environment lease journal is full');
      (state.stepLeases ??= []).push({ runId, stepId, target, at: Date.now(), ...(remoteSnapshot ? { remoteSnapshot } : {}) }); this.save(state);
    }); this.queue = job.catch(() => undefined); return job;
  }
  /** Release local step ownership on any exit; unknown remote deployments remain a separate durable lease. */
  async reconcileSteps(runId: string, activeStep?: string): Promise<void> {
    const job = this.queue.then(() => { const state = this.read(); let changed = false;
      for (const l of state.stepLeases ?? []) if (l.runId === runId && !l.releasedAt && l.stepId !== activeStep) { l.releasedAt = Date.now(); changed = true; }
      if (changed) this.save(state);
    }); this.queue = job.catch(() => undefined); return job;
  }
  verifyStepSnapshot(runId: string, stepId: string, snapshot: string): void {
    const lease = this.read().stepLeases?.find(l => l.runId === runId && l.stepId === stepId && !l.releasedAt);
    if (!lease || lease.remoteSnapshot !== snapshot) throw new Error('Shared test environment changed during this step; its test evidence cannot be accepted');
  }
  execute(op: 'deploy-test' | 'test-deploy-status' | 'cancel-test-deploy', target: TestDeployTarget, buildId: number | undefined, ports: DeploymentPorts, releaseId?: number): Promise<Record<string, unknown>> {
    const job = this.queue.then(() => this.perform(op, target, buildId, ports, releaseId)); this.queue = job.catch(() => undefined); return job;
  }
  private async perform(op: string, target: TestDeployTarget, buildId: number | undefined, p: DeploymentPorts, releaseId?: number): Promise<Record<string, unknown>> {
    const authorize = () => { p.authorize(); const local = this.targets().find(t => t.id === target.id); if (!local || deploymentHash(local) !== deploymentHash(target)) throw new Error('Test target changed or is not locally configured: propose and approve its exact configuration again'); };
    authorize();
    const call = (method: string, url: string, body?: unknown) => {
      try { authorize(); } catch (error) { if (method !== 'GET') throw new NoRemoteEffect(error instanceof Error ? error.message : 'Deployment refused before dispatch'); throw error; }
      return p.call(method, url, body);
    };
    const base = `https://dev.azure.com/${encodeURIComponent(target.organization)}/${target.projectId}`;
    const releaseBase = `https://vsrm.dev.azure.com/${encodeURIComponent(target.organization)}/${target.projectId}/_apis/release`;
    if (op === 'deploy-test') {
      const previous = this.read().deployments.filter(d => d.runId === p.runId);
      if (previous.some(d => deploymentHash(d.target) !== deploymentHash(target))) throw new Error('Further deployments must use the same exact approved target');
      if (previous.some(d => !['succeeded', 'failed', 'canceled'].includes(d.state))) throw new Error('This run already requested an active or uncertain deployment. Read test-deploy-status before creating another.');
      const last = previous.at(-1);
      if (last) {
        const receipt = await this.perform('test-deploy-status', target, undefined, p, last.releaseId);
        if (!receipt.terminal) throw new Error('The previous deployment is active or uncertain again; wait before deploying');
        // A human can restart any historical release. Check all active attempts, including deployment-group targets.
        if (target.kind !== 'app-service') await testEnvironmentSnapshot(target, call);
      }
    }
    const state = this.read(), history = state.deployments.filter(d => d.runId === p.runId), latest = history.filter(d => d.target.id === target.id).at(-1);
    const own = releaseId === undefined ? latest : history.find(d => d.target.id === target.id && d.releaseId === releaseId);
    const identity = (d: Deployment) => ({ targetId: target.id, releaseId: d.releaseId, environmentId: d.environmentId, buildId: d.buildId, buildNumber: d.buildNumber ?? null, sourceVersion: d.commit, latest: d === latest });
    if (op === 'test-deploy-status' || op === 'cancel-test-deploy') {
      if (!own) throw new Error('This run has no deployment on this target with that owned release id');
      if (deploymentHash(own.target) !== deploymentHash(target)) throw new Error('Deployment target differs from the approved historical target');
      if (!own.releaseId || !own.environmentId) throw new Error('Release creation has an unknown outcome; the test lease remains held. Reconcile in Azure DevOps before any new release.');
      const release = await call('GET', `${releaseBase}/releases/${own.releaseId}?${API}`);
      const env = Array.isArray(release.environments) ? release.environments.map(v => object(v, 'release environment')).find(e => e.id === own.environmentId && e.definitionEnvironmentId === target.environmentId) : undefined;
      if (!env || object(release.releaseDefinition, 'release definition').id !== target.releaseDefinitionId) throw new Error('Deployment identity changed');
      const status = release.status === 'abandoned' ? 'canceled' : String(env.status);
      const terminal = ['succeeded', 'failed', 'canceled', 'rejected', 'partiallySucceeded'].includes(status);
      own.state = terminal ? status === 'succeeded' ? 'succeeded' : status === 'canceled' ? 'canceled' : 'failed' : release.status === 'draft' ? 'draft' : 'queued';
      if (!terminal) own.released = false;
      this.save(state);
      if (op === 'cancel-test-deploy' && !terminal) {
        if (release.status === 'draft') await call('PATCH', `${releaseBase}/releases/${own.releaseId}?${API}`, { status: 'abandoned', comment: 'Routine cleanup of its own draft test release' });
        else await call('PATCH', `${releaseBase}/releases/${own.releaseId}/environments/${own.environmentId}?${API}`, { status: 'canceled', comment: 'Routine cleanup of its own test deployment' });
        return { ...identity(own), status: 'cancellation-requested', terminal: false, success: false };
      }
      if (own === latest && status === 'succeeded' && (target.kind === 'app-service' || own.initiatingLease) && !own.evidenceConflict) {
        try {
        const snapshot = await testEnvironmentSnapshot(target, call), observed: unknown[] = snapshot === 'empty' ? [] : JSON.parse(snapshot);
        if (observed[1] !== own.releaseId || observed[5] !== 1 || (own.successfulDeploymentId !== undefined && observed[0] !== own.successfulDeploymentId)) throw new Error('Another release or deployment attempt replaced this run deployment; test evidence is invalid');
        // Only the lease present at dispatch may adopt our first deployment attempt, once. Later BEFORE/AFTER
        // leases retain their immutable baseline even if a human redeploys this same owned release.
        if (own.successfulDeploymentId === undefined) {
          const lease = state.stepLeases?.find(l => l.runId === p.runId && !l.releasedAt && l.stepId === own.initiatingLease?.stepId && l.at === own.initiatingLease.at);
          if (lease) lease.remoteSnapshot = snapshot;
          own.successfulDeploymentId = observed[0] as number;
        }
        } catch (error) { own.evidenceConflict = String(error); }
        this.save(state);
      }
      return { ...identity(own), status, terminal: ['succeeded', 'failed', 'canceled'].includes(own.state), success: own.state === 'succeeded' && !own.evidenceConflict, ...(own.evidenceConflict ? { evidenceConflict: own.evidenceConflict } : {}) };
    }
    if (history.some(d => deploymentHash(d.target) !== deploymentHash(target))) throw new Error('Further deployments must use the same exact approved target');
    if (history.some(d => !['succeeded', 'failed', 'canceled'].includes(d.state))) throw new Error('This run already requested an active or uncertain deployment. Read test-deploy-status before creating another.');
    const leaseKey = deploymentLeaseKey;
    if (state.stepLeases?.some(l => !l.releasedAt && leaseKey(l.target) === leaseKey(target) && l.runId !== p.runId) || state.deployments.some(d => leaseKey(d.target) === leaseKey(target) && !d.released && d.runId !== p.runId)) throw new Error('The exact test node is leased by another deployment or an unresolved request');
    if (!p.source || p.source.repositoryId !== target.repositoryId || !/^[a-f0-9]{40,64}$/i.test(p.source.commit)) throw new Error('Test deployment requires a verified source commit from this run’s own PR');
    if (buildId === undefined && p.source.pullRequestId) {
      const builds = await call('GET', `${base}/_apis/build/builds?definitions=${target.buildDefinitionId}&reasonFilter=pullRequest&statusFilter=completed&resultFilter=succeeded&branchName=${encodeURIComponent(p.source.branch)}&queryOrder=finishTimeDescending&$top=100&${API}`);
      const found = Array.isArray(builds.value) ? builds.value.map(v => object(v, 'build')).find(b => b.sourceVersion === p.source!.commit) : undefined;
      if (!found) throw new Error('The run PR has no succeeded merge build yet; wait for its pipeline, then retry');
      buildId = pos(found.id);
    }
    const build = await call('GET', `${base}/_apis/build/builds/${pos(buildId)}?${API}`);
    if (p.source.pullRequestId && (p.source.branch !== `refs/pull/${p.source.pullRequestId}/merge` || build.reason !== 'pullRequest')) throw new Error('Expected this run PR merge build, not a branch build');
    if (build.id !== buildId || build.status !== 'completed' || build.result !== 'succeeded' || object(build.project, 'build project').id !== target.projectId || object(build.definition, 'build definition').id !== target.buildDefinitionId || String(object(build.repository, 'build repository').id).toLowerCase() !== target.repositoryId || build.sourceVersion !== p.source.commit || build.sourceBranch !== p.source.branch) throw new Error('Build is not the successful build of the run-owned PR verified commit');
    if (history.some(d => d.buildId === buildId)) throw new Error('This run already deployed this build; read test-deploy-status with its releaseId');
    const definition = await call('GET', `${releaseBase}/definitions/${target.releaseDefinitionId}?${API}`);
    if (definition.id !== target.releaseDefinitionId || definition.revision !== target.definitionRevision || releaseDefinitionFingerprint(definition) !== target.definitionSha256) throw new Error('Release definition changed since the test target was approved');
    const environments = Array.isArray(definition.environments) ? definition.environments.map(v => object(v, 'environment')) : [];
    if (environments.length !== 1 || environments[0]!.id !== target.environmentId || environments[0]!.name !== target.environmentName) throw new Error('Only a dedicated single-environment test release is supported');
    if ((Array.isArray(definition.variableGroups) && definition.variableGroups.length) || (Array.isArray(environments[0]!.variableGroups) && environments[0]!.variableGroups.length)) throw new Error('Mutable variable groups are unsupported for deterministic test releases');
    const artifacts = Array.isArray(definition.artifacts) ? definition.artifacts.map(v => object(v, 'artifact')) : [];
    if (artifacts.length !== 1 || artifacts[0]!.alias !== target.artifactAlias || artifacts[0]!.type !== 'Build') throw new Error('Test release must contain exactly the approved build artifact');
    const reference = object(artifacts[0]!.definitionReference, 'artifact reference');
    if (String(object(reference.definition, 'artifact definition').id) !== String(target.buildDefinitionId) || object(reference.project, 'artifact project').id !== target.projectId) throw new Error('Release artifact source differs from the approved build definition');
    const phases = (v: unknown, parameters = [definition.processParameters, environments[0]!.processParameters]) => { if (target.kind === 'app-service') return validateAppServicePhases(v, target, ...parameters); if (!Array.isArray(v) || v.length !== 1) throw new Error('Only one machine-group phase is supported'); const phase = object(v[0], 'phase'), input = object(phase.deploymentInput, 'deployment input');
      if (phase.phaseType !== 'machineGroupBasedDeployment' || input.queueId !== target.queueId || !Array.isArray(input.tags) || input.tags.length || (!Array.isArray(input.demands) || input.demands.length !== 2)) throw new Error('Unsupported or changed test-node routing');
      const demands = (input.demands as unknown[]).map(v => object(v, 'machine demand'));
      if (!demands.some(d => d.name === 'Agent.Name' && d.value === target.machineName) || !demands.some(d => d.name === 'Agent.ComputerName' && d.value === target.computerName) || demands.some(d => Object.keys(d).some(k => !['name', 'value'].includes(k)))) throw new Error('The server must enforce both the approved agent name and computer name');
      return phase; };
    const approvedPhases = phases(environments[0]!.deployPhases);
    if (target.kind === 'app-service') validateAppServiceDefinition(definition, target);
    const verifyNode = async () => {
      if (target.kind === 'app-service') { if (!p.arm) throw new Error('Read-only Azure resource verifier unavailable'); await verifyAppService(target, call, p.arm); return; }
      const queue = await call('GET', `${base}/_apis/distributedtask/queues/${target.queueId}?${API}`), group = await call('GET', `${base}/_apis/distributedtask/deploymentgroups/${target.deploymentGroupId}?${API}`);
      if (queue.id !== target.queueId || group.id !== target.deploymentGroupId || object(queue.pool, 'queue pool').id !== target.poolId || object(group.pool, 'group pool').id !== target.poolId) throw new Error('Deployment queue no longer maps to the approved group');
      const nodes = await call('GET', `${base}/_apis/distributedtask/deploymentgroups/${target.deploymentGroupId}/targets?$top=2&${API}`);
      if (!Array.isArray(nodes.value) || nodes.value.length !== 1) throw new Error('Deployment group must contain only the exact approved test node');
      const node = object(nodes.value[0], 'node'), agent = object(node.agent, 'node agent');
      if (node.id !== target.machineId || agent.id !== target.agentId || agent.name !== target.machineName || agent.enabled !== true || agent.status !== 'online') throw new Error('Approved test node is unavailable or changed');
      const capabilities = await call('GET', `https://dev.azure.com/${encodeURIComponent(target.organization)}/_apis/distributedtask/pools/${target.poolId}/agents/${target.agentId}?includeCapabilities=true&${API}`);
      const system = object(capabilities.systemCapabilities, 'agent system capabilities');
      if (capabilities.id !== target.agentId || system['Agent.Name'] !== target.machineName || system['Agent.ComputerName'] !== target.computerName) throw new Error('Node system capabilities do not match the approved server-side demands');
    };
    if (target.kind === 'app-service') await testEnvironmentSnapshot(target, call);
    await verifyNode(); await p.verifySource?.(); authorize();
    const liveDefinition = await call('GET', `${releaseBase}/definitions/${target.releaseDefinitionId}?${API}`);
    if (releaseDefinitionFingerprint(liveDefinition) !== target.definitionSha256) throw new Error('Release definition changed before creation');
    const entry: Deployment = { runId: p.runId, target, buildId: pos(buildId), ...(typeof build.buildNumber === 'string' ? { buildNumber: text(build.buildNumber, 'build number', 256) } : {}), commit: p.source.commit, state: 'creating', token: randomUUID() };
    const initiatingLease = state.stepLeases?.find(l => l.runId === p.runId && !l.releasedAt && deploymentLeaseKey(l.target) === deploymentLeaseKey(target));
    if (initiatingLease) entry.initiatingLease = { stepId: initiatingLease.stepId, at: initiatingLease.at };
    state.deployments.push(entry); this.save(state);
    let release: Record<string, unknown>;
    try { release = await call('POST', `${releaseBase}/releases?${API}`, { definitionId: target.releaseDefinitionId, isDraft: true, manualEnvironments: [target.environmentName], description: `Routine ${p.runId} operation ${entry.token}`, artifacts: [{ alias: target.artifactAlias, instanceReference: { id: String(buildId) } }] }); }
    catch (error) {
      // Only a definitively unperformed first POST can relinquish this intent; a lost/invalid response stays leased.
      if (error instanceof NoRemoteEffect) { state.deployments = state.deployments.filter(d => d.token !== entry.token); this.save(state); }
      throw error;
    }
    entry.releaseId = pos(release.id); entry.state = 'draft'; this.save(state);
    if (release.status !== 'draft' || release.releaseDefinitionRevision !== target.definitionRevision || object(release.releaseDefinition, 'release definition').id !== target.releaseDefinitionId || !Array.isArray(release.environments) || release.environments.length !== 1) throw new Error('Created draft does not match the approved definition snapshot; it remains inactive');
    const env = object(release.environments[0], 'release environment');
    if (env.definitionEnvironmentId !== target.environmentId || env.name !== target.environmentName) throw new Error('Draft environment identity differs');
    // Azure may return process parameters on the created draft. Validate its effective values, not just the
    // unchanged macro text. The host sends no variables or parameter overrides on creation/activation.
    const draftPhases = phases(env.deployPhasesSnapshot, [release.processParameters === undefined ? definition.processParameters : release.processParameters, env.processParameters === undefined ? environments[0]!.processParameters : env.processParameters]);
    if (target.kind === 'app-service') {
      if ([release.variables, env.variables].some(v => v != null && Object.keys(object(v, 'release variables')).length)) throw new Error('Draft release variable overrides are unsupported');
      if (deploymentHash(draftPhases) !== deploymentHash(approvedPhases)) throw new Error('Draft App Service parameter defaults differ from the approved definition');
    }
    if (deploymentHash(env.deployPhasesSnapshot) !== deploymentHash(environments[0]!.deployPhases)) throw new Error('Draft deployment phase differs from the approved snapshot');
    const actual = Array.isArray(release.artifacts) ? release.artifacts.map(v => object(v, 'release artifact')) : [];
    if (actual.length !== 1 || actual[0]!.alias !== target.artifactAlias || String(object(object(actual[0]!.definitionReference, 'artifact reference').version, 'artifact version').id) !== String(buildId)) throw new Error('Draft contains a different build');
    entry.environmentId = pos(env.id); this.save(state);
    await verifyNode(); await p.verifySource?.();
    if (target.kind === 'app-service') await testEnvironmentSnapshot(target, call, [entry.releaseId!]);
    await call('PATCH', `${releaseBase}/releases/${entry.releaseId}?${API}`, { status: 'active', comment: 'Approved routine test deployment' });
    await verifyNode(); await p.verifySource?.();
    if (target.kind === 'app-service') await testEnvironmentSnapshot(target, call, [entry.releaseId!]);
    await call('PATCH', `${releaseBase}/releases/${entry.releaseId}/environments/${entry.environmentId}?${API}`, { status: 'inProgress', comment: 'Approved routine exact test target' });
    entry.state = 'queued'; this.save(state);
    return { ...identity(entry), latest: true, status: 'queued', success: false, next: 'Poll test-deploy-status; queue acceptance is not successful deployment' };
  }
  private read(): State { if (!fs.existsSync(this.stateFile)) return { schema: 1, deployments: [] }; const v = object(JSON.parse(fs.readFileSync(this.stateFile, 'utf8')), 'deployment ledger'); if (v.schema !== 1 || !Array.isArray(v.deployments) || v.deployments.length > 2000) throw new Error('Invalid deployment ledger'); return v as unknown as State; }
  private save(state: State): void { if (state.deployments.length > 2000) throw new Error('Deployment ledger limit reached'); fs.mkdirSync(path.dirname(this.stateFile), { recursive: true }); const tmp = `${this.stateFile}.${randomUUID()}.tmp`; const fd = fs.openSync(tmp, 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } renameRetrying(tmp, this.stateFile); }
}
