// Draft PR validation is a scoped request to an existing build policy, never a pipeline/configuration mutation.
import { expect, it, vi } from 'vitest';
import { queuePrValidation } from '../../../src/main/flows/pr-validation';
import type { TestDeployTarget } from '../../../src/shared/flow-automation';
const guid = '11111111-2222-3333-4444-555555555555';
const target = { organization: 'contoso', projectId: guid, buildDefinitionId: 6 } as TestDeployTarget;
const pr = { id: 23, project: 'Example', projectId: guid, repositoryId: guid, source: 'refs/heads/fix/routine', target: 'refs/heads/main' };
const artifactId = `vstfs:///CodeReview/CodeReviewId/${guid}/23`;
const evaluation = { evaluationId: guid, artifactId, status: 'notApplicable', configuration: { isEnabled: true, type: { id: '0609b952-1397-4640-95ec-e00a01b2c241' }, settings: { buildDefinitionId: 6 } } };
it('queues exactly the owned PR existing pipeline policy while leaving the draft and definitions untouched', async () => {
  const call = vi.fn(async (method: string) => method === 'GET' ? { value: [evaluation] } : evaluation), verify = vi.fn(async () => {});
  expect(await queuePrValidation(target, pr, 'a'.repeat(40), call, verify)).toMatchObject({ status: 'queued', pullRequestId: 23 });
  expect(verify).toHaveBeenCalledOnce(); expect(call.mock.calls.map(c => c[0])).toEqual(['GET', 'PATCH']);
});
it.each(['foreign-pr', 'wrong-pipeline', 'disabled', 'multiple'])('refuses %s without a mutation', async variation => {
  const row = structuredClone(evaluation);
  if (variation === 'foreign-pr') row.artifactId += '4';
  if (variation === 'wrong-pipeline') row.configuration.settings.buildDefinitionId = 7;
  if (variation === 'disabled') row.configuration.isEnabled = false;
  const call = vi.fn(async () => ({ value: variation === 'multiple' ? [row, row] : [row] }));
  await expect(queuePrValidation(target, pr, 'a'.repeat(40), call, async () => {})).rejects.toThrow('Exactly one'); expect(call).toHaveBeenCalledOnce();
});
