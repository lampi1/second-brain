// The cold-start queue (admission.ts, ADR 0222, superseding ADR 0036) with a fake load sampler: at most `slots` cold
// starts at once (cores/2), a slot held until its run calls done (or slotMaxMs, or drop), a 'turn' never waiting; the
// emergency brake (95 % CPU / 10 % free RAM) with hysteresis (two samples under); FIFO, the app's chats behind the
// work chats, "Avvia ora" past the cap, the switch; then ChatManager against the fake CLI: an agent's new chat and an
// agent reopening a closed chat wait while the brake is on or every slot is taken, the slot frees at the engine's first
// answer, the user's own message and a message between chats never wait (and take the chat's queued work with them, in
// order; ADR 0064: mail to an idle chat starved for hours), a queued chat closed by hand drops its work, no warm engine
// starts while braking but one does while chats wait for a slot; a queued chat never looks busy, so the Orchestrator is
// never told it "finished" a turn it did not run (2026-10-14).
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.
import { describe, expect, it } from 'vitest';
import { AdmissionQueue, coldStartSlots, forcedSampler, type AdmissionLimits, type LoadSample } from '../../../src/main/chats/admission';
import { waitFor } from './helpers';

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

  it('a key started again while its slot is held keeps one slot, and the new run can free it', () => {
    const f = fakeLoad(10, 60);
    const q = new AdmissionQueue({ sampler: f.sampler, limits: () => ({ ...ON, slots: 2 }), autoTick: false });
    const done: (() => void)[] = [];
    q.request('a', 'start', d => { done.push(d); });
    q.request('a', 'start', d => { done.push(d); });
    expect(q.slots()).toEqual({ starting: 1, slots: 2 });
    done[1]!();                           // the later run's first answer: no wait for the 120 s cap
    expect(q.slots()).toEqual({ starting: 0, slots: 2 });
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
    expect(q.held()).toBe(true);                 // the tile says the brake, not «dietro altre»
    f.load.cpu = 99;
    q.tick(); expect(ran).toEqual([]);           // back over: the count restarts
    f.load.cpu = 50;
    q.tick(); q.tick(); expect(ran).toEqual(['a', 'b']);
    expect(q.held()).toBe(false);
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
