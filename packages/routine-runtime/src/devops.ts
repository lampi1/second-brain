// DevOps calls of the routine runtime (ADR 0175): the few fixed Azure DevOps REST calls a run makes on ITS work item
// (read, patch fields/state/tags, add/read comments), authenticated by a TokenProvider (az Bearer or package PAT Basic).
// `executeWrites` runs the writes a step-result.json lists, within the package's `devops` grant, through the run ledger:
// the ledger avoids duplicates but never blocks a run (an unknown outcome is verified on DevOps: present → done,
// absent → one retry, unclear → "not verified"; owner, 2026-10-27). A comment carries a visible run marker to find it.
import { createHash } from 'node:crypto';
import type { TokenProvider } from './ports';
import { checkedAuthorization } from './token';
import type { RoutineDevOps } from './format';
import { WRITE_CATEGORY, type StepWrite } from './step-result';
import type { Masker } from './mask';
import { StaleAttempt, type LedgerEntry, type RunStore } from './run-store';
import { executeExtended, imagesHtml, mentionTags, refusal, tracker, uploadImages, type Deployments, type ExtendedContext, type ExtendedOutcome, type Plan } from './devops-ops';

export interface DevOpsComment { id: number; authorId: string; authorName?: string; createdAt: number; text: string }
export interface DevOpsWorkItem { id: number; rev: number; project: string; fields: Record<string, unknown> }
type Request = (url: string, init: RequestInit) => Promise<Response>;

export class DevOpsCallError extends Error {
  /** true when DevOps answered and refused (4xx but 408/429): the write surely did not apply */
  constructor(message: string, readonly definite = false) { super(message); }
}

const ORG = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$/;
const base = (org: string) => { if (!ORG.test(org)) throw new DevOpsCallError('DevOps: invalid organization'); return `https://dev.azure.com/${encodeURIComponent(org)}`; };

