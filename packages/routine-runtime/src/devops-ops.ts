// The routine runtime's extended DevOps writes (ADR 0175): test plans, suites, cases and outcomes; the run's own PR
// (create, link, comment, publish, abandon) and related links; the run branch push; the PR validation build; the test
// deployment; and the downgrade that hands the work item back to a person. A session lists them in step-result.json;
// devops.ts `executeWrites` runs them here, one ledger entry each. Behaviour is copied from the app's host writer
// (src/main/flows/devops-writer.ts) and its downgrade cleanup, through the same moved modules (devops-host/).
// A write never blocks the run (owner, 2026-10-27): a lost outcome is re-read on DevOps for that exact effect: present
// -> done; absent -> one retry; unclear -> "not verified". A refusal (HTTP 4xx, a broken precondition) -> "failed".
// Created resources (plan, suite, case, PR, branch, deployment) are kept in the ledger entry's `resource` so later
// writes point at them by the session's ref, and the next prompts list them (`runResources`).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { TestDeployTarget } from '../../../src/shared/flow-automation';
import { DevOpsCallError, commentHtml, html, mentionHtml, type DevOpsClient } from './devops';
import type { RoutineDevOps } from './format';
import type { Masker } from './mask';
import type { LedgerEntry, RunStore } from './run-store';
import type { StepWrite } from './step-result';
import { devopsResource, type OwnedPullRequest, type ResourceLedger } from './devops-host/devops-resources';
import { organizationUrl, readEvidenceImage, type UploadedImage } from './devops-host/devops-content';
import { HostPushPreconditionError, pushRunBranch, runBranch, type HostPush } from './devops-host/git-push';
import { prBuildStatus } from './devops-host/pr-build-status';
import { queuePrValidation, sameArtifact } from './devops-host/pr-validation';
import type { TestDeploymentCoordinator } from './devops-host/test-deployment';
import { NoRemoteEffect } from './devops-host/write-refusal';
import { object } from './devops-host/schema';

const API = 'api-version=7.1';
type Call = DevOpsClient['call'];
export type Deployments = Pick<TestDeploymentCoordinator, 'execute' | 'settle' | 'ownedTargets'>;

