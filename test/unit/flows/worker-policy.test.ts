// Routine grants should remove duplicate approval questions, never actual host gates or scope checks.
import { expect, it } from 'vitest';
import { workerWritePolicy } from '../../../src/main/flows/worker-policy';
it('states exact host-approved operations and asks only for missing authority or a real decision', () => {
  const text = workerWritePolicy({ organization: 'contoso', projects: ['Example'], ops: ['git-push', 'comment'], fields: [], pushTargets: [{ project: 'Example', repositoryId: '11111111-2222-3333-4444-555555555555', workspaceInput: 'workspace' }] }, 'refs/heads/fix/routine-original');
  expect(text).toContain('without asking for approval again');
  expect(text).toContain('git-push'); expect(text).toContain('workspace'); expect(text).toContain('Host-owned branch: refs/heads/fix/routine-original');
  expect(text).toContain('satisfies generic role instructions');
  expect(text).toContain('approval/manual steps'); expect(text).toContain('production');
  expect(workerWritePolicy(undefined)).toContain('No DevOps write grant');
});
