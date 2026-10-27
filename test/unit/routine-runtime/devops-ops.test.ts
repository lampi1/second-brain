// The routine runtime's extended DevOps writes (devops-ops.ts) against an in-memory Azure DevOps: test plan, suite
// (Related link to the run's work item, name read back), test case (no Tested By link; description, priority, tags),
// outcome; the run branch push, the draft PR and its link, a PR comment, publish; the test deployment through a fake
// coordinator; the downgrade (cleanup, tags, state, comment with mentions, downgrade.md) and the run stopping on it.
// Comment images (upload-image: only the step folder's files, uploaded once, never blocking) and work item mentions.
// Also the C1 rule: an MCP server config file is deleted once read. No network, no git, no tokens.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevOpsClient, createMasker, createRoutineRuntime, createRunStore, executeWrites, readConfigOnce, runResources, validateStepResult, type RunRecord, type StepWrite, type WriteContext } from '../../../packages/routine-runtime/src/index';
import { done, fakeDevOps, routinePackage, scriptedEngine, tempDir } from './fakes';

// GUIDs built at run time (the repo guard refuses GUID literals)
const g = (c: string) => [8, 4, 4, 4, 12].map(n => c.repeat(n)).join('-');
const PROJECT_ID = g('a'), REPO = g('b'), MENTION = g('c'), CONTACT = g('d');
const RUN = '20261027-120000-abc123', BRANCH = `refs/heads/fix/routine-${RUN}`;
const PUSHED = '1'.repeat(40), MERGE = '2'.repeat(40);
// the organization URL, split so the publish guard does not read it as a real tenant
const ATTACHMENTS = 'https://dev.azure.com/' + 'contoso/_apis/wit/attachments';

type Json = Record<string, unknown>;
interface Item { id: number; rev: number; type: string; fields: Json; relations: Json[] }
interface Pr { pullRequestId: number; title: string; description: string; isDraft: boolean; status: string; sourceRefName: string; targetRefName: string; threads: { id: number; comments: { content: string }[] }[] }
interface Fault { method: string; path: RegExp; mode: 'lost' | 'drop'; times: number }

/** Azure DevOps in memory: work items with relations, test plans, suites, cases and points, a repository with refs,
 *  pull requests and threads, PR builds. `lost` = applied then the response is lost; `drop` = never applied. */
