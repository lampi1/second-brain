// DevOps write adapter (ADR 0145): every operation against a fake REST endpoint, and every refusal that keeps a run
// inside its grant (other work item, unowned plan/suite/case, ungranted project, field or operation, login errors).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DevOpsWriteGrant } from '../../src/shared/flow-automation';
import { DevOpsWriter, type DevOpsWriteContext } from '../../src/main/flows/devops-writer';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });
const GUID = '11111111-2222-3333-4444-555555555555';
const grant = (over: Partial<DevOpsWriteGrant> = {}): DevOpsWriteGrant => ({ organization: 'contoso', projects: ['ProjectA', 'ProjectB'], ops: ['tags', 'comment', 'fields', 'test-plans', 'test-results', 'pr-links'], fields: ['System.State', 'System.AreaPath'], ...over });
interface Call { method: string; url: string; body: unknown; headers: Record<string, string> }

function setup(options: { grant?: DevOpsWriteGrant; project?: string; prProject?: string; status?: (call: Call) => number | undefined } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-dw-')); dirs.push(dir);
  const calls: Call[] = [], audit = vi.fn();
  const request = vi.fn(async (url: string, init: RequestInit) => {
    const call: Call = { method: init.method!, url, body: init.body ? JSON.parse(init.body as string) : undefined, headers: init.headers as Record<string, string> };
    calls.push(call);
    const status = options.status?.(call) ?? 200;
    let body: unknown = {};
    if (call.method === 'GET' && url.includes('/_apis/wit/workitems/42')) body = { id: 42, rev: 7, fields: { 'System.TeamProject': options.project ?? 'ProjectA', 'System.Tags': 'old; keep' } };
    else if (url.includes('/testplan/plans?')) body = { id: 100, rootSuite: { id: 101 } };
    else if (url.includes('/suites?')) body = { id: 102 };
    else if (url.includes('$Test%20Case')) body = { id: 103 };
    else if (url.includes('/TestPoint?testCaseId')) body = { value: [{ id: 900 }] };
    else if (url.includes('/comments?')) body = { id: 5 };
    else if (url.includes('/_apis/identities?')) body = { value: [{ id: url.match(/identityIds=([^&]+)/)![1], providerDisplayName: 'Test <User>' }] };
    else if (url.includes('/_apis/projects/')) body = { id: GUID, name: options.prProject ?? 'ProjectB' };
    return new Response(JSON.stringify(body), { status });
  });
  const writer = new DevOpsWriter({ file: path.join(dir, 'ledger.json'), token: async () => 'token-value', request, audit });
  const context: DevOpsWriteContext = { runId: 'run-1', grant: options.grant ?? grant(), workItemId: 42 };
  return { writer, context, calls, audit, request, file: path.join(dir, 'ledger.json'), run: (req: Record<string, unknown>, ctx = context) => writer.execute(ctx, req) };
}

