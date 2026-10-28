// Fake-only Azure detector regressions: scope, baseline, bounded snapshots, cancellation and secret-safe failures.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDevOpsDetector, detectDevOps } from '../../packages/routine-runtime/src/devops-detector';
import type { FlowAutomationConfig, FlowTrigger } from '../../src/shared/flow-automation';

const AS_OF = '2026-01-02T03:04:05.000Z';
const trigger = (extra: Partial<Extract<FlowTrigger, { kind: 'devops' }>> = {}): Extract<FlowTrigger, { kind: 'devops' }> => ({
  kind: 'devops', everyMinutes: 15, organization: 'example-org', project: 'Sample Project', areaPath: 'Sample Project\\Team', workItemType: 'Bug', states: ['New', 'Active'], includeExisting: false, ...extra,
});
const config = (extra: Parameters<typeof trigger>[0] = {}): FlowAutomationConfig => ({ flowId: 'sample', flowVersion: 1, trigger: trigger(extra), scope: { project: 'Sample Project', areaPath: 'Sample Project\\Team' }, inputs: {}, priority: 'normal' });
const item = (id: number, rev = 1, fields: Record<string, string> = {}) => ({ id, rev, fields: { 'System.Title': `Item ${id}`, 'System.TeamProject': 'Sample Project', 'System.AreaPath': 'Sample Project\\Team', 'System.WorkItemType': 'Bug', 'System.State': 'Active', ...fields } });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
function fixture(values = [item(1)]) {
  let current = values;
  const token = vi.fn(async () => 'fake-test-token');
  const request = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query?: string; ids?: number[] };
    if (body.query) {
      const after = Number(body.query.match(/\[System.Id\] > (\d+)/)?.[1]);
      return json({ asOf: AS_OF, workItems: current.filter(w => w.id > after).slice(0, Number(new URL(url).searchParams.get('$top'))).map(w => ({ id: w.id, url: 'https://untrusted.example/never-follow' })) });
    }
    return json({ value: current.filter(w => body.ids?.includes(w.id)) });
  });
  return { token, request, detect: createDevOpsDetector({ token, request }), set: (next: typeof values) => { current = next; } };
}
afterEach(() => vi.useRealTimers());

