// The chat-endpoint tool of the DevOps write adapter (ADR 0145): a chat bound to a running adapter step of an
// automatic flow asks for one DevOps write. The caller is its token's chat; the host derives run, work item and grant,
// so nothing the agent sends can widen them. Mounted by wiring.ts on every chat's own endpoint.
import type { McpTool } from '../mcp/server';
import { DEVOPS_WRITE_REQUESTS } from './devops-writer';

export type DevOpsWriteRun = (chatId: string, request: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>;
const str = { type: 'string' }, int = { type: 'integer', minimum: 1 };

export function devopsWriteTools(write: DevOpsWriteRun): McpTool[] {
  return [{
    name: 'flow_devops_write',
    description: 'Only for a chat bound to a running automatic-flow step that declares the devops-write adapter: one Azure DevOps write, checked by the host against the grant the user approved for that flow (organization, projects, operations, fields). Targets only the run\'s own work item (host input work-item-id) and the test plans, suites and cases this run created. op: add-tags|remove-tags {tags}, set-fields {fields: {referenceName: value}}, comment {text, mentions?: identity GUIDs from the grant (the host adds each @name, read from DevOps)}, link-pr {projectId, repositoryId, pullRequestId}, create-test-plan {project, name, areaPath?, iteration?}, rename-test-plan {project, planId, name}, create-test-suite {project, planId, parentSuiteId (the plan rootSuiteId or a suite you created), name}, create-test-case {project, planId, suiteId, title, steps: [{action, expected}]} (linked "Tests" to the work item), set-test-outcome {project, planId, suiteId, testCaseId, outcome passed|failed|blocked|notApplicable}. New separately granted operations: upload-image {filename} reads PNG/JPEG only from the host run evidence folder, returns attachmentId; rich-comments accepts [label](same-org HTTPS URL) and ![caption](attachment:ID), never raw HTML or external images; relate-work-item {relatedWorkItemId}, relate-pr {projectId,repositoryId,pullRequestId}; create-pr {project,repositoryId,sourceRef,targetRef,title,text} creates one draft PR owned by the run; pr-comment {pullRequestId,text}, publish-pr and abandon-pr {pullRequestId} affect only that run-created draft PR. deploy-test {targetId,buildId} requires an exact configured test target; test-deploy-status {targetId} reads its receipt; cancel-test-deploy {targetId} cancels only this run’s deployment and retains the lease until a terminal status is verified. Mentions require mentionReason intake|block|downgrade|final. A refusal is final for that request: never retry it through another tool. Returns ids to quote as evidence.',
    inputSchema: { type: 'object', required: ['op'], additionalProperties: false, properties: {
      op: { type: 'string', enum: [...DEVOPS_WRITE_REQUESTS] },
      tags: { type: 'array', items: str, minItems: 1, maxItems: 10 }, fields: { type: 'object', additionalProperties: str }, text: str, format: { type: 'string', enum: ['plain', 'markdown'] }, filename: str, relatedWorkItemId: int, sourceRef: str, targetRef: str, targetId: str, buildId: int, mentionReason: { type: 'string', enum: ['intake', 'block', 'downgrade', 'final'] }, mentions: { type: 'array', items: str, maxItems: 10 },
      projectId: str, repositoryId: str, pullRequestId: int, project: str, name: str, areaPath: str, iteration: str,
      planId: int, parentSuiteId: int, suiteId: int, testCaseId: int, title: str,
      steps: { type: 'array', maxItems: 50, items: { type: 'object', required: ['action'], additionalProperties: false, properties: { action: str, expected: str } } },
      outcome: { type: 'string', enum: ['passed', 'failed', 'blocked', 'notApplicable'] },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => {
      const chatId = ctx.params.chatId;
      if (!chatId) throw new Error('This tool works only on a chat\'s own endpoint.');
      return JSON.stringify(await write(chatId, args, ctx.signal));
    },
  }];
}
