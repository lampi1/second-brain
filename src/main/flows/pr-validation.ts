// Queue only the existing build-policy evaluation of the run-owned PR and the exact approved pipeline.
// Draft PRs do not auto-trigger Azure Repos builds. Re-evaluation changes no policy, pipeline, PR draft state or target.
import type { TestDeployTarget } from '../../shared/flow-automation';
import type { OwnedPullRequest } from './devops-resources';
import { object, text } from './schema';
export async function queuePrValidation(target: TestDeployTarget, pr: OwnedPullRequest, mergeCommit: string, call: (method: string, url: string, body?: unknown) => Promise<Record<string, unknown>>, verify: () => Promise<void>): Promise<Record<string, unknown>> {
  if (pr.projectId !== target.projectId) throw new Error('PR and approved pipeline must belong to the same project');
  const artifactId = `vstfs:///CodeReview/CodeReviewId/${pr.projectId}/${pr.id}`;
  const base = `https://dev.azure.com/${encodeURIComponent(target.organization)}/${pr.projectId}/_apis/policy/evaluations`;
  const result = await call('GET', `${base}?artifactId=${encodeURIComponent(artifactId)}&includeNotApplicable=true&$top=100&api-version=7.1-preview.1`);
  if (!Array.isArray(result.value) || result.value.length >= 100) throw new Error('Policy evaluation list is incomplete');
  const matches = result.value.map(v => object(v, 'policy evaluation')).filter(row => {
    const c = object(row.configuration, 'policy configuration');
    return row.artifactId === artifactId && c.isEnabled === true && c.isDeleted !== true && String(object(c.type, 'policy type').id).toLowerCase() === '0609b952-1397-4640-95ec-e00a01b2c241' && object(c.settings, 'policy settings').buildDefinitionId === target.buildDefinitionId;
  });
  if (matches.length !== 1) throw new Error('Exactly one existing build-validation policy for the approved pipeline is required; no policy or pipeline was changed');
  const evaluation = matches[0]!, id = text(evaluation.evaluationId, 'evaluation id', 36);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new Error('Invalid policy evaluation identity');
  await verify();
  if (['running', 'queued'].includes(String(evaluation.status).toLowerCase())) return { pullRequestId: pr.id, evaluationId: id, mergeCommit, status: 'already-running' };
  const queued = await call('PATCH', `${base}/${id}?api-version=7.1-preview.1`, { status: 'queued' });
  if (queued.evaluationId !== id || queued.artifactId !== artifactId) throw new Error('Unexpected policy reevaluation receipt; inspect the own PR before retrying');
  return { pullRequestId: pr.id, evaluationId: id, mergeCommit, buildDefinitionId: target.buildDefinitionId, status: 'queued', next: 'Wait for the succeeded PR merge build, then deploy-test. Queue acceptance is not a successful build.' };
}