describe('read-only DevOps flow detection', () => {
  it('records a complete initial baseline without emitting or mutating its input cursor', async () => {
    const f = fixture([item(1, 4), item(2, 8)]), cursor = {};
    const result = await f.detect(config(), cursor);
    expect(result.items).toEqual([]); expect(result.cursor).toMatchObject({ '1': '4', '2': '8' }); expect(cursor).toEqual({});
    expect(result.summary).toContain('base iniziale');
    expect((await f.detect(config(), result.cursor)).items).toEqual([]);
  });

  it('emits current matches only when explicitly configured, with reserved inputs and stable keys', async () => {
    const f = fixture([item(14, 3, { 'System.Title': `A\n${'b'.repeat(400)}` })]);
    const result = await f.detect(config({ includeExisting: true }), {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ key: 'devops:example-org:Sample%20Project:14:3', inputs: { 'work-item-id': '14', 'work-item-revision': '3' } });
    const link = new URL(result.items[0]!.inputs['work-item-url']!);
    expect(link.origin).toBe('https://dev.azure.com'); expect(link.pathname).toBe('/example-org/Sample%20Project/_workitems/edit/14');
    expect(result.items[0]!.title).toHaveLength(240); expect(result.items[0]!.title).not.toContain('\n');
    expect((await f.detect(config({ includeExisting: true }), result.cursor)).items).toEqual([]);
  });

  it('emits new and advanced revisions, retaining absent IDs against duplicate reentry', async () => {
    const f = fixture([item(1, 3)]), initial = await f.detect(config(), {});
    f.set([item(1, 4), item(2, 1)]);
    const changed = await f.detect(config(), initial.cursor);
    expect(changed.items.map(i => i.key)).toEqual(['devops:example-org:Sample%20Project:1:4', 'devops:example-org:Sample%20Project:2:1']);
    f.set([]); const absent = await f.detect(config(), changed.cursor); expect(absent.cursor['1']).toBe('4');
    f.set([item(1, 4), item(2, 1)]); expect((await f.detect(config(), absent.cursor)).items).toEqual([]);
    f.set([item(1, 3)]); expect((await f.detect(config(), absent.cursor)).cursor['1']).toBe('4');
    f.set([item(1, 5)]); expect((await f.detect(config(), absent.cursor)).items).toHaveLength(1);
  });

  it('treats an empty first snapshot as an initialized baseline', async () => {
    const f = fixture([]), result = await f.detect(config(), {});
    f.set([item(2)]); expect((await f.detect(config(), result.cursor)).items).toHaveLength(1);
  });

  it('pins all filters without assigned-to-me and never follows server-provided URLs', async () => {
    const f = fixture([item(1, 1, { 'System.AreaPath': 'Sample Project\\Team\\Child' })]);
    await f.detect(config(), {});
    const query = JSON.parse(String(f.request.mock.calls[0]![1].body)).query as string;
    expect(query).toContain("[System.TeamProject] = 'Sample Project'");
    expect(query).toContain("[System.AreaPath] UNDER 'Sample Project\\Team'");
    expect(query).toContain("[System.WorkItemType] = 'Bug'"); expect(query).toContain("[System.State] IN ('New', 'Active')");
    expect(query).not.toMatch(/AssignedTo|@Me/);
    for (const [url, init] of f.request.mock.calls) {
      expect(new URL(url).origin).toBe('https://dev.azure.com'); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
      expect(new URL(url).pathname).toMatch(/\/_apis\/wit\/(wiql|workitemsbatch)$/);
    }
    const batch = JSON.parse(String(f.request.mock.calls[1]![1].body));
    expect(batch).toMatchObject({ errorPolicy: 'Fail', asOf: AS_OF });
    expect(batch.fields).not.toContain('System.Description');
  });

  it('quotes injection-shaped literals and encodes the configured project path', async () => {
    const f = fixture([]);
    await f.detect(config({ project: "A' OR 1=1 --", areaPath: "A'\\Team", workItemType: "Bug' OR 'x'='x", states: ["New') OR [System.Id] > 0 --"] }), {});
    const [url, init] = f.request.mock.calls[0]!;
    expect(new URL(url).hostname).toBe('dev.azure.com');
    const query = JSON.parse(String(init.body)).query as string;
    expect(query).toContain("[System.TeamProject] = 'A'' OR 1=1 --'");
    expect(query).toContain("[System.WorkItemType] = 'Bug'' OR ''x''=''x'");
    expect(query).toContain("[System.State] IN ('New'') OR [System.Id] > 0 --')");
  });

  it.each([{ organization: 'https://evil.example/x' }, { organization: '../other' }, { project: '..' }, { project: 'A/B' }, { states: [] }, { areaPath: 'A\nB' }])('rejects invalid scope before acquiring credentials: %j', async extra => {
    const f = fixture(); await expect(f.detect(config(extra), {})).rejects.toThrow('filtro'); expect(f.token).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it('does not reuse a baseline across changed filters', async () => {
    const f = fixture(), initial = await f.detect(config(), {});
    f.set([item(2)]); const changed = await f.detect(config({ states: ['Active'] }), initial.cursor);
    expect(changed.items).toEqual([]); expect(changed.cursor['1']).toBeUndefined(); expect(changed.cursor['2']).toBe('1');
  });

  it('pages more than 200 matches at the original server snapshot', async () => {
    const f = fixture(Array.from({ length: 401 }, (_, i) => item(i + 1)));
    const result = await f.detect(config({ includeExisting: true }), {});
    expect(result.items).toHaveLength(401); expect(f.request).toHaveBeenCalledTimes(6);
    const queries = f.request.mock.calls.filter(([, init]) => JSON.parse(String(init.body)).query).map(([, init]) => JSON.parse(String(init.body)).query as string);
    expect(queries[1]).toContain('[System.Id] > 200'); expect(queries[2]).toContain('[System.Id] > 400');
    expect(queries[1]).toContain(`ASOF '${AS_OF}'`); expect(queries[2]).toContain(`ASOF '${AS_OF}'`);
  });

  it('accepts the exact limit after an empty overflow probe and rejects any truncation atomically', async () => {
    const f = fixture(Array.from({ length: 2000 }, (_, i) => item(i + 1))), cursor = {};
    expect((await f.detect(config(), cursor)).cursor['2000']).toBe('1'); expect(f.request).toHaveBeenCalledTimes(21);
    f.set(Array.from({ length: 2001 }, (_, i) => item(i + 1)));
    await expect(f.detect(config(), cursor)).rejects.toThrow('limite'); expect(cursor).toEqual({});
  });

  it.each<Record<string, string>>([
    { 'System.TeamProject': 'Other' }, { 'System.AreaPath': 'Sample Project\\Teamwork' }, { 'System.WorkItemType': 'Task' }, { 'System.State': 'Closed' },
  ])('rejects unexpected out-of-scope batch data: %j', async fields => {
    const f = fixture([item(1, 1, fields)]); await expect(f.detect(config(), {})).rejects.toThrow('risposta non valida');
  });

  it('fails on missing batch entries, malformed pages, duplicate IDs and absent asOf', async () => {
    for (const result of [{ workItems: [{ id: 1 }] }, { asOf: AS_OF, workItems: [{ id: 1 }, { id: 1 }] }, { asOf: AS_OF, workItems: 'bad' }]) {
      const detect = createDevOpsDetector({ token: async () => 'fake', request: async () => json(result) });
      await expect(detect(config(), {})).rejects.toThrow('risposta non valida');
    }
    const request = vi.fn().mockResolvedValueOnce(json({ asOf: AS_OF, workItems: [{ id: 1 }] })).mockResolvedValueOnce(json({ value: [] }));
    await expect(createDevOpsDetector({ token: async () => 'fake', request })(config(), {})).rejects.toThrow('risposta non valida');
  });

  it.each([203, 302, 401, 403, 429, 500])('sanitizes HTTP %s without reflecting response bodies', async status => {
    const detect = createDevOpsDetector({ token: async () => 'fake', request: async () => new Response('private secret accessToken', { status }) });
    await expect(detect(config(), {})).rejects.not.toThrow('private secret');
  });

  it('sanitizes authentication and transport failures and rejects unsafe token text', async () => {
    const request = vi.fn();
    await expect(createDevOpsDetector({ token: async () => { throw new Error('private secret'); }, request })(config(), {})).rejects.toThrow('Azure CLI');
    await expect(createDevOpsDetector({ token: async () => 'bad\r\nheader', request })(config(), {})).rejects.toThrow('Azure CLI'); expect(request).not.toHaveBeenCalled();
    await expect(createDevOpsDetector({ token: async () => 'fake', request: async () => { throw new Error('private secret'); } })(config(), {})).rejects.not.toThrow('private secret');
    await expect(detectDevOps(config(), {})).rejects.toThrow('Azure CLI');
  });

  it('bounds response bytes both with and without Content-Length', async () => {
    for (const response of [new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024) } }), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
      const detect = createDevOpsDetector({ token: async () => 'fake', request: async () => response });
      await expect(detect(config(), {})).rejects.toThrow('limite');
    }
  });

  it('cancels before auth, during uncooperative auth and during uncooperative requests', async () => {
    const f = fixture(), already = new AbortController(); already.abort(new Error('private reason'));
    await expect(f.detect(config(), {}, already.signal)).rejects.toThrow('annullato'); expect(f.token).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = createDevOpsDetector({ token: () => new Promise(() => {}), request: f.request })(config(), {}, controller.signal);
    controller.abort(new Error('private reason')); await expect(pending).rejects.toThrow('annullato'); expect(f.request).not.toHaveBeenCalled();
    const second = new AbortController();
    const request = vi.fn(() => new Promise<Response>(() => {}));
    const reading = createDevOpsDetector({ token: async () => 'fake', request })(config(), {}, second.signal);
    await vi.waitFor(() => expect(request).toHaveBeenCalled()); second.abort(); await expect(reading).rejects.toThrow('annullato');
  });

  it('times out uncooperative auth without committing anything', async () => {
    vi.useFakeTimers();
    const pending = createDevOpsDetector({ token: () => new Promise(() => {}) })(config(), {});
    const assertion = expect(pending).rejects.toThrow('scaduto');
    await vi.advanceTimersByTimeAsync(60_000); await assertion;
  });
});
