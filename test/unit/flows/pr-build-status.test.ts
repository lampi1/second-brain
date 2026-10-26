// Latest PR merge-build observations: only the approved pipeline/repository/commit; no remote writes or fallback successes.
import { expect, it, vi } from 'vitest';
import { prBuildStatus } from '../../../src/main/flows/pr-build-status';
import type { TestDeployTarget } from '../../../src/shared/flow-automation';
const guid = '11111111-2222-3333-4444-555555555555', commit = 'a'.repeat(40);
const target = { id: 'test', organization: 'contoso', projectId: guid, repositoryId: guid, buildDefinitionId: 6 } as TestDeployTarget;
const source = { commit, pullRequestId: 23 };
const build = { id: 41, buildNumber: 'build-41', sourceVersion: commit, sourceBranch: 'refs/pull/23/merge', reason: 'pullRequest', project: { id: guid }, definition: { id: 6 }, repository: { id: guid }, status: 'completed', result: 'succeeded' };
it.each([['notStarted', '', 'queued'], ['inProgress', '', 'running'], ['completed', 'failed', 'failed'], ['completed', 'succeeded', 'succeeded'], ['completed', 'canceled', 'canceled'], ['completed', 'partiallySucceeded', 'failed']])('returns %s/%s as %s, never the older successful build', async (status, result, expected) => {
  const call = vi.fn(async () => ({ value: [{ ...build, status, result }, { ...build, id: 40 }] })), verify = vi.fn(async () => {});
  expect(await prBuildStatus(target, source, call, verify)).toMatchObject({ buildId: 41, buildNumber: 'build-41', sourceVersion: commit, status: expected });
  expect(call.mock.calls).toHaveLength(1); expect(call).toHaveBeenCalledWith('GET', expect.stringContaining('refs%2Fpull%2F23%2Fmerge')); expect(verify).toHaveBeenCalledTimes(2);
});
it.each([{ sourceVersion: 'b'.repeat(40) }, { sourceBranch: 'refs/pull/24/merge' }, { repository: { id: 'other' } }, { definition: { id: 7 } }, { project: { id: 'other' } }, { reason: 'manual' }])('does not return a foreign or stale build: %j', async patch => {
  expect(await prBuildStatus(target, source, async () => ({ value: [{ ...build, ...patch }] }), async () => {})).toMatchObject({ status: 'not-found', buildId: null });
});
it('refuses a source identity that changes while reading', async () => {
  const verify = vi.fn(async () => {}).mockImplementationOnce(async () => {}).mockImplementationOnce(async () => { throw new Error('changed'); });
  await expect(prBuildStatus(target, source, async () => ({ value: [build] }), verify)).rejects.toThrow('changed');
});