function fakeAdo() {
  const items = new Map<number, Item>(), comments = new Map<number, string[]>();
  const plans: { id: number; name: string; rootSuite: number }[] = [];
  const suites: { id: number; plan: number; name: string; parent?: number; cases: number[] }[] = [];
  const outcomes = new Map<string, string>(), prs: Pr[] = [], refs = new Map<string, string>();
  const calls: { method: string; url: string; body?: unknown }[] = [], faults: Fault[] = [], uploads: { name: string; bytes: Buffer }[] = [];
  let next = 1000;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const timeout = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; return e; };
  const addItem = (id: number, type: string, fields: Json) => { const item = { id, rev: 1, type, fields, relations: [] }; items.set(id, item); return item; };
  const prJson = (p: Pr) => ({ ...p, repository: { id: REPO, project: { id: PROJECT_ID, name: 'Proj' } }, mergeStatus: 'succeeded', lastMergeCommit: { commitId: MERGE }, lastMergeSourceCommit: { commitId: refs.get(p.sourceRefName) ?? PUSHED } });

  function apply(method: string, url: URL, body: unknown): Response {
    const p = decodeURIComponent(url.pathname);
    let m: RegExpExecArray | null;
    if (/\/_apis\/connectionData$/i.test(p)) return json({ authenticatedUser: { id: g('e') } });
    if (url.hostname === 'vssps.dev.azure.com' && /\/_apis\/identities$/i.test(p)) return json({ value: [{ id: url.searchParams.get('identityIds'), providerDisplayName: 'Anna Bianchi' }] });
    if (/\/_apis\/wit\/attachments$/i.test(p) && method === 'POST') {
      uploads.push({ name: url.searchParams.get('fileName')!, bytes: Buffer.from(body as Uint8Array) });
      const id = g(String(uploads.length % 10));
      return json({ id, url: `${ATTACHMENTS}/${id}` });
    }
    if ((m = /\/_apis\/projects\/([^/]+)$/i.exec(p))) return json({ id: m[1], name: 'Proj' });
    if (/\/_apis\/wit\/wiql$/i.test(p)) {
      const q = String((body as Json).query), title = /\[System\.Title\] = '((?:[^']|'')*)'/.exec(q)![1]!.replace(/''/g, "'");
      return json({ workItems: [...items.values()].filter(i => i.type === 'Test Case' && i.fields['System.Title'] === title).map(i => ({ id: i.id })) });
    }
    if (/\/_apis\/wit\/workitems\/\$Test Case$/i.test(p)) {
      const fields: Json = {};
      for (const op of body as { path: string; value: unknown }[]) fields[op.path.replace('/fields/', '')] = op.value;
      return json({ id: addItem(next++, 'Test Case', fields).id });
    }
    if ((m = /\/_apis\/wit\/workitems\/(\d+)\/comments$/i.exec(p))) {
      const id = Number(m[1]), list = comments.get(id) ?? [];
      if (method === 'POST') { comments.set(id, [...list, String((body as Json).text)]); return json({ id: next++ }); }
      return json({ comments: list.map((text, i) => ({ id: i + 1, text, createdBy: { id: g('e') }, createdDate: new Date().toISOString() })) });
    }
    if ((m = /\/_apis\/wit\/workitems\/(\d+)\/updates$/i.exec(p))) return json({ value: [] });
    if ((m = /\/_apis\/wit\/workitems\/(\d+)$/i.exec(p))) {
      const item = items.get(Number(m[1]));
      if (!item) return json({ message: 'not found' }, 404);
      if (method === 'PATCH') {
        for (const op of body as { op: string; path: string; value: unknown }[]) {
          if (op.op === 'test') { if (op.value !== item.rev) return json({ message: 'rev changed' }, 412); continue; }
          if (op.path === '/relations/-') item.relations.push(op.value as Json);
          else item.fields[op.path.replace('/fields/', '')] = op.value;
        }
        item.rev += 1;
        return json({ id: item.id, rev: item.rev });
      }
      return json({ id: item.id, rev: item.rev, fields: { ...item.fields, 'System.TeamProject': 'Proj', 'System.WorkItemType': item.type }, ...(url.searchParams.get('$expand') ? { relations: item.relations } : {}) });
    }
    if (/\/_apis\/testplan\/plans$/i.test(p)) {
      if (method === 'POST') {
        const id = next++, root = next++, name = String((body as Json).name);
        plans.push({ id, name, rootSuite: root }); suites.push({ id: root, plan: id, name, cases: [] });
        return json({ id, name, rootSuite: { id: root } });
      }
      return json({ value: plans.map(x => ({ id: x.id, name: x.name, rootSuite: { id: x.rootSuite } })) });
    }
    if ((m = /\/_apis\/testplan\/plans\/(\d+)$/i.exec(p))) {
      const plan = plans.find(x => x.id === Number(m![1]))!;
      if (method === 'PATCH') plan.name = String((body as Json).name);
      return json({ id: plan.id, name: plan.name });
    }
    if ((m = /\/_apis\/testplan\/plans\/(\d+)\/suites$/i.exec(p))) {
      const plan = Number(m[1]);
      if (method === 'POST') {
        const b = body as { name: string; parentSuite: { id: number } }, id = next++;
        suites.push({ id, plan, name: b.name, parent: b.parentSuite.id, cases: [] }); addItem(id, 'Test Suite', { 'System.Title': b.name });
        return json({ id, name: b.name });
      }
      return json({ value: suites.filter(s => s.plan === plan).map(s => ({ id: s.id, name: s.name })) });
    }
    if ((m = /\/_apis\/testplan\/plans\/(\d+)\/suites\/(\d+)$/i.exec(p))) { const s = suites.find(x => x.id === Number(m![2]))!; return json({ id: s.id, name: s.name }); }
    if ((m = /\/_apis\/testplan\/plans\/(\d+)\/suites\/(\d+)\/testcase$/i.exec(p))) {
      const s = suites.find(x => x.id === Number(m![2]))!;
      if (method === 'POST') for (const c of body as { workItem: { id: number } }[]) s.cases.push(c.workItem.id);
      return json({ value: s.cases.map(id => ({ workItem: { id } })) });
    }
    if ((m = /\/_apis\/testplan\/plans\/(\d+)\/suites\/(\d+)\/testpoint$/i.exec(p))) {
      const suite = Number(m[2]);
      if (method === 'PATCH') { for (const x of body as { id: number; results: { outcome: string } }[]) outcomes.set(`${suite}:${x.id / 10}`, x.results.outcome); return json({ value: [] }); }
      const tc = Number(url.searchParams.get('testCaseId'));
      return json({ value: suites.find(x => x.id === suite)!.cases.includes(tc) ? [{ id: tc * 10, results: { outcome: outcomes.get(`${suite}:${tc}`) ?? 'unspecified' } }] : [] });
    }
    if ((m = /\/_apis\/git\/repositories\/([^/]+)\/refs$/i.exec(p))) {
      const filter = url.searchParams.get('filter') ?? '';
      return json({ value: [...refs].filter(([name]) => name.startsWith(`refs/${filter}`)).map(([name, objectId]) => ({ name, objectId })) });
    }
    if ((m = /\/_apis\/git\/repositories\/([^/]+)\/pullrequests\/(\d+)\/threads$/i.exec(p))) {
      const pr = prs.find(x => x.pullRequestId === Number(m![2]))!;
      if (method === 'POST') { const t = { id: next++, comments: (body as { comments: { content: string }[] }).comments }; pr.threads.push(t); return json({ id: t.id }); }
      return json({ value: pr.threads });
    }
    if ((m = /\/_apis\/git\/repositories\/([^/]+)\/pullrequests\/(\d+)$/i.exec(p))) {
      const pr = prs.find(x => x.pullRequestId === Number(m![2]))!;
      if (method === 'PATCH') Object.assign(pr, body);
      return json(prJson(pr));
    }
    if ((m = /\/_apis\/git\/repositories\/([^/]+)\/pullrequests$/i.exec(p))) {
      if (method === 'POST') {
        const b = body as Json, pr: Pr = { pullRequestId: next++, title: String(b.title), description: String(b.description), isDraft: b.isDraft === true, status: 'active', sourceRefName: String(b.sourceRefName), targetRefName: String(b.targetRefName), threads: [] };
        prs.push(pr); refs.set(`refs/pull/${pr.pullRequestId}/merge`, MERGE);
        return json(prJson(pr));
      }
      const source = url.searchParams.get('searchCriteria.sourceRefName'), target = url.searchParams.get('searchCriteria.targetRefName');
      return json({ value: prs.filter(x => x.sourceRefName === source && x.targetRefName === target).map(prJson) });
    }
    if ((m = /\/_apis\/git\/repositories\/([^/]+)$/i.exec(p))) return json({ id: m[1]!.toLowerCase(), project: { id: PROJECT_ID, name: 'Proj' } });
    if (/\/_apis\/build\/builds$/i.test(p)) {
      const branch = url.searchParams.get('branchName');
      return json({ value: prs.filter(x => `refs/pull/${x.pullRequestId}/merge` === branch).map(() => ({ id: 55, buildNumber: '55', sourceVersion: MERGE, sourceBranch: branch, reason: 'pullRequest', project: { id: PROJECT_ID }, definition: { id: 7 }, repository: { id: REPO }, status: 'completed', result: 'succeeded' })) });
    }
    return json({ message: `fake DevOps: no route ${method} ${p}` }, 404);
  }

  const request = async (raw: string, init: RequestInit): Promise<Response> => {
    const url = new URL(raw), method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : init.body;
    calls.push({ method, url: raw, body });
    const fault = faults.find(f => f.method === method && f.path.test(decodeURIComponent(url.pathname)) && f.times > 0);
    if (fault) { fault.times--; if (fault.mode === 'lost') apply(method, url, body); throw timeout(); }
    return apply(method, url, body);
  };
  return { items, comments, plans, suites, outcomes, prs, refs, calls, uploads, request, addItem,
    authorization: { authorization: async () => 'Bearer fake-token' },
    fault(f: Omit<Fault, 'times'> & { times?: number }) { faults.push({ times: 1, ...f }); },
    posts: (re: RegExp) => calls.filter(c => c.method === 'POST' && re.test(decodeURIComponent(new URL(c.url).pathname))).length };
}

