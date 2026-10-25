// Synthetic hosted App Service release contracts: exact resource/build identity, tamper checks and durable local leases.
// No Azure account, production configuration, external write or model is used by these tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppServiceTestDeployTarget } from '../../../src/shared/flow-automation';
import { APP_SERVICE_TASK_IDS, appServiceResourceId, validateAppServiceDefinition, verifyAppService } from '../../../src/main/flows/app-service-target';
import { DevOpsWriter } from '../../../src/main/flows/devops-writer';
import { TestDeploymentCoordinator, releaseDefinitionFingerprint, validateDeployTarget } from '../../../src/main/flows/test-deployment';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const guid = '11111111-2222-3333-4444-555555555555', commit = 'a'.repeat(40);
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-target-')); dirs.push(dir);
  const phase = { phaseType: 'agentBasedDeployment', deploymentInput: { queueId: 7, demands: [] }, workflowTasks: [{ taskId: APP_SERVICE_TASK_IDS[0]!, definitionType: 'task' as string | null | undefined, version: '4.*', enabled: true, inputs: { ConnectionType: 'AzureRM', ConnectedServiceName: guid, WebAppName: 'sample-test', WebAppKind: 'webApp', Package: '$(System.DefaultWorkingDirectory)/_app/**/*.zip' } }] };
  const definition = { id: 4, revision: 2, environments: [{ id: 9, name: 'Test', deployPhases: [phase], variables: {}, variableGroups: [], preDeployApprovals: { approvals: [{ isAutomated: true }] } }], artifacts: [{ alias: '_app', type: 'Build', definitionReference: { project: { id: guid }, definition: { id: '6' } } }], variables: {}, variableGroups: [] };
  const target: AppServiceTestDeployTarget = { kind: 'app-service', id: 'test-app', organization: 'contoso', project: 'Example', projectId: guid, releaseDefinitionId: 4, definitionRevision: 2, definitionSha256: releaseDefinitionFingerprint(definition), environmentId: 9, environmentName: 'Test', queueId: 7, artifactAlias: '_app', buildDefinitionId: 6, repositoryId: guid, subscriptionId: guid, serviceConnectionId: guid, resourceGroup: 'Sample_Test', webAppName: 'sample-test', allowedTaskIds: [...APP_SERVICE_TASK_IDS], confirmedTest: true };
  const file = path.join(dir, 'targets.json'); fs.writeFileSync(file, JSON.stringify({ schema: 1, targets: [target] }));
  const state = path.join(dir, 'state.json'), coordinator = new TestDeploymentCoordinator(file, state);
  const build = { id: 40, reason: 'pullRequest', status: 'completed', result: 'succeeded', project: { id: guid }, definition: { id: 6 }, repository: { id: guid }, sourceVersion: commit, sourceBranch: 'refs/pull/23/merge' };
  const call = vi.fn(async (method: string, url: string, _body?: unknown): Promise<Record<string, unknown>> => {
    if (url.includes('/release/deployments?')) return { value: [] };
    if (url.includes('/build/builds?')) return { value: [build] };
    if (url.includes('/build/builds/')) return build;
    if (url.includes('/release/definitions/')) return structuredClone(definition);
    if (url.includes('/serviceendpoint/')) return { id: guid, type: 'azurerm', data: { subscriptionId: guid, environment: 'AzureCloud' } };
    if (url.includes('/queues/')) return { id: 7, pool: { isHosted: true } };
    if (method === 'POST') return { id: 20, status: 'draft', processParameters: structuredClone((definition as Record<string, unknown>).processParameters), definitionSnapshotRevision: 2, releaseDefinition: { id: 4 }, environments: [{ id: 90, definitionEnvironmentId: 9, name: 'Test', processParameters: structuredClone((definition.environments[0]! as Record<string, unknown>).processParameters), deployPhasesSnapshot: [structuredClone(phase)] }], artifacts: [{ alias: '_app', definitionReference: { version: { id: '40' } } }] };
    if (method === 'PATCH') return {};
    throw new Error(`Unexpected fixture request ${url}`);
  });
  const arm = vi.fn(async () => ({ id: appServiceResourceId(target), name: target.webAppName, type: 'Microsoft.Web/sites' }));
  const ports = { runId: 'run-a', authorize: vi.fn(), call, arm, verifySource: vi.fn(async () => {}), source: { repositoryId: guid, commit, branch: 'refs/pull/23/merge', pullRequestId: 23 } };
  return { coordinator, target, definition, phase, build, call, ports, state, file };
}
it('registers an exact App Service shape and deploys the latest successful own PR merge build without VM APIs', async () => {
  const f = fixture(); expect(validateDeployTarget(f.target)).toEqual(f.target);
  await expect(f.coordinator.execute('deploy-test', f.target, undefined, f.ports)).resolves.toMatchObject({ status: 'queued', environmentId: 90 });
  expect(f.call.mock.calls.some(([, url]) => /deploymentgroup|\/agents\//.test(url))).toBe(false);
  expect(f.ports.verifySource).toHaveBeenCalledTimes(3);
  expect(f.ports.arm).toHaveBeenCalledWith(appServiceResourceId(f.target));
});
it.each(['reason', 'sourceBranch', 'sourceVersion', 'repository'])('rejects a build with the wrong %s before creating a release', async field => {
  const f = fixture(); Object.assign(f.build, { [field]: field === 'repository' ? { id: 'other' } : 'wrong' });
  await expect(f.coordinator.execute('deploy-test', f.target, 40, f.ports)).rejects.toThrow(/merge build|successful build/);
  expect(f.call.mock.calls.some(([method]) => method === 'POST')).toBe(false);
});
it('refuses mutable variables, queues, arbitrary tasks, slots, scripts, connection/app substitutions and fingerprint drift', () => {
  const f = fixture(); const variants = [
    (d: typeof f.definition) => { d.environments[0]!.variables = { key: 'value' }; },
    (d: typeof f.definition) => { d.environments[0]!.deployPhases[0]!.deploymentInput.queueId = 8; },
    (d: typeof f.definition) => { d.environments[0]!.deployPhases[0]!.workflowTasks[0]!.taskId = guid; },
    (d: typeof f.definition) => { Object.assign(d.environments[0]!.deployPhases[0]!.workflowTasks[0]!.inputs, { DeployToSlotOrASEFlag: 'true' }); },
    (d: typeof f.definition) => { Object.assign(d.environments[0]!.deployPhases[0]!.workflowTasks[0]!.inputs, { ScriptType: 'Inline Script' }); },
    (d: typeof f.definition) => { d.environments[0]!.deployPhases[0]!.workflowTasks[0]!.inputs.WebAppName = '$(target)'; },
  ];
  for (const alter of variants) { const changed = structuredClone(f.definition); alter(changed); expect(() => validateAppServiceDefinition(changed, f.target)).toThrow(); expect(releaseDefinitionFingerprint(changed)).not.toBe(f.target.definitionSha256); }
  expect(() => validateDeployTarget({ ...f.target, machineId: 1 })).toThrow('no deployment-group');
  expect(() => validateDeployTarget({ ...f.target, confirmedTest: false })).toThrow('test-only');
});
it('checks live ARM identity rather than trusting a web app name or service connection alone', async () => {
  const f = fixture(); await expect(verifyAppService(f.target, f.call, async () => ({ id: '/wrong', name: 'sample-test', type: 'Microsoft.Web/sites' }))).rejects.toThrow('exact approved');
});
it.each(['completed', 'failed', 'downgraded', 'cancelled', 'crash'])('releases step ownership on %s, including an alias for the same web app', async exit => {
  const f = fixture(); const other = { ...f.target, id: 'alias' }; fs.writeFileSync(f.file, JSON.stringify({ schema: 1, targets: [f.target, other] }));
  await f.coordinator.acquireStep('run-a', 'before', f.target, () => {});
  await expect(f.coordinator.acquireStep('run-b', 'before', other, () => {})).rejects.toThrow('leased');
  if (exit === 'crash') await new TestDeploymentCoordinator(f.file, f.state).recoverStepLeases(); else await f.coordinator.reconcileSteps('run-a');
  await expect(f.coordinator.acquireStep('run-b', 'before', other, () => {})).resolves.toBeUndefined();
});
it('crash recovery releases step ownership but retains a remotely uncertain deployment', async () => {
  const f = fixture(); f.call.mockImplementationOnce(async () => f.build);
  await f.coordinator.acquireStep('run-a', 'deploy', f.target, () => {});
  await f.coordinator.execute('deploy-test', f.target, 40, f.ports);
  await f.coordinator.recoverStepLeases();
  await expect(f.coordinator.acquireStep('run-b', 'before', f.target, () => {})).rejects.toThrow('uncertain');
  expect(await f.coordinator.settle('run-a', () => {})).toBe(false);
});
it('rebaselines only the original deploy lease once and rejects same-release redeployment during AFTER', async () => {
  const f = fixture(); await f.coordinator.acquireStep('run-a', 'deploy', f.target, () => {}, 'empty');
  await f.coordinator.execute('deploy-test', f.target, 40, f.ports);
  let attempt = 1, deploymentId = 101;
  const row = () => ({ id: deploymentId, release: { id: 20 }, releaseDefinition: { id: 4 }, definitionEnvironmentId: 9, deploymentStatus: 'succeeded', operationStatus: 'phaseSucceeded', lastModifiedOn: 'same-release', attempt });
  f.call.mockImplementation(async (_method, url) => url.includes('/release/deployments?') ? { value: url.includes('queryOrder=') ? [row()] : [] } : { id: 20, status: 'active', releaseDefinition: { id: 4 }, environments: [{ id: 90, definitionEnvironmentId: 9, status: 'succeeded' }] });
  await expect(f.coordinator.execute('test-deploy-status', f.target, undefined, f.ports)).resolves.toMatchObject({ success: true });
  const baseline = JSON.stringify([101, 20, 'succeeded', 'phaseSucceeded', 'same-release', 1]);
  f.coordinator.verifyStepSnapshot('run-a', 'deploy', baseline);
  await f.coordinator.reconcileSteps('run-a'); await f.coordinator.acquireStep('run-a', 'after', f.target, () => {}, baseline);
  attempt = 2; deploymentId = 102;
  await expect(f.coordinator.execute('test-deploy-status', f.target, undefined, f.ports)).resolves.toMatchObject({ terminal: true, success: false, evidenceConflict: expect.stringContaining('deployment attempt') });
  expect(() => f.coordinator.verifyStepSnapshot('run-a', 'after', JSON.stringify([102, 20, 'succeeded', 'phaseSucceeded', 'same-release', 2]))).toThrow('changed');
  f.coordinator.verifyStepSnapshot('run-a', 'after', baseline);
  expect(await f.coordinator.settle('run-a', () => {})).toBe(true);
});
it('rejects a human redeployment that completed before the first host success poll', async () => {
  const f = fixture(); await f.coordinator.acquireStep('run-a', 'deploy', f.target, () => {}, 'empty');
  await f.coordinator.execute('deploy-test', f.target, 40, f.ports);
  f.call.mockImplementation(async (_method, url) => url.includes('/release/deployments?') ? { value: url.includes('queryOrder=') ? [{ id: 102, attempt: 2, release: { id: 20 }, releaseDefinition: { id: 4 }, definitionEnvironmentId: 9, deploymentStatus: 'succeeded', operationStatus: 'phaseSucceeded' }] : [] } : { releaseDefinition: { id: 4 }, environments: [{ id: 90, definitionEnvironmentId: 9, status: 'succeeded' }] });
  await expect(f.coordinator.execute('test-deploy-status', f.target, undefined, f.ports)).resolves.toMatchObject({ terminal: true, success: false, evidenceConflict: expect.stringContaining('deployment attempt') });
  f.coordinator.verifyStepSnapshot('run-a', 'deploy', 'empty');
});
it('the authoring inspector computes the live fingerprint without installing targets or mutating Azure', async () => {
  const f = fixture(), installed = fs.readFileSync(f.file, 'utf8');
  const request = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(url.startsWith('https://management.azure.com/') ? await f.ports.arm() : await f.call(init.method!, url)), { status: 200 }));
  const writer = new DevOpsWriter({ file: path.join(path.dirname(f.file), 'writer.json'), token: async () => 'fixture', armToken: async () => 'fixture-arm', request });
  const { definitionRevision: _revision, definitionSha256: _sha, ...candidate } = f.target;
  await expect(writer.inspectTarget(candidate)).resolves.toEqual({ schema: 1, targets: [f.target] });
  expect(request.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true); expect(fs.readFileSync(f.file, 'utf8')).toBe(installed);
});