export function createDevOpsClient(options: { authorization: TokenProvider; request?: Request; timeoutMs?: number }) {
  const call = async (method: string, url: string, body?: unknown, contentType = 'application/json'): Promise<Record<string, unknown>> => {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
    const authorization = checkedAuthorization(await options.authorization.authorization(signal));
    const response = await (options.request ?? fetch)(url, { method, redirect: 'error', signal,
      headers: { Authorization: authorization, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': contentType } : {}) },
      // an image upload sends its bytes as they are; everything else is JSON
      ...(body !== undefined ? { body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) } : {}) });
    if (response.status === 401 || response.status === 403 || response.status === 203) throw new DevOpsCallError('DevOps: not authorised (check the PAT or az login)', true);
    if (!response.ok) throw new DevOpsCallError(`DevOps: ${method} failed (HTTP ${response.status})`, response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429);
    const text = await response.text();
    try { return text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { throw new DevOpsCallError('DevOps: invalid response'); }
  };
  const client = {
    /** One authorised DevOps REST call (the extended writes and the host modules build the URL; never an agent). */
    call,
    /** The Authorization header value (for the host git push only; never logged, never written). */
    authorization: async (signal?: AbortSignal): Promise<string> => checkedAuthorization(await options.authorization.authorization(signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000))),
    /** The item's links (attachments: rel "AttachedFile"). */
    async relations(org: string, id: number): Promise<{ rel: string; url: string; name?: string }[]> {
      const r = await call('GET', `${base(org)}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.1`);
      const list = Array.isArray(r.relations) ? r.relations as Record<string, unknown>[] : [];
      return list.flatMap(x => typeof x.rel === 'string' && typeof x.url === 'string'
        ? [{ rel: x.rel, url: x.url, ...(typeof (x.attributes as Record<string, unknown> | undefined)?.name === 'string' ? { name: (x.attributes as Record<string, string>).name } : {}) }] : []);
    },
    /** Downloads an attachment of this organization (no other host). */
    async download(url: string): Promise<Buffer> {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new DevOpsCallError('DevOps: invalid attachment URL'); }
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'dev.azure.com' || !/\/_apis\/wit\/attachments\//i.test(parsed.pathname)) throw new DevOpsCallError('DevOps: not a DevOps attachment URL');
      const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
      const authorization = checkedAuthorization(await options.authorization.authorization(signal));
      const response = await (options.request ?? fetch)(parsed.toString(), { method: 'GET', redirect: 'error', signal, headers: { Authorization: authorization } });
      if (!response.ok) throw new DevOpsCallError(`DevOps: download failed (HTTP ${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    },
    async item(org: string, id: number): Promise<DevOpsWorkItem> {
      const r = await call('GET', `${base(org)}/_apis/wit/workitems/${id}?api-version=7.1`);
      const fields = (r.fields ?? {}) as Record<string, unknown>;
      if (r.id !== id || typeof r.rev !== 'number' || typeof fields['System.TeamProject'] !== 'string') throw new DevOpsCallError('DevOps: invalid work item');
      return { id, rev: r.rev, project: fields['System.TeamProject'], fields };
    },
    async patch(org: string, id: number, ops: { op: 'add' | 'replace' | 'remove' | 'test'; path: string; value?: unknown }[]): Promise<number> {
      const r = await call('PATCH', `${base(org)}/_apis/wit/workitems/${id}?api-version=7.1`, ops, 'application/json-patch+json');
      if (typeof r.rev !== 'number') throw new DevOpsCallError('DevOps: invalid patch response');
      return r.rev;
    },
    async comment(org: string, project: string, id: number, html: string): Promise<number> {
      const r = await call('POST', `${base(org)}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4`, { text: html });
      if (typeof r.id !== 'number') throw new DevOpsCallError('DevOps: invalid comment response');
      return r.id;
    },
    async comments(org: string, project: string, id: number): Promise<DevOpsComment[]> {
      const r = await call('GET', `${base(org)}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4&$top=200&order=desc`);
      const list = Array.isArray(r.comments) ? r.comments as Record<string, unknown>[] : [];
      return list.flatMap(c => {
        const by = (c.createdBy ?? {}) as Record<string, unknown>;
        return typeof c.id === 'number' && typeof c.text === 'string' && typeof by.id === 'string'
          ? [{ id: c.id, authorId: by.id.toLowerCase(), ...(typeof by.displayName === 'string' ? { authorName: by.displayName } : {}), createdAt: Date.parse(String(c.createdDate)) || 0, text: c.text }] : [];
      });
    },
    /** The item's update history (who changed which fields when), oldest first. */
    async updates(org: string, id: number): Promise<{ rev: number; byId: string; at: number; fields: string[] }[]> {
      const r = await call('GET', `${base(org)}/_apis/wit/workItems/${id}/updates?$top=200&api-version=7.1`);
      const list = Array.isArray(r.value) ? r.value as Record<string, unknown>[] : [];
      return list.flatMap(u => {
        const by = (u.revisedBy ?? {}) as Record<string, unknown>;
        return typeof u.rev === 'number' && typeof by.id === 'string'
          ? [{ rev: u.rev, byId: by.id.toLowerCase(), at: Date.parse(String(u.revisedDate)) || 0, fields: Object.keys((u.fields ?? {}) as object) }] : [];
      });
    },
    /** The identity this token acts as (authenticatedUser of connectionData). */
    async me(org: string): Promise<string> {
      const r = await call('GET', `${base(org)}/_apis/connectionData`);
      const id = (r.authenticatedUser as Record<string, unknown> | undefined)?.id;
      if (typeof id !== 'string' || !id) throw new DevOpsCallError('DevOps: no authenticated user');
      return id.toLowerCase();
    },
  };
  return client;
}
export type DevOpsClient = ReturnType<typeof createDevOpsClient>;

export const html = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Plain text → comment HTML (paragraphs and line breaks only). */
export const commentHtml = (text: string): string => html(text).replace(/\r?\n/g, '<br/>');
export const mentionHtml = (identity: string, name?: string): string => `<a href="#" data-vss-mention="version:2.0,${identity}">@${html(name ?? identity)}</a>`;
/** The visible marker that makes a comment findable after a crash (no secret, no prompt text). */
export const runMarker = (runId: string, key: string): string => `routine run ${runId} · ${key.slice(0, 12)}`;

export interface WriteContext {
  runId: string; attempt: number; stepId: string; workItem: number;
  grant: RoutineDevOps; client: DevOpsClient; store: RunStore; masker: Masker;
  /** the run's inputs (a push target names its checkout input) */
  inputs?: Record<string, string>;
  /** the test deployment coordinator (deploy-test, cancel-test-deploy, downgrade cleanup) */
  deployments?: Deployments;
  arm?: ExtendedContext['arm'];
  /** who a downgrade comment mentions besides devops.mentions */
  contact?: ExtendedContext['contact'];
  push?: ExtendedContext['push'];
  /** the step's own folder: comment images are read only from its evidence/ and screenshots/ */
  stepDir?: string;
  /** the review→fix round of the step (1 = first pass): a later round's writes are new writes, not duplicates */
  round?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// round 1 keeps the key of runs started before review→fix loops existed
const writeKey = (runId: string, stepId: string, index: number, write: StepWrite, round = 1) =>
  createHash('sha256').update(JSON.stringify(round > 1 ? [runId, stepId, index, write, round] : [runId, stepId, index, write])).digest('hex');

type ClassicWrite = Extract<StepWrite, { op: 'comment' | 'state' | 'fields' | 'tags' }>;
const isClassic = (w: StepWrite): w is ClassicWrite => w.op === 'comment' || w.op === 'state' || w.op === 'fields' || w.op === 'tags';

function describe(write: ClassicWrite): string {
  switch (write.op) {
    case 'comment': return 'comment';
    case 'state': return `state → ${write.state}`;
    case 'fields': return `fields ${Object.keys(write.fields).join(', ')}`;
    case 'tags': return `tags +${(write.add ?? []).join(',')} -${(write.remove ?? []).join(',')}`;
  }
}

/** Refuses a write the package does not allow; null = allowed. */
export function refusedWrite(grant: RoutineDevOps, write: StepWrite): string | null {
  if (!grant.ops.includes(WRITE_CATEGORY[write.op])) return `the package does not allow "${write.op}" writes`;
  const inProjects = (p: string) => grant.projects.some(x => x.toLowerCase() === p.toLowerCase());
  switch (write.op) {
    case 'fields':
      for (const f of Object.keys(write.fields)) if (!grant.fields.includes(f)) return `field ${f} is not in the package's devops.fields`;
      if (Object.keys(write.fields).some(f => f === 'System.State' || f === 'System.Tags')) return 'use the state or tags write for System.State / System.Tags';
      return null;
    case 'create-test-plan': return write.project && !inProjects(write.project) ? `project ${write.project} is not in the package's devops.projects` : null;
    case 'create-pr': return inProjects(write.project) ? null : `project ${write.project} is not in the package's devops.projects`;
    case 'comment': case 'pr-comment':
      if ((write.mentions ?? []).find(m => !(grant.mentions ?? []).includes(m))) return 'a mention is not in the package\'s devops.mentions';
      return write.images?.length && !grant.ops.includes('attachments') ? 'the package does not allow "attachments" (comment images)' : null;
    case 'push-branch': return grant.pushTargets?.some(t => t.repositoryId === write.repositoryId && t.project.toLowerCase() === write.project.toLowerCase()) ? null : 'the repository is not in the package\'s devops.pushTargets';
    case 'queue-pr-validation': case 'deploy-test': case 'cancel-test-deploy': return grant.deployTargets?.some(t => t.id === write.targetId) ? null : `target ${write.targetId} is not in the package's devops.deployTargets`;
    case 'downgrade': return grant.downgrade ? null : 'the package has no devops.downgrade';
    default: return null;
  }
}

const tagSet = (fields: Record<string, unknown>) => new Map(String(fields['System.Tags'] ?? '').split(';').map(t => t.trim()).filter(Boolean).map(t => [t.toLowerCase(), t]));

/** Whether a write's effect is already on DevOps: present, absent, or unclear (the read itself failed). Comments are
 *  matched by the ledger's visible marker; state, fields and tags by the item's current values. */
export async function verifyWrite(context: Pick<WriteContext, 'client' | 'grant' | 'workItem' | 'masker'>, write: ClassicWrite, marker: string, project: string): Promise<'present' | 'absent' | 'unclear'> {
  try {
    if (write.op === 'comment') return (await context.client.comments(context.grant.organization, project, context.workItem)).some(c => c.text.includes(marker)) ? 'present' : 'absent';
    const fields = (await context.client.item(context.grant.organization, context.workItem)).fields;
    if (write.op === 'state') return String(fields['System.State'] ?? '').toLowerCase() === write.state.toLowerCase() ? 'present' : 'absent';
    if (write.op === 'fields') return Object.entries(write.fields).every(([f, v]) => String(fields[f] ?? '') === String(typeof v === 'string' ? context.masker.mask(v) : v)) ? 'present' : 'absent';
    const tags = tagSet(fields);
    return (write.add ?? []).every(t => tags.has(t.toLowerCase())) && (write.remove ?? []).every(t => !tags.has(t.toLowerCase())) ? 'present' : 'absent';
  } catch { return 'unclear'; }
}

export interface WritesOutcome {
  /** "<what>" or "<what> (already done | verified on DevOps | after one retry)" */
  done: string[];
  /** the effect could not be confirmed: reported as "not verified", the run goes on */
  notVerified: string[];
  /** DevOps refused the write (HTTP 4xx): reported, the run goes on */
  failed: string[];
  /** a downgrade ran (its reason): the run stops and waits for a person */
  downgraded?: string;
}

/**
 * Runs a step's DevOps writes on the run's work item. The ledger prevents duplicates but never blocks a run: an unknown
 * outcome (timeout, crash, lost response) is settled by re-reading DevOps for that exact effect: present → done;
 * absent → one retry; still unclear → "not verified" and the run continues. Throws only when the package does not
 * allow a write (refusal) or when a newer attempt took the run (StaleAttempt).
 */
export async function executeWrites(context: WriteContext, writes: StepWrite[]): Promise<WritesOutcome> {
  const { client, grant, workItem, store, masker } = context;
  const out: WritesOutcome = { done: [], notVerified: [], failed: [] };
  for (const refused of writes.map(w => refusedWrite(grant, w))) if (refused) throw new DevOpsCallError(`DevOps write refused: ${refused}`, true);
  const now = context.now ?? Date.now;
  let project: string | undefined;
  // the generic verify-then-decide loop of the extended writes (devops-ops.ts): same rules as the classic one below
  const settle = async (plan: Plan): Promise<'done' | 'not-verified' | 'failed'> => {
    const current = () => store.ledger(context.runId)[plan.key];
    const entry = current();
    if (entry?.state === 'done') { out.done.push(`${plan.what} (already done)`); return 'done'; }
    if (entry?.state === 'not-verified') { out.notVerified.push(plan.what); return 'not-verified'; }
    if (entry?.state === 'failed') { out.failed.push(plan.what); return 'failed'; }
    const save = (state: LedgerEntry['state'], extra: Partial<LedgerEntry> = {}) => {
      const prior = current();
      const resource = { ...prior?.resource, ...extra.resource };
      store.setLedger(context.runId, context.attempt, plan.key, { ...prior, ...extra, state, what: plan.what, at: now(), tries: extra.tries ?? prior?.tries ?? 0, ...(Object.keys(resource).length ? { resource } : {}) });
    };
    let reason = '';
    const once = async (): Promise<'ok' | 'definite' | 'unknown'> => {
      const t = tracker(client.call, resource => save('writing', { ...(resource ? { resource } : {}) }));
      try { save('done', (await plan.once(t)) ?? {}); return 'ok'; }
      catch (e) {
        if (e instanceof StaleAttempt) throw e;
        reason = masker.mask(e instanceof Error ? e.message : String(e)).slice(0, 300);
        return refusal(t, e) ? 'definite' : 'unknown';
      }
    };
    let tries = entry?.tries ?? 0, label = plan.what;
    let result: 'ok' | 'definite' | 'unknown' = entry?.state === 'writing' ? 'unknown' : (save('writing', { tries: ++tries }), await once());
    while (result === 'unknown') {
      let seen: Awaited<ReturnType<Plan['verify']>>;
      try { seen = await plan.verify(); } catch (e) { if (e instanceof StaleAttempt) throw e; seen = { seen: 'unclear' }; }
      if (seen.seen === 'present') { save('done', seen.extra ?? {}); label = `${plan.what} (verified on DevOps)`; result = 'ok'; break; }
      if (seen.seen === 'unclear' || tries >= 2) break;
      save('writing', { tries: ++tries }); label = `${plan.what} (after one retry)`;
      result = await once();
    }
    if (result === 'ok') { out.done.push(label); return 'done'; }
    if (result === 'definite') { save('failed'); out.failed.push(reason ? `${plan.what}: ${reason}` : plan.what); return 'failed'; }
    save('not-verified'); out.notVerified.push(plan.what); return 'not-verified';
  };
  const classic = async (write: ClassicWrite, key: string): Promise<void> => {
    const what = describe(write), marker = runMarker(context.runId, key);
    const entry = store.ledger(context.runId)[key];
    if (entry?.state === 'done') { out.done.push(`${what} (already done)`); return; }
    if (entry?.state === 'not-verified') { out.notVerified.push(what); return; }
    if (entry?.state === 'failed') { out.failed.push(what); return; }
    const save = (state: LedgerEntry['state'], extra: Partial<LedgerEntry> = {}) => store.setLedger(context.runId, context.attempt, key, { state, what, at: Date.now(), tries: extra.tries ?? store.ledger(context.runId)[key]?.tries ?? 0, ...extra });
    if (!project) {
      try { project = (await client.item(grant.organization, workItem)).project; }
      // nothing was sent: no ledger entry, so a resumed run tries again
      catch { if (entry?.state === 'writing') save('not-verified'); out.notVerified.push(`${what} (work item unreadable)`); return; }
      if (!grant.projects.some(p => p.toLowerCase() === project!.toLowerCase())) throw new DevOpsCallError(`DevOps write refused: work item ${workItem} is in project ${project}, outside the package's devops.projects`, true);
    }
    // a comment's mentions and images: images uploaded first (their failures listed, never blocking the comment)
    let before = '', after = '';
    if (write.op === 'comment' && (write.mentions?.length || write.images?.length)) {
      const ectx = { runId: context.runId, workItem, project: project!, grant, client, store, masker, ...(context.stepDir ? { stepDir: context.stepDir } : {}), ...(context.contact ? { contact: context.contact } : {}) };
      if (write.mentions?.length) before = `${await mentionTags(ectx, write.mentions)}<br/>`;
      if (write.images?.length) after = imagesHtml(await uploadImages(ectx, write.images, settle, out));
    }
    const once = async (): Promise<'ok' | 'definite' | 'unknown'> => {
      try {
        if (write.op === 'comment') {
          const commentId = await client.comment(grant.organization, project!, workItem, `${before}${commentHtml(masker.mask(write.text))}${after}<br/><small>${html(marker)}</small>`);
          save('done', { commentId }); return 'ok';
        }
        let ops: { op: 'add' | 'replace' | 'remove'; path: string; value?: unknown }[];
        if (write.op === 'state') ops = [{ op: 'add', path: '/fields/System.State', value: write.state }];
        else if (write.op === 'fields') ops = Object.entries(write.fields).map(([f, v]) => ({ op: 'add' as const, path: `/fields/${f}`, value: typeof v === 'string' ? masker.mask(v) : v }));
        else {
          // tags are re-read each time: adding and removing are idempotent on the current value
          const tags = tagSet((await client.item(grant.organization, workItem)).fields), was = [...tags.values()].join('; ');
          for (const t of write.add ?? []) tags.set(t.toLowerCase(), t);
          for (const t of write.remove ?? []) tags.delete(t.toLowerCase());
          // "add" on System.Tags only appends (a removal was a silent no-op): replace the list, or drop the field when empty
          if ([...tags.values()].join('; ') === was) { save('done'); return 'ok'; } // already as asked: removing a missing field would fail
          ops = [tags.size ? { op: 'replace', path: '/fields/System.Tags', value: [...tags.values()].join('; ') } : { op: 'remove', path: '/fields/System.Tags' }];
        }
        const rev = await client.patch(grant.organization, workItem, ops);
        // a tags write is done only when the item really shows it (DevOps answers a no-op patch with the same rev)
        if (write.op === 'tags' && await verifyWrite(context, write, marker, project!) !== 'present') return 'unknown';
        save('done', { rev }); return 'ok';
      } catch (e) { return e instanceof DevOpsCallError && e.definite ? 'definite' : 'unknown'; }
    };
    // a "writing" entry is a write whose outcome was lost (crash): verify before anything else
    let tries = entry?.tries ?? 0, label = what;
    let result: 'ok' | 'definite' | 'unknown' = entry?.state === 'writing' ? 'unknown' : (save('writing', { tries: ++tries }), await once());
    while (result === 'unknown') {
      const seen = await verifyWrite(context, write, marker, project!);
      if (seen === 'present') { save('done'); label = `${what} (verified on DevOps)`; result = 'ok'; break; }
      if (seen === 'unclear' || tries >= 2) break;
      save('writing', { tries: ++tries }); label = `${what} (after one retry)`;
      result = await once();
    }
    if (result === 'ok') out.done.push(label);
    else if (result === 'definite') { save('failed'); out.failed.push(what); }
    else { save('not-verified'); out.notVerified.push(what); }
  };
  for (const [index, write] of writes.entries()) {
    const key = writeKey(context.runId, context.stepId, index, write, context.round);
    if (isClassic(write)) { await classic(write, key); continue; }
    if (!project) {
      try { project = (await client.item(grant.organization, workItem)).project; }
      catch { out.notVerified.push(`${write.op} (work item unreadable)`); continue; }
      if (!grant.projects.some(p => p.toLowerCase() === project!.toLowerCase())) throw new DevOpsCallError(`DevOps write refused: work item ${workItem} is in project ${project}, outside the package's devops.projects`, true);
    }
    const ext: ExtendedOutcome = out;
    // test resources are keyed by their ref, run-wide: later writes and steps point at them by it, never a duplicate
    const resourceKey = write.op === 'create-test-plan' ? `test:plan:${write.ref}` : write.op === 'create-test-suite' ? `test:suite:${write.ref}` : write.op === 'create-test-case' ? `test:case:${write.ref}` : key;
    await executeExtended({
      runId: context.runId, attempt: context.attempt, stepId: context.stepId, workItem, project, grant, client, store, masker,
      inputs: context.inputs ?? {}, runDir: store.runDir(context.runId), ...(context.stepDir ? { stepDir: context.stepDir } : {}),
      ...(context.deployments ? { deployments: context.deployments } : {}), ...(context.arm ? { arm: context.arm } : {}),
      ...(context.contact ? { contact: context.contact } : {}), ...(context.push ? { push: context.push } : {}),
      sleep: context.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), now,
    }, write, resourceKey, settle, ext, (w, k) => isClassic(w) ? classic(w, k) : Promise.resolve());
    if (out.downgraded) break;
  }
  return out;
}