describe('DevOps write adapter', () => {
  it('edits tags on the run work item only, with a revision test and the bearer token', async () => {
    const { run, calls, audit } = setup();
    expect(await run({ op: 'add-tags', tags: ['new', 'KEEP'] })).toEqual({ workItemId: 42, tags: ['old', 'keep', 'new'] });
    const patch = calls[1]!;
    expect(patch).toMatchObject({ method: 'PATCH', url: expect.stringMatching(/^https:\/\/dev\.azure\.com\/contoso\/_apis\/wit\/workitems\/42\?/) });
    expect(patch.headers.Authorization).toBe('Bearer token-value');
    expect(patch.body).toEqual([{ op: 'test', path: '/rev', value: 7 }, { op: 'add', path: '/fields/System.Tags', value: 'old; keep; new' }]);
    expect(await run({ op: 'remove-tags', tags: ['old'] })).toMatchObject({ tags: ['keep'] });
    expect(audit).toHaveBeenCalledWith({ runId: 'run-1', op: 'add-tags', target: 'workitem:42' });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('token-value');
  });
  it('sets only granted fields and keeps area paths inside granted projects', async () => {
    const { run, calls } = setup();
    expect(await run({ op: 'set-fields', fields: { 'system.state': 'Active', 'System.AreaPath': 'ProjectB\\Team' } })).toMatchObject({ fields: ['System.State', 'System.AreaPath'] });
    expect(calls[1]!.body).toContainEqual({ op: 'add', path: '/fields/System.State', value: 'Active' });
    await expect(run({ op: 'set-fields', fields: { 'System.Title': 'x' } })).rejects.toThrow('not in the approved');
    await expect(run({ op: 'set-fields', fields: { 'System.AreaPath': 'Other\\Team' } })).rejects.toThrow('Project is not in');
  });
  it('comments with escaped text and links pull requests', async () => {
    const { run, calls } = setup();
    expect(await run({ op: 'comment', text: '<b>done</b>' })).toEqual({ workItemId: 42, commentId: 5 });
    expect(calls[1]!.url).toContain('/contoso/ProjectA/_apis/wit/workItems/42/comments?');
    expect(calls[1]!.body).toEqual({ text: '&lt;b&gt;done&lt;/b&gt;' });
    await run({ op: 'link-pr', projectId: GUID, repositoryId: GUID, pullRequestId: 9 });
    expect(calls[2]!.url).toContain(`/contoso/_apis/projects/${GUID}?`);
    expect(JSON.stringify(calls.at(-1)!.body)).toContain(`vstfs:///Git/PullRequestId/${GUID}%2F${GUID}%2F9`);
    await expect(run({ op: 'link-pr', projectId: 'x', repositoryId: GUID, pullRequestId: 9 })).rejects.toThrow('GUID');
  });
  it('mentions only granted identities, with the name read from DevOps and the text still escaped', async () => {
    const M1 = 'aaaaaaaa-0000-0000-0000-000000000001', M2 = 'aaaaaaaa-0000-0000-0000-000000000002';
    const { run, calls } = setup({ grant: grant({ mentions: [M1, M2] }) });
    expect(await run({ op: 'comment', text: '<i>x</i>', mentions: [M1.toUpperCase(), M2] })).toEqual({ workItemId: 42, commentId: 5, mentions: 2 });
    expect(calls[1]!.url).toMatch(new RegExp(`^https://vssps\\.[^/]+/contoso/_apis/identities\\?identityIds=${M1}&api-version=7\\.1$`));
    expect(calls.at(-1)!.body).toEqual({ text: `<a href="#" data-vss-mention="version:2.0,${M1}">@Test &lt;User&gt;</a> <a href="#" data-vss-mention="version:2.0,${M2}">@Test &lt;User&gt;</a><br/>&lt;i&gt;x&lt;/i&gt;` });
    const n = calls.length;
    await expect(run({ op: 'comment', text: 'x', mentions: ['aaaaaaaa-0000-0000-0000-000000000009'] })).rejects.toThrow('not in the approved');
    await expect(run({ op: 'comment', text: 'x', mentions: ['not-a-guid'] })).rejects.toThrow('GUID');
    await expect(run({ op: 'comment', text: 'x', mentions: [M1, M1] })).rejects.toThrow('duplicate');
    await expect(setup().run({ op: 'comment', text: 'x', mentions: [M1] })).rejects.toThrow('not in the approved');
    expect(calls.length).toBe(n);
    const wrong = setup({ grant: grant({ mentions: [M1] }), status: c => (c.url.includes('/identities?') ? 404 : undefined) });
    await expect(wrong.run({ op: 'comment', text: 'x', mentions: [M1] })).rejects.toThrow();
    expect(wrong.calls.some(c => c.url.includes('/comments?'))).toBe(false);
  });
  it('creates plans, suites, cases and results only inside what this run created', async () => {
    const { run, calls, file } = setup();
    expect(await run({ op: 'create-test-plan', project: 'projecta', name: 'Plan' })).toEqual({ planId: 100, rootSuiteId: 101 });
    expect(calls[0]!.url).toContain('/contoso/ProjectA/_apis/testplan/plans?');
    expect(await run({ op: 'create-test-suite', project: 'ProjectA', planId: 100, parentSuiteId: 101, name: 'Suite' })).toEqual({ planId: 100, suiteId: 102 });
    expect(await run({ op: 'create-test-case', project: 'ProjectA', planId: 100, suiteId: 102, title: 'Case', steps: [{ action: 'Open', expected: 'Shown' }] })).toMatchObject({ testCaseId: 103, linkedTo: 42 });
    expect(JSON.stringify(calls.find(c => c.url.includes('$Test%20Case'))!.body)).toContain('TestedBy-Reverse');
    expect(await run({ op: 'set-test-outcome', project: 'ProjectA', planId: 100, suiteId: 102, testCaseId: 103, outcome: 'passed' })).toEqual({ testCaseId: 103, outcome: 'passed', points: 1 });
    expect(calls.at(-1)!.body).toEqual([{ id: 900, results: { outcome: 'passed' } }]);
    expect(await run({ op: 'rename-test-plan', project: 'ProjectA', planId: 100, name: 'Renamed' })).toEqual({ planId: 100, name: 'Renamed' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).runs['run-1']).toMatchObject({ plans: [{ id: 100 }], suites: [{ id: 102 }], testCases: [{ id: 103 }] });
  });
  it('refuses plans, suites and cases another run created', async () => {
    const { run, context } = setup(); await run({ op: 'create-test-plan', project: 'ProjectA', name: 'Plan' });
    const other = { ...context, runId: 'run-2' };
    await expect(run({ op: 'rename-test-plan', project: 'ProjectA', planId: 100, name: 'x' }, other)).rejects.toThrow('created by this run');
    await expect(run({ op: 'rename-test-plan', project: 'ProjectA', planId: 555, name: 'x' })).rejects.toThrow('created by this run');
    await expect(run({ op: 'create-test-suite', project: 'ProjectA', planId: 100, parentSuiteId: 777, name: 'x' })).rejects.toThrow('suites created');
    await expect(run({ op: 'set-test-outcome', project: 'ProjectA', planId: 100, suiteId: 101, testCaseId: 103, outcome: 'passed' })).rejects.toThrow('test cases created');
    await expect(run({ op: 'rename-test-plan', project: 'ProjectB', planId: 100, name: 'x' })).rejects.toThrow('created by this run');
  });
  it('refuses ungranted operations, projects and a work item outside the grant before writing', async () => {
    const limited = setup({ grant: grant({ ops: ['comment'], fields: [] }) });
    await expect(limited.run({ op: 'add-tags', tags: ['x'] })).rejects.toThrow('"tags" is not enabled');
    expect(limited.request).not.toHaveBeenCalled();
    const { run, calls } = setup({ project: 'Elsewhere' });
    await expect(run({ op: 'comment', text: 'x' })).rejects.toThrow('Project is not in');
    expect(calls.filter(c => c.method !== 'GET')).toHaveLength(0);
    await expect(run({ op: 'create-test-plan', project: 'Other', name: 'x' })).rejects.toThrow('Project is not in');
    await expect(run({ op: 'nope' })).rejects.toThrow('Unknown');
    await expect(run({ op: 'comment', text: 'x', workItemId: 1 })).rejects.toThrow();
  });
  it('refuses a pull request from a project outside the grant', async () => {
    const { run, calls } = setup({ prProject: 'Elsewhere' });
    await expect(run({ op: 'link-pr', projectId: GUID, repositoryId: GUID, pullRequestId: 9 })).rejects.toThrow('Project is not in');
    expect(calls.filter(c => c.method !== 'GET')).toHaveLength(0);
  });
  it('refuses a create before any POST when the run ledger is full', async () => {
    const { run, calls, file } = setup();
    const testCases = Array.from({ length: 500 }, (_, i) => ({ project: 'ProjectA', planId: 1, suiteId: 2, id: i + 1 }));
    fs.writeFileSync(file, JSON.stringify({ schema: 1, runs: { 'run-1': { plans: [], suites: [], testCases } } }));
    await expect(run({ op: 'create-test-plan', project: 'ProjectA', name: 'Plan' })).rejects.toThrow('ledger limit');
    expect(calls).toHaveLength(0);
  });
  it('maps login and conflict errors and fails closed on a corrupt ledger', async () => {
    await expect(setup({ status: () => 401 }).run({ op: 'comment', text: 'x' })).rejects.toThrow('az login');
    await expect(setup({ status: c => c.method === 'PATCH' ? 412 : undefined }).run({ op: 'add-tags', tags: ['x'] })).rejects.toThrow('changed meanwhile');
    const broken = setup(); fs.writeFileSync(broken.file, '{');
    await expect(broken.run({ op: 'comment', text: 'x' })).rejects.toThrow('ledger is unreadable');
  });
});
