// The CPU-aware queue (admission.ts, ADR 0036) with a fake load sampler: FIFO, hysteresis (two samples under), one
// admission per sample, "Avvia ora", the switch; then ChatManager against the fake CLI: an agent's new chat and an
// agent's message to an idle chat wait while the load is high, the user's own message never waits (and takes the
// queued one with it), a queued chat closed by hand drops its work, no warm engine starts while busy.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AdmissionQueue, MAIL_WAITS, forcedSampler, type AdmissionLimits, type LoadSample } from '../../../src/main/chats/admission';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { FAKE, fakeLog, recEmitter, tmp, waitFor } from './helpers';

function fakeLoad(cpu = 90, freeRam = 50) {
  const load: LoadSample = { cpu, freeRam };
  return { load, sampler: { sample: () => ({ ...load }) } };
}
const ON: AdmissionLimits = { enabled: true, cpu: 75, ram: 15 };

describe('AdmissionQueue', () => {
  it('runs at once under the thresholds, queues over them (CPU or RAM)', () => {
    const f = fakeLoad(40, 50);
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ON, autoTick: false });
    const ran: string[] = [];
    expect(q.request('a', 'start', () => ran.push('a'))).toBeNull();
    f.load.freeRam = 10;
    expect(q.request('b', 'start', () => ran.push('b'))?.position).toBe(1);
    f.load.freeRam = 50; f.load.cpu = 80;
    expect(q.request('c', 'turn', () => ran.push('c'))?.position).toBe(2);
    expect(ran).toEqual(['a']);
  });

  it('nobody jumps the queue: under the thresholds a new request still waits behind the others', () => {
    const f = fakeLoad();
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ON, autoTick: false });
    const ran: string[] = [];
    q.request('a', 'start', () => ran.push('a'));
    f.load.cpu = 10;
    expect(q.request('b', 'start', () => ran.push('b'))?.position).toBe(2);
    expect(ran).toEqual([]);
  });

  it('admits FIFO, one per sample, after two samples in a row under', () => {
    const f = fakeLoad();
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ON, autoTick: false });
    const ran: string[] = [];
    for (const k of ['a', 'b', 'c']) q.request(k, 'start', () => ran.push(k));
    f.load.cpu = 50;
    q.tick(); expect(ran).toEqual([]);           // one sample under: not yet
    f.load.cpu = 90;
    q.tick(); expect(ran).toEqual([]);           // back over: the count restarts
    f.load.cpu = 50;
    q.tick(); q.tick(); expect(ran).toEqual(['a']);
    q.tick(); expect(ran).toEqual(['a']);        // the admitted one needs time to show in the load
    q.tick(); expect(ran).toEqual(['a', 'b']);
    expect(q.list().map(e => [e.key, e.position])).toEqual([['c', 1]]);
    q.tick(); q.tick();
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(q.list()).toEqual([]);
  });

  it('a key already waiting keeps its messages in order behind one entry', () => {
    const f = fakeLoad();
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ON, autoTick: false });
    const ran: string[] = [];
    q.request('a', 'start', () => ran.push('a1'));
    q.request('b', 'turn', () => ran.push('b'));
    expect(q.request('a', 'turn', () => ran.push('a2'))?.position).toBe(1);
    expect(q.admitNow('a')).toBe(true);
    expect(ran).toEqual(['a1', 'a2']);
    expect(q.admitNow('a')).toBe(false);
    expect(q.entry('b')?.position).toBe(1);
  });

  it('drop forgets the work; the switch turned off lets everything go in order; busy() says when not to prewarm', () => {
    const f = fakeLoad();
    let limits = ON;
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => limits, autoTick: false });
    const ran: string[] = [];
    expect(q.busy()).toBe(true);
    q.request('a', 'start', () => ran.push('a'));
    q.request('b', 'start', () => ran.push('b'));
    q.request('c', 'start', () => ran.push('c'));
    expect(q.drop('b')).toBe(true);
    f.load.cpu = 10;
    expect(q.busy()).toBe(true);                 // someone waits
    limits = { ...ON, enabled: false };
    q.tick();
    expect(ran).toEqual(['a', 'c']);
    expect(q.busy()).toBe(false);
    f.load.cpu = 99;
    expect(q.request('d', 'start', () => ran.push('d'))).toBeNull(); // off: never waits
  });

  it('SB_LOAD_FORCE parses "cpu,freeRam" and refuses anything else', () => {
    expect(forcedSampler('95,40')?.sample()).toEqual({ cpu: 95, freeRam: 40 });
    expect(forcedSampler(undefined)).toBeNull();
    expect(forcedSampler('lots')).toBeNull();
  });
});