export interface ExtendedContext {
  runId: string; attempt: number; stepId: string; workItem: number; project: string;
  grant: RoutineDevOps; client: DevOpsClient; store: RunStore; masker: Masker;
  /** the run's inputs (a push target's workspaceInput names the local checkout) */
  inputs: Record<string, string>;
  /** the run folder (downgrade.md) */
  runDir: string;
  /** the step's own folder: the only place comment images are read from (its evidence/ and screenshots/) */
  stepDir?: string;
  /** the test deployment coordinator (state under the runs root); absent: deploy writes fail */
  deployments?: Deployments;
  /** read-only Azure Resource Manager GET for App Service test targets */
  arm?: (resourceId: string) => Promise<Record<string, unknown>>;
  /** the person a downgrade comment mentions (the escalation contact) */
  contact?: { id: string; name?: string };
  push?: (p: HostPush) => Promise<{ branch: string; commit: string }>;
  /** a parking package (escalation.park): the downgrade parks the run instead of handing it over (see downgrade) */
  park?: ParkStop;
  /** the branch a checkout is on (`refs/heads/...`), undefined when detached or unreadable (tests replace it) */
  headOf?: (workspace: string) => Promise<string | undefined>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** Where a parked run stopped: `n` = the run's park count (its own ledger keys); `position` = "Passo i di n" for the comment. */
export interface ParkStop { n: number; position: string }
export interface ExtendedOutcome { done: string[]; notVerified: string[]; failed: string[]; downgraded?: string; resumeFrom?: string;
  /** a parked downgrade: its comment and whether the run branch was published */
  parked?: { commentId?: number; branch: string; pushed: boolean } }

/** One write as the settle loop sees it: a ledger key, a label, the attempt and the read-back. */
interface Plan {
  key: string; what: string;
  once(t: Tracker): Promise<Partial<LedgerEntry> | void>;
  verify(): Promise<{ seen: 'present'; extra?: Partial<LedgerEntry> } | { seen: 'absent' } | { seen: 'unclear' }>;
}
/** Which calls of an attempt changed something: decides whether a failure is a refusal (nothing applied) or unknown. */
interface Tracker { sent: number; applied: number; refusedLast: boolean; call: Call; progress(resource: LedgerEntry['resource']): void }

const guidOk = (s: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const lower = (s: string) => s.toLowerCase();
const projectOf = (p: string) => p.split('\\')[0]!;

/** The resources the run's ledger holds, by kind, for later writes. */
export function ledgerResources(ledger: Record<string, LedgerEntry>) {
  const of = (prefix: string): ({ ref: string; id: number } & Record<string, string | number | boolean>)[] => Object.entries(ledger)
    .filter(([k, e]) => k.startsWith(prefix) && e.resource && typeof e.resource.id === 'number')
    .map(([k, e]) => ({ ...e.resource!, ref: k.slice(prefix.length), id: e.resource!.id as number }));
  const pr = ledger['pr:create']?.resource;
  return {
    plans: of('test:plan:'), suites: of('test:suite:'), cases: of('test:case:'),
    pr: pr && typeof pr.id === 'number' ? pr as unknown as OwnedPullRequest : undefined,
    pushes: Object.entries(ledger).filter(([k, e]) => k.startsWith('push:') && e.state === 'done' && e.resource).map(([, e]) => e.resource as unknown as { project: string; repositoryId: string; branch: string; commit: string }),
    deployments: Object.entries(ledger).filter(([k, e]) => k.startsWith('deploy:') && e.resource).map(([, e]) => e.resource!),
  };
}

/** The run's DevOps resources as prompt lines (the next steps see ids, names and states). */
export function runResources(ledger: Record<string, LedgerEntry>, organization: string): string[] {
  const r = ledgerResources(ledger), lines: string[] = [];
  for (const p of r.plans) lines.push(`- test plan "${p.ref}": id ${p.id}${p.name ? ` «${p.name}»` : ''} (root suite ${p.rootSuiteId})`);
  for (const s of r.suites) lines.push(`- test suite "${s.ref}": id ${s.id} in plan ${s.planId}${s.name ? `, name on DevOps «${s.name}»` : ''}`);
  for (const c of r.cases) lines.push(`- test case "${c.ref}": id ${c.id} in suite ${c.suiteId}${c.outcome ? `, outcome ${c.outcome}` : ''}`);
  if (r.pr) lines.push(`- this run's PR: ${r.pr.id} (${r.pr.source} -> ${r.pr.target}) https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(r.pr.project)}/_git/${r.pr.repositoryId}/pullrequest/${r.pr.id}`);
  for (const p of r.pushes) lines.push(`- pushed ${p.branch} at ${p.commit}`);
  for (const d of r.deployments) lines.push(`- test deployment on ${d.targetId}: ${d.status}${d.releaseId ? ` (release ${d.releaseId})` : ''}${d.buildId ? `, build ${d.buildId}` : ''}`);
  return lines;
}

/** The writes outside the four work-item ones; `settle` is the shared ledger loop of devops.ts. */
export async function executeExtended(ctx: ExtendedContext, write: Exclude<StepWrite, { op: 'comment' | 'state' | 'fields' | 'tags' }>, key: string,
  settle: (plan: Plan) => Promise<'done' | 'not-verified' | 'failed'>, out: ExtendedOutcome, classic: (write: StepWrite, key: string) => Promise<void>): Promise<void> {
  const { grant, client, masker, store } = ctx;
  const org = `https://dev.azure.com/${encodeURIComponent(grant.organization)}`;
  const ledger = () => store.ledger(ctx.runId);
  const resources = () => ledgerResources(ledger());
  // the images a PR comment of this write shows (uploaded from the step folder just before it)
  let images: UploadedImage[] = [];
  const mine = (): ResourceLedger => { const r = resources(); return { prs: r.pr ? [r.pr] : [], pushes: r.pushes, images }; };
  const inGrant = (project: string) => grant.projects.some(p => lower(p) === lower(project));
  const relations = async (id = ctx.workItem): Promise<Record<string, unknown>[]> => {
    const r = await client.call('GET', `${org}/_apis/wit/workitems/${id}?$expand=relations&${API}`);
    return Array.isArray(r.relations) ? r.relations.map(x => object(x, 'relation')) : [];
  };
  const resourcePorts = (t: Tracker) => ({
    grant: { organization: grant.organization, projects: grant.projects, ops: ['rich-comments', ...grant.ops] as never[], fields: grant.fields, ...(grant.mentions ? { mentions: grant.mentions } : {}) },
    workItemId: ctx.workItem, mine: mine(), call: t.call,
    workItem: async () => {
      const item = await t.call('GET', `${org}/_apis/wit/workitems/${ctx.workItem}?fields=System.TeamProject,System.Tags&${API}`), fields = object(item.fields, 'work item fields');
      if (item.id !== ctx.workItem || !Number.isSafeInteger(item.rev) || typeof fields['System.TeamProject'] !== 'string' || !inGrant(fields['System.TeamProject'])) throw new Error('The run work item left the package projects');
      return { project: fields['System.TeamProject'], rev: item.rev as number, tags: String(fields['System.Tags'] ?? '').split(';').map(s => s.trim()).filter(Boolean) };
    },
    patchItem: (patch: unknown[]) => t.call('PATCH', `${org}/_apis/wit/workitems/${ctx.workItem}?${API}`, patch, 'application/json-patch+json'),
    record: (change: (entry: ResourceLedger) => void) => { const m = mine(); change(m); const pr = m.prs?.[0]; if (pr) t.progress({ ...pr }); },
  });
  const entry = () => ledger()[key];
  const label = (s: string) => masker.mask(s);

  switch (write.op) {
    case 'create-test-plan': {
      const project = write.project ?? ctx.project, name = masker.mask(write.name);
      if (!inGrant(project)) { out.failed.push(`test plan "${write.ref}": project ${project} is outside the package's devops.projects`); return; }
      for (const p of [write.areaPath, write.iteration]) if (p && lower(projectOf(p)) !== lower(project)) { out.failed.push(`test plan "${write.ref}": paths must be inside project ${project}`); return; }
      const list = async () => { const r = await client.call('GET', `${org}/${encodeURIComponent(project)}/_apis/testplan/plans?${API}`); return (Array.isArray(r.value) ? r.value : []).map(v => object(v, 'plan')); };
      const before = async () => { const e = entry(); if (typeof e?.resource?.before === 'string') return e.resource.before.split(',').filter(Boolean).map(Number); return (await list()).map(p => Number(p.id)); };
      let known: number[] | undefined;
      await settle({ key, what: `test plan "${write.ref}" «${label(write.name)}»`,
        async once(t) {
          known ??= await before(); t.progress({ before: known.join(',') });
          const created = await t.call('POST', `${org}/${encodeURIComponent(project)}/_apis/testplan/plans?${API}`, { name, ...(write.areaPath ? { areaPath: write.areaPath } : {}), ...(write.iteration ? { iteration: write.iteration } : {}) });
          return { resource: { id: Number(created.id), rootSuiteId: Number(object(created.rootSuite, 'root suite').id), project, name } };
        },
        async verify() {
          const ids = new Set(known ?? (await before()));
          const fresh = (await list()).filter(p => p.name === name && !ids.has(Number(p.id)));
          if (fresh.length > 1) return { seen: 'unclear' };
          return fresh.length ? { seen: 'present', extra: { resource: { id: Number(fresh[0]!.id), rootSuiteId: Number(object(fresh[0]!.rootSuite, 'root suite').id), project, name } } } : { seen: 'absent' };
        } });
      return;
    }
    case 'rename-test-plan': {
      const plan = resources().plans.find(p => p.ref === write.plan);
      if (!plan) { out.failed.push(`rename test plan "${write.plan}": no plan with that ref in this run`); return; }
      const name = masker.mask(write.name), url = `${org}/${encodeURIComponent(String(plan.project))}/_apis/testplan/plans/${plan.id}?${API}`;
      await settle({ key, what: `rename test plan "${write.plan}" -> «${label(write.name)}»`,
        async once(t) { await t.call('PATCH', url, { name }); },
        async verify() { return (await client.call('GET', url)).name === name ? { seen: 'present' } : { seen: 'absent' }; } });
      return;
    }
    case 'create-test-suite': {
      const plan = resources().plans.find(p => p.ref === write.plan);
      if (!plan) { out.failed.push(`test suite "${write.ref}": no plan "${write.plan}" in this run`); return; }
      const parent = write.parent === undefined ? Number(plan.rootSuiteId) : resources().suites.find(s => s.ref === write.parent && s.planId === plan.id)?.id;
      if (!parent) { out.failed.push(`test suite "${write.ref}": no suite "${write.parent}" in plan "${write.plan}"`); return; }
      const project = String(plan.project), name = masker.mask(write.name);
      const list = async () => { const r = await client.call('GET', `${org}/${encodeURIComponent(project)}/_apis/testplan/Plans/${plan.id}/suites?${API}`); return (Array.isArray(r.value) ? r.value : []).map(v => object(v, 'suite')); };
      const related = `${org}/_apis/wit/workItems/${ctx.workItem}`;
      const linked = async (suiteId: number) => (await relations(suiteId)).some(r => r.rel === 'System.LinkTypes.Related' && lower(String(r.url)).endsWith(`/_apis/wit/workitems/${ctx.workItem}`));
      // the suite name as DevOps holds it, for the next step to compare with the work item's title
      const readName = async (suiteId: number) => { try { const s = await client.call('GET', `${org}/${encodeURIComponent(project)}/_apis/testplan/Plans/${plan.id}/suites/${suiteId}?${API}`); return typeof s.name === 'string' ? s.name : ''; } catch { return ''; } };
      let known: number[] | undefined;
      await settle({ key, what: `test suite "${write.ref}" «${label(write.name)}»`,
        async once(t) {
          let id = entry()?.resource?.id as number | undefined;
          if (!id) {
            known ??= typeof entry()?.resource?.before === 'string' ? String(entry()!.resource!.before).split(',').filter(Boolean).map(Number) : (await list()).map(s => Number(s.id));
            t.progress({ before: known.join(',') });
            const created = await t.call('POST', `${org}/${encodeURIComponent(project)}/_apis/testplan/Plans/${plan.id}/suites?${API}`, { suiteType: 'staticTestSuite', name, parentSuite: { id: parent } });
            id = Number(created.id); t.progress({ id, planId: Number(plan.id), project });
          }
          // a suite is a work item: its Related link points at the run's work item (the test cases reach it through it)
          if (!await linked(id)) await t.call('PATCH', `${org}/_apis/wit/workitems/${id}?${API}`, [{ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Related', url: related } }], 'application/json-patch+json');
          return { resource: { id, planId: Number(plan.id), project, name: await readName(id) } };
        },
        async verify() {
          let id = entry()?.resource?.id as number | undefined;
          if (!id) {
            const ids = new Set(known ?? String(entry()?.resource?.before ?? '').split(',').filter(Boolean).map(Number));
            const fresh = (await list()).filter(s => s.name === name && !ids.has(Number(s.id)));
            if (fresh.length !== 1) return fresh.length ? { seen: 'unclear' } : { seen: 'absent' };
            id = Number(fresh[0]!.id);
            store.setLedger(ctx.runId, ctx.attempt, key, { ...entry()!, resource: { ...entry()!.resource, id, planId: Number(plan.id), project } });
          }
          return await linked(id) ? { seen: 'present', extra: { resource: { id, planId: Number(plan.id), project, name: await readName(id) } } } : { seen: 'absent' };
        } });
      return;
    }
    case 'create-test-case': {
      const suite = resources().suites.find(s => s.ref === write.suite);
      if (!suite) { out.failed.push(`test case "${write.ref}": no suite "${write.suite}" in this run`); return; }
      const project = String(suite.project), title = masker.mask(write.title);
      const steps = write.steps.map(s => ({ action: masker.mask(s.action), expected: masker.mask(s.expected ?? '') }));
      const xml = `<steps id="0" last="${steps.length + 1}">${steps.map((s, i) => `<step id="${i + 2}" type="ValidateStep"><parameterizedString isformatted="true">${html(html(s.action))}</parameterizedString><parameterizedString isformatted="true">${html(html(s.expected))}</parameterizedString><description/></step>`).join('')}</steps>`;
      const suiteUrl = `${org}/${encodeURIComponent(project)}/_apis/testplan/Plans/${suite.planId}/Suites/${suite.id}/TestCase`;
      const inSuite = async (id: number) => { const r = await client.call('GET', `${suiteUrl}?${API}`); return (Array.isArray(r.value) ? r.value : []).some(v => Number(object(object(v, 'suite test case').workItem, 'test case').id) === id); };
      // test cases with this exact title in the project, to tell this run's new one apart after a lost response
      const titled = async () => {
        const r = await client.call('POST', `${org}/${encodeURIComponent(project)}/_apis/wit/wiql?${API}`, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project.replace(/'/g, "''")}' AND [System.WorkItemType] = 'Test Case' AND [System.Title] = '${title.replace(/'/g, "''")}'` });
        return (Array.isArray(r.workItems) ? r.workItems : []).map(w => Number(object(w, 'wiql item').id));
      };
      const before = () => typeof entry()?.resource?.before === 'string' ? String(entry()!.resource!.before).split(',').filter(Boolean).map(Number) : undefined;
      const res = (id: number) => ({ id, suiteId: Number(suite.id), planId: Number(suite.planId), project });
      await settle({ key, what: `test case "${write.ref}" «${label(write.title)}»`,
        async once(t) {
          let id = entry()?.resource?.id as number | undefined;
          if (!id) {
            const known = before() ?? await titled(); t.progress({ before: known.join(',') });
            const created = await t.call('POST', `${org}/${encodeURIComponent(project)}/_apis/wit/workitems/$Test%20Case?${API}`, [
              { op: 'add', path: '/fields/System.Title', value: title },
              ...(steps.length ? [{ op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: xml }] : []),
              ...(write.description ? [{ op: 'add', path: '/fields/System.Description', value: commentHtml(masker.mask(write.description)) }] : []),
              ...(write.priority !== undefined ? [{ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: write.priority }] : []),
              ...(write.tags?.length ? [{ op: 'add', path: '/fields/System.Tags', value: write.tags.join('; ') }] : []),
            ], 'application/json-patch+json');
            id = Number(created.id); t.progress(res(id));
          }
          // no link to the work item: the case reaches it through its suite's Related link
          if (!await inSuite(id)) await t.call('POST', `${suiteUrl}?${API}`, [{ workItem: { id } }]);
          return { resource: res(id) };
        },
        async verify() {
          let id = entry()?.resource?.id as number | undefined;
          if (!id) {
            const known = before(); if (!known) return { seen: 'absent' };
            const fresh = (await titled()).filter(x => !known.includes(x));
            if (fresh.length !== 1) return fresh.length ? { seen: 'unclear' } : { seen: 'absent' };
            id = fresh[0]!;
            store.setLedger(ctx.runId, ctx.attempt, key, { ...entry()!, resource: { ...entry()!.resource, ...res(id) } });
          }
          return await inSuite(id) ? { seen: 'present', extra: { resource: res(id) } } : { seen: 'absent' };
        } });
      return;
    }
    case 'set-test-outcome': {
      const tc = resources().cases.find(c => c.ref === write.testCase);
      if (!tc) { out.failed.push(`test outcome "${write.testCase}": no test case with that ref in this run`); return; }
      const points = `${org}/${encodeURIComponent(String(tc.project))}/_apis/testplan/Plans/${tc.planId}/Suites/${tc.suiteId}/TestPoint`;
      const read = async () => { const r = await client.call('GET', `${points}?testCaseId=${tc.id}&${API}`); return (Array.isArray(r.value) ? r.value : []).map(v => object(v, 'test point')); };
      const caseKey = `test:case:${write.testCase}`;
      await settle({ key, what: `test case "${write.testCase}" -> ${write.outcome}`,
        async once(t) {
          const list = await read(); if (!list.length || list.length > 50) throw new NoRemoteEffect('DevOps: no test point for this test case');
          await t.call('PATCH', `${points}?${API}`, list.map(p => ({ id: Number(p.id), results: { outcome: write.outcome } })));
          const c = ledger()[caseKey]; if (c) store.setLedger(ctx.runId, ctx.attempt, caseKey, { ...c, resource: { ...c.resource, outcome: write.outcome } });
        },
        async verify() {
          const list = await read();
          return list.length && list.every(p => lower(String(object(p.results ?? {}, 'point results').outcome ?? '')) === lower(write.outcome)) ? { seen: 'present' } : { seen: 'absent' };
        } });
      return;
    }
    case 'tag-test-case': {
      // tags a test case of this run after its creation (e.g. #pr<n> once the PR exists); existing tags are kept
      const tc = resources().cases.find(c => c.ref === write.testCase);
      if (!tc) { out.failed.push(`test case tags "${write.testCase}": no test case with that ref in this run`); return; }
      const url = `${org}/_apis/wit/workitems/${tc.id}?${API}`;
      const read = async () => { const item = await client.call('GET', `${org}/_apis/wit/workitems/${tc.id}?fields=System.Tags&${API}`); return { rev: item.rev as number, tags: String(object(item.fields ?? {}, 'test case fields')['System.Tags'] ?? '').split(';').map(s => s.trim()).filter(Boolean) }; };
      const missing = (tags: string[]) => write.add.filter(a => !tags.some(t => lower(t) === lower(a)));
      await settle({ key, what: `test case "${write.testCase}" tags +${write.add.join(',')}`,
        async once(t) {
          const now = await read(), add = missing(now.tags);
          if (add.length) await t.call('PATCH', url, [{ op: 'test', path: '/rev', value: now.rev }, { op: 'add', path: '/fields/System.Tags', value: [...now.tags, ...add].join('; ') }], 'application/json-patch+json');
        },
        async verify() { return missing((await read()).tags).length ? { seen: 'absent' } : { seen: 'present' }; } });
      return;
    }
    case 'link-pr': case 'relate-pr': {
      const artifact = `vstfs:///Git/PullRequestId/${write.projectId}/${write.repositoryId}/${write.pullRequestId}`;
      const present = async () => (await relations()).some(r => r.rel === 'ArtifactLink' && sameArtifact(r.url, artifact));
      await settle({ key, what: `${write.op === 'link-pr' ? 'link' : 'relate'} PR ${write.pullRequestId}`,
        async once(t) {
          if (await present()) return; // create-pr already linked it, or a previous attempt did
          if (write.op === 'relate-pr') { await devopsResource({ ...write }, resourcePorts(t)); return; }
          const project = await t.call('GET', `${org}/_apis/projects/${write.projectId}?${API}`);
          if (typeof project.name !== 'string' || lower(String(project.id)) !== write.projectId || !inGrant(project.name)) throw new NoRemoteEffect('The PR project is outside the package projects');
          const item = await resourcePorts(t).workItem();
          await t.call('PATCH', `${org}/_apis/wit/workitems/${ctx.workItem}?${API}`, [{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/relations/-', value: { rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/${write.projectId}%2F${write.repositoryId}%2F${write.pullRequestId}`, attributes: { name: 'Pull Request' } } }], 'application/json-patch+json');
        },
        async verify() { return await present() ? { seen: 'present' } : { seen: 'absent' }; } });
      return;
    }
    case 'relate-work-item': {
      if (write.relatedWorkItemId === ctx.workItem) { out.failed.push('relate work item: not to itself'); return; }
      const present = async () => (await relations()).some(r => r.rel === 'System.LinkTypes.Related' && lower(String(r.url)).endsWith(`/_apis/wit/workitems/${write.relatedWorkItemId}`));
      await settle({ key, what: `relate work item ${write.relatedWorkItemId}`,
        async once(t) { if (!await present()) await devopsResource({ ...write }, resourcePorts(t)); },
        async verify() { return await present() ? { seen: 'present' } : { seen: 'absent' }; } });
      return;
    }
    case 'create-pr': {
      const prKey = 'pr:create', existing = resources().pr;
      if (existing && ledger()[prKey]?.state === 'done') { out.done.push(`PR ${existing.id} (already created by this run)`); return; }
      const artifactOf = (pr: OwnedPullRequest) => `vstfs:///Git/PullRequestId/${pr.projectId}/${pr.repositoryId}/${pr.id}`;
      const linkPr = async (t: Tracker, pr: OwnedPullRequest) => {
        if ((await relations()).some(r => r.rel === 'ArtifactLink' && sameArtifact(r.url, artifactOf(pr)))) return;
        const item = await resourcePorts(t).workItem();
        await t.call('PATCH', `${org}/_apis/wit/workitems/${ctx.workItem}?${API}`, [{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/relations/-', value: { rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/${pr.projectId}%2F${pr.repositoryId}%2F${pr.id}`, attributes: { name: 'Pull Request' } } }], 'application/json-patch+json');
      };
      const find = async (): Promise<OwnedPullRequest | undefined | 'many'> => {
        const r = await client.call('GET', `${org}/${encodeURIComponent(write.project)}/_apis/git/repositories/${write.repositoryId}/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(write.sourceRef)}&searchCriteria.targetRefName=${encodeURIComponent(write.targetRef)}&searchCriteria.status=all&${API}`);
        const hits = (Array.isArray(r.value) ? r.value : []).map(v => object(v, 'PR')).filter(p => p.title === masker.mask(write.title));
        if (hits.length > 1) return 'many';
        if (!hits.length) return undefined;
        const p = hits[0]!, repo = object(p.repository, 'PR repository'), project = object(repo.project, 'PR project');
        return { project: write.project, projectId: lower(String(project.id)), repositoryId: write.repositoryId, id: Number(p.pullRequestId), source: write.sourceRef, target: write.targetRef };
      };
      await settle({ key: prKey, what: `PR «${label(write.title)}»`,
        async once(t) {
          const known = resources().pr;
          if (known) { await linkPr(t, known); return { resource: { ...known } }; }
          await devopsResource({ ...write, title: masker.mask(write.title), text: masker.mask(write.text) }, resourcePorts(t));
          const pr = resources().pr; return pr ? { resource: { ...pr } } : undefined;
        },
        async verify() {
          const pr = resources().pr ?? await find();
          if (pr === 'many') return { seen: 'unclear' };
          if (!pr) return { seen: 'absent' };
          if (!resources().pr) store.setLedger(ctx.runId, ctx.attempt, prKey, { ...entry() ?? { state: 'writing', what: 'PR', at: ctx.now(), tries: 1 }, resource: { ...pr } });
          return (await relations()).some(r => r.rel === 'ArtifactLink' && sameArtifact(r.url, artifactOf(pr))) ? { seen: 'present', extra: { resource: { ...pr } } } : { seen: 'absent' };
        } });
      return;
    }
    case 'pr-comment': {
      const pr = resources().pr;
      if (!pr) { out.failed.push('PR comment: this run has no PR'); return; }
      for (const m of write.mentions ?? []) if (!(grant.mentions ?? []).includes(m)) { out.failed.push(`PR comment: mention ${m} is not in the package's devops.mentions`); return; }
      const marker = `routine run ${ctx.runId} · ${key.slice(0, 12)}`;
      const threads = `${org}/${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repositoryId}/pullrequests/${pr.id}/threads?${API}`;
      if (write.images?.length && ledger()[key]?.state !== 'done') images = await uploadImages(ctx, write.images, settle, out);
      const body = prCommentBody(masker.mask(write.text), images);
      await settle({ key, what: `PR ${pr.id} comment`,
        async once(t) { await devopsResource({ op: 'pr-comment', pullRequestId: pr.id, text: `${body}\n\n${marker}`, ...(write.mentions ? { mentions: write.mentions } : {}) }, resourcePorts(t)); },
        async verify() {
          const r = await client.call('GET', threads);
          return (Array.isArray(r.value) ? r.value : []).some(th => (Array.isArray(object(th, 'thread').comments) ? (object(th, 'thread').comments as unknown[]) : []).some(c => String(object(c, 'comment').content ?? '').includes(marker))) ? { seen: 'present' } : { seen: 'absent' };
        } });
      return;
    }
    case 'publish-pr': case 'abandon-pr': {
      const pr = resources().pr;
      if (!pr) { out.failed.push(`${write.op}: this run has no PR`); return; }
      const url = `${org}/${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repositoryId}/pullrequests/${pr.id}?${API}`;
      await settle({ key, what: `${write.op === 'publish-pr' ? 'publish' : 'abandon'} PR ${pr.id}`,
        async once(t) { await devopsResource({ op: write.op, pullRequestId: pr.id }, resourcePorts(t)); },
        async verify() { const live = await client.call('GET', url); return (write.op === 'publish-pr' ? live.isDraft === false && live.status === 'active' : live.status === 'abandoned' || live.isDraft === false) ? { seen: 'present' } : { seen: 'absent' }; } });
      return;
    }
    case 'push-branch': {
      const target = grant.pushTargets?.find(t => t.repositoryId === write.repositoryId && lower(t.project) === lower(write.project));
      const workspace = target ? ctx.inputs[target.workspaceInput] : undefined;
      if (!target || !workspace) { out.failed.push(`push branch: ${target ? `input "${target.workspaceInput}" (the local checkout) is empty` : 'repository outside the package\'s devops.pushTargets'}`); return; }
      if (resources().pushes.some(p => p.repositoryId !== write.repositoryId)) { out.failed.push('push branch: a run publishes only one repository'); return; }
      const branch = runBranch(ctx.runId), pushKey = `push:${key}`;
      const refUrl = `${org}/${encodeURIComponent(write.project)}/_apis/git/repositories/${write.repositoryId}/refs?filter=${encodeURIComponent(branch.slice(5))}&${API}`;
      const live = async () => { const refs = await client.call('GET', refUrl); return (Array.isArray(refs.value) ? refs.value : []).map(v => object(v, 'git ref')).find(r => r.name === branch); };
      await settle({ key: pushKey, what: `push ${branch}`,
        async once(t) {
          const repository = await t.call('GET', `${org}/${encodeURIComponent(write.project)}/_apis/git/repositories/${write.repositoryId}?${API}`);
          if (lower(String(repository.id)) !== write.repositoryId || lower(String(object(repository.project, 'repository project').name)) !== lower(write.project)) throw new NoRemoteEffect('Repository is outside the exact project');
          const previous = resources().pushes.filter(p => p.repositoryId === write.repositoryId).at(-1), now = await live();
          if (now && (!previous || now.objectId !== previous.commit)) throw new NoRemoteEffect('The run branch already exists or was changed outside this run');
          const authorization = await client.authorization();
          const result = await (ctx.push ?? pushRunBranch)({ workspace, runId: ctx.runId, ...(write.commit ? { commit: write.commit } : {}), organization: grant.organization, project: write.project, repositoryId: write.repositoryId, authorization,
            beforePush: () => { t.sent++; }, authorize: () => {}, signal: AbortSignal.timeout(10 * 60_000) });
          if (result.branch !== branch || !/^[a-f0-9]{40,64}$/.test(result.commit)) throw new Error('Unexpected host push receipt');
          t.applied++;
          return { resource: { project: write.project, repositoryId: write.repositoryId, branch, commit: result.commit } };
        },
        async verify() {
          const ref = await live();
          return ref ? { seen: 'present', extra: { resource: { project: write.project, repositoryId: write.repositoryId, branch, commit: String(ref.objectId) } } } : { seen: 'absent' };
        } });
      return;
    }
    case 'queue-pr-validation': case 'deploy-test': case 'cancel-test-deploy': {
      const target = grant.deployTargets?.find(t => t.id === write.targetId);
      if (!target) { out.failed.push(`${write.op}: target ${write.targetId} is not in the package's devops.deployTargets`); return; }
      if (write.op === 'cancel-test-deploy') { await cancelDeploy(ctx, target, key, settle, out); return; }
      const src = await prSource(ctx, target, client.call).catch((e: unknown) => e instanceof Error ? e : new Error(String(e)));
      if (src instanceof Error) { out.failed.push(`${write.op}: ${masker.mask(src.message)}`); return; }
      if (write.op === 'queue-pr-validation') {
        await settle({ key, what: `queue PR ${src.pr.id} validation on ${target.id}`,
          async once(t) { const r = await queuePrValidation(target, src.pr, src.source.commit, t.call, src.verifySource); return { resource: { status: String(r.status) } }; },
          async verify() { const r = await prBuildStatus(target, { commit: src.source.commit, pullRequestId: src.pr.id }, client.call, src.verifySource); return ['queued', 'running', 'succeeded'].includes(String(r.status)) ? { seen: 'present' } : { seen: 'absent' }; } });
        return;
      }
      await deploy(ctx, target, src, write.waitMinutes ?? 60, key, out);
      return;
    }
    case 'downgrade': {
      out.downgraded = masker.mask(write.reason);
      if (write.resumeFrom) out.resumeFrom = write.resumeFrom;
      await downgrade(ctx, write.reason, settle, out, classic);
      return;
    }
  }
}

/** The run's own PR for a deploy target, its live merge commit, and the check that the merge build is still current
 *  (copied from the host writer: same project and repository, active, merge succeeded, source pushed by this run). */
async function prSource(ctx: ExtendedContext, target: TestDeployTarget, call: Call) {
  const org = `https://dev.azure.com/${encodeURIComponent(ctx.grant.organization)}`;
  const r = ledgerResources(ctx.store.ledger(ctx.runId)), pr = r.pr;
  if (!pr || pr.repositoryId !== target.repositoryId || pr.projectId !== target.projectId || lower(pr.project) !== lower(target.project)) throw new Error('needs this run\'s own PR in the target\'s project and repository');
  const prUrl = `${org}/${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repositoryId}/pullrequests/${pr.id}?${API}`;
  const live = await call('GET', prUrl);
  if (live.pullRequestId !== pr.id || live.sourceRefName !== pr.source || live.targetRefName !== pr.target || lower(String(object(live.repository, 'PR repository').id)) !== pr.repositoryId || live.status !== 'active') throw new Error('the run PR identity changed');
  if (live.mergeStatus !== 'succeeded') throw new Error('the run PR merge is not ready (merge status not succeeded)');
  const source = { repositoryId: pr.repositoryId, commit: String(object(live.lastMergeCommit, 'PR merge commit').commitId), branch: `refs/pull/${pr.id}/merge`, pullRequestId: pr.id };
  const verifySource = async () => {
    const refs = async (filter: string) => { const x = await call('GET', `${org}/${encodeURIComponent(pr.project)}/_apis/git/repositories/${pr.repositoryId}/refs?filter=${encodeURIComponent(filter)}&${API}`); return Array.isArray(x.value) ? x.value.map(v => object(v, 'ref')) : []; };
    const branchRef = (await refs(pr.source.slice(5))).find(x => x.name === pr.source), mergeRef = (await refs(`pull/${pr.id}/merge`)).find(x => x.name === source.branch);
    const fresh = await call('GET', prUrl), published = r.pushes.filter(p => p.repositoryId === pr.repositoryId).at(-1);
    if (fresh.mergeStatus !== 'succeeded' || !branchRef || !mergeRef || mergeRef.objectId !== source.commit || object(fresh.lastMergeSourceCommit, 'PR source commit').commitId !== branchRef.objectId || (ctx.grant.ops.includes('git-push') && (!published || published.commit !== branchRef.objectId))) throw new NoRemoteEffect('The PR merge build is stale relative to the run source branch');
    if (fresh.pullRequestId !== pr.id || fresh.status !== 'active' || fresh.sourceRefName !== pr.source || fresh.targetRefName !== pr.target || object(fresh.lastMergeCommit, 'PR merge commit').commitId !== source.commit) throw new NoRemoteEffect('The run PR merge identity changed before deployment');
  };
  return { pr, source, verifySource };
}

const deployPorts = (ctx: ExtendedContext, call: Call, extra: Partial<Parameters<Deployments['execute']>[3]> = {}) => ({ runId: ctx.runId, authorize: () => {}, call: (m: string, u: string, b?: unknown) => call(m, u, b), ...(ctx.arm ? { arm: ctx.arm } : {}), ...extra });

/** deploy-test: waits for the PR's merge build, deploys it through the coordinator, waits for the deployment. */
async function deploy(ctx: ExtendedContext, target: TestDeployTarget, src: Awaited<ReturnType<typeof prSource>>, waitMinutes: number, key: string, out: ExtendedOutcome): Promise<void> {
  const deployKey = `deploy:${target.id}:${key}`, what = `deploy PR ${src.pr.id} to ${target.id}`;
  const prior = ctx.store.ledger(ctx.runId)[deployKey];
  if (prior?.state === 'done') { out.done.push(`${what} (already done)`); return; }
  if (prior?.state === 'failed') { out.failed.push(what); return; }
  if (!ctx.deployments) { out.failed.push(`${what}: this host has no test deployment coordinator`); return; }
  const save = (state: LedgerEntry['state'], resource: LedgerEntry['resource']) => ctx.store.setLedger(ctx.runId, ctx.attempt, deployKey, { state, what, at: ctx.now(), tries: 1, resource: { targetId: target.id, ...resource } });
  const until = ctx.now() + waitMinutes * 60_000;
  let release = typeof prior?.resource?.releaseId === 'number' ? prior.resource.releaseId : undefined, buildId = typeof prior?.resource?.buildId === 'number' ? prior.resource.buildId : undefined;
  if (!release && prior?.state !== 'writing') {
    // the merge build first (the session cannot poll between its end and this write)
    for (;;) {
      const b = await prBuildStatus(target, { commit: src.source.commit, pullRequestId: src.pr.id }, ctx.client.call, src.verifySource).catch((e: unknown) => ({ status: 'error', error: e instanceof Error ? e.message : String(e) }) as Record<string, unknown>);
      if (b.status === 'succeeded') { buildId = Number(b.buildId); break; }
      if (b.status === 'failed' || b.status === 'canceled') { save('failed', { status: `PR build ${String(b.status)}`, buildId: Number(b.buildId) }); out.failed.push(`${what}: the PR build ${String(b.status)}`); return; }
      if (b.status === 'error') { out.failed.push(`${what}: ${ctx.masker.mask(String(b.error))}`); return; }
      if (ctx.now() >= until) { out.notVerified.push(`${what}: the PR build is still ${String(b.status)} after ${waitMinutes} minutes, nothing deployed`); return; }
      await ctx.sleep(60_000);
    }
    save('writing', { status: 'requested', buildId });
    try {
      const r = await ctx.deployments.execute('deploy-test', target, buildId, deployPorts(ctx, ctx.client.call, { source: src.source, verifySource: src.verifySource }));
      release = Number(r.releaseId) || undefined;
      save('writing', { status: String(r.status), buildId, ...(release ? { releaseId: release } : {}) });
    } catch (e) {
      const message = ctx.masker.mask(e instanceof Error ? e.message : String(e));
      if (e instanceof NoRemoteEffect || !(e instanceof DevOpsCallError) && !/unknown|uncertain/i.test(message)) { save('failed', { status: `refused: ${message}`, buildId }); out.failed.push(`${what}: ${message}`); return; }
      // lost outcome: the coordinator keeps its lease; the status read below settles it
    }
  }
  for (;;) {
    let s: Record<string, unknown>;
    try { s = await ctx.deployments.execute('test-deploy-status', target, undefined, deployPorts(ctx, ctx.client.call), release); }
    catch (e) { save('not-verified', { status: 'unknown', ...(buildId ? { buildId } : {}) }); out.notVerified.push(`${what}: ${ctx.masker.mask(e instanceof Error ? e.message : String(e))}`); return; }
    release ??= Number(s.releaseId) || undefined;
    const base = { status: String(s.status), ...(buildId ? { buildId } : {}), ...(release ? { releaseId: release } : {}) };
    if (s.terminal === true) {
      if (s.success === true) { save('done', base); out.done.push(`${what} (release ${release ?? '?'} succeeded)`); }
      else { save('failed', base); out.failed.push(`${what}: deployment ${String(s.status)}`); }
      return;
    }
    if (ctx.now() >= until) { save('not-verified', base); out.notVerified.push(`${what}: still ${String(s.status)} after ${waitMinutes} minutes`); return; }
    await ctx.sleep(30_000);
  }
}

async function cancelDeploy(ctx: ExtendedContext, target: TestDeployTarget, key: string, settle: (plan: Plan) => Promise<'done' | 'not-verified' | 'failed'>, out: ExtendedOutcome): Promise<void> {
  if (!ctx.deployments) { out.failed.push(`cancel deployment on ${target.id}: this host has no test deployment coordinator`); return; }
  const status = () => ctx.deployments!.execute('test-deploy-status', target, undefined, deployPorts(ctx, ctx.client.call));
  await settle({ key, what: `cancel deployment on ${target.id}`,
    async once(t) {
      const s = await status(); if (s.terminal === true) return { resource: { status: String(s.status) } };
      await ctx.deployments!.execute('cancel-test-deploy', target, undefined, deployPorts(ctx, t.call), Number(s.releaseId));
      return { resource: { status: String((await status()).status) } };
    },
    async verify() { const s = await status(); return s.terminal === true || s.status === 'cancellation-requested' ? { seen: 'present' } : { seen: 'absent' }; } });
}

/** The comment a downgrade leaves (the app's text, Italian like its other routine comments). */
export const needsHumanComment = (reason: string): string => `Serve un intervento umano: ${reason}. La routine si è fermata; segue la pulizia automatica.`;

/** The one comment of a parked run (Italian, for its contact): why, then only the step number (owner, 2026-10-28). */
export const parkComment = (reason: string, park: ParkStop): string => [
  `Serve il tuo aiuto: ${reason.trim().replace(/[.\s]+$/, '')}.`,
  `${park.position}.`,
].join('\n');

/** Publishes the run branch before a park when a push target's checkout is on it (fast-forward, like push-branch).
 *  Detached or another branch: nothing to publish yet (an analysis lives in the run folder, kept for the resume). */
async function pushParked(ctx: ExtendedContext, scope: string, settle: (plan: Plan) => Promise<'done' | 'not-verified' | 'failed'>, out: ExtendedOutcome, classic: (write: StepWrite, key: string) => Promise<void>): Promise<{ branch: string; pushed: boolean }> {
  const branch = runBranch(ctx.runId), name = branch.slice('refs/heads/'.length);
  if (!ctx.grant.ops.includes('git-push')) return { branch: name, pushed: false };
  const headOf = ctx.headOf ?? gitHead;
  for (const target of ctx.grant.pushTargets ?? []) {
    const workspace = ctx.inputs[target.workspaceInput];
    if (!workspace || await headOf(workspace) !== branch) continue;
    const key = `${scope}:push`;
    await executeExtended(ctx, { op: 'push-branch', project: target.project, repositoryId: target.repositoryId }, key, settle, out, classic);
    const state = ctx.store.ledger(ctx.runId)[`push:${key}`]?.state;
    return { branch: name, pushed: state === 'done' };
  }
  return { branch: name, pushed: false };
}

/** `refs/heads/...` of a checkout's HEAD; undefined when detached or unreadable (read only, no credentials). */
const gitHead = (workspace: string): Promise<string | undefined> => new Promise(resolve => execFile('git', ['-C', workspace, 'symbolic-ref', '--quiet', 'HEAD'],
  { timeout: 30_000, windowsHide: true, encoding: 'utf8' }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined)));

/** The downgrade, as the app's cleanup did it: the run's draft PR abandoned and its test deployment ended, the reason
 *  kept in downgrade.md, then the package's tag removed, its tag added, its state set, a comment for a person; each
 *  phase one ledger entry, so a resumed run continues where it stopped. */
async function downgrade(ctx: ExtendedContext, reason: string, settle: (plan: Plan) => Promise<'done' | 'not-verified' | 'failed'>, out: ExtendedOutcome, classic: (write: StepWrite, key: string) => Promise<void>): Promise<void> {
  const policy = ctx.grant.downgrade!, park = ctx.park;
  // each park of a run has its own ledger keys: a run parked, answered and parked again writes again
  const scope = park ? `downgrade:p${park.n}` : 'downgrade';
  const cleanup = async (phase: string) => {
    // a parked run keeps its draft PR: the answered run goes on with it; its test deployment ends (others need it)
    const pr = park ? undefined : ledgerResources(ctx.store.ledger(ctx.runId)).pr;
    if (pr) await executeExtended(ctx, { op: 'abandon-pr' }, `${scope}:${phase}:abandon-pr`, settle, out, classic);
    for (const targetId of ctx.deployments?.ownedTargets(ctx.runId) ?? []) {
      const target = ctx.grant.deployTargets?.find(t => t.id === targetId);
      if (target) await cancelDeploy(ctx, target, `${scope}:${phase}:cancel:${targetId}`, settle, out);
    }
    if (ctx.deployments && !await ctx.deployments.settle(ctx.runId, () => {}).catch(() => false)) out.notVerified.push('test deployment still active or uncertain: its lease is kept');
  };
  await cleanup('before');
  fs.mkdirSync(ctx.runDir, { recursive: true });
  fs.writeFileSync(path.join(ctx.runDir, 'downgrade.md'), ctx.masker.mask(`# Downgrade\n\nClassification correction: ${reason}\nRun: ${ctx.runId}; step: ${ctx.stepId}. Evidence for a future reviewed routine update, not an automatic rule.\n`));
  const pushed = park ? await pushParked(ctx, scope, settle, out, classic) : undefined;
  await classic({ op: 'tags', remove: [policy.removeTag] }, `${scope}:remove-tag`);
  await classic({ op: 'tags', add: [policy.addTag] }, `${scope}:add-tag`);
  await classic({ op: 'state', state: policy.state }, `${scope}:state`);
  const marker = park ? `routine run ${ctx.runId} · park ${park.n} ·` : `routine run ${ctx.runId} · downgrade`;
  // a parked run talks only to its contact (owner, 2026-10-28: the bug comment mentions only the contact)
  const mentions = park && ctx.contact ? [ctx.contact.id] : [...new Set([...(ctx.grant.mentions ?? []), ...(ctx.contact ? [ctx.contact.id] : [])])];
  const text = park ? parkComment(reason, park) : needsHumanComment(reason);
  await settle({ key: `${scope}:comment`, what: 'downgrade comment',
    async once(t) {
      const tags = mentions.map(id => mentionHtml(id, id === ctx.contact?.id ? ctx.contact.name : undefined)).join(' ');
      const r = await t.call('POST', `https://dev.azure.com/${encodeURIComponent(ctx.grant.organization)}/${encodeURIComponent(ctx.project)}/_apis/wit/workItems/${ctx.workItem}/comments?api-version=7.1-preview.4`,
        { text: `${tags ? `${tags}<br/>` : ''}${commentHtml(ctx.masker.mask(text))}<br/><small>${html(marker)}</small>` });
      return typeof r.id === 'number' ? { commentId: r.id } : undefined;
    },
    async verify() {
      const found = (await ctx.client.comments(ctx.grant.organization, ctx.project, ctx.workItem)).find(c => c.text.includes(marker));
      return found ? { seen: 'present', extra: { commentId: found.id } } : { seen: 'absent' };
    } });
  if (park && pushed) {
    const commentId = ctx.store.ledger(ctx.runId)[`${scope}:comment`]?.commentId;
    out.parked = { branch: pushed.branch, pushed: pushed.pushed, ...(typeof commentId === 'number' ? { commentId } : {}) };
  }
  await cleanup('after');
}

type ImageContext = Pick<ExtendedContext, 'runId' | 'workItem' | 'project' | 'grant' | 'client' | 'store' | 'masker' | 'stepDir'>;

/** upload-image, ported from the host writer: each PNG/JPEG of the step's own folder (evidence/ or screenshots/) is
 *  uploaded once per run (ledger key = its content hash), then attached to the work item. A file that cannot be read or
 *  uploaded is listed, never blocks: the comment goes out without it. Returns the images the comment may show. */
export async function uploadImages(ctx: ImageContext, files: readonly string[], settle: (plan: Plan) => Promise<'done' | 'not-verified' | 'failed'>, out: ExtendedOutcome): Promise<UploadedImage[]> {
  const org = `https://dev.azure.com/${encodeURIComponent(ctx.grant.organization)}`, images: UploadedImage[] = [];
  const itemUrl = `${org}/_apis/wit/workitems/${ctx.workItem}?$expand=relations&${API}`;
  const attached = async (call: Call, url: string) => {
    const item = await call('GET', itemUrl), rels = Array.isArray(item.relations) ? item.relations.map(x => object(x, 'relation')) : [];
    return { rev: item.rev, present: rels.some(r => r.rel === 'AttachedFile' && lower(String(r.url)) === lower(url)) };
  };
  for (const file of files) {
    let img: ReturnType<typeof readEvidenceImage>;
    try {
      const [folder, name] = file.split('/');
      if (!ctx.stepDir || (folder !== 'evidence' && folder !== 'screenshots') || !name) throw new Error('only evidence/ or screenshots/ of this step');
      // the real path: readEvidenceImage refuses a folder reached through a link (Windows short names included)
      img = readEvidenceImage(fs.realpathSync.native(path.join(ctx.stepDir, folder)), name);
    } catch (e) { out.failed.push(`image ${file}: ${ctx.masker.mask(e instanceof Error ? e.message : String(e)).slice(0, 200)}`); continue; }
    const key = `image:${img.sha256}`, ledger = () => ctx.store.ledger(ctx.runId);
    if (!ledger()[key] && Object.keys(ledger()).filter(k => k.startsWith('image:')).length >= 50) { out.failed.push(`image ${file}: run attachment limit reached`); continue; }
    const uploaded = () => { const r = ledger()[key]?.resource; return typeof r?.url === 'string' && typeof r.id === 'string' ? { id: r.id, url: r.url, sha256: img.sha256, name: img.name } : undefined; };
    await settle({ key, what: `image ${file}`,
      async once(t) {
        let image = uploaded();
        if (!image) {
          const result = await t.call('POST', `${org}/${encodeURIComponent(ctx.project)}/_apis/wit/attachments?fileName=${encodeURIComponent(img.name)}&uploadType=Simple&${API}`, img.data, 'application/octet-stream');
          const id = String(result.id ?? '').toLowerCase(), url = organizationUrl(String(result.url ?? ''), ctx.grant.organization), parsed = new URL(url);
          if (!guidOk(id) || !new RegExp(`/_apis/wit/attachments/${id}$`, 'i').test(parsed.pathname) || [...parsed.searchParams.keys()].join() !== (parsed.search ? 'fileName' : '') || parsed.hash) throw new NoRemoteEffect('Unexpected attachment URL');
          image = { id, url, sha256: img.sha256, name: img.name };
          t.progress({ id, url, name: img.name, sha256: img.sha256 });
        }
        const now = await attached(t.call, image.url);
        if (!now.present) await t.call('PATCH', `${org}/_apis/wit/workitems/${ctx.workItem}?${API}`, [{ op: 'test', path: '/rev', value: now.rev }, { op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: image.url, attributes: { comment: 'Routine evidence' } } }], 'application/json-patch+json');
        return { resource: { id: image.id, url: image.url, name: image.name, sha256: image.sha256 } };
      },
      async verify() { const image = uploaded(); return image && (await attached(ctx.client.call, image.url)).present ? { seen: 'present' } : { seen: 'absent' }; } });
    // an uploaded attachment can be shown even when linking it to the item stayed unconfirmed
    const image = uploaded(); if (image) images.push(image);
  }
  return images;
}

/** The @mention tags of a work item comment (DevOps markup, as the host writer made them): only identities of the
 *  package's devops.mentions; the display name read best-effort from DevOps (the id when unreadable). */
export async function mentionTags(ctx: Pick<ExtendedContext, 'grant' | 'client' | 'contact'>, mentions: readonly string[]): Promise<string> {
  const tags: string[] = [];
  for (const id of mentions) {
    let name = id === ctx.contact?.id ? ctx.contact.name : undefined;
    if (!name) {
      try {
        const r = await ctx.client.call('GET', `https://vssps.dev.azure.com/${encodeURIComponent(ctx.grant.organization)}/_apis/identities?identityIds=${id}&api-version=7.1`);
        const first = Array.isArray(r.value) ? object(r.value[0], 'identity') : {};
        const found = first.customDisplayName ?? first.providerDisplayName;
        if (typeof found === 'string' && found.trim()) name = found.slice(0, 120);
      } catch { /* the id stands in for the name: the mention still notifies */ }
    }
    tags.push(mentionHtml(id, name));
  }
  return tags.join(' ');
}

/** A PR comment's text with its images: `{{image:<file name>}}` in the text puts that image there (so a caption line
 *  can sit right above it); the images it does not place follow the text; a placeholder whose image did not upload
 *  says so instead of showing the raw token. */
export function prCommentBody(text: string, images: readonly UploadedImage[]): string {
  const md = (i: UploadedImage) => `![${i.name.replace(/[[\]]/g, '')}](attachment:${i.id})`;
  const placed = new Set<UploadedImage>();
  const body = text.replace(/\{\{image:([^{}\r\n]{1,200})\}\}/g, (_, name: string) => {
    const image = images.find(i => i.name === name.trim());
    if (!image) return `immagine ${name.trim()} non caricata`;
    placed.add(image);
    return md(image);
  });
  return `${body}${images.filter(i => !placed.has(i)).map(i => `\n\n${md(i)}`).join('')}`;
}

/** The images of a work item comment, as HTML after its text. */
export const imagesHtml = (images: readonly UploadedImage[]): string => images.map(i => `<br/><img src="${html(i.url)}" alt="${html(i.name)}"/>`).join('');

/** Builds the per-attempt tracker: counts the calls that change something and whether the last one was refused. */
export function tracker(call: Call, progress: Tracker['progress']): Tracker {
  const t: Tracker = { sent: 0, applied: 0, refusedLast: false, progress,
    call: async (method, url, body, contentType) => {
      const mutation = method !== 'GET' && !/\/_apis\/wit\/wiql/i.test(url);
      if (mutation) { t.sent++; t.refusedLast = false; }
      try { const r = await call(method, url, body, contentType); if (mutation) t.applied++; return r; }
      catch (e) { if (mutation && e instanceof DevOpsCallError && e.definite) t.refusedLast = true; throw e; }
    } };
  return t;
}

/** Whether a failed attempt surely changed nothing: no change sent (a broken precondition, a refused read), or the
 *  only change sent was refused by DevOps. A transient error before any change is unknown (verified, then retried). */
export function refusal(t: Tracker, e: unknown): boolean {
  if (e instanceof NoRemoteEffect || e instanceof HostPushPreconditionError) return true;
  if (t.sent === 0) return !(e instanceof DevOpsCallError) || e.definite;
  return t.applied === 0 && t.sent === 1 && t.refusedLast;
}

export type { Plan, Tracker };
export { guidOk };