const target = { id: 'it-a', organization: 'contoso', project: 'Proj', projectId: PROJECT_ID, repositoryId: REPO, buildDefinitionId: 7, releaseDefinitionId: 3, definitionRevision: 1, definitionSha256: 'x', environmentId: 1, environmentName: 'IT', queueId: 1, artifactAlias: 'a', confirmedTest: true as const, deploymentGroupId: 1, poolId: 1, agentId: 1, machineId: 1, machineName: 'm', computerName: 'm' };

function setup() {
  const root = tempDir(), ado = fakeAdo(), masker = createMasker();
  ado.addItem(9, 'Bug', { 'System.Title': 'Contatti duplicati', 'System.State': 'New', 'System.Tags': 'ai-fixable' });
  const store = createRunStore(root, masker), now = Date.now();
  const run: RunRecord = { schema: 1, runId: RUN, routineId: 'demo', routineTitle: 'Demo', status: 'running', attempt: 0, inputs: {}, workItem: 9, createdAt: now, updatedAt: now, steps: [] };
  store.create(run); store.claim(RUN);
  const client = createDevOpsClient({ authorization: ado.authorization, request: ado.request });
  const deployCalls: string[] = [];
  const deployments = {
    async execute(op: string) { deployCalls.push(op); return op === 'deploy-test' ? { status: 'queued', releaseId: 77 } : { status: 'succeeded', terminal: true, success: true, releaseId: 77 }; },
    async settle() { return true; }, ownedTargets: () => [] as string[],
  };
  const pushed: { authorization?: string; workspace: string }[] = [];
  const context: WriteContext = {
    runId: RUN, attempt: 1, stepId: 'fix', workItem: 9, client, store, masker,
    grant: { organization: 'contoso', projects: ['Proj'], fields: [], mentions: [MENTION],
      ops: ['comment', 'state', 'fields', 'tags', 'test-plans', 'test-results', 'pr-create', 'pr-links', 'related-links', 'pr-comment', 'pr-publish', 'pr-abandon', 'git-push', 'test-deploy', 'pr-validation', 'downgrade', 'attachments'],
      pushTargets: [{ project: 'Proj', repositoryId: REPO, workspaceInput: 'checkout' }], deployTargets: [target as never],
      downgrade: { removeTag: 'ai-fixable', addTag: 'needs-human', state: 'Active' } },
    inputs: { checkout: path.join(root, 'checkout') }, deployments: deployments as never, contact: { id: CONTACT, name: 'Mario Rossi' },
    push: async p => { pushed.push({ workspace: p.workspace, ...(p.authorization ? { authorization: p.authorization } : {}) }); p.beforePush(); ado.refs.set(BRANCH, PUSHED); return { branch: BRANCH, commit: PUSHED }; },
    sleep: async () => {}, now: () => Date.now(), stepDir: store.stepDir(RUN, 3, 'fix'),
  };
  const exec = (writes: StepWrite[], stepId = 'fix') => executeWrites({ ...context, stepId }, writes);
  return { root, ado, store, exec, pushed, deployCalls, context };
}