// Mirrors classic release process-parameter structure, with deliberately synthetic target/default values.
function parameterFixture(scope: 'definition' | 'environment' = 'definition') {
  const f = fixture(), task = f.phase.workflowTasks[0]!;
  task.definitionType = null;
  const parameters: { inputs: Record<string, unknown>[] } = { inputs: [
    { name: 'ConnectedServiceName', defaultValue: guid, type: 'connectedService:AzureRM' },
    { name: 'WebAppName', defaultValue: f.target.webAppName, type: 'string' },
    { name: 'WebAppKind', defaultValue: 'webApp', type: 'pickList' },
    { name: 'StartupCommand', defaultValue: '', type: 'string' },
  ] };
  for (const input of parameters.inputs) Object.assign(task.inputs, { [String(input.name)]: `$(Parameters.${input.name})` });
  Object.assign(task.inputs, { DockerNamespace: '$(Parameters.DockerNamespace)', DockerRepository: '$(Parameters.DockerRepository)' });
  Object.assign(scope === 'definition' ? f.definition : f.definition.environments[0]!, { processParameters: parameters });
  f.target.definitionSha256 = releaseDefinitionFingerprint(f.definition);
  fs.writeFileSync(f.file, JSON.stringify({ schema: 1, targets: [f.target] }));
  return { ...f, parameters };
}
it.each(['definition', 'environment'] as const)('inspects and deploys null-type tasks using pinned %s defaults, without any request overrides', async scope => {
  const f = parameterFixture(scope), original = JSON.stringify(f.definition);
  const request = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(url.startsWith('https://management.azure.com/') ? await f.ports.arm() : await f.call(init.method!, url)), { status: 200 }));
  const writer = new DevOpsWriter({ file: path.join(path.dirname(f.file), 'writer.json'), token: async () => 'fixture', armToken: async () => 'fixture-arm', request });
  const { definitionSha256: _sha, ...candidate } = f.target;
  await expect(writer.inspectTarget(candidate)).resolves.toEqual({ schema: 1, targets: [f.target] });
  await expect(f.coordinator.execute('deploy-test', f.target, 40, f.ports)).resolves.toMatchObject({ status: 'queued' });
  const mutations = f.call.mock.calls.filter(([method]) => method !== 'GET');
  expect(mutations[0]![2]).toEqual({ definitionId: 4, isDraft: true, manualEnvironments: ['Test'], description: expect.stringMatching(/^Routine run-a operation /), artifacts: [{ alias: '_app', instanceReference: { id: '40' } }] });
  expect(mutations.slice(1).map(([, , body]) => Object.keys(body as object).sort())).toEqual([['comment', 'status'], ['comment', 'status']]);
  expect(JSON.stringify(f.definition)).toBe(original);
});
it.each(['definition', 'environment'] as const)('resolves user-selected parameter aliases in %s without field-name or routine-specific rules', async scope => {
  const f = parameterFixture(scope), task = f.phase.workflowTasks[0]!;
  for (const [index, input] of f.parameters.inputs.entries()) {
    const field = String(input.name), name = `CustomDeploy_${index}`;
    input.name = name;
    Object.assign(task.inputs, { [field]: `$(Parameters.${name})` });
  }
  f.target.definitionSha256 = releaseDefinitionFingerprint(f.definition);
  fs.writeFileSync(f.file, JSON.stringify({ schema: 1, targets: [f.target] }));
  await expect(f.coordinator.execute('deploy-test', f.target, 40, f.ports)).resolves.toMatchObject({ status: 'queued' });
});
it.each([
  ['WebAppName', 'another-app'], ['ConnectedServiceName', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
  ['WebAppKind', 'webAppContainer'], ['StartupCommand', 'run-custom-command'],
])('rejects an unsafe %s default', (name, defaultValue) => {
  const f = parameterFixture(); f.parameters.inputs.find(input => input.name === name)!.defaultValue = defaultValue;
  expect(() => validateAppServiceDefinition(f.definition, f.target)).toThrow();
});
it.each(['missing', 'undefined', 'null', 'nested', 'partial-default', 'duplicate', 'secret'])('rejects a %s process-parameter default', variation => {
  const f = parameterFixture(), input = f.parameters.inputs.find(input => input.name === 'WebAppName')!;
  if (variation === 'missing') f.parameters.inputs = f.parameters.inputs.filter(i => i !== input);
  if (variation === 'undefined') delete input.defaultValue;
  if (variation === 'null') input.defaultValue = null;
  if (variation === 'nested') input.defaultValue = '$(Parameters.Other)';
  if (variation === 'partial-default') input.defaultValue = 'prefix-$(Other)';
  if (variation === 'duplicate') f.parameters.inputs.push({ ...input, name: 'webappname' });
  if (variation === 'secret') input.isSecret = true;
  expect(() => validateAppServiceDefinition(f.definition, f.target)).toThrow(/default|Nested/);
});
it.each(['ConnectedServiceName', 'WebAppName', 'WebAppKind', 'StartupCommand'])('rejects foreign, partial and nested references in checked input %s', field => {
  for (const value of ['$(Other)', 'prefix-$(Parameters.WebAppName)', '$(Parameters.WebAppName)-suffix', '$(Parameters.$(Other))', '${{ parameters.WebAppName }}', '$[variables.WebAppName]']) {
    const f = parameterFixture(); Object.assign(f.phase.workflowTasks[0]!.inputs, { [field]: value });
    expect(() => validateAppServiceDefinition(f.definition, f.target)).toThrow('Unsupported macro');
  }
});
it.each(['metaTask', 'other', undefined])('still rejects task definitionType %s', definitionType => {
  const f = parameterFixture(); f.phase.workflowTasks[0]!.definitionType = definitionType;
  expect(() => validateAppServiceDefinition(f.definition, f.target)).toThrow('Unapproved');
});
it.each(['definition', 'environment'] as const)('changed %s defaults invalidate a registered fingerprint before release creation', async scope => {
  const f = parameterFixture(scope); f.parameters.inputs.find(i => i.name === 'WebAppKind')!.defaultValue = 'webAppLinux';
  // This remains an otherwise allowed kind: the fingerprint, not the field allowlist, must reject the change.
  expect(() => validateAppServiceDefinition(f.definition, f.target)).not.toThrow();
  expect(releaseDefinitionFingerprint(f.definition)).not.toBe(f.target.definitionSha256);
  await expect(f.coordinator.execute('deploy-test', f.target, 40, f.ports)).rejects.toThrow('definition changed');
  expect(f.call.mock.calls.some(([method]) => method !== 'GET')).toBe(false);
});

it.each(['WebAppName', 'ConnectedServiceName', 'WebAppKind', 'StartupCommand'])('refuses changed draft %s defaults before either activation PATCH', async name => {
  const f = parameterFixture('environment'), original = f.call.getMockImplementation()!;
  f.call.mockImplementation(async (method, url, body) => {
    const response = await original(method, url, body);
    if (method === 'POST') {
      const environments = response.environments as { processParameters: typeof f.parameters }[];
      environments[0]!.processParameters.inputs.find(i => i.name === name)!.defaultValue = name === 'WebAppKind' ? 'webAppLinux' : 'different';
    }
    return response;
  });
  await expect(f.coordinator.execute('deploy-test', f.target, 40, f.ports)).rejects.toThrow(/approved|unsupported|defaults differ/);
  expect(f.call.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
});
it('refuses variables in the returned draft even though the host requested no overrides', async () => {
  const f = parameterFixture(), original = f.call.getMockImplementation()!;
  f.call.mockImplementation(async (method, url, body) => { const response = await original(method, url, body); return method === 'POST' ? { ...response, variables: { 'Parameters.WebAppName': { value: 'different' } } } : response; });
  await expect(f.coordinator.execute('deploy-test', f.target, 40, f.ports)).rejects.toThrow('variable overrides');
  expect(f.call.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
});
