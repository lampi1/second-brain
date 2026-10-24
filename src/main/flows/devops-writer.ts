// Host-enforced Azure DevOps write adapter for automatic flows (ADR 0145). A bound flow step's chat asks for one
// operation; this module checks it against the user-approved grant (organization, projects, ops, fields), allows only
// the run's own work item and the test plans, suites and cases this run created (a durable ledger), and calls a fixed
// set of REST endpoints with the host Azure CLI token. Never production, never Azure resources, no token in files/logs.
// Used by flows/devops-write-tool.ts; tests inject token and fetch.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DevOpsWriteGrant, DevOpsWriteOp } from '../../shared/flow-automation';
import { devopsToken } from './devops-detector';
import { integer, keys, object, text } from './schema';

export const DEVOPS_WRITE_REQUESTS = ['add-tags', 'remove-tags', 'set-fields', 'comment', 'link-pr', 'create-test-plan', 'rename-test-plan', 'create-test-suite', 'create-test-case', 'set-test-outcome'] as const;
export type DevOpsWriteRequestOp = typeof DEVOPS_WRITE_REQUESTS[number];
/** Which user-approved category each request needs. */
const CATEGORY: Record<DevOpsWriteRequestOp, DevOpsWriteOp> = {
  'add-tags': 'tags', 'remove-tags': 'tags', 'set-fields': 'fields', comment: 'comment', 'link-pr': 'pr-links',
  'create-test-plan': 'test-plans', 'rename-test-plan': 'test-plans', 'create-test-suite': 'test-plans', 'create-test-case': 'test-plans', 'set-test-outcome': 'test-results',
};
const OUTCOMES = ['passed', 'failed', 'blocked', 'notApplicable'] as const;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const TIMEOUT_MS = 60_000, MAX_BYTES = 2 * 1024 * 1024, MAX_RUNS = 500, MAX_PER_RUN = 500;
const API = 'api-version=7.1';

/** What the host resolved for the calling chat: never supplied by the agent. */
export interface DevOpsWriteContext { runId: string; grant: DevOpsWriteGrant; workItemId: number }
interface Plan { project: string; id: number; rootSuiteId: number }
interface Suite { project: string; planId: number; id: number }
interface TestCase { project: string; planId: number; suiteId: number; id: number }
interface Ledger { schema: 1; runs: Record<string, { plans: Plan[]; suites: Suite[]; testCases: TestCase[] }> }
export interface DevOpsWriterOptions {
  /** Brain-scoped ledger file of resources each run created. */
  file: string;
  token?: (signal?: AbortSignal) => Promise<string>;
  request?: (url: string, init: RequestInit) => Promise<Response>;
  audit?: (entry: { runId: string; op: DevOpsWriteRequestOp; target: string }) => void;
}
export class DevOpsWriteError extends Error {}
const deny = (message: string): never => { throw new DevOpsWriteError(message); };
const lower = (s: string): string => s.toLowerCase();
const safeText = (value: unknown, label: string, max: number): string => { const s = text(value, label, max); if (CONTROL.test(s)) deny(`${label}: control characters are not allowed`); return s; };
const id = (value: unknown, label: string): number => integer(value, label, 1, 2_147_483_647);
const html = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '<br/>');