describe('ChatManager with the CPU queue', () => {
  const managers: ChatManager[] = [];
  afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });
  function setup(extra: Partial<ChatManagerOptions> = {}, before?: (ud: string, cwd: string) => void) {
    const ud = tmp('ud'), home = tmp('home'), cwd = tmp('cwd');
    before?.(ud, cwd);
    const argLog = `${ud}/argv.jsonl`;
    const f = fakeLoad();
    const m = new ChatManager({
      emitter: recEmitter(), userData: ud, claudePath: FAKE, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: argLog },
      admission: { sampler: f.sampler, limits: () => ON, autoTick: false }, ...extra,
    });
    managers.push(m);
    const starts = () => fakeLog(argLog).filter(l => l.argv).length;
    const users = (id: string) => m.items(id).filter(i => i.kind === 'user').map(i => (i as { text: string }).text);
    return { m, f, cwd, starts, users };
  }

  it("an agent's new chat waits (no engine started) and starts with \"Avvia ora\"", async () => {
    const { m, cwd, starts, users } = setup();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'do it' }, 'agent');
    expect(c.queued).toMatchObject({ kind: 'start', position: 1, cpu: 90, freeRam: 50 });
    expect(c.state).toBe('idle');
    expect(m.queueState()?.waiting.map(w => w.chatId)).toEqual([c.id]);
    await new Promise(r => setTimeout(r, 300));
    expect(starts()).toBe(0);
    expect(m.admitNow(c.id)).toBe(true);
    await waitFor(() => users(c.id).includes('do it'), 'the queued prompt delivered');
    expect(m.list().find(x => x.id === c.id)?.queued).toBeUndefined();
    await waitFor(() => starts() === 1, 'its engine');
  });

  it("the user's own chat and message never wait; the user's message takes the queued one with it, in order", async () => {
    const { m, cwd, users } = setup();
    const mine = await m.create({ harness: 'claude', cwd, prompt: 'mine' });
    expect(mine.queued).toBeUndefined();
    await waitFor(() => m.list().find(x => x.id === mine.id)?.state === 'idle', 'my turn done');
    // an agent's message to the idle chat waits for the load
    await m.send(mine.id, 'from the regia', undefined, false, 'Regia');
    expect(m.list().find(x => x.id === mine.id)?.queued?.kind).toBe('turn');
    expect(users(mine.id)).toEqual(['mine']);
    await m.send(mine.id, 'me again');
    await waitFor(() => users(mine.id).length === 3, 'both delivered');
    expect(users(mine.id)).toEqual(['mine', 'from the regia', 'me again']);
    expect(m.list().find(x => x.id === mine.id)?.queued).toBeUndefined();
  });

  it('the load dropping admits the chat by itself; a queued chat closed by hand drops its work', async () => {
    const { m, f, cwd, users, starts } = setup();
    const a = await m.create({ harness: 'claude', cwd, prompt: 'a' }, 'agent');
    const b = await m.create({ harness: 'claude', cwd, prompt: 'b' }, 'agent');
    expect(m.list().find(x => x.id === b.id)?.queued?.position).toBe(2);
    await m.close(b.id);
    expect(m.queueState()?.waiting.map(w => w.chatId)).toEqual([a.id]);
    f.load.cpu = 30;
    const q = (m as unknown as { admission: AdmissionQueue }).admission;
    q.tick(); q.tick();
    await waitFor(() => users(a.id).includes('a'), 'admitted when the load dropped');
    await waitFor(() => starts() >= 1, 'its engine');
    await new Promise(r => setTimeout(r, 500));
    expect(starts()).toBe(1); // b's engine never started
  });

  it('no warm engine is started while the machine is busy', async () => {
    const { m, cwd, starts } = setup({ prewarm: true, prewarmDelayMs: 0 });
    await m.create({ harness: 'claude', cwd, prompt: 'x' }); // the user's: starts at once
    await waitFor(() => starts() >= 1, 'its engine');
    await new Promise(r => setTimeout(r, 800));
    expect(starts()).toBe(1); // its own engine, no waiting one next to it
  });

  it('chats cut by a restart resume through the queue, not all at once', async () => {
    const cut = (id: string, cwd: string) => ({ id, harness: 'claude', cwd, sessionId: crypto.randomUUID(), title: id, model: null, effort: null, permissionMode: null, isRegia: false, createdAt: 1, working: true });
    const { m, starts } = setup({}, (ud, cwd) => fs.writeFileSync(path.join(ud, 'chats.json'), JSON.stringify({ version: 2, chats: [cut('c_a', cwd), cut('c_b', cwd)] })));
    expect(m.resumeInterrupted()).toBe(2);
    await new Promise(r => setTimeout(r, 50));
    expect(m.queueState()?.waiting.map(w => [w.chatId, w.kind, w.position])).toEqual([['c_a', 'start', 1], ['c_b', 'start', 2]]);
    await new Promise(r => setTimeout(r, 300));
    expect(starts()).toBe(0);
  });

  it('chat mail is never held in the queue: it fails, so the mail stays unread', async () => {
    const { m, f, cwd, users } = setup();
    f.load.cpu = 10;
    const c = await m.create({ harness: 'claude', cwd, prompt: 'go' });
    await waitFor(() => m.list().find(x => x.id === c.id)?.state === 'idle', 'turn done');
    f.load.cpu = 95;
    await expect(m.send(c.id, 'mail', undefined, false, 'Altra chat', true)).rejects.toThrow(MAIL_WAITS);
    expect(m.queueState()?.waiting).toEqual([]);
    expect(users(c.id)).toEqual(['go']);
  });
});
