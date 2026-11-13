// Unit tests of lib/devlinks.ts: the DevOps links of a chat found locally in its messages and tool calls (URLs of
// both hosts, DevOps MCP tool ids and titles, cached titles, dedup and newest-first order).
import { describe, expect, it } from 'vitest';
import type { ChatItem, TasksState } from '../../src/shared/contract';
import { devopsToolName, extractDevLinks, linkLabel, parseDevopsUrl, toolRefs } from '../../src/renderer/lib/devlinks';

const user = (at: number, text: string): ChatItem => ({ kind: 'user', id: `u${at}`, at, text });
const asst = (at: number, text: string): ChatItem => ({ kind: 'assistant', id: `a${at}`, at, text });
const tool = (at: number, name: string, input: unknown, output?: string): ChatItem => ({ kind: 'tool', id: `t${at}`, at, name, summary: '', input, status: 'ok', output });

describe('parseDevopsUrl', () => {
  it('reads PRs, work items, test plans, builds and releases on dev.azure.com', () => {
    expect(parseDevopsUrl('https://dev.azure.com/o/Shop/_git/shop-web/pullrequest/81')).toMatchObject({ kind: 'pr', id: 81, org: 'https://dev.azure.com/o' });
    expect(parseDevopsUrl('https://dev.azure.com/o/Shop/_workitems/edit/4711/')).toMatchObject({ kind: 'workitem', id: 4711 });
    expect(parseDevopsUrl('https://dev.azure.com/o/Shop/_boards/board?workitem=99')).toMatchObject({ kind: 'workitem', id: 99 });
    expect(parseDevopsUrl('https://dev.azure.com/o/Shop/_testPlans/define?planId=5100&suiteId=5104')).toMatchObject({ kind: 'testplan', id: 5100 });
    expect(parseDevopsUrl('https://dev.azure.com/o/Shop/_build/results?buildId=20931&view=results')).toMatchObject({ kind: 'build', id: 20931 });
    expect(parseDevopsUrl('https://dev.azure.com/o/Shop/_releaseProgress?_a=release-pipeline-progress&releaseId=77')).toMatchObject({ kind: 'release', id: 77 });
  });
  it('reads the old visualstudio.com host', () => {
    expect(parseDevopsUrl('https://acme.visualstudio.com/Shop/_git/web/pullrequest/5')).toMatchObject({ kind: 'pr', id: 5, org: 'https://acme.visualstudio.com' });
  });
  it('ignores API URLs, repos, boards and other sites; strips trailing punctuation', () => {
    expect(parseDevopsUrl('https://dev.azure.com/o/_apis/wit/workItems/4711')).toBeNull();
    expect(parseDevopsUrl('https://dev.azure.com/o/Shop/_git/shop-web')).toBeNull();
    expect(parseDevopsUrl('https://example.com/pullrequest/1')).toBeNull();
    expect(parseDevopsUrl('https://dev.azure.com/o/Shop/_workitems/edit/12.')?.url).toBe('https://dev.azure.com/o/Shop/_workitems/edit/12');
  });
});

describe('DevOps MCP tools', () => {
  it('recognizes the DevOps servers only', () => {
    expect(devopsToolName('mcp__my-devops__wit_get_work_item')).toBe('wit_get_work_item');
    expect(devopsToolName('mcp__azure-devops__repo_get_pull_request_by_id')).toBe('repo_get_pull_request_by_id');
    expect(devopsToolName('mcp__sb-browser__browser_click')).toBeNull();
    expect(devopsToolName('Bash')).toBeNull();
  });
  it('reads ids from the input and the title from a (truncated) result', () => {
    const out = '{"id":4720,"fields":{"System.WorkItemType":"Bug","System.Title":"IVA \\"doppia\\" sul reso","System.Description":"lungo…';
    expect(toolRefs('mcp__my-devops__wit_get_work_item', { id: 4720, project: 'Shop' }, out)).toEqual([{ kind: 'workitem', id: 4720, project: 'Shop', title: 'IVA "doppia" sul reso', type: 'Bug' }]);
    expect(toolRefs('mcp__my-devops__repo_get_pull_request_by_id', { repositoryId: 'r1', pullRequestId: '85', project: 'Shop' }, '{"pullRequestId":85,"title":"Resi","repository":{"id":"g","name":"shop-web"}}'))
      .toEqual([{ kind: 'pr', id: 85, project: 'Shop', repo: 'shop-web', title: 'Resi' }]);
    expect(toolRefs('mcp__my-devops__wit_get_work_items_batch_by_ids', { ids: [1, 2] }, '[{"id":1,"fields":{"System.Title":"Uno"}}]'))
      .toEqual([{ kind: 'workitem', id: 1, project: undefined, title: 'Uno', type: undefined }, { kind: 'workitem', id: 2, project: undefined }]);
    expect(toolRefs('mcp__my-devops__pipelines_get_build_status', { project: 'Shop', buildId: 9 })).toEqual([{ kind: 'build', id: 9, project: 'Shop' }]);
    expect(toolRefs('mcp__my-devops__testplan_list_test_cases', { project: 'Shop', planid: 5100 })).toEqual([{ kind: 'testplan', id: 5100, project: 'Shop' }]);
  });
  it('does not take a title from a comment list', () => {
    expect(toolRefs('mcp__my-devops__wit_list_work_item_comments', { workItemId: 7 }, '{"System.Title":"no"}')).toEqual([{ kind: 'workitem', id: 7, project: undefined }]);
  });
});