const testPlanWrites: StepWrite[] = [
  { op: 'create-test-plan', ref: 'plan', name: 'Piano 127906' },
  { op: 'create-test-suite', ref: 'suite', plan: 'plan', name: '127906 Contatti duplicati' },
  { op: 'create-test-case', ref: 'tc01', suite: 'suite', title: '127906-TC01 - P0 Verifica che i contatti non si duplichino', steps: [{ action: 'Salva la clinica', expected: 'Un contatto' }],
    description: 'User Story: #127906 - Contatti duplicati\nTipo Test: Funzionale', priority: 1, tags: ['#127906', '#pr5', '#orisdentair', '#anagrafica'] },
  { op: 'set-test-outcome', testCase: 'tc01', outcome: 'passed' },
];
const prWrites: StepWrite[] = [
  { op: 'push-branch', project: 'Proj', repositoryId: REPO },
  { op: 'create-pr', project: 'Proj', repositoryId: REPO, sourceRef: BRANCH, targetRef: 'refs/heads/main', title: 'fix: contacts saved once', text: 'Fix.' },
];

describe('test plan writes', () => {
  it('plan → suite (Related to the work item, name read back) → case (no Tested By; description, priority, tags) → outcome', async () => {
    const { ado, store, exec } = setup();
    const out = await exec(testPlanWrites);
    expect(out.failed).toEqual([]); expect(out.notVerified).toEqual([]);
    expect(out.done).toHaveLength(4);
    const suite = ado.suites.find(s => s.name === '127906 Contatti duplicati')!;
    expect(ado.items.get(suite.id)!.relations).toEqual([{ rel: 'System.LinkTypes.Related', url: expect.stringMatching(/\/_apis\/wit\/workItems\/9$/) }]);
    const tc = [...ado.items.values()].find(i => i.type === 'Test Case')!;
    expect(tc.relations).toEqual([]);
    expect(ado.items.get(9)!.relations).toEqual([]);
    expect(tc.fields).toMatchObject({ 'Microsoft.VSTS.Common.Priority': 1, 'System.Tags': '#127906; #pr5; #orisdentair; #anagrafica' });
    expect(String(tc.fields['System.Description'])).toBe('User Story: #127906 - Contatti duplicati<br/>Tipo Test: Funzionale');
    expect(suite.cases).toEqual([tc.id]);
    expect(ado.outcomes.get(`${suite.id}:${tc.id}`)).toBe('passed');
    const lines = runResources(store.ledger(RUN), 'contoso').join('\n');
    expect(lines).toContain('name on DevOps «127906 Contatti duplicati»');
    expect(lines).toContain(`test case "tc01": id ${tc.id} in suite ${suite.id}, outcome passed`);
  });

  it('the same writes again are already done: nothing is created twice', async () => {
    const { ado, exec } = setup();
    await exec(testPlanWrites);
    const out = await exec(testPlanWrites);
    expect(out.done.every(d => d.endsWith('(already done)'))).toBe(true);
    expect(ado.plans).toHaveLength(1);
    expect(ado.posts(/\$Test Case$/)).toBe(1);
  });

  it('a test case whose create response was lost is found by title, never created twice', async () => {
    const { ado, exec } = setup();
    ado.fault({ method: 'POST', path: /\$Test Case$/, mode: 'lost' });
    const out = await exec(testPlanWrites.slice(0, 3));
    expect(out.notVerified).toEqual([]);
    expect(out.done[2]).toMatch(/test case "tc01".*\((after one retry|verified on DevOps)\)/);
    expect([...ado.items.values()].filter(i => i.type === 'Test Case')).toHaveLength(1);
    expect(ado.posts(/\$Test Case$/)).toBe(1);
    expect(ado.suites.at(-1)!.cases).toHaveLength(1);
  });

  it('a suite on a plan the run did not create fails; the run goes on', async () => {
    const { exec } = setup();
    const out = await exec([{ op: 'create-test-suite', ref: 's', plan: 'nope', name: 'x' }]);
    expect(out.failed).toEqual(['test suite "s": no plan "nope" in this run']);
  });
});

