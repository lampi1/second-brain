// Explicit test-only release adapter. Local user-managed targets pin one definition revision and one deployment-group
// machine. A draft is validated before activation; ambiguous writes retain the lease. No approval or production API.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { renameRetrying } from '../rules/storage';
import { identifier, integer, keys, object, text } from './schema';
import type { TestDeployTarget } from '../../shared/flow-automation';

const API = 'api-version=7.1';
const pos = (v: unknown): number => integer(v, 'target id', 1, 2_147_483_647);
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : v;
export const deploymentHash = (v: unknown): string => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function validateDeployTarget(value: unknown): TestDeployTarget {
  const t = object(value, 'test deployment target');
  keys(t, ['id', 'organization', 'project', 'projectId', 'releaseDefinitionId', 'definitionRevision', 'definitionSha256', 'environmentId', 'environmentName', 'deploymentGroupId', 'queueId', 'poolId', 'agentId', 'machineId', 'machineName', 'computerName', 'artifactAlias', 'buildDefinitionId', 'repositoryId', 'confirmedTest'], 'test deployment target');
  if (t.confirmedTest !== true) throw new Error('Deployment target must be explicitly confirmed test-only by the user');
  const guid = (v: unknown): string => { const s = text(v, 'GUID', 36).toLowerCase(); if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)) throw new Error('Invalid deployment GUID'); return s; };
  const organization = text(t.organization, 'organization', 50), project = text(t.project, 'project', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(organization) || /[\\/\x00-\x1f]/.test(project)) throw new Error('Invalid deployment organization/project');
  const sha = text(t.definitionSha256, 'definitionSha256', 64); if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Invalid deployment definition fingerprint');
  return { id: identifier(t.id, 'target id'), organization, project, projectId: guid(t.projectId), releaseDefinitionId: pos(t.releaseDefinitionId), definitionRevision: pos(t.definitionRevision), definitionSha256: sha,
    environmentId: pos(t.environmentId), environmentName: text(t.environmentName, 'environment name', 200), deploymentGroupId: pos(t.deploymentGroupId), queueId: pos(t.queueId), poolId: pos(t.poolId), agentId: pos(t.agentId), computerName: text(t.computerName, 'computer name', 200), machineId: pos(t.machineId), machineName: text(t.machineName, 'machine name', 200),
    artifactAlias: text(t.artifactAlias, 'artifact alias', 200), buildDefinitionId: pos(t.buildDefinitionId), repositoryId: guid(t.repositoryId), confirmedTest: true };
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
    const e = object(value, 'environment'); return { id: e.id, name: e.name, deployPhases: e.deployPhases, variables: e.variables, variableGroups: e.variableGroups, preDeployApprovals: e.preDeployApprovals, postDeployApprovals: e.postDeployApprovals, preDeploymentGates: e.preDeploymentGates, postDeploymentGates: e.postDeploymentGates };
  }), artifacts: d.artifacts, variables: d.variables, variableGroups: d.variableGroups });
}
interface Deployment { runId: string; target: TestDeployTarget; buildId: number; commit: string; state: 'creating' | 'draft' | 'queued' | 'succeeded' | 'failed' | 'canceled'; releaseId?: number; environmentId?: number; token: string; released?: boolean }
interface State { schema: 1; deployments: Deployment[] }
export interface DeploymentPorts {
  runId: string; authorize(): void;
  call(method: string, url: string, body?: unknown): Promise<Record<string, unknown>>;
  /** The host verified this commit against the run-owned PR's live source commit. */
  source?: { repositoryId: string; commit: string; branch: string };
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
  history(runId: string): unknown[] { return structuredClone(this.read().deployments.filter(d => d.runId === runId)); }
  ownedTargets(runId: string): string[] { return this.read().deployments.filter(d => d.runId === runId && !d.released).map(d => d.target.id); }
  targets(): TestDeployTarget[] { return readDeployTargets(this.targetsFile); }
  execute(op: 'deploy-test' | 'test-deploy-status' | 'cancel-test-deploy', target: TestDeployTarget, buildId: number | undefined, ports: DeploymentPorts): Promise<Record<string, unknown>> {
    const job = this.queue.then(() => this.perform(op, target, buildId, ports)); this.queue = job.catch(() => undefined); return job;
  }
  private async perform(op: string, target: TestDeployTarget, buildId: number | undefined, p: DeploymentPorts): Promise<Record<string, unknown>> {
    const authorize = () => { p.authorize(); const local = this.targets().find(t => t.id === target.id); if (!local || deploymentHash(local) !== deploymentHash(target)) throw new Error('Test target changed or is not locally configured: propose and approve its exact configuration again'); };
    authorize();
    const call = (method: string, url: string, body?: unknown) => { authorize(); return p.call(method, url, body); };
    const base = `https://dev.azure.com/${encodeURIComponent(target.organization)}/${target.projectId}`;
    const releaseBase = `https://vsrm.dev.azure.com/${encodeURIComponent(target.organization)}/${target.projectId}/_apis/release`;
    const state = this.read(), own = state.deployments.find(d => d.runId === p.runId && d.target.id === target.id);
    if (op === 'test-deploy-status' || op === 'cancel-test-deploy') {
      if (!own) throw new Error('This run has no deployment on this target');
      if (!own.releaseId || !own.environmentId) throw new Error('Release creation has an unknown outcome; the test lease remains held. Reconcile in Azure DevOps before any new release.');
      const release = await call('GET', `${releaseBase}/releases/${own.releaseId}?${API}`);
      const env = Array.isArray(release.environments) ? release.environments.map(v => object(v, 'release environment')).find(e => e.id === own.environmentId && e.definitionEnvironmentId === target.environmentId) : undefined;
      if (!env || object(release.releaseDefinition, 'release definition').id !== target.releaseDefinitionId) throw new Error('Deployment identity changed');
      const status = release.status === 'abandoned' ? 'canceled' : String(env.status);
      if (op === 'cancel-test-deploy' && !['succeeded', 'failed', 'canceled', 'rejected', 'partiallySucceeded'].includes(status)) {
        if (release.status === 'draft') await call('PATCH', `${releaseBase}/releases/${own.releaseId}?${API}`, { status: 'abandoned', comment: 'Routine cleanup of its own draft test release' });
        else await call('PATCH', `${releaseBase}/releases/${own.releaseId}/environments/${own.environmentId}?${API}`, { status: 'canceled', comment: 'Routine cleanup of its own test deployment' });
        return { targetId: target.id, releaseId: own.releaseId, status: 'cancellation-requested', terminal: false, success: false };
      }
      if (['succeeded', 'failed', 'canceled', 'rejected', 'partiallySucceeded'].includes(status)) { own.state = status === 'succeeded' ? 'succeeded' : status === 'canceled' ? 'canceled' : 'failed'; this.save(state); }
      return { targetId: target.id, releaseId: own.releaseId, environmentId: own.environmentId, status, terminal: ['succeeded', 'failed', 'canceled'].includes(own.state), success: own.state === 'succeeded' };
    }
    if (own) throw new Error('This run already requested a deployment. Read test-deploy-status; never create it again.');
    const leaseKey = (t: TestDeployTarget) => `${t.organization.toLowerCase()}/${t.poolId}/${t.agentId}`;
    if (state.deployments.some(d => leaseKey(d.target) === leaseKey(target) && !d.released)) throw new Error('The exact test node is leased by another deployment or an unresolved request');
    if (!p.source || p.source.repositoryId !== target.repositoryId || !/^[a-f0-9]{40,64}$/i.test(p.source.commit)) throw new Error('Test deployment requires a verified source commit from this run’s own PR');
    const build = await call('GET', `${base}/_apis/build/builds/${pos(buildId)}?${API}`);
    if (build.id !== buildId || build.status !== 'completed' || build.result !== 'succeeded' || object(build.project, 'build project').id !== target.projectId || object(build.definition, 'build definition').id !== target.buildDefinitionId || String(object(build.repository, 'build repository').id).toLowerCase() !== target.repositoryId || build.sourceVersion !== p.source.commit || build.sourceBranch !== p.source.branch) throw new Error('Build is not the successful build of the run-owned PR source commit');
    const definition = await call('GET', `${releaseBase}/definitions/${target.releaseDefinitionId}?${API}`);
    if (definition.id !== target.releaseDefinitionId || definition.revision !== target.definitionRevision || releaseDefinitionFingerprint(definition) !== target.definitionSha256) throw new Error('Release definition changed since the test target was approved');
    const environments = Array.isArray(definition.environments) ? definition.environments.map(v => object(v, 'environment')) : [];
    if (environments.length !== 1 || environments[0]!.id !== target.environmentId || environments[0]!.name !== target.environmentName) throw new Error('Only a dedicated single-environment test release is supported');
    if ((Array.isArray(definition.variableGroups) && definition.variableGroups.length) || (Array.isArray(environments[0]!.variableGroups) && environments[0]!.variableGroups.length)) throw new Error('Mutable variable groups are unsupported for deterministic test releases');
    const artifacts = Array.isArray(definition.artifacts) ? definition.artifacts.map(v => object(v, 'artifact')) : [];
    if (artifacts.length !== 1 || artifacts[0]!.alias !== target.artifactAlias || artifacts[0]!.type !== 'Build') throw new Error('Test release must contain exactly the approved build artifact');
    const reference = object(artifacts[0]!.definitionReference, 'artifact reference');
    if (String(object(reference.definition, 'artifact definition').id) !== String(target.buildDefinitionId) || object(reference.project, 'artifact project').id !== target.projectId) throw new Error('Release artifact source differs from the approved build definition');
    const phases = (v: unknown) => { if (!Array.isArray(v) || v.length !== 1) throw new Error('Only one machine-group phase is supported'); const phase = object(v[0], 'phase'), input = object(phase.deploymentInput, 'deployment input');
      if (phase.phaseType !== 'machineGroupBasedDeployment' || input.queueId !== target.queueId || !Array.isArray(input.tags) || input.tags.length || (!Array.isArray(input.demands) || input.demands.length !== 2)) throw new Error('Unsupported or changed test-node routing');
      const demands = (input.demands as unknown[]).map(v => object(v, 'machine demand'));
      if (!demands.some(d => d.name === 'Agent.Name' && d.value === target.machineName) || !demands.some(d => d.name === 'Agent.ComputerName' && d.value === target.computerName) || demands.some(d => Object.keys(d).some(k => !['name', 'value'].includes(k)))) throw new Error('The server must enforce both the approved agent name and computer name');
      return phase; };
    phases(environments[0]!.deployPhases);
    const verifyNode = async () => {
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
    await verifyNode(); authorize();
    const entry: Deployment = { runId: p.runId, target, buildId: pos(buildId), commit: p.source.commit, state: 'creating', token: randomUUID() };
    state.deployments.push(entry); this.save(state);
    const release = await call('POST', `${releaseBase}/releases?${API}`, { definitionId: target.releaseDefinitionId, isDraft: true, manualEnvironments: [target.environmentName], description: `Routine ${p.runId} operation ${entry.token}`, artifacts: [{ alias: target.artifactAlias, instanceReference: { id: String(buildId) } }] });
    entry.releaseId = pos(release.id); entry.state = 'draft'; this.save(state);
    if (release.status !== 'draft' || release.definitionSnapshotRevision !== target.definitionRevision || object(release.releaseDefinition, 'release definition').id !== target.releaseDefinitionId || !Array.isArray(release.environments) || release.environments.length !== 1) throw new Error('Created draft does not match the approved definition snapshot; it remains inactive');
    const env = object(release.environments[0], 'release environment');
    if (env.definitionEnvironmentId !== target.environmentId || env.name !== target.environmentName) throw new Error('Draft environment identity differs');
    phases(env.deployPhasesSnapshot);
    if (deploymentHash(env.deployPhasesSnapshot) !== deploymentHash(environments[0]!.deployPhases)) throw new Error('Draft deployment phase differs from the approved snapshot');
    const actual = Array.isArray(release.artifacts) ? release.artifacts.map(v => object(v, 'release artifact')) : [];
    if (actual.length !== 1 || actual[0]!.alias !== target.artifactAlias || String(object(object(actual[0]!.definitionReference, 'artifact reference').version, 'artifact version').id) !== String(buildId)) throw new Error('Draft contains a different build');
    entry.environmentId = pos(env.id); this.save(state);
    await verifyNode();
    await call('PATCH', `${releaseBase}/releases/${entry.releaseId}?${API}`, { status: 'active', comment: 'Approved routine test deployment' });
    await verifyNode();
    await call('PATCH', `${releaseBase}/releases/${entry.releaseId}/environments/${entry.environmentId}?${API}`, { status: 'inProgress', comment: 'Approved routine exact test target' });
    entry.state = 'queued'; this.save(state);
    return { targetId: target.id, releaseId: entry.releaseId, environmentId: entry.environmentId, status: 'queued', success: false, next: 'Poll test-deploy-status; queue acceptance is not successful deployment' };
  }
  private read(): State { if (!fs.existsSync(this.stateFile)) return { schema: 1, deployments: [] }; const v = object(JSON.parse(fs.readFileSync(this.stateFile, 'utf8')), 'deployment ledger'); if (v.schema !== 1 || !Array.isArray(v.deployments) || v.deployments.length > 2000) throw new Error('Invalid deployment ledger'); return v as unknown as State; }
  private save(state: State): void { if (state.deployments.length > 2000) throw new Error('Deployment ledger limit reached'); fs.mkdirSync(path.dirname(this.stateFile), { recursive: true }); const tmp = `${this.stateFile}.${randomUUID()}.tmp`; const fd = fs.openSync(tmp, 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } renameRetrying(tmp, this.stateFile); }
}
