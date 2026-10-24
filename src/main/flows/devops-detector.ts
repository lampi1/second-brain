// Read-only Azure DevOps detector for automatic flows: pinned WIQL, bounded snapshots and revision deduplication.
// The automation service commits this cursor with its events; no model, external writes, credential storage or logs.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { FlowAutomationConfig, FlowDetectionItem, FlowDetectionResult, FlowTrigger } from '../../shared/flow-automation';
import { filterMisses, splitTags } from './filters';

const RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
const PAGE_SIZE = 200, MAX_ITEMS = 2000, MAX_CURSOR = 10_000, MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 60_000, BASELINE = '__devopsBaseline';
const FIELDS = ['System.Id', 'System.Rev', 'System.Title', 'System.TeamProject', 'System.AreaPath', 'System.WorkItemType', 'System.State', 'System.Tags', 'System.IterationPath'];
const LOGIN = 'DevOps: accesso Azure CLI non disponibile. Esegui az login.';
type Trigger = Extract<FlowTrigger, { kind: 'devops' }>;
export interface DevOpsDetectorOptions {
  token?: (signal?: AbortSignal) => Promise<string>;
  request?: (url: string, init: RequestInit) => Promise<Response>;
}
class DetectionError extends Error {}
const fail = (message: string): never => { throw new DetectionError(message); };
const invalid = (): never => fail('DevOps: risposta non valida o incompleta; cursore invariato.');
const limit = (): never => fail('DevOps: limite di lettura raggiunto; restringi il filtro. Cursore invariato.');
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const folded = (s: string): string => s.toLowerCase();
const areaOf = (s: string): string => s.replace(/\//g, '\\');

function checkedTrigger(config: FlowAutomationConfig): Trigger {
  const t = config.trigger;
  const text = (s: unknown, max: number): s is string => typeof s === 'string' && !!s.trim() && s.length <= max && !/[\x00-\x1f\x7f]/.test(s);
  if (t.kind !== 'devops' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$/.test(t.organization)
    || !text(t.project, 128) || t.project === '.' || t.project === '..' || /[/\\]/.test(t.project)
    || !text(t.areaPath, 512) || !text(t.workItemType, 128) || !Array.isArray(t.states) || !t.states.length
    || t.states.length > 32 || !t.states.every(s => text(s, 128)) || typeof t.includeExisting !== 'boolean') {
    return fail('DevOps: filtro non valido. Specifica organizzazione, progetto, area, tipo e stati.');
  }
  return { ...t, areaPath: areaOf(t.areaPath), states: [...t.states], ...(t.iterationPath ? { iterationPath: areaOf(t.iterationPath) } : {}) };
}

/** CLI output remains in memory only. Windows needs its .cmd launcher, with an entirely constant command line. */
export function devopsToken(signal?: AbortSignal): Promise<string> { return azureToken(signal); }
function azureToken(signal?: AbortSignal): Promise<string> {
  if (process.env.VITEST || process.env.SB_TEST || process.env.SB_DEMO) return Promise.reject(new DetectionError(LOGIN));
  const args = ['account', 'get-access-token', '--resource', RESOURCE, '--query', 'accessToken', '--output', 'tsv'];
  const win = process.platform === 'win32';
  return new Promise((resolve, reject) => {
    execFile(win ? process.env.ComSpec ?? 'cmd.exe' : 'az', win ? ['/d', '/s', '/c', `az ${args.join(' ')}`] : args,
      { windowsHide: true, timeout: 30_000, maxBuffer: 32_768, encoding: 'utf8', signal }, (error, stdout) => {
        if (error || !stdout.trim()) reject(new DetectionError(LOGIN));
        else resolve(stdout.trim());
      });
  });
}

/** Also bounds injected implementations that ignore their AbortSignal; late promises cannot commit a cursor. */
function cancellable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DetectionError('DevOps: controllo annullato o scaduto.'));
    if (signal.aborted) { pending.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

async function readJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (response.status === 401 || response.status === 403 || response.status === 203 || (response.status >= 300 && response.status < 400)) fail(LOGIN);
  if (!response.ok) fail(`DevOps: lettura non riuscita (HTTP ${response.status}).`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) limit();
  const reader = response.body?.getReader();
  if (!reader) return invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await cancellable(reader.read(), signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) limit();
      chunks.push(chunk.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  try { return record(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { return invalid(); }
}

function cursorFor(cursor: Record<string, string>, fingerprint: string): Record<string, string> {
  if (Object.keys(cursor).length > MAX_CURSOR + 1) return limit();
  if (cursor[BASELINE] !== fingerprint) return {};
  const next: Record<string, string> = {};
  for (const [key, revision] of Object.entries(cursor)) {
    if (key === BASELINE) continue;
    if (!/^[1-9]\d*$/.test(key) || !positive(Number(key)) || !/^[1-9]\d*$/.test(revision) || !positive(Number(revision))) return invalid();
    next[key] = revision;
  }
  next[BASELINE] = fingerprint;
  return next;
}

/** Inject token acquisition and fetch in tests; production uses the host Azure CLI and only fixed Azure read APIs. */
export function createDevOpsDetector(options: DevOpsDetectorOptions = {}) {
  return async (config: FlowAutomationConfig, cursor: Record<string, string>, signal?: AbortSignal): Promise<FlowDetectionResult> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const t = checkedTrigger(config);
      const fingerprint = createHash('sha256').update(JSON.stringify([t.organization, t.project, t.areaPath, t.workItemType, [...t.states].sort()])).digest('hex');
      const next = cursorFor(cursor, fingerprint), baseline = next[BASELINE] !== fingerprint;
      if (controller.signal.aborted) fail('DevOps: controllo annullato o scaduto.');
      let token: string;
      try { token = await cancellable((options.token ?? azureToken)(controller.signal), controller.signal); }
      catch { return fail(controller.signal.aborted ? 'DevOps: controllo annullato o scaduto.' : LOGIN); }
      if (typeof token !== 'string' || !token || token.length > 32_768 || /\s/.test(token)) fail(LOGIN);
      const base = `https://dev.azure.com/${encodeURIComponent(t.organization)}/${encodeURIComponent(t.project)}/_apis/wit`;
      const api = async (endpoint: 'wiql' | 'workitemsbatch', body: object, top = PAGE_SIZE) => {
        const url = `${base}/${endpoint}?api-version=7.1${endpoint === 'wiql' ? `&timePrecision=true&$top=${top}` : ''}`;
        const response = await cancellable((options.request ?? fetch)(url, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), controller.signal);
        return readJson(response, controller.signal);
      };
      const where = `[System.TeamProject] = ${literal(t.project)} AND [System.AreaPath] UNDER ${literal(t.areaPath)} AND [System.WorkItemType] = ${literal(t.workItemType)} AND [System.State] IN (${t.states.map(literal).join(', ')})`
        + (t.workItemIds?.length ? ` AND [System.Id] IN (${t.workItemIds.filter(positive).join(', ')})` : '');
      const items: FlowDetectionItem[] = [];
      let after = 0, count = 0, asOf = '';
      // WIQL has no continuation token. Stable ASOF + ordered ID keyset pages avoid omissions during edits.
      for (let page = 0; page <= MAX_ITEMS / PAGE_SIZE; page++) {
        const overflow = count === MAX_ITEMS;
        const result = await api('wiql', { query: `SELECT [System.Id] FROM WorkItems WHERE ${where} AND [System.Id] > ${after} ORDER BY [System.Id] ASC${asOf ? ` ASOF ${literal(asOf)}` : ''}` }, overflow ? 1 : PAGE_SIZE);
        if (!Array.isArray(result.workItems) || result.workItems.length > (overflow ? 1 : PAGE_SIZE)) invalid();
        const references = result.workItems as unknown[];
        if (overflow && references.length) limit();
        if (!references.length) break;
        if (!asOf) {
          if (typeof result.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(result.asOf) || !Number.isFinite(Date.parse(result.asOf))) invalid();
          asOf = result.asOf as string;
        }
        const ids = references.map(value => {
          const id = record(value).id;
          if (!positive(id) || id <= after) return invalid();
          after = id; return id;
        });
        const batch = await api('workitemsbatch', { ids, fields: FIELDS, asOf, errorPolicy: 'Fail' });
        if (!Array.isArray(batch.value) || batch.value.length !== ids.length) invalid();
        const expected = new Set(ids);
        for (const value of batch.value as unknown[]) {
          const item = record(value), fields = record(item.fields), id = item.id, revision = item.rev;
          if (!positive(id) || !positive(revision) || !expected.delete(id)) invalid();
          const project = fields['System.TeamProject'], area = fields['System.AreaPath'], type = fields['System.WorkItemType'], state = fields['System.State'];
          if (typeof project !== 'string' || folded(project) !== folded(t.project) || typeof area !== 'string'
            || !(folded(area) === folded(t.areaPath) || folded(area).startsWith(`${folded(t.areaPath)}\\`))
            || typeof type !== 'string' || folded(type) !== folded(t.workItemType) || typeof state !== 'string' || !t.states.some(s => folded(s) === folded(state))
            || typeof fields['System.Title'] !== 'string') invalid();
          const idKey = String(id), previous = Number(next[idKey] ?? '0');
          if (Number(revision) > previous) {
            next[idKey] = String(revision);
            // a revision outside the filters is remembered (cursor) but not queued: a later revision that matches is
            const passes = !filterMisses(t, { id: id as number, tags: splitTags(fields['System.Tags']), iterationPath: typeof fields['System.IterationPath'] === 'string' ? fields['System.IterationPath'] : '' }).length;
            if ((!baseline || t.includeExisting) && passes) items.push({
              key: `devops:${encodeURIComponent(t.organization)}:${encodeURIComponent(t.project)}:${id}:${revision}`,
              title: `#${id} ${(fields['System.Title'] as string).replace(/[\x00-\x1f\x7f]/g, ' ').trim()}`.slice(0, 240),
              inputs: { 'work-item-id': idKey, 'work-item-revision': String(revision), 'work-item-url': `https://dev.azure.com/${encodeURIComponent(t.organization)}/${encodeURIComponent(t.project)}/_workitems/edit/${id}` },
            });
          }
        }
        count += ids.length;
        if (Object.keys(next).length - (next[BASELINE] ? 1 : 0) > MAX_CURSOR) limit();
        if (ids.length < PAGE_SIZE) break;
      }
      if (controller.signal.aborted) fail('DevOps: controllo annullato o scaduto.');
      next[BASELINE] = fingerprint;
      return { cursor: next, items, summary: baseline && !t.includeExisting ? `DevOps: base iniziale di ${count} elementi registrata.` : `DevOps: ${count} elementi controllati, ${items.length} novità.` };
    } catch (error) {
      if (error instanceof DetectionError) throw error;
      throw new DetectionError(controller.signal.aborted ? 'DevOps: controllo annullato o scaduto.' : 'DevOps: lettura non riuscita; cursore invariato.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
  };
}

export const detectDevOps = createDevOpsDetector();

/** One work item as the Routine page's preview shows it (ADR 0154): a fixed Azure read API, the same token as the detector. */
export interface DevOpsItem { id: number; revision: number; title: string; type: string; state: string; project: string; areaPath: string; iterationPath: string; tags: string[]; url: string }
export function createDevOpsItemReader(options: DevOpsDetectorOptions = {}) {
  return async (organization: string, project: string, id: number, signal?: AbortSignal): Promise<DevOpsItem> => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$/.test(organization) || !project.trim() || /[/\\\x00-\x1f]/.test(project) || !positive(id)) fail('DevOps: work item non valido.');
    const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      let token: string;
      try { token = await cancellable((options.token ?? azureToken)(controller.signal), controller.signal); } catch { return fail(LOGIN); }
      const url = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}?api-version=7.1&fields=${FIELDS.join(',')}`;
      const response = await cancellable((options.request ?? fetch)(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }), controller.signal);
      if (response.status === 404) fail(`DevOps: il work item ${id} non esiste o non lo vedi.`);
      const item = await readJson(response, controller.signal), fields = record(item.fields);
      if (item.id !== id || !positive(item.rev)) invalid();
      const str = (key: string): string => typeof fields[key] === 'string' ? (fields[key] as string).replace(/[\x00-\x1f\x7f]/g, ' ').trim() : '';
      return { id, revision: item.rev as number, title: str('System.Title').slice(0, 240), type: str('System.WorkItemType'), state: str('System.State'),
        project: str('System.TeamProject'), areaPath: str('System.AreaPath'), iterationPath: str('System.IterationPath'), tags: splitTags(fields['System.Tags']),
        url: `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_workitems/edit/${id}` };
    } catch (error) {
      if (error instanceof DetectionError) throw error;
      throw new DetectionError('DevOps: lettura del work item non riuscita.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
  };
}