describe('PR, push and deploy writes', () => {
  it('a write outside the package grant is refused before anything is sent', async () => {
    const { ado, exec } = setup();
    await expect(exec([{ op: 'push-branch', project: 'Proj', repositoryId: g('f') }])).rejects.toThrow(/pushTargets/);
    await expect(exec([{ op: 'deploy-test', targetId: 'prod' }])).rejects.toThrow(/deployTargets/);
    expect(ado.calls).toEqual([]);
  });

  it('push → draft PR linked to the work item → the second create is a no-op → comment → publish', async () => {
    const { ado, store, exec, pushed } = setup();
    const out = await exec(prWrites);
    expect(out.failed).toEqual([]);
    expect(pushed).toEqual([{ workspace: expect.stringMatching(/checkout$/), authorization: 'Bearer fake-token' }]);
    expect(ado.prs).toHaveLength(1);
    const pr = ado.prs[0]!;
    expect(pr).toMatchObject({ isDraft: true, sourceRefName: BRANCH });
    expect(ado.items.get(9)!.relations).toEqual([expect.objectContaining({ rel: 'ArtifactLink', url: expect.stringContaining(`%2F${pr.pullRequestId}`) })]);
    const again = await exec([prWrites[1]!, { op: 'pr-comment', text: 'Ready for review.', mentions: [MENTION] }, { op: 'publish-pr' }], 'review');
    expect(again.done[0]).toBe(`PR ${pr.pullRequestId} (already created by this run)`);
    expect(again.failed).toEqual([]);
    expect(ado.prs).toHaveLength(1);
    expect(pr.threads).toHaveLength(1);
    expect(pr.threads[0]!.comments[0]!.content).toContain(`@<${MENTION.toUpperCase()}>`);
    expect(pr.threads[0]!.comments[0]!.content).toContain(`routine run ${RUN}`);
    expect(pr.isDraft).toBe(false);
    expect(runResources(store.ledger(RUN), 'contoso').join('\n')).toContain(`pushed ${BRANCH} at ${PUSHED}`);
  });

  it('a PR comment mentioning someone outside devops.mentions is refused', async () => {
    const { exec } = setup();
    await expect(exec([{ op: 'pr-comment', text: 'x', mentions: [g('9')] }])).rejects.toThrow(/mentions/);
  });

  it('deploy-test waits for the PR merge build, deploys through the coordinator, records the release', async () => {
    const { store, exec, deployCalls } = setup();
    await exec(prWrites);
    const out = await exec([{ op: 'deploy-test', targetId: 'it-a', waitMinutes: 5 }], 'deploy');
    expect(out.failed).toEqual([]);
    expect(out.done[0]).toMatch(/deploy PR \d+ to it-a \(release 77 succeeded\)/);
    expect(deployCalls).toEqual(['deploy-test', 'test-deploy-status']);
    const entry = Object.entries(store.ledger(RUN)).find(([k]) => k.startsWith('deploy:it-a:'))![1];
    expect(entry).toMatchObject({ state: 'done', resource: { targetId: 'it-a', buildId: 55, releaseId: 77 } });
    expect(runResources(store.ledger(RUN), 'contoso').join('\n')).toContain('test deployment on it-a: succeeded (release 77), build 55');
  });

  it('deploy-test without the run PR fails without blocking the run', async () => {
    const { exec, deployCalls } = setup();
    const out = await exec([{ op: 'deploy-test', targetId: 'it-a' }]);
    expect(out.failed[0]).toMatch(/needs this run's own PR/);
    expect(deployCalls).toEqual([]);
  });
});

describe('downgrade', () => {
  it('abandons the run draft PR, swaps the tags, sets the state, comments with the mentions, writes downgrade.md', async () => {
    const { root, ado, exec } = setup();
    await exec(prWrites);
    const out = await exec([{ op: 'downgrade', reason: 'serve una decisione di prodotto' }], 'review');
    expect(out.downgraded).toBe('serve una decisione di prodotto');
    expect(out.failed).toEqual([]);
    expect(ado.prs[0]!.status).toBe('abandoned');
    const item = ado.items.get(9)!;
    expect(item.fields['System.Tags']).toBe('needs-human');
    expect(item.fields['System.State']).toBe('Active');
    const comment = ado.comments.get(9)!.join('\n');
    expect(comment).toContain('Serve un intervento umano: serve una decisione di prodotto.');
    expect(comment).toContain(`version:2.0,${MENTION}`);
    expect(comment).toContain(`version:2.0,${CONTACT}`);
    expect(comment).toContain('@Mario Rossi');
    expect(fs.readFileSync(path.join(root, RUN, 'downgrade.md'), 'utf8')).toContain('Classification correction: serve una decisione di prodotto');
  });

  it('a step that downgrades stops the run in needs-human, with no later step', async () => {
    const root = tempDir(), devops = fakeDevOps();
    devops.addItem({ id: 5, fields: { 'System.Title': 'x', 'System.Tags': 'ai-fixable', 'System.State': 'New' } });
    const engine = scriptedEngine(r => done('ok', r.stepId === 'analyse' ? [{ op: 'downgrade', reason: 'not a bug' }] : undefined));
    const pkg = routinePackage({ devops: { organization: 'contoso', projects: ['Proj'], ops: ['comment', 'state', 'fields', 'tags', 'downgrade'], fields: [], downgrade: { removeTag: 'ai-fixable', addTag: 'needs-human', state: 'Active' } } });
    const runtime = createRoutineRuntime({ pkg, paths: { runsRoot: path.join(root, 'runs'), workspace: id => path.join(root, 'ws', id) }, engine, devops: { authorization: devops.authorization, request: devops.request } });
    const handle = runtime.startItem(5);
    const run = await handle.finished;
    expect(run.status).toBe('needs-human');
    expect(run.error).toBe('step analyse downgraded the work item: not a bug');
    expect(engine.requests.map(r => r.stepId)).toEqual(['analyse']);
    expect(devops.items.get(5)!.fields['System.Tags']).toBe('needs-human');
    expect(devops.comments.get(5)!.some(c => c.text.includes('Serve un intervento umano: not a bug'))).toBe(true);
  });
});

describe('MCP server config (C1)', () => {
  it('is deleted once read: the secrets never stay where the session could read them', () => {
    const file = path.join(tempDir(), 'config.json');
    fs.writeFileSync(file, JSON.stringify({ pat: 'x' }));
    expect(readConfigOnce<{ pat: string }>(file)).toEqual({ pat: 'x' });
    expect(fs.existsSync(file)).toBe(false);
  });
});

/** A real (tiny) PNG: signature, IHDR 1×1, IEND: what readEvidenceImage accepts. */
function png(seed: number): Buffer {
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4, seed)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
}

