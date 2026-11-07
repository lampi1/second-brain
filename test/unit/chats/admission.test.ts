// The cold-start queue (admission.ts, ADR 0221, superseding ADR 0036) with a fake load sampler: at most `slots` cold
// starts at once (cores/2), a slot held until its run calls done (or slotMaxMs, or drop), a 'turn' never waiting; the
// emergency brake (95 % CPU / 10 % free RAM) with hysteresis (two samples under); FIFO, the app's chats behind the
// work chats, "Avvia ora" past the cap, the switch; then ChatManager against the fake CLI: an agent's new chat and an
// agent reopening a closed chat wait while the brake is on or every slot is taken, the slot frees at the engine's first
// answer, the user's own message and a message between chats never wait (and take the chat's queued work with them, in
// order; ADR 0064: mail to an idle chat starved for hours), a queued chat closed by hand drops its work, no warm engine
// starts while braking but one does while chats wait for a slot; a queued chat never looks busy, so the Orchestrator is
// never told it "finished" a turn it did not run (2026-10-14).
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AdmissionQueue, coldStartSlots, forcedSampler, type AdmissionLimits, type LoadSample } from '../../../src/main/chats/admission';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { OrchestratorWake } from '../../../src/main/chats/orchestrator-wake';
import { ChatMail, inboxDir, sendMail, slug, unread } from '../../../src/main/chats/mail';
import type { ChatSummary } from '../../../src/shared/contract';
import { log } from '../../../src/main/log';
import { FAKE, fakeLog, recEmitter, tmp, waitFor } from './helpers';

/** default: over the emergency brake */
function fakeLoad(cpu = 99, freeRam = 50) {
  const load: LoadSample = { cpu, freeRam };
  return { load, sampler: { sample: () => ({ ...load }) } };
}
const ON: AdmissionLimits = { enabled: true, cpu: 95, ram: 10, slots: 8 };

