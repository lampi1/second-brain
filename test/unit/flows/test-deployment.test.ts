// Release adapter tests use fixed REST fixtures. They prove fail-closed target/commit/grant checks and durable leases,
// not that a particular company's Azure release task is safe; no remote service is called.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { TestDeploymentCoordinator, releaseDefinitionFingerprint, validateDeployTarget } from '../../../src/main/flows/test-deployment';
import type { TestDeployTarget } from '../../../src/shared/flow-automation';
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })); });
const guid = '11111111-2222-3333-4444-555555555555', commit = 'a'.repeat(40);
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-deploy-')); dirs.push(dir);
  const phase = { phaseType: 'machineGroupBasedDeployment', deploymentInput: { queueId: 7, tags: [], demands: [{ name: 'Agent.Name', value: 'test-agent' }, { name: 'Agent.ComputerName', value: 'test-host' }] }, workflowTasks: [] };
  const definition = { id: 4, revision: 2, environments: [{ id: 9, name: 'Test', deployPhases: [phase], variableGroups: [] }], artifacts: [{ alias: 'app', type: 'Build', definitionReference: { project: { id: guid }, definition: { id: '6' } } }], variableGroups: [] };
  const target: TestDeployTarget = { id: 'test-a', organization: 'contoso', project: 'Example', projectId: guid, releaseDefinitionId: 4, definitionRevision: 2, definitionSha256: releaseDefinitionFingerprint(definition), environmentId: 9, environmentName: 'Test', deploymentGroupId: 8, queueId: 7, poolId: 10, agentId: 11, machineId: 12, machineName: 'test-agent', computerName: 'test-host', artifactAlias: 'app', buildDefinitionId: 6, repositoryId: guid, confirmedTest: true };
  const config = path.join(dir, 'targets.json'); fs.writeFileSync(config, JSON.stringify({ schema: 1, targets: [target] }));
  const coordinator = new TestDeploymentCoordinator(config, path.join(dir, 'state.json'));
  let status = 'inProgress', revoke = false, failCreate = false, snapshotRevision = 2, extraNode = false;
  const authorize = vi.fn(() => { if (revoke) throw new Error('grant revoked'); });
  const call = vi.fn(async (method: string, url: string, _body?: unknown): Promise<Record<string, unknown>> => {
    if (method === 'GET' && url.includes('/build/builds/')) return { id: 40, status: 'completed', result: 'succeeded', project: { id: guid }, definition: { id: 6 }, repository: { id: guid }, sourceVersion: commit, sourceBranch: 'refs/heads/fix' };
    if (method === 'GET' && url.includes('/release/definitions/')) return structuredClone(definition);
    if (url.includes('/queues/7?')) return { id: 7, pool: { id: 10 } };
    if (url.includes('/deploymentgroups/8?')) return { id: 8, pool: { id: 10 } };
    if (url.includes('/targets?')) return { value: [{ id: 12, agent: { id: 11, name: 'test-agent', enabled: true, status: 'online' } }, ...(extraNode ? [{ id: 13 }] : [])] };
    if (url.includes('/pools/10/agents/11?')) return { id: 11, systemCapabilities: { 'Agent.Name': 'test-agent', 'Agent.ComputerName': 'test-host' } };
    if (method === 'POST' && url.includes('/release/releases?')) {
      if (failCreate) throw new Error('lost response');
      return { id: 20, status: 'draft', definitionSnapshotRevision: snapshotRevision, releaseDefinition: { id: 4 }, environments: [{ id: 90, definitionEnvironmentId: 9, name: 'Test', deployPhasesSnapshot: [structuredClone(phase)] }], artifacts: [{ alias: 'app', definitionReference: { version: { id: '40' } } }] };
    }
    if (method === 'GET' && url.includes('/release/releases/20?')) return { id: 20, releaseDefinition: { id: 4 }, environments: [{ id: 90, definitionEnvironmentId: 9, status }] };
    if (method === 'PATCH') return {};
    throw new Error(`Unexpected mocked request ${method} ${url}`);
  });
  const ports = { runId: 'run-a', authorize, call, source: { repositoryId: guid, commit, branch: 'refs/heads/fix' } };
  return { coordinator, target, ports, call, definition, config, phase, set: (v: { status?: string; revoke?: boolean; failCreate?: boolean; snapshotRevision?: number; extraNode?: boolean }) => { status = v.status ?? status; revoke = v.revoke ?? revoke; failCreate = v.failCreate ?? failCreate; snapshotRevision = v.snapshotRevision ?? snapshotRevision; extraNode = v.extraNode ?? extraNode; } };
}
it('creates and validates a draft, uses release-instance environment id, and keeps the lease through AFTER tests', async () => {
  const s = setup(); expect(await s.coordinator.execute('deploy-test', s.target, 40, s.ports)).toMatchObject({ status: 'queued', success: false, environmentId: 90 });
  const creates = s.call.mock.calls.filter(c => c[0] === 'POST'); expect(creates).toHaveLength(1); expect(creates[0]![2]).toMatchObject({ isDraft: true, manualEnvironments: ['Test'] });
  expect(s.call.mock.calls.some(c => c[0] === 'PATCH' && c[1].includes('/environments/90?'))).toBe(true);
  expect(s.call.mock.calls.some(c => c[1].includes('/environments/9?'))).toBe(false);
  s.set({ status: 'succeeded' }); expect(await s.coordinator.execute('test-deploy-status', s.target, undefined, s.ports)).toMatchObject({ success: true });
  await expect(s.coordinator.execute('deploy-test', s.target, 40, { ...s.ports, runId: 'run-b' })).rejects.toThrow('leased');
  expect(await s.coordinator.settle('run-a', s.ports.authorize)).toBe(true);
  await expect(s.coordinator.execute('deploy-test', s.target, 40, { ...s.ports, runId: 'run-b' })).resolves.toMatchObject({ status: 'queued' });
});
it('rejects production/unconfigured targets, changed definitions, wrong builds and missing server-side demands before dispatch', async () => {
  const s = setup(); expect(() => validateDeployTarget({ ...s.target, confirmedTest: false })).toThrow('test-only');
  await expect(s.coordinator.execute('deploy-test', { ...s.target, id: 'other' }, 40, s.ports)).rejects.toThrow('locally configured');
  await expect(s.coordinator.execute('deploy-test', s.target, 41, s.ports)).rejects.toThrow('successful build');
  s.definition.revision = 3; await expect(s.coordinator.execute('deploy-test', s.target, 40, s.ports)).rejects.toThrow('changed');
  expect(s.call.mock.calls.some(c => c[0] === 'POST')).toBe(false);
  const noDemands = setup(); noDemands.phase.deploymentInput.demands = []; noDemands.target.definitionSha256 = releaseDefinitionFingerprint(noDemands.definition); fs.writeFileSync(noDemands.config, JSON.stringify({ schema: 1, targets: [noDemands.target] }));
  await expect(noDemands.coordinator.execute('deploy-test', noDemands.target, 40, noDemands.ports)).rejects.toThrow('routing');
  expect(noDemands.call.mock.calls.some(c => c[0] === 'POST')).toBe(false);
});
it('does not activate a different definition snapshot and does not repeat an ambiguous creation', async () => {
  const changed = setup(); changed.set({ snapshotRevision: 3 }); await expect(changed.coordinator.execute('deploy-test', changed.target, 40, changed.ports)).rejects.toThrow('snapshot'); expect(changed.call.mock.calls.some(c => c[0] === 'PATCH')).toBe(false);
  const lost = setup(); lost.set({ failCreate: true }); await expect(lost.coordinator.execute('deploy-test', lost.target, 40, lost.ports)).rejects.toThrow('lost response');
  await expect(lost.coordinator.execute('deploy-test', lost.target, 40, lost.ports)).rejects.toThrow('already requested'); expect(await lost.coordinator.settle('run-a', lost.ports.authorize)).toBe(false);
  expect(lost.call.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(1);
});
it('rechecks authority and node membership before release creation', async () => {
  const revoked = setup(); revoked.set({ revoke: true }); await expect(revoked.coordinator.execute('deploy-test', revoked.target, 40, revoked.ports)).rejects.toThrow('revoked'); expect(revoked.call).not.toHaveBeenCalled();
  const added = setup(); added.set({ extraNode: true }); await expect(added.coordinator.execute('deploy-test', added.target, 40, added.ports)).rejects.toThrow('only the exact'); expect(added.call.mock.calls.some(c => c[0] === 'POST')).toBe(false);
});
it('rechecks a terminal deployment-group release before allowing another build and retains a restarted release lease', async () => {
  const s = setup(); await s.coordinator.execute('deploy-test', s.target, 40, s.ports); s.set({ status: 'succeeded' }); await s.coordinator.execute('test-deploy-status', s.target, undefined, s.ports);
  s.set({ status: 'inProgress' });
  await expect(s.coordinator.execute('deploy-test', s.target, 41, s.ports)).rejects.toThrow(/active|uncertain/);
  await expect(s.coordinator.execute('test-deploy-status', s.target, undefined, s.ports)).resolves.toMatchObject({ status: 'inProgress', terminal: false, success: false });
  expect(await s.coordinator.settle('run-a', () => {})).toBe(false); expect(s.call.mock.calls.filter(([m]) => m === 'POST')).toHaveLength(1);
});
