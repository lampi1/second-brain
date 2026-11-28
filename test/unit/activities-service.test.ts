// «Attività pianificate» engine (src/main/activities/service.ts, store.ts, triage.ts, ipc-handlers/activities.ts) with a fake
// clock, fake readers and a fake model: nothing new = 0 model calls; a pass of the filter = ONE triage call; proposals = ONE
// grouped news to the Orchestrator; the daily cap pauses with a visible reason and loses nothing; the next run is saved
// before the run (a crash never repeats it); a failed read keeps the cursor; the state file survives a restart.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivitiesService, type ActivitiesDeps, type ActivityNews } from '../../src/main/activities/service';
import { parseProposals, triagePrompt } from '../../src/main/activities/triage';
import { activitiesHandlers } from '../../src/main/ipc-handlers/activities';
import { defaultActivity, type ActivityInput, type ActivityItem, type ActivityReadResult, type ActivitySourceReader } from '../../src/shared/activities';

const T0 = new Date(2026, 10, 28, 12, 0).getTime();
const MIN = 60_000;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmpFile = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-')); dirs.push(d); return path.join(d, 'activities.json'); };

const item = (key: string, at: number, extra: Partial<ActivityItem> = {}): ActivityItem => ({ key, at, from: 'Giulia', title: `Titolo ${key}`, text: 'testo', unread: true, mentionsMe: false, url: `https://example.test/${key}`, ...extra });
const input = (extra: Partial<ActivityInput> = {}): ActivityInput => ({ ...defaultActivity('outlook'), name: 'Posta', propose: 'se mi chiedono una risposta, proponila', enabled: true, ...extra });

interface Rig { svc: ActivitiesService; clock: { t: number }; reads: ReturnType<typeof vi.fn>; ai: ReturnType<typeof vi.fn>; news: ActivityNews[]; emitted: number; file: string; src: { result: ActivityReadResult } }
function rig(file = tmpFile(), clock = { t: T0 }): Rig {
  const src = { result: { items: [] } as ActivityReadResult };
  const reads = vi.fn(async () => src.result);
  const reader: ActivitySourceReader = { source: 'outlook', read: reads };
  const ai = vi.fn(async (_p: string) => ({ ok: true as const, text: '[]', tokens: 100, costUsd: 0.001, model: 'cheap' }));
  const news: ActivityNews[] = [];
  const r = { emitted: 0 } as Rig;
  const deps: ActivitiesDeps = { file, now: () => clock.t, reader: s => (s === 'outlook' ? reader : null), ai, notify: n => news.push(n), emit: () => { r.emitted++; }, fence: () => 'FENCE', newId: (() => { let n = 0; return () => `id${++n}`; })() };
  return Object.assign(r, { svc: new ActivitiesService(deps), clock, reads, ai, news, file, src });
}
const created = (r: Rig, i: ActivityInput = input()): string => { const res = r.svc.save({ input: i }); if (!res.ok) throw new Error(res.error); return res.id; };