describe('AdmissionQueue', () => {
  it('cold starts get cores/2 slots, at least one', () => {
    expect(coldStartSlots(14)).toBe(7);
    expect(coldStartSlots(3)).toBe(1);
    expect(coldStartSlots(1)).toBe(1);
    expect(coldStartSlots()).toBeGreaterThanOrEqual(1);
  });

  it('runs at once under the brake, queues over it (CPU or RAM); a turn never waits', () => {
    const f = fakeLoad(40, 50);
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ON, autoTick: false });
    const ran: string[] = [];
    expect(q.request('a', 'start', () => ran.push('a'))).toBeNull();
    f.load.freeRam = 5;
    expect(q.request('b', 'start', () => ran.push('b'))?.position).toBe(1);
    f.load.freeRam = 50; f.load.cpu = 99;
    expect(q.request('c', 'start', () => ran.push('c'))?.position).toBe(2);
    expect(q.request('d', 'turn', () => ran.push('d'))).toBeNull(); // its engine is up: never waits, not even braked
    expect(ran).toEqual(['a', 'd']);
  });

  it('on a calm machine only the slots limit cold starts; each frees its slot once, at done', () => {
    const f = fakeLoad(10, 60);
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ({ ...ON, slots: 2 }), autoTick: false });
    const ran: string[] = [];
    const done: Record<string, () => void> = {};
    const req = (k: string) => q.request(k, 'start', d => { ran.push(k); done[k] = d; });
    expect(req('a')).toBeNull();
    expect(req('b')).toBeNull();
    expect(q.slots()).toEqual({ starting: 2, slots: 2 });
    expect(req('c')?.position).toBe(1);   // every slot taken, the CPU is fine
    expect(req('d')?.position).toBe(2);
    expect(ran).toEqual(['a', 'b']);
    done.b!();
    expect(ran).toEqual(['a', 'b', 'c']);
    done.b!();                            // twice: still one slot
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(q.slots()).toEqual({ starting: 2, slots: 2 });
    done.a!();
    expect(ran).toEqual(['a', 'b', 'c', 'd']);
    expect(q.list()).toEqual([]);
  });

  it('a slot whose run never reports back frees itself after slotMaxMs', async () => {
    const f = fakeLoad(10, 60);
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ({ ...ON, slots: 1 }), autoTick: false, slotMaxMs: 30 });
    const ran: string[] = [];
    q.request('a', 'start', () => ran.push('a'));
    expect(q.request('b', 'start', () => ran.push('b'))?.position).toBe(1);
    await waitFor(() => ran.includes('b'), 'b admitted when a\'s slot timed out');
    q.stop();
  });

  it('"Avvia ora" goes past the cap; closing a starting chat frees its slot', () => {
    const f = fakeLoad(10, 60);
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ({ ...ON, slots: 1 }), autoTick: false });
    const ran: string[] = [];
    q.request('a', 'start', () => ran.push('a'));
    q.request('b', 'start', () => ran.push('b'));
    q.request('c', 'start', () => ran.push('c'));
    expect(q.admitNow('b')).toBe(true);
    expect(q.slots()).toEqual({ starting: 2, slots: 1 });
    expect(ran).toEqual(['a', 'b']);
    q.drop('a');                          // still one over the cap: c waits
    expect(ran).toEqual(['a', 'b']);
    q.drop('b');
    expect(ran).toEqual(['a', 'b', 'c']);
  });

  it('nobody jumps the queue: under the brake a new request still waits behind the others', () => {
    const f = fakeLoad();
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ON, autoTick: false });
    const ran: string[] = [];
    q.request('a', 'start', () => ran.push('a'));
    f.load.cpu = 10;
    expect(q.request('b', 'start', () => ran.push('b'))?.position).toBe(2);
    expect(ran).toEqual([]);
  });

  it('after the brake: two samples in a row under, then FIFO up to the free slots', () => {
    const f = fakeLoad();
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ({ ...ON, slots: 2 }), autoTick: false });
    const ran: string[] = [];
    const done: Record<string, () => void> = {};
    for (const k of ['a', 'b', 'c']) q.request(k, 'start', d => { ran.push(k); done[k] = d; });
    f.load.cpu = 50;
    q.tick(); expect(ran).toEqual([]);           // one sample under: not yet
    f.load.cpu = 99;
    q.tick(); expect(ran).toEqual([]);           // back over: the count restarts
    f.load.cpu = 50;
    q.tick(); q.tick(); expect(ran).toEqual(['a', 'b']);
    expect(q.list().map(e => [e.key, e.position])).toEqual([['c', 1]]);
    f.load.cpu = 99;
    done.a!();                                   // a slot frees with the brake on: c still waits
    expect(ran).toEqual(['a', 'b']);
    f.load.cpu = 50;
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
    q.request('b', 'start', () => ran.push('b'));
    expect(q.request('a', 'turn', () => ran.push('a2'))?.position).toBe(1);
    expect(q.admitNow('a')).toBe(true);
    expect(ran).toEqual(['a1', 'a2']);
    expect(q.admitNow('a')).toBe(false);
    expect(q.entry('b')?.position).toBe(1);
  });

  it('drop forgets the work; the switch turned off lets everything go in order; braking() only follows the brake', () => {
    const f = fakeLoad();
    let limits = ON;
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => limits, autoTick: false });
    const ran: string[] = [];
    expect(q.braking()).toBe(true);
    q.request('a', 'start', () => ran.push('a'));
    q.request('b', 'start', () => ran.push('b'));
    q.request('c', 'start', () => ran.push('c'));
    expect(q.drop('b')).toBe(true);
    f.load.cpu = 10;
    expect(q.braking()).toBe(false);             // chats wait, yet a warm engine may start: the next one adopts it
    limits = { ...ON, enabled: false };
    q.tick();
    expect(ran).toEqual(['a', 'c']);
    f.load.cpu = 99;
    expect(q.braking()).toBe(false);             // off: never
    expect(q.request('d', 'start', () => ran.push('d'))).toBeNull(); // off: never waits
  });

  it('SB_LOAD_FORCE parses "cpu,freeRam" and refuses anything else', () => {
    expect(forcedSampler('99,40')?.sample()).toEqual({ cpu: 99, freeRam: 40 });
    expect(forcedSampler(undefined)).toBeNull();
    expect(forcedSampler('lots')).toBeNull();
  });
});

