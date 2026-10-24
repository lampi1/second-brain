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
    description: 'Only for a chat bound to a running automatic-flow step that declares the devops-write adapter: one Azure DevOps write, checked by the host against the grant the user approved for that flow (organization, projects, operations, fields). Targets only the run\'s own work item (host input work-item-id) and the test plans, suites and cases this run created. op: add-tags|remove-tags {tags}, set-fields {fields: {referenceName: value}}, comment {text, mentions?: identity GUIDs from the grant (the host adds each @name, read from DevOps)}, link-pr {projectId, repositoryId, pullRequestId}, create-test-plan {project, name, areaPath?, iteration?}, rename-test-plan {project, planId, name}, create-test-suite {project, planId, parentSuiteId (the plan rootSuiteId or a suite you created), name}, create-test-case {project, planId, suiteId, title, steps: [{action, expected}]} (linked "Tests" to the work item), set-test-outcome {project, planId, suiteId, testCaseId, outcome passed|failed|blocked|notApplicable}. A refusal is final for that request: never retry it through another tool. Returns ids to quote as evidence.',
    inputSchema: { type: 'object', required: ['op'], additionalProperties: false, properties: {
      op: { type: 'string', enum: [...DEVOPS_WRITE_REQUESTS] },
      tags: { type: 'array', items: str, minItems: 1, maxItems: 10 }, fields: { type: 'object', additionalProperties: str }, text: str, mentions: { type: 'array', items: str, maxItems: 10 },
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