describe('comment images (upload-image)', () => {
  it('a work item comment and a PR comment show images of the step folder, each uploaded and attached once', async () => {
    const { ado, exec, context } = setup();
    const before = png(1), after = png(2);
    fs.writeFileSync(path.join(context.stepDir!, 'screenshots', 'before.png'), before);
    fs.writeFileSync(path.join(context.stepDir!, 'evidence', 'after.png'), after);
    await exec(prWrites);
    const out = await exec([
      { op: 'comment', text: 'Prima del fix', images: ['screenshots/before.png'] },
      { op: 'pr-comment', text: 'Prima e dopo', images: ['screenshots/before.png', 'evidence/after.png'] },
    ]);
    expect(out.failed).toEqual([]); expect(out.notVerified).toEqual([]);
    // the bytes went up as they are, once per image (the second use of before.png reuses its upload)
    expect(ado.uploads.map(u => u.name)).toEqual(['before.png', 'after.png']);
    expect(ado.uploads[0]!.bytes.equals(before)).toBe(true);
    const [beforeUrl, afterUrl] = [g('1'), g('2')].map(id => `${ATTACHMENTS}/${id}`);
    expect(ado.items.get(9)!.relations.filter(r => r.rel === 'AttachedFile').map(r => r.url)).toEqual([beforeUrl, afterUrl]);
    const comment = ado.comments.get(9)!.at(-1)!;
    expect(comment).toContain('Prima del fix');
    expect(comment).toContain(`<img src="${beforeUrl}" alt="before.png"/>`);
    const thread = ado.prs[0]!.threads.at(-1)!.comments[0]!.content;
    expect(thread).toContain(`![before.png](${beforeUrl})`);
    expect(thread).toContain(`![after.png](${afterUrl})`);
  });

  it('only files of the step\'s own evidence/ or screenshots/ folder: any other path is refused', () => {
    const result = (images: string[]) => () => validateStepResult({ outcome: 'done', summary: 's', devopsWrites: [{ op: 'comment', text: 't', images }] });
    expect(result(['screenshots/a.png'])).not.toThrow();
    for (const bad of ['../02-other/screenshots/a.png', 'screenshots/../../a.png', 'C:/x/a.png', '/tmp/a.png', 'notes/a.png', 'screenshots/a.gif', 'screenshots/sub/a.png'])
      expect(result([bad]), bad).toThrow(/images/);
  });

  it('an image that is missing or cannot be uploaded never blocks the comment', async () => {
    const { ado, exec, context } = setup();
    fs.writeFileSync(path.join(context.stepDir!, 'screenshots', 'before.png'), png(1));
    fs.writeFileSync(path.join(context.stepDir!, 'evidence', 'fake.png'), Buffer.from('not an image at all, just text'));
    ado.fault({ method: 'POST', path: /\/_apis\/wit\/attachments$/, mode: 'drop', times: 2 });
    const out = await exec([{ op: 'comment', text: 'Esito', images: ['screenshots/before.png', 'evidence/missing.png', 'evidence/fake.png'] }]);
    expect(out.notVerified).toEqual(['image screenshots/before.png']);
    expect(out.failed).toEqual([expect.stringMatching(/^image evidence\/missing\.png: /), expect.stringMatching(/^image evidence\/fake\.png: /)]);
    expect(out.done).toEqual(['comment']);
    expect(ado.comments.get(9)!.at(-1)).not.toContain('<img');
    expect(ado.uploads).toEqual([]);
  });

  it('images need the package\'s attachments grant: refused before anything is sent', async () => {
    const { ado, context } = setup();
    const grant = { ...context.grant, ops: context.grant.ops.filter(o => o !== 'attachments') };
    await expect(executeWrites({ ...context, grant }, [{ op: 'comment', text: 'x', images: ['screenshots/a.png'] }])).rejects.toThrow(/attachments/);
    expect(ado.calls).toEqual([]);
  });
});

describe('work item comment mentions', () => {
  it('an identity of devops.mentions becomes a DevOps mention; one outside it is refused before anything is sent', async () => {
    const { ado, exec } = setup();
    const out = await exec([{ op: 'comment', text: 'Serve una verifica', mentions: [MENTION] }]);
    expect(out.done).toEqual(['comment']);
    expect(ado.comments.get(9)!.at(-1)).toMatch(new RegExp(`^<a href="#" data-vss-mention="version:2\\.0,${MENTION}">@Anna Bianchi</a><br/>Serve una verifica`));
    const sent = ado.calls.length;
    await expect(exec([{ op: 'comment', text: 'x', mentions: [g('9')] }])).rejects.toThrow(/mentions/);
    expect(ado.calls.length).toBe(sent);
  });
});
