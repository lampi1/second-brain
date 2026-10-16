// The CPU-aware queue (admission.ts, ADR 0036) with a fake load sampler: FIFO, the app's chats behind the work chats,
// hysteresis (two samples under), one
// admission per sample, "Avvia ora", the switch; then ChatManager against the fake CLI: an agent's new chat and an
// agent reopening a closed chat wait while the load is high, the user's own message and a message between chats never
// wait (and take the chat's queued work with them, in order; ADR 0064: mail to an idle chat starved for hours), a queued chat closed by hand drops its work, no warm engine starts while busy; a queued chat
// never looks busy, so the Regia is never told it "finished" a turn it did not run (2026-10-14).
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AdmissionQueue, forcedSampler, type AdmissionLimits, type LoadSample } from '../../../src/main/chats/admission';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { RegiaWake } from '../../../src/main/chats/regia-wake';
import { ChatMail, inboxDir, sendMail, slug, unread } from '../../../src/main/chats/mail';
import type { ChatSummary } from '../../../src/shared/contract';
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

  it("the app's chats wait behind every work chat, each in order of arrival; a running one is never stopped", () => {
    const f = fakeLoad();
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ON, autoTick: false });
    const ran: string[] = [];
    const req = (k: string, app: boolean) => q.request(k, 'start', () => ran.push(k), app);
    req('app1', true); req('app2', true);
    expect(req('work1', false)?.position).toBe(1);
    expect(req('work2', false)?.position).toBe(2);
    expect(req('app3', true)?.position).toBe(5);
    expect(q.list().map(e => [e.key, !!e.app])).toEqual([['work1', false], ['work2', false], ['app1', true], ['app2', true], ['app3', true]]);
    q.request('app1', 'turn', () => ran.push('app1+'), false); // a later message of a waiting key joins its entry
    expect(q.entry('app1')?.position).toBe(3);
    f.load.cpu = 50;
    for (let i = 0; i < 10; i++) q.tick();
    expect(ran).toEqual(['work1', 'work2', 'app1', 'app1+', 'app2', 'app3']);
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
      emitter: recEmitter(), userData: ud, enginePaths: { claude: FAKE }, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: argLog },
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

  it('a queued chat never looks busy: no "ha finito il turno" to the Regia before its first turn ran', async () => {
    const emitter = recEmitter();
    const { m, cwd, users } = setup({ emitter });
    const sent: string[] = [];
    const wake = new RegiaWake({ send: async (_id, text) => { sent.push(text); }, enabled: () => true, list: () => m.list(), groupMs: 50, perChatMs: 0 });
    const regia = await m.create({ harness: 'claude', cwd, regia: true });
    const c = await m.create({ harness: 'claude', cwd, prompt: 'screenshot nelle PR' }, 'agent');
    for (const e of emitter.events) wake.observe(e.channel, e.payload);
    const states = (emitter.of('chat:updated') as ChatSummary[]).filter(x => x.id === c.id).map(x => x.state);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every(s => s === 'idle')).toBe(true); // never 'starting': nothing started
    expect(m.workMs(c.id)).toBe(0); // no work time while it waits
    await new Promise(r => setTimeout(r, 200));
    expect(wake.queued()).toEqual([]);
    expect(sent).toEqual([]);
    // admitted, its real turn runs and ends: that one is told
    const seen = emitter.events.length;
    m.admitNow(c.id);
    await waitFor(() => users(c.id).includes('screenshot nelle PR') && m.list().find(x => x.id === c.id)?.lastResult !== undefined, 'its first turn');
    await waitFor(() => m.list().find(x => x.id === c.id)?.state === 'idle', 'turn over');
    for (const e of emitter.events.slice(seen)) wake.observe(e.channel, e.payload);
    expect(wake.queued().map(e => [e.chatId, e.kind])).toEqual([[c.id, 'done']]);
    wake.stop();
    void regia;
  });

  it("the user's own chat and message never wait; the user's message takes the queued one with it, in order", async () => {
    const { m, cwd, users } = setup();
    const mine = await m.create({ harness: 'claude', cwd, prompt: 'mine' });
    expect(mine.queued).toBeUndefined();
    await waitFor(() => m.list().find(x => x.id === mine.id)?.state === 'idle', 'my turn done');
    // an agent reopening it once closed (archived) waits for the load (a new engine)
    await m.archive(mine.id);
    await m.send(mine.id, 'from the regia', undefined, false, 'Regia');
    expect(m.list().find(x => x.id === mine.id)?.queued?.kind).toBe('start');
    expect(users(mine.id)).toEqual(['mine']);
    await m.send(mine.id, 'me again');
    await waitFor(() => users(mine.id).length === 3, 'both delivered');
    expect(users(mine.id)).toEqual(['mine', 'from the regia', 'me again']);
    expect(m.list().find(x => x.id === mine.id)?.queued).toBeUndefined();
  });

  it("a message between chats to an open chat never waits for the load (app_send_to_chat), after the chat's own queued work", async () => {
    const { m, cwd, users } = setup();
    const mine = await m.create({ harness: 'claude', cwd, prompt: 'mine' });
    await waitFor(() => m.list().find(x => x.id === mine.id)?.state === 'idle', 'my turn done');
    await m.send(mine.id, 'from the regia', undefined, false, 'Regia');
    expect(m.list().find(x => x.id === mine.id)?.queued).toBeUndefined();
    await waitFor(() => users(mine.id).includes('from the regia'), 'a new turn at once, CPU 90%');
    // a chat whose first turn still waits in the queue: that work goes first, then the message
    const queued = await m.create({ harness: 'claude', cwd, prompt: 'do it' }, 'agent');
    expect(queued.queued?.kind).toBe('start');
    await m.send(queued.id, 'and this', undefined, false, 'Regia');
    await waitFor(() => users(queued.id).length === 2, 'both delivered');
    expect(users(queued.id)).toEqual(['do it', 'and this']);
    expect(m.queueState()?.waiting).toEqual([]);
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

  it("an app chat's queued work goes after a work chat's that came later", async () => {
    const { m, f, cwd, users } = setup();
    const app = await m.create({ harness: 'claude', cwd, prompt: 'fix the app', title: 'App · coda' }, 'agent');
    const pers = await m.create({ harness: 'claude', cwd, prompt: 'pers app', title: 'Pers · App: tile' }, 'agent');
    const improve = await m.create({ harness: 'claude', cwd, prompt: 'improve', title: 'Qualcosa', space: 'app' }, 'agent');
    const work = await m.create({ harness: 'claude', cwd, prompt: 'plan it', title: 'Shop · sprint' }, 'agent');
    expect(m.queueState()?.waiting.map(w => w.chatId)).toEqual([work.id, app.id, pers.id, improve.id]);
    expect(m.list().find(x => x.id === work.id)?.queued?.position).toBe(1);
    expect(m.list().find(x => x.id === app.id)?.queued?.position).toBe(2);
    f.load.cpu = 30;
    const q = (m as unknown as { admission: AdmissionQueue }).admission;
    q.tick(); q.tick();
    await waitFor(() => users(work.id).includes('plan it'), 'the work chat admitted first');
    expect(users(app.id)).toEqual([]);
  });

  it('chat mail reaches an idle chat at once under load, as a new turn: taken once, never put back (ADR 0064)', async () => {
    const { m, f, cwd, users } = setup();
    f.load.cpu = 10;
    const c = await m.create({ harness: 'claude', cwd, prompt: 'go', title: 'Shop · sprint' });
    await waitFor(() => m.list().find(x => x.id === c.id)?.state === 'idle', 'turn done');
    f.load.cpu = 95;
    // someone else's work waits in the queue too: the mail does not wait behind it
    const other = await m.create({ harness: 'claude', cwd, prompt: 'other' }, 'agent');
    expect(other.queued?.position).toBe(1);
    const root = tmp('brain');
    const dir = inboxDir(root);
    sendMail(dir, { from: 'Regia', fromHarness: 'claude', to: 'Shop · sprint', toHarness: 'claude', text: 'riprendi il lavoro', refusal: () => null });
    const mail = new ChatMail({ root: () => root, chats: m, instance: 'second-brain-dev' });
    expect(await mail.tick()).toBe(1);
    mail.stop();
    await waitFor(() => users(c.id).some(t => t.includes('riprendi il lavoro')), 'the mail as a new turn');
    expect(unread(dir, slug('Shop · sprint'))).toEqual([]);
    const actions = fs.readFileSync(path.join(dir, 'inbox.log'), 'utf8').trim().split('\n').map(l => (JSON.parse(l) as { action: string }).action);
    expect(actions).toEqual(['sent', 'delivered']);
    expect(m.queueState()?.waiting.map(w => w.chatId)).toEqual([other.id]);
  });
});
