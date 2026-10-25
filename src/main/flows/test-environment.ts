// Read-only Azure deployment observations for shared test environments. Local leases coordinate this app; these
// checks detect queued/active QA releases and drift during evidence collection without claiming a cross-user lock.
import type { TestDeployTarget } from '../../shared/flow-automation';
import { object } from './schema';
export async function testEnvironmentSnapshot(target: TestDeployTarget, call: (method: string, url: string) => Promise<Record<string, unknown>>, ownReleaseIds: number[] = []): Promise<string> {
  const base = `https://vsrm.dev.azure.com/${encodeURIComponent(target.organization)}/${target.projectId}/_apis/release/deployments?definitionId=${target.releaseDefinitionId}&definitionEnvironmentId=${target.environmentId}`;
  const terminal = ['succeeded', 'partiallySucceeded', 'failed'], ended = ['rejected', 'canceled', 'phaseCanceled', 'phaseFailed', 'phaseSucceeded', 'phasePartiallySucceeded', 'gateFailed'];
  for (const status of ['inProgress', 'notDeployed']) {
    const result = await call('GET', `${base}&deploymentStatus=${status}&$top=100&api-version=7.1`);
    if (!Array.isArray(result.value) || result.value.length >= 100) throw new Error('Test environment activity is incomplete; inspect shared environment');
    for (const value of result.value) {
      const row = object(value, 'deployment activity');
      if (object(row.releaseDefinition, 'release definition').id !== target.releaseDefinitionId || row.definitionEnvironmentId !== target.environmentId) throw new Error('Unexpected test environment activity identity');
      if (!terminal.includes(String(row.deploymentStatus)) && !ended.includes(String(row.operationStatus)) && !ownReleaseIds.includes(Number(object(row.release, 'release').id))) throw new Error('Another deployment is queued or active on this shared test environment');
    }
  }
  const latest = await call('GET', `${base}&queryOrder=descending&$top=1&api-version=7.1`);
  if (!Array.isArray(latest.value) || latest.value.length > 1) throw new Error('Invalid latest test deployment response');
  if (!latest.value.length) return 'empty';
  const row = object(latest.value[0], 'latest deployment');
  if (object(row.releaseDefinition, 'release definition').id !== target.releaseDefinitionId || row.definitionEnvironmentId !== target.environmentId || !Number.isSafeInteger(row.id)) throw new Error('Unexpected latest deployment identity');
  return JSON.stringify([row.id, object(row.release, 'release').id, row.deploymentStatus, row.operationStatus, row.lastModifiedOn, row.attempt]);
}