describe('ChatManager with the cold-start queue', () => {
  const managers: ChatManager[] = [];
  afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });
  /** load: the fake one at the start (default over the brake); slots: the cap (default 8) */
  function setup(extra: Partial<ChatManagerOptions> = {}, before?: (ud: string, cwd: string) => void, at: { cpu?: number; freeRam?: number; slots?: number } = {}) {
    const ud = tmp('ud'), home = tmp('home'), cwd = tmp('cwd');
    before?.(ud, cwd);
    const argLog = `${ud}/argv.jsonl`;
    const f = fakeLoad(at.cpu, at.freeRam);
    const m = new ChatManager({
      emitter: recEmitter(), userData: ud, enginePaths: { claude: FAKE }, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: argLog },
      admission: { sampler: f.sampler, limits: () => ({ ...ON, slots: at.slots ?? ON.slots }), autoTick: false }, ...extra,
    });
    managers.push(m);
    const starts = () => fakeLog(argLog).filter(l => l.argv).length;
    const users = (id: string) => m.items(id).filter(i => i.kind === 'user').map(i => (i as { text: string }).text);
    return { m, f, cwd, starts, users };
  }

  it("an agent's new chat waits (no engine started) and starts with \"Avvia ora\"", async () => {
    const { m, cwd, starts, users } = setup();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'do it' }, 'agent');
    expect(c.queued).toMatchObject({ kind: 'start', position: 1, cpu: 99, freeRam: 50, starting: 0, slots: 8 });
    expect(c.state).toBe('idle');
    expect(m.queueState()?.waiting.map(w => w.chatId)).toEqual([c.id]);
    await new Promise(r => setTimeout(r, 300));
    expect(starts()).toBe(0);
    expect(m.admitNow(c.id)).toBe(true);
    await waitFor(() => users(c.id).includes('do it'), 'the queued prompt delivered');
    expect(m.list().find(x => x.id === c.id)?.queued).toBeUndefined();
    await waitFor(() => starts() === 1, 'its engine');
  });

  it('a queued chat never looks busy: no "ha finito il turno" to the Orchestrator before its first turn ran', async () => {
    const emitter = recEmitter();
    const { m, cwd, users } = setup({ emitter });
    const sent: string[] = [];
    const wake = new OrchestratorWake({ send: async (_id, text) => { sent.push(text); }, enabled: () => true, list: () => m.list(), groupMs: 50, perChatMs: 0 });
    const orchestrator = await m.create({ harness: 'claude', cwd, orchestrator: true });
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
    void orchestrator;
  });

  it("a chat the Orchestrator opens while answering the user's own message never waits; one it opens on its own does", async () => {
    const { m, cwd, users } = setup();
    const orchestrator = await m.create({ harness: 'claude', cwd, orchestrator: true });
    await waitFor(() => m.list().find(x => x.id === orchestrator.id)?.state === 'idle', 'Orchestrator up');
    // with no turn of the user's going on, its new chat waits for the load as before
    const own = await m.create({ harness: 'claude', cwd, prompt: 'on its own' }, 'agent');
    expect(own.queued?.kind).toBe('start');
    await m.send(orchestrator.id, 'slow: the user asks something');
    await waitFor(() => m.list().find(x => x.id === orchestrator.id)?.state === 'running', 'the user\'s turn runs');
    const forUser = await m.create({ harness: 'claude', cwd, prompt: 'for the user' }, 'agent');
    expect(forUser.queued).toBeUndefined();
    await waitFor(() => users(forUser.id).includes('for the user'), 'delivered at once');
    expect(m.list().find(x => x.id === own.id)?.queued?.kind).toBe('start');
  });

  it("the user's own chat and message never wait; the user's message takes the queued one with it, in order", async () => {
    const { m, cwd, users } = setup();
    const mine = await m.create({ harness: 'claude', cwd, prompt: 'mine' });
    expect(mine.queued).toBeUndefined();
    await waitFor(() => m.list().find(x => x.id === mine.id)?.state === 'idle', 'my turn done');
    // an agent reopening it once closed (archived) waits for the load (a new engine). Closed by itself here: one the user
    // closed with ✕ an agent never reopens by writing to it (ADR 0217, close-tree.test.ts), and a chat without a role
    // never closes by itself, so the record says auto
    await m.archive(mine.id);
    const rec = (m as unknown as { chats: Map<string, { s: { closedBy?: string }; userClosing?: true }> }).chats.get(mine.id)!;
    rec.s.closedBy = 'auto'; delete rec.userClosing;
    await m.send(mine.id, 'from the orchestrator', undefined, false, 'Orchestrator');
    expect(m.list().find(x => x.id === mine.id)?.queued?.kind).toBe('start');
    expect(users(mine.id)).toEqual(['mine']);
    await m.send(mine.id, 'me again');
    await waitFor(() => users(mine.id).length === 3, 'both delivered');
    expect(users(mine.id)).toEqual(['mine', 'from the orchestrator', 'me again']);
    expect(m.list().find(x => x.id === mine.id)?.queued).toBeUndefined();
  });

  it("a message between chats to an open chat never waits for the load (app_send_to_chat), after the chat's own queued work", async () => {
    const { m, cwd, users } = setup();
    const mine = await m.create({ harness: 'claude', cwd, prompt: 'mine' });
    await waitFor(() => m.list().find(x => x.id === mine.id)?.state === 'idle', 'my turn done');
    await m.send(mine.id, 'from the orchestrator', undefined, false, 'Orchestrator');
    expect(m.list().find(x => x.id === mine.id)?.queued).toBeUndefined();
    await waitFor(() => users(mine.id).includes('from the orchestrator'), 'a new turn at once, CPU 99%');
    // a chat whose first turn still waits in the queue: that work goes first, then the message
    const queued = await m.create({ harness: 'claude', cwd, prompt: 'do it' }, 'agent');
    expect(queued.queued?.kind).toBe('start');
    await m.send(queued.id, 'and this', undefined, false, 'Orchestrator');
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

  it('no warm engine is started while the emergency brake is on', async () => {
    const { m, cwd, starts } = setup({ prewarm: true, prewarmDelayMs: 0 });
    await m.create({ harness: 'claude', cwd, prompt: 'x' }); // the user's: starts at once
    await waitFor(() => starts() >= 1, 'its engine');
    await new Promise(r => setTimeout(r, 800));
    expect(starts()).toBe(1); // its own engine, no waiting one next to it
  });

  it('a warm engine is started under the brake, whatever waits for a slot (proposal 2)', async () => {
    const { m, cwd, starts } = setup({ prewarm: true, prewarmDelayMs: 0 }, undefined, { cpu: 30, freeRam: 60 });
    await m.create({ harness: 'claude', cwd, prompt: 'x' }); // the user's: starts at once
    await waitFor(() => starts() >= 2, 'its engine and a warm one next to it');
  });

  it("a cold first turn logs its steps after the spawn: CLI setup, init, first event, MCP at init (proposal 6)", async () => {
    const info = vi.spyOn(log, 'info');
    try {
      const { m, cwd } = setup({}, undefined, { cpu: 10, freeRam: 60 });
      await m.create({ harness: 'claude', cwd, prompt: 'x' });
      const turn1 = () => info.mock.calls.find(c => c[1] === 'timing: turn' && (c[2] as { data?: { turn?: number } })?.data?.turn === 1);
      await waitFor(() => !!turn1(), 'the first turn timed');
      const d = (turn1()![2] as { data: Record<string, unknown> }).data;
      expect(d).toMatchObject({ warm: expect.any(Boolean), sentAfterSpawnMs: expect.any(Number), initAfterSpawnMs: expect.any(Number), stateAfterSpawnMs: expect.any(Number), firstEventAfterSpawnMs: expect.any(Number), mcpAtInit: expect.any(Number) });
      expect(d.firstEventAfterSpawnMs as number).toBeGreaterThanOrEqual(0);
    } finally { info.mockRestore(); }
  });

  it("a cold start holds its slot until its engine's first answer, then the next waiting chat starts", async () => {
    const { m, cwd, users } = setup({}, undefined, { cpu: 10, freeRam: 60, slots: 1 });
    const a = await m.create({ harness: 'claude', cwd, prompt: 'a' }, 'agent');
    const b = await m.create({ harness: 'claude', cwd, prompt: 'b' }, 'agent');
    expect(a.queued).toBeUndefined();
    expect(b.queued).toMatchObject({ kind: 'start', position: 1, starting: 1, slots: 1 });
    await waitFor(() => users(b.id).includes('b'), 'b admitted once a answered, no tick needed');
    expect(m.queueState()?.waiting).toEqual([]);
  });

  it('chats cut by a restart resume through the queue, not all at once', async () => {
    const cut = (id: string, cwd: string) => ({ id, harness: 'claude', cwd, sessionId: crypto.randomUUID(), title: id, model: null, effort: null, permissionMode: null, isOrchestrator: false, createdAt: 1, working: true });
    const { m, starts } = setup({}, (ud, cwd) => fs.writeFileSync(path.join(ud, 'chats.json'), JSON.stringify({ version: 2, chats: [cut('c_a', cwd), cut('c_b', cwd)] })));
    expect(m.resumeInterrupted()).toBe(2);
    await new Promise(r => setTimeout(r, 50));
    expect(m.queueState()?.waiting.map(w => [w.chatId, w.kind, w.position])).toEqual([['c_a', 'start', 1], ['c_b', 'start', 2]]);
    await new Promise(r => setTimeout(r, 300));
    expect(starts()).toBe(0);
  });

  it("an app chat's queued work goes after a work chat's that came later", async () => {
    const { m, f, cwd, users } = setup({}, undefined, { slots: 1 });
    const app = await m.create({ harness: 'claude', cwd, prompt: 'fix the app', title: 'App · coda' }, 'agent');
    const pers = await m.create({ harness: 'claude', cwd, prompt: 'pers app', title: 'Pers · App: tile' }, 'agent');
    const improve = await m.create({ harness: 'claude', cwd, prompt: 'improve', title: 'App · Qualcosa' }, 'agent');
    const work = await m.create({ harness: 'claude', cwd, prompt: 'plan it', title: 'Shop · sprint' }, 'agent');
    expect(m.queueState()?.waiting.map(w => w.chatId)).toEqual([work.id, app.id, pers.id, improve.id]);
    expect(m.list().find(x => x.id === work.id)?.queued?.position).toBe(1);
    expect(m.list().find(x => x.id === app.id)?.queued?.position).toBe(2);
    f.load.cpu = 30;
    const q = (m as unknown as { admission: AdmissionQueue }).admission;
    q.tick(); q.tick();
    // one slot: the work chat took it, the app's wait in their order
    expect(m.queueState()?.waiting.map(w => w.chatId)).toEqual([app.id, pers.id, improve.id]);
    await waitFor(() => users(work.id).includes('plan it'), 'the work chat admitted first');
  });

  it('chat mail reaches an idle chat at once under load, as a new turn: taken once, never put back (ADR 0064)', async () => {
    const { m, f, cwd, users } = setup();
    f.load.cpu = 10;
    const c = await m.create({ harness: 'claude', cwd, prompt: 'go', title: 'Shop · sprint' });
    await waitFor(() => m.list().find(x => x.id === c.id)?.state === 'idle', 'turn done');
    f.load.cpu = 99;
    // someone else's work waits in the queue too: the mail does not wait behind it
    const other = await m.create({ harness: 'claude', cwd, prompt: 'other' }, 'agent');
    expect(other.queued?.position).toBe(1);
    const root = tmp('brain');
    const dir = inboxDir(root);
    sendMail(dir, { from: 'Orchestrator', fromHarness: 'claude', to: 'Shop · sprint', toHarness: 'claude', text: 'riprendi il lavoro', refusal: () => null });
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

describe('workflow priority', () => {
  it('reorders queued work when linked to an incident, without interrupting running work', () => {
    const f = fakeLoad(); let urgent = false; const ran: string[] = [];
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ({ ...ON, slots: 1 }), autoTick: false, underNeeded: 1,
      priority: key => urgent && key === 'incident' ? 0 : key === 'support' ? 1 : 2 });
    for (const key of ['normal', 'incident', 'support']) q.request(key, 'start', () => ran.push(key));
    expect(q.list().map(e => e.key)).toEqual(['support', 'normal', 'incident']);
    urgent = true; expect(q.list()[0]!.key).toBe('incident');
    f.load.cpu = 10; q.tick(); expect(ran).toEqual(['incident']); q.stop();
  });
});