export class DevOpsWriter {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: DevOpsWriterOptions) {}

  /** Validate, authorize and perform one request; returns a short receipt the agent can quote as evidence.
   *  One request at a time, so the created-resources ledger never loses an update. */
  execute(context: DevOpsWriteContext, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const next = this.queue.then(() => this.perform(context, request, signal));
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async perform(context: DevOpsWriteContext, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const raw = object(request, 'request'), op = raw.op as DevOpsWriteRequestOp;
    if (!(DEVOPS_WRITE_REQUESTS as readonly string[]).includes(op)) deny('Unknown DevOps write operation');
    const { grant } = context;
    if (!grant.ops.includes(CATEGORY[op])) deny(`DevOps write "${CATEGORY[op]}" is not enabled for this flow`);
    const controller = new AbortController(), abort = () => controller.abort();
    const timer = setTimeout(abort, TIMEOUT_MS); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      let token: string;
      try { token = await (this.options.token ?? devopsToken)(controller.signal); } catch { return deny('DevOps: Azure CLI login unavailable. Run az login.'); }
      if (typeof token !== 'string' || !token || token.length > 32_768 || /\s/.test(token)) deny('DevOps: Azure CLI login unavailable. Run az login.');
      const call = (method: string, url: string, body?: unknown, contentType = 'application/json') => this.call(token, method, url, body, contentType, controller.signal);
      const org = `https://dev.azure.com/${encodeURIComponent(grant.organization)}`;
      const project = (value: unknown): string => {
        const name = safeText(value, 'project', 128);
        const granted = grant.projects.find(p => lower(p) === lower(name));
        return granted ?? deny('Project is not in the approved DevOps write grant');
      };
      const projectOf = (pathValue: string): string => project(pathValue.replace(/\//g, '\\').split('\\')[0]);
      const ledger = this.read(), mine = ledger.runs[context.runId] ?? { plans: [], suites: [], testCases: [] };
      const plan = (p: string, planId: unknown): Plan => mine.plans.find(item => item.id === id(planId, 'planId') && lower(item.project) === lower(p)) ?? deny('Only test plans created by this run can be changed');
      const suite = (p: string, planId: number, suiteId: unknown): number => {
        const value = id(suiteId, 'suiteId'), owner = plan(p, planId);
        if (owner.rootSuiteId === value || mine.suites.some(item => item.id === value && item.planId === planId)) return value;
        return deny('Only test suites created by this run can be changed');
      };
      /** Refuse before the POST, so a full ledger never leaves an unrecorded resource behind. */
      const room = () => { if (mine.plans.length + mine.suites.length + mine.testCases.length >= MAX_PER_RUN) deny('DevOps write ledger limit reached for this run'); };
      const record = (mutate: (entry: typeof mine) => void) => {
        const fresh = this.read(), entry = fresh.runs[context.runId] ?? { plans: [], suites: [], testCases: [] };
        mutate(entry);
        if (entry.plans.length + entry.suites.length + entry.testCases.length > MAX_PER_RUN) deny('DevOps write ledger limit reached for this run');
        fresh.runs[context.runId] = entry;
        const ids = Object.keys(fresh.runs); for (const old of ids.slice(0, Math.max(0, ids.length - MAX_RUNS))) delete fresh.runs[old];
        this.write(fresh);
      };
      /** The run's own work item, read live: its project must still be in the grant before any write. */
      const workItem = async () => {
        const item = await call('GET', `${org}/_apis/wit/workitems/${context.workItemId}?fields=System.TeamProject,System.Tags&${API}`);
        const fields = object(item.fields, 'work item fields'), rev = item.rev;
        if (item.id !== context.workItemId || !Number.isSafeInteger(rev) || typeof fields['System.TeamProject'] !== 'string') deny('DevOps: unexpected work item response');
        return { project: project(fields['System.TeamProject']), rev: rev as number, tags: typeof fields['System.Tags'] === 'string' ? (fields['System.Tags'] as string).split(';').map(t => t.trim()).filter(Boolean) : [] };
      };
      const patchItem = (patch: unknown[]) => call('PATCH', `${org}/_apis/wit/workitems/${context.workItemId}?${API}`, patch, 'application/json-patch+json');
      const audit = (target: string) => { try { this.options.audit?.({ runId: context.runId, op, target }); } catch { /* audit is best effort */ } };

      switch (op) {
        case 'add-tags': case 'remove-tags': {
          keys(raw, ['op', 'tags'], 'request');
          if (!Array.isArray(raw.tags) || !raw.tags.length || raw.tags.length > 10) deny('tags: 1-10 values');
          const tags = (raw.tags as unknown[]).map(t => { const s = safeText(t, 'tag', 100); if (s.includes(';')) deny('tag: ";" is not allowed'); return s; });
          const item = await workItem();
          const next = op === 'add-tags' ? [...item.tags, ...tags.filter(t => !item.tags.some(x => lower(x) === lower(t)))] : item.tags.filter(x => !tags.some(t => lower(t) === lower(x)));
          await patchItem([{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/fields/System.Tags', value: next.join('; ') }]);
          audit(`workitem:${context.workItemId}`); return { workItemId: context.workItemId, tags: next };
        }
        case 'set-fields': {
          keys(raw, ['op', 'fields'], 'request');
          const fields = object(raw.fields, 'fields'), entries = Object.entries(fields);
          if (!entries.length || entries.length > 10) deny('fields: 1-10 values');
          const patch = entries.map(([name, value]) => {
            const granted = grant.fields.find(f => lower(f) === lower(name)) ?? deny(`Field ${name} is not in the approved DevOps write grant`);
            const v = safeText(value, granted, 1000);
            // A move must stay inside the approved projects: area and iteration paths start with their project.
            if (['system.areapath', 'system.iterationpath'].includes(lower(granted))) projectOf(v);
            return { op: 'add', path: `/fields/${granted}`, value: v };
          });
          const item = await workItem();
          await patchItem([{ op: 'test', path: '/rev', value: item.rev }, ...patch]);
          audit(`workitem:${context.workItemId}`); return { workItemId: context.workItemId, fields: patch.map(p => p.path.slice(8)) };
        }
        case 'comment': {
          keys(raw, ['op', 'text', 'mentions'], 'request');
          const body = text(raw.text, 'text', 10_000);
          if (raw.mentions !== undefined && (!Array.isArray(raw.mentions) || raw.mentions.length > 10)) deny('mentions: at most 10 identity ids');
          const ids = ((raw.mentions as unknown[] | undefined) ?? []).map(value => { const s = lower(safeText(value, 'mention', 36)); if (!GUID.test(s)) deny('mentions must be identity GUIDs'); return s; });
          if (new Set(ids).size !== ids.length) deny('mentions: duplicate identity');
          if (ids.some(v => !(grant.mentions ?? []).includes(v))) deny('Mention is not in the approved DevOps write grant');
          const item = await workItem();
          // the adapter builds each mention itself, the name read from DevOps; the agent's text stays escaped
          const tags: string[] = [];
          for (const identity of ids) {
            const found = await call('GET', `https://vssps.dev.azure.com/${encodeURIComponent(grant.organization)}/_apis/identities?identityIds=${identity}&${API}`);
            const row = Array.isArray(found.value) && found.value.length === 1 ? object(found.value[0], 'identity') : deny('DevOps: mention identity not found');
            const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
            const name = pick(row.customDisplayName) || pick(row.providerDisplayName);
            if (lower(String(row.id)) !== identity || !name || name.length > 256 || CONTROL.test(name)) deny('DevOps: unexpected identity response');
            tags.push(`<a href="#" data-vss-mention="version:2.0,${identity}">@${html(name)}</a>`);
          }
          const result = await call('POST', `${org}/${encodeURIComponent(item.project)}/_apis/wit/workItems/${context.workItemId}/comments?api-version=7.1-preview.4`, { text: `${tags.length ? `${tags.join(' ')}<br/>` : ''}${html(body)}` });
          audit(`workitem:${context.workItemId}`); return { workItemId: context.workItemId, commentId: result.id, ...(ids.length ? { mentions: ids.length } : {}) };
        }
        case 'link-pr': {
          keys(raw, ['op', 'projectId', 'repositoryId', 'pullRequestId'], 'request');
          const projectId = safeText(raw.projectId, 'projectId', 36), repositoryId = safeText(raw.repositoryId, 'repositoryId', 36), pr = id(raw.pullRequestId, 'pullRequestId');
          if (!GUID.test(projectId) || !GUID.test(repositoryId)) deny('projectId and repositoryId must be GUIDs');
          // The PR's project must be in the grant too: resolve its GUID to a name.
          const prProject = await call('GET', `${org}/_apis/projects/${projectId}?${API}`);
          if (typeof prProject.name !== 'string' || lower(String(prProject.id)) !== lower(projectId)) deny('DevOps: unexpected project response');
          project(prProject.name);
          const item = await workItem();
          await patchItem([{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/relations/-', value: { rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/${projectId}%2F${repositoryId}%2F${pr}`, attributes: { name: 'Pull Request' } } }]);
          audit(`workitem:${context.workItemId}`); return { workItemId: context.workItemId, pullRequestId: pr };
        }
        case 'create-test-plan': {
          keys(raw, ['op', 'project', 'name', 'areaPath', 'iteration'], 'request'); room();
          const p = project(raw.project), name = safeText(raw.name, 'name', 256);
          const areaPath = raw.areaPath === undefined ? undefined : safeText(raw.areaPath, 'areaPath', 1000), iteration = raw.iteration === undefined ? undefined : safeText(raw.iteration, 'iteration', 1000);
          for (const value of [areaPath, iteration]) if (value && lower(projectOf(value)) !== lower(p)) deny('Test plan paths must be inside its project');
          const created = await call('POST', `${org}/${encodeURIComponent(p)}/_apis/testplan/plans?${API}`, { name, ...(areaPath ? { areaPath } : {}), ...(iteration ? { iteration } : {}) });
          const planId = id(created.id, 'created plan id'), rootSuiteId = id(object(created.rootSuite, 'root suite').id, 'root suite id');
          record(entry => entry.plans.push({ project: p, id: planId, rootSuiteId }));
          audit(`testplan:${planId}`); return { planId, rootSuiteId };
        }
        case 'rename-test-plan': {
          keys(raw, ['op', 'project', 'planId', 'name'], 'request');
          const p = project(raw.project), owned = plan(p, raw.planId), name = safeText(raw.name, 'name', 256);
          await call('PATCH', `${org}/${encodeURIComponent(p)}/_apis/testplan/plans/${owned.id}?${API}`, { name });
          audit(`testplan:${owned.id}`); return { planId: owned.id, name };
        }
        case 'create-test-suite': {
          keys(raw, ['op', 'project', 'planId', 'parentSuiteId', 'name'], 'request'); room();
          const p = project(raw.project), owned = plan(p, raw.planId), parent = suite(p, owned.id, raw.parentSuiteId), name = safeText(raw.name, 'name', 256);
          const created = await call('POST', `${org}/${encodeURIComponent(p)}/_apis/testplan/Plans/${owned.id}/suites?${API}`, { suiteType: 'staticTestSuite', name, parentSuite: { id: parent } });
          const suiteId = id(created.id, 'created suite id');
          record(entry => entry.suites.push({ project: p, planId: owned.id, id: suiteId }));
          audit(`testsuite:${suiteId}`); return { planId: owned.id, suiteId };
        }
        case 'create-test-case': {
          keys(raw, ['op', 'project', 'planId', 'suiteId', 'title', 'steps'], 'request'); room();
          const p = project(raw.project), owned = plan(p, raw.planId), suiteId = suite(p, owned.id, raw.suiteId), title = safeText(raw.title, 'title', 256);
          if (!Array.isArray(raw.steps) || raw.steps.length > 50) deny('steps: at most 50');
          const steps = (raw.steps as unknown[]).map((value, i) => { const s = object(value, `step ${i + 1}`); keys(s, ['action', 'expected'], 'step'); return { action: text(s.action, 'step action', 4000), expected: s.expected === undefined ? '' : text(s.expected, 'step expected', 4000, true) }; });
          const xml = `<steps id="0" last="${steps.length + 1}">${steps.map((s, i) => `<step id="${i + 2}" type="ValidateStep"><parameterizedString isformatted="true">${html(html(s.action))}</parameterizedString><parameterizedString isformatted="true">${html(html(s.expected))}</parameterizedString><description/></step>`).join('')}</steps>`;
          await workItem(); // the linked work item must still be inside the grant
          const created = await call('POST', `${org}/${encodeURIComponent(p)}/_apis/wit/workitems/$Test%20Case?${API}`, [
            { op: 'add', path: '/fields/System.Title', value: title },
            ...(steps.length ? [{ op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: xml }] : []),
            // "Tests" link to the run's own work item, the only one the test case may reference.
            { op: 'add', path: '/relations/-', value: { rel: 'Microsoft.VSTS.Common.TestedBy-Reverse', url: `${org}/_apis/wit/workItems/${context.workItemId}` } },
          ], 'application/json-patch+json');
          const caseId = id(created.id, 'created test case id');
          record(entry => entry.testCases.push({ project: p, planId: owned.id, suiteId, id: caseId }));
          await call('POST', `${org}/${encodeURIComponent(p)}/_apis/testplan/Plans/${owned.id}/Suites/${suiteId}/TestCase?${API}`, [{ workItem: { id: caseId } }]);
          audit(`testcase:${caseId}`); return { planId: owned.id, suiteId, testCaseId: caseId, linkedTo: context.workItemId };
        }
        case 'set-test-outcome': {
          keys(raw, ['op', 'project', 'planId', 'suiteId', 'testCaseId', 'outcome'], 'request');
          const p = project(raw.project), owned = plan(p, raw.planId), suiteId = suite(p, owned.id, raw.suiteId), caseId = id(raw.testCaseId, 'testCaseId');
          if (!mine.testCases.some(c => c.id === caseId && c.planId === owned.id && c.suiteId === suiteId)) deny('Only test cases created by this run can get results');
          if (!(OUTCOMES as readonly string[]).includes(raw.outcome as string)) deny(`outcome: one of ${OUTCOMES.join(', ')}`);
          const points = await call('GET', `${org}/${encodeURIComponent(p)}/_apis/testplan/Plans/${owned.id}/Suites/${suiteId}/TestPoint?testCaseId=${caseId}&${API}`);
          if (!Array.isArray(points.value) || !points.value.length || points.value.length > 50) deny('DevOps: no test point for this test case');
          const ids = (points.value as unknown[]).map(v => id(object(v, 'test point').id, 'test point id'));
          await call('PATCH', `${org}/${encodeURIComponent(p)}/_apis/testplan/Plans/${owned.id}/Suites/${suiteId}/TestPoint?${API}`, ids.map(pointId => ({ id: pointId, results: { outcome: raw.outcome } })));
          audit(`testcase:${caseId}`); return { testCaseId: caseId, outcome: raw.outcome, points: ids.length };
        }
      }
      return deny('Unknown DevOps write operation');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  private async call(token: string, method: string, url: string, body: unknown, contentType: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const response = await (this.options.request ?? fetch)(url, { method, redirect: 'error', signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': contentType }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if ([203, 401, 403].includes(response.status) || (response.status >= 300 && response.status < 400)) deny('DevOps: Azure CLI login unavailable or no permission. Run az login.');
    if (response.status === 412) deny('DevOps: the work item changed meanwhile; read it again and retry.');
    if (!response.ok) deny(`DevOps: write refused (HTTP ${response.status}).`);
    const source = await response.text();
    if (Buffer.byteLength(source) > MAX_BYTES) deny('DevOps: response too large');
    if (!source.trim()) return {};
    try { return object(JSON.parse(source) as unknown, 'response'); } catch { return deny('DevOps: invalid response'); }
  }
  private read(): Ledger {
    try {
      if (!fs.existsSync(this.options.file)) return { schema: 1, runs: {} };
      const raw = object(JSON.parse(fs.readFileSync(this.options.file, 'utf8')) as unknown, 'ledger');
      if (raw.schema !== 1) throw new Error('schema');
      return { schema: 1, runs: object(raw.runs, 'ledger runs') as Ledger['runs'] };
    } catch { return deny('DevOps write ledger is unreadable; restore it before writing.'); }
  }
  private write(data: Ledger): void {
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
    const temp = `${this.options.file}.${randomUUID()}.tmp`;
    try { const fd = fs.openSync(temp, 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp, this.options.file); }
    finally { try { fs.rmSync(temp, { force: true }); } catch { /* cleanup cannot undo the rename */ } }
  }
}