describe('extractDevLinks', () => {
  it('dedups by object, keeps the first URL, orders by the last mention', () => {
    const links = extractDevLinks([
      user(1, 'guarda https://dev.azure.com/o/Shop/_workitems/edit/4711 e la PR https://dev.azure.com/o/Shop/_git/web/pullrequest/81'),
      asst(2, 'Il bug è [qui](https://dev.azure.com/o/Shop/_workitems/edit/4711?src=x).'),
      asst(3, 'build https://dev.azure.com/o/Shop/_build/results?buildId=5'),
    ]);
    expect(links.map(l => `${l.kind}:${l.id}`)).toEqual(['build:5', 'workitem:4711', 'pr:81']);
    expect(links[1]!.url).toBe('https://dev.azure.com/o/Shop/_workitems/edit/4711');
    expect(linkLabel(links[2]!)).toBe('PR 81');
  });
  it('builds URLs for tool ids from the organization seen in the chat, with the tool title', () => {
    const links = extractDevLinks([
      asst(1, 'https://dev.azure.com/o/Shop/_workitems/edit/1'),
      tool(2, 'mcp__my-devops__wit_get_work_item', { id: 4720, project: 'Shop' }, '{"fields":{"System.WorkItemType":"Bug","System.Title":"IVA doppia"}}'),
      tool(3, 'mcp__my-devops__repo_get_pull_request_by_id', { repositoryId: 'shop-web', pullRequestId: 85, project: 'Shop' }),
    ]);
    expect(links[0]).toMatchObject({ kind: 'pr', id: 85, url: 'https://dev.azure.com/o/Shop/_git/shop-web/pullrequest/85' });
    expect(links[1]).toMatchObject({ kind: 'workitem', id: 4720, title: 'IVA doppia', type: 'Bug', url: 'https://dev.azure.com/o/Shop/_workitems/edit/4720' });
  });
  it('skips tool ids with no known organization', () => {
    expect(extractDevLinks([tool(1, 'mcp__my-devops__wit_get_work_item', { id: 3 })])).toEqual([]);
  });
  it('takes titles and the organization from the cached DevOps data', () => {
    const devops = {
      prs: [{ id: 81, title: 'Rimborso con sconto', url: 'https://dev.azure.com/o/Shop/_git/web/pullrequest/81', workItems: [] }],
      assigned: [{ id: 4711, type: 'Bug', title: 'Reso sbagliato', url: 'https://dev.azure.com/o/Shop/_workitems/edit/4711' }],
      news: [], urgent: [], reviews: [], oldReviews: [], details: {},
    } as unknown as TasksState;
    const links = extractDevLinks([
      asst(1, 'PR https://dev.azure.com/o/Shop/_git/web/pullrequest/81'),
      tool(2, 'mcp__my-devops__wit_get_work_item', { id: 4711 }),
    ], devops);
    expect(links).toEqual([
      { kind: 'workitem', id: 4711, url: 'https://dev.azure.com/o/_workitems/edit/4711', title: 'Reso sbagliato', type: 'Bug', at: 2 },
      { kind: 'pr', id: 81, url: 'https://dev.azure.com/o/Shop/_git/web/pullrequest/81', title: 'Rimborso con sconto', at: 1 },
    ]);
  });
  it('finds URLs inside tool inputs and outputs', () => {
    const links = extractDevLinks([tool(1, 'Bash', { command: 'start https://acme.visualstudio.com/Shop/_testPlans/execute?planId=42' }, 'ok')]);
    expect(links).toMatchObject([{ kind: 'testplan', id: 42 }]);
  });
});
