// Read-only status of the latest build for the run-owned PR's live merge commit and approved test pipeline.
// Used by the scoped DevOps adapter; a failed newer attempt must never be hidden by an older successful build.
import type { TestDeployTarget } from '../../shared/flow-automation';
import { integer, object, text } from './schema';
export async function prBuildStatus(target: TestDeployTarget, source: { commit: string; pullRequestId: number }, call: (method: string, url: string) => Promise<Record<string, unknown>>, verify: () => Promise<void>): Promise<Record<string, unknown>> {
  await verify();
  const branch = `refs/pull/${source.pullRequestId}/merge`;
  const url = `https://dev.azure.com/${encodeURIComponent(target.organization)}/${target.projectId}/_apis/build/builds?definitions=${target.buildDefinitionId}&reasonFilter=pullRequest&branchName=${encodeURIComponent(branch)}&queryOrder=queueTimeDescending&$top=100&api-version=7.1`;
  const response = await call('GET', url);
  if (!Array.isArray(response.value)) throw new Error('Invalid PR build status response');
  const builds = response.value.map(v => object(v, 'PR build'));
  const build = builds.find(b => b.sourceVersion === source.commit && b.sourceBranch === branch && b.reason === 'pullRequest' && object(b.project, 'build project').id === target.projectId && object(b.definition, 'build definition').id === target.buildDefinitionId && String(object(b.repository, 'build repository').id).toLowerCase() === target.repositoryId);
  await verify();
  const identity = { targetId: target.id, pullRequestId: source.pullRequestId, buildDefinitionId: target.buildDefinitionId, sourceVersion: source.commit, sourceBranch: branch };
  if (!build) return { ...identity, status: 'not-found', buildId: null, buildNumber: null, searchLimited: builds.length >= 100, next: 'No matching build in the latest 100. Queue the existing PR validation policy if needed; no build was started by this read.' };
  const status = build.status === 'notStarted' || build.status === 'postponed' ? 'queued' : build.status === 'inProgress' || build.status === 'cancelling' ? 'running' : build.status === 'completed' ? build.result === 'succeeded' ? 'succeeded' : build.result === 'canceled' ? 'canceled' : ['failed', 'partiallySucceeded'].includes(String(build.result)) ? 'failed' : 'unknown' : 'unknown';
  return { ...identity, buildId: integer(build.id, 'build id', 1, 2_147_483_647), buildNumber: typeof build.buildNumber === 'string' ? text(build.buildNumber, 'build number', 256) : null, status, rawStatus: build.status, result: build.result ?? null };
}
