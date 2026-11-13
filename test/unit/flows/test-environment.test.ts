// Shared QA activity is observed separately from local routine leases; mocked Azure reads cannot claim an external lock.
import { expect, it, vi } from 'vitest';
import { testEnvironmentSnapshot } from '../../../packages/routine-runtime/src/devops-host/test-environment';
import type { TestDeployTarget } from '../../../src/shared/flow-automation';
const target = { organization: 'contoso', projectId: 'project', releaseDefinitionId: 4, environmentId: 9 } as TestDeployTarget;
const deployment = { id: 8, release: { id: 3 }, releaseDefinition: { id: 4 }, definitionEnvironmentId: 9, deploymentStatus: 'inProgress', operationStatus: 'phaseInProgress' };
it('blocks on another queued or active release and permits only the exact own release exception', async () => {
  const call = vi.fn(async () => ({ value: [deployment] }));
  await expect(testEnvironmentSnapshot(target, call)).rejects.toThrow('Another deployment');
  await expect(testEnvironmentSnapshot(target, call, [3])).resolves.toContain('phaseInProgress');
  deployment.operationStatus = 'queued'; await expect(testEnvironmentSnapshot(target, call, [4])).rejects.toThrow('Another deployment');
});
it('snapshot changes after a completed foreign release, even if it finished between polls', async () => {
  const call = vi.fn(async (_method: string, url: string) => ({ value: url.includes('$top=1&') ? [{ ...deployment, deploymentStatus: 'succeeded', operationStatus: 'phaseSucceeded' }] : [] }));
  const first = await testEnvironmentSnapshot(target, call); deployment.id++;
  expect(await testEnvironmentSnapshot(target, call)).not.toBe(first);
});