describe('activities engine', () => {
  it('nothing new = zero model calls, run recorded idle; a second read of the same items stays idle', async () => {
    const r = rig();
    const id = created(r, input({ filter: { ...defaultActivity('outlook').filter, unreadOnly: true } }));
    const first = await r.svc.run({ id });
    expect(first.ok && first.run).toMatchObject({ status: 'idle', read: 0, kept: 0, usedModel: false, tokens: null });
    r.src.result = { items: [item('a', T0 - 5 * MIN, { unread: false })] };
    const filtered = await r.svc.run({ id });
    expect(filtered.ok && filtered.run).toMatchObject({ status: 'idle', read: 1, kept: 0 });   // read, but dropped by the filter
    const again = await r.svc.run({ id });
    expect(again.ok && again.run).toMatchObject({ status: 'idle', read: 1, kept: 0 });
    expect(r.ai).not.toHaveBeenCalled();
  });

  it('a pass of the filter = one triage call; no proposal = quiet, cost and tokens on the run', async () => {
    const r = rig();
    const id = created(r);
    r.src.result = { items: [item('a', T0 - MIN), item('b', T0 - 2 * MIN)] };
    const res = await r.svc.run({ id });
    expect(r.ai).toHaveBeenCalledTimes(1);
    expect(r.news).toHaveLength(0);
    expect(res.ok && res.run).toMatchObject({ status: 'quiet', read: 2, kept: 2, proposals: 0, usedModel: true, tokens: 100, costUsd: 0.001, model: 'cheap' });
    expect(r.svc.state().activities[0]).toMatchObject({ todayTriage: 1, todayCostUsd: 0.001 });
  });

  it('triage proposes = ONE grouped news to the Orchestrator, only for known keys', async () => {
    const r = rig();
    const id = created(r);
    r.ai.mockResolvedValueOnce({ ok: true, text: 'ecco: [{"key":"a","action":"Rispondi che va bene"},{"key":"zzz","action":"inventata"},{"key":"b","action":"Chiedi un rinvio"}]', tokens: 200, costUsd: 0.002, model: 'cheap' });
    r.src.result = { items: [item('a', T0 - MIN), item('b', T0 - 2 * MIN)] };
    const res = await r.svc.run({ id });
    expect(r.news).toHaveLength(1);
    expect(r.news[0]!.proposals.map(p => p.key)).toEqual(['a', 'b']);
    expect(r.news[0]!.text).toContain('Sì/No');
    expect(res.ok && res.run).toMatchObject({ status: 'proposed', proposals: 2 });
  });

  it('daily cap reached = capped with a visible reason, no model call, the cursor stays so nothing is lost', async () => {
    const r = rig();
    const id = created(r, input({ dailyCap: 1 }));
    r.src.result = { items: [item('a', T0 - MIN)] };
    await r.svc.run({ id });
    expect(r.ai).toHaveBeenCalledTimes(1);
    r.clock.t += 5 * MIN;
    r.src.result = { items: [item('b', T0 + MIN)] };
    const capped = await r.svc.run({ id });
    expect(r.ai).toHaveBeenCalledTimes(1);
    expect(capped.ok && capped.run).toMatchObject({ status: 'capped', usedModel: false });
    expect(capped.ok && capped.run?.error).toContain('Tetto giornaliero');
    const next = r.svc.state().activities[0]!.nextAt!;
    expect(new Date(next).getDate()).toBe(new Date(T0).getDate() + 1);   // waits for tomorrow
    r.clock.t = next;   // tomorrow: the item that waited is triaged now
    await r.svc.run({ id });
    expect(r.ai).toHaveBeenCalledTimes(2);
  });

  it('the next run is saved before the run: a crash in the middle never repeats it', async () => {
    const file = tmpFile();
    const r = rig(file);
    const id = created(r);
    expect(r.svc.state().activities[0]!.nextAt).toBe(T0);
    let release!: () => void;
    r.reads.mockImplementationOnce(() => new Promise<ActivityReadResult>(res => { release = () => res({ items: [] }); }));
    const pending = r.svc.run({ id });
    await vi.waitFor(() => expect(r.reads).toHaveBeenCalled());
    // «crash»: the app restarts from the file while the run is still in the air
    const after = rig(file, { t: T0 + MIN });
    expect(after.svc.state().activities[0]).toMatchObject({ id, nextAt: T0 + 30 * MIN });
    await after.svc.tick();
    expect(after.reads).not.toHaveBeenCalled();   // not due yet: no repeat
    release();
    await pending;
  });

  it('a failed read is an error, keeps the cursor, and never loops (the next slot is already planned)', async () => {
    const r = rig();
    const id = created(r);
    r.src.result = { items: [], error: 'accesso scaduto' };
    const res = await r.svc.run({ id });
    expect(res.ok && res.run).toMatchObject({ status: 'error', error: 'accesso scaduto', usedModel: false });
    await r.svc.tick();
    expect(r.reads).toHaveBeenCalledTimes(1);
    r.src.result = { items: [item('a', T0 - MIN)] };
    r.clock.t += 30 * MIN;
    await r.svc.tick();
    expect(r.ai).toHaveBeenCalledTimes(1);   // the item that came after the failure is still there to triage
  });

  it('a triage failure keeps the cursor: the items come back at the next run', async () => {
    const r = rig();
    const id = created(r);
    r.src.result = { items: [item('a', T0 - MIN)] };
    r.ai.mockResolvedValueOnce({ ok: false, error: 'modello non raggiungibile' } as never);
    const bad = await r.svc.run({ id });
    expect(bad.ok && bad.run).toMatchObject({ status: 'error', usedModel: true });
    const good = await r.svc.run({ id });
    expect(good.ok && good.run).toMatchObject({ status: 'quiet', kept: 1 });
  });

  it('the timer runs what is due, once, and the global pause stops it while «Esegui ora» still works', async () => {
    const r = rig();
    const id = created(r);
    await r.svc.tick();
    expect(r.reads).toHaveBeenCalledTimes(1);
    await r.svc.tick();
    expect(r.reads).toHaveBeenCalledTimes(1);   // next slot is in 30 minutes
    r.clock.t += 31 * MIN;
    r.svc.pause({ paused: true });
    await r.svc.tick();
    expect(r.reads).toHaveBeenCalledTimes(1);
    expect(r.svc.state().activities[0]!.nextAt).toBeNull();
    await r.svc.run({ id });
    expect(r.reads).toHaveBeenCalledTimes(2);
    r.svc.pause({ paused: false });
    r.clock.t += 31 * MIN;
    await r.svc.tick();
    expect(r.reads).toHaveBeenCalledTimes(3);
  });

  it('the catalog: validation errors in the user words, enable/disable, remove, history of 20, survives a restart', async () => {
    const file = tmpFile();
    const r = rig(file);
    expect(r.svc.save({ input: { name: 'x', source: 'outlook', propose: '' } })).toMatchObject({ ok: false });
    const id = created(r, input({ enabled: false }));
    expect(r.svc.state().activities[0]).toMatchObject({ enabled: false, nextAt: null, scheduleText: 'ogni 30 min' });
    r.svc.enable({ id, on: true });
    expect(r.svc.state().activities[0]!.nextAt).toBe(T0);
    for (let i = 0; i < 25; i++) { r.clock.t += MIN; await r.svc.run({ id }); }
    expect(r.svc.history(id)).toHaveLength(20);
    expect(r.svc.history(id)[0]!.at).toBeGreaterThan(r.svc.history(id)[1]!.at);
    const reborn = rig(file);
    expect(reborn.svc.state().activities.map(a => a.name)).toEqual(['Posta']);
    expect(reborn.svc.history(id)).toHaveLength(20);
    expect(r.svc.remove({ id })).toMatchObject({ ok: true });
    expect(r.svc.state().activities).toHaveLength(0);
    await expect(r.svc.run({ id })).resolves.toMatchObject({ ok: false });
  });

  it('a reader that is missing or throws is a visible error', async () => {
    const r = rig();
    const id = created(r);
    r.reads.mockRejectedValueOnce(new Error('boom'));
    expect((await r.svc.run({ id })).ok && true).toBe(true);
    expect(r.svc.history(id)[0]).toMatchObject({ status: 'error' });
    const g = r.svc.save({ input: input({ source: 'gmail', name: 'Gmail' }) });
    expect(g.ok && (await r.svc.run({ id: g.id })).ok).toBe(true);
    expect(r.svc.history(g.ok ? g.id : '')[0]!.error).toContain('non è collegato');
  });

  it('the handlers call the service; without one they answer the placeholder', async () => {
    const r = rig();
    const h = activitiesHandlers(r.svc);
    expect(await h['activities:state'](undefined, undefined as never)).toMatchObject({ activities: [], paused: false });
    expect(await activitiesHandlers()['activities:run']({ id: 'x' }, undefined as never)).toMatchObject({ ok: false });
  });
});

describe('triage prompt and answer', () => {
  it('fences the data and keeps the fence out of it', () => {
    const p = triagePrompt({ name: 'n', source: 'teams', propose: 'p' }, [{ key: 'k', from: 'FENCE', title: 't', text: 'x' }], 'FENCE');
    expect(p.split('FENCE').length).toBe(4);   // the two fence lines and the sentence naming it; the data's own copy was removed
  });
  it('parses a JSON list inside prose, drops unknown keys, repeats and empty actions; rejects text without a list', () => {
    const items = [{ key: 'a', title: 'A' }, { key: 'b', title: 'B', url: 'https://example.test/b' }];
    expect(parseProposals('x [{"key":"b","action":" fai   questo "},{"key":"b","action":"due"},{"key":"a","action":""},{"key":"q","action":"no"}] y', items)).toEqual([{ key: 'b', title: 'B', action: 'fai questo', url: 'https://example.test/b' }]);
    expect(() => parseProposals('niente', items)).toThrow();
    expect(() => parseProposals('[oops', items)).toThrow();
  });
});
