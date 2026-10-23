import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import type { ChatSummary, HandoffInfo } from '../../../src/shared/contract';
import { AutoCloseService, autoCloseNow } from '../../../src/main/chats/auto-close';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(harness = 'anthropic', extra: Partial<ChatManagerOptions> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-auto-manager-')); roots.push(dir);
  let sink!: SessionSink, state = 'idle', seq = 0;
  const sent: string[] = [];
  const close = vi.fn(async () => { state = 'closed'; sink.changed({ state: 'closed' }); sink.exit({ code: 0, error: null }); });
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, ...extra, sessionFactory: (_h, _o, s) => {
    sink = s;
    return { harness, sessionId: null, pid: null, root: null, alive: true, get busy() { return state === 'running'; },
      start() { state = 'idle'; sink.changed({ state: 'idle' }); },
      send(text: string) { sent.push(text); state = 'running'; sink.changed({ state: 'running' }); sink.item({ kind: 'assistant', id: `a${++seq}`, at: Date.now(), text: 'Risultato' }, false); sink.item({ kind: 'result', id: `r${seq}`, at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false); state = 'idle'; sink.changed({ state: 'idle' }); },
      close, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } }); managers.push(m);
  return { m, dir, close, sent, sink: () => sink };
}
describe('main automatic archive reservations', () => {
  it('keeps assigned work and empty-mailbox waits open across completed provider turns until explicit completion', async () => {
    const f=fixture(),c=await f.m.create({harness:'anthropic',cwd:f.dir,model:'known',prompt:'Assigned work'},'agent');
    expect(f.m.list()[0]?.work?.status).toBe('assigned');
    expect(f.m.autoCloseCandidates(()=>false)[0]?.eligible).toBe(false);
    await f.m.set(c.id,{workStatus:'waiting-mail'});
    await f.m.send(c.id,'A status update, not an explicit completion');
    expect(f.m.list()[0]?.work?.status).toBe('waiting-mail');
    expect(await f.m.archiveAutomatic(c.id,()=>true)).toBe(false);
    expect(f.m.releaseIdle(1,Date.now()+600_000)).toBe(0);
    await f.m.set(c.id,{workStatus:'completed'});
    expect(f.m.autoCloseCandidates(()=>false)[0]?.eligible).toBe(true);
    expect(f.close).not.toHaveBeenCalled();
  });
  it('persists work holds through restart and still allows an explicit manual close', async () => {
    const f=fixture(),c=await f.m.create({harness:'anthropic',cwd:f.dir,model:'known',prompt:'Assigned work'},'agent');
    await f.m.set(c.id,{workStatus:'waiting-mail'});await f.m.shutdown();
    const restored=fixture('anthropic',{userData:f.dir});
    expect(restored.m.list().find(chat=>chat.id===c.id)?.work?.status).toBe('waiting-mail');
    await restored.m.archive(c.id);
    expect(restored.m.list().find(chat=>chat.id===c.id)?.closedBy).toBe('user');
  });
  it('rejects mixed setting patches before releasing a persisted hold', async () => {
    const f=fixture(),c=await f.m.create({harness:'anthropic',cwd:f.dir,model:'known',prompt:'Assigned'},'agent');
    const before=fs.readFileSync(path.join(f.dir,'chats.json'),'utf8');
    await expect(f.m.set(c.id,{workStatus:'completed',title:''})).rejects.toThrow(/separatamente/);
    expect(f.m.list()[0]?.work?.status).toBe('assigned');
    expect(fs.readFileSync(path.join(f.dir,'chats.json'),'utf8')).toBe(before);
  });
  it('does not start a cold note or close a held session before a later send', async () => {
    const f=fixture('claude',{coldHandoff:()=>true,coldIdleMs:()=>50*60_000}),c=await f.m.create({harness:'claude',cwd:f.dir,prompt:'Assigned'},'agent');
    f.sink().childrenCoverage?.('complete');
    const internal=f.m as unknown as {chats:Map<string,{s:ChatSummary;lastTurnAt:number;coldNoteAt:number}>;handoffs:{write(id:string,note:object):void}};
    const record=internal.chats.get(c.id)!;
    record.s.contextTokens=250_000;record.lastTurnAt=Date.now()-51*60_000;record.coldNoteAt=0;
    expect(f.m.coldTick()).toBe(0);expect(f.sent).toHaveLength(1);
    record.lastTurnAt=1;record.coldNoteAt=2;
    internal.handoffs.write(c.id,{title:'Fixture',text:'Recorded note',source:'chat',at:2});
    await f.m.set(c.id,{workStatus:'waiting-mail'});await f.m.send(c.id,'Read a new message');
    expect(f.close).not.toHaveBeenCalled();expect(f.m.list()[0]?.work?.status).toBe('waiting-mail');
  });
  it('does not replace a cold session when child activity arrives while its close awaits', async () => {
    const f = fixture('claude', { coldHandoff: () => true, cacheTtlMs: 1 }), c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'First' });
    f.sink().childrenCoverage?.('complete');
    const internal = f.m as unknown as { chats: Map<string, { s: ChatSummary; lastTurnAt: number; coldNoteAt: number }>; handoffs: { write(id: string, note: object): void } };
    const r = internal.chats.get(c.id)!;
    r.s.contextTokens = 250_000; r.lastTurnAt = 1; r.coldNoteAt = 2;
    internal.handoffs.write(c.id, { title: 'Fixture', text: 'Recorded note', source: 'chat', at: 2 });
    const original = r.s.sessionId; let finish!: () => void;
    f.close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const sending = f.m.send(c.id, 'Next assignment');
    await vi.waitFor(() => expect(f.close).toHaveBeenCalled());
    f.sink().children?.({ key: 'agent:late', nativeId: 'late', parentNativeId: null, toolCallId: null, kind: 'agent', state: 'running', task: 'Late child', observedAt: Date.now(), source: 'live' });
    finish(); await sending;
    expect(f.m.list()[0]?.sessionId).toBe(original);
    expect(f.m.items(c.id).some(item => item.kind === 'system' && !!item.continued)).toBe(false);
  });
  it('does not release an idle engine with an unknown child census or an in-flight delivery hold', async () => {
    const unknown = fixture('codex'); await unknown.m.create({ harness: 'codex', cwd: unknown.dir, prompt: 'First' });
    expect(unknown.m.releaseIdle(1, Date.now() + 60_000)).toBe(0);
    expect(unknown.close).not.toHaveBeenCalled();
    const held = fixture(), c = await held.m.create({ harness: 'anthropic', cwd: held.dir, model: 'known', prompt: 'First' });
    const release = held.m.holdActivity(c.id);
    expect(held.m.releaseIdle(1, Date.now() + 60_000)).toBe(0);
    expect(held.close).not.toHaveBeenCalled(); release();
    expect(held.m.releaseIdle(1, Date.now() + 60_000)).toBe(1);
  });
  it('does not mistake a running observed shell for a verified empty agent census', async () => {
    const f = fixture(); await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'First' });
    f.sink().children?.({ key: 'shell:one', nativeId: 'one', toolCallId: null, parentNativeId: null, kind: 'shell', state: 'running', task: 'Test fixture', observedAt: Date.now(), source: 'live' });
    expect(f.m.list()[0]?.agentChildren).toMatchObject({ coverage: 'complete', active: 0, observedActive: 0 });
    expect(f.m.releaseIdle(1, Date.now() + 60_000)).toBe(0);
    expect(f.close).not.toHaveBeenCalled();
  });
  it('closes through the real scheduler reservation after its two-minute warning', async () => {
    const f = fixture(), c = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'First' });
    let clock = autoCloseNow();
    const scheduler = new AutoCloseService({ now: () => clock, delayMs: () => 1, candidates: () => f.m.autoCloseCandidates(() => false), archive: (id, _permit, valid) => f.m.archiveAutomatic(id, valid), emit() {} });
    scheduler.setPresence([{ chatId: c.id, draft: false, shown: false, browser: false, queued: 0, touchedAt: 0 }]);
    for (let i = 0; i <= 12; i++) {
      scheduler.setPresence([{ chatId: c.id, draft: false, shown: false, browser: false, queued: 0, touchedAt: 0 }]);
      if (i < 12) clock += 10_000;
    }
    await scheduler.tick();
    expect(f.m.list()[0]?.closedBy).toBe('auto');
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('refuses the old renderer auto flag and admits only a successful, fully observed idle candidate', async () => {
    const f = fixture(), c = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'Do work' });
    await expect(f.m.archive(c.id, { auto: true })).rejects.toThrow(/timer verificato/);
    expect(f.m.autoCloseCandidates(() => false).find(x => x.id === c.id)?.eligible).toBe(true);
    expect(await f.m.archiveAutomatic(c.id, () => true)).toBe(true);
    expect(f.m.list()[0]).toMatchObject({ closedBy: 'auto' });
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('holds before a message awaits an in-flight handoff and cancels closing without dropping delivery', async () => {
    const f = fixture(), c = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'First' });
    let release!: (h: HandoffInfo) => void;
    vi.spyOn(f.m, 'ensureHandoff').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const original = f.m.autoCloseCandidates(() => false)[0]!.stamp;
    const valid = () => f.m.autoCloseCandidates(() => false)[0]?.stamp === original;
    const closing = f.m.archiveAutomatic(c.id, valid);
    const delivery = f.m.send(c.id, 'New assignment');
    release({} as HandoffInfo);
    expect(await closing).toBe(false); await delivery;
    expect(f.close).not.toHaveBeenCalled();
    expect(f.sent.at(-1)).toBe('New assignment');
    expect(f.m.list()[0]?.closedAt).toBeUndefined();
  });
  it('rechecks new pending after close awaits and never drops it or marks the chat archived', async () => {
    const f = fixture(), c = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'First' });
    let finish!: () => void;
    f.close.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const closing = f.m.archiveAutomatic(c.id, () => true);
    await vi.waitFor(() => expect(f.close).toHaveBeenCalled());
    f.sink().pending({ id: 'new-question', type: 'question', tool: 'AskUserQuestion', title: 'Question', detail: '', input: {}, at: Date.now() });
    finish(); expect(await closing).toBe(false);
    expect(f.m.pending().map(p => p.id)).toContain('new-question');
    expect(f.m.list()[0]?.closedAt).toBeUndefined();
  });
  it('closes a finished CLI chat without a full child census, never one with a sub-agent at work or a main hold', async () => {
    const f = fixture('codex'), c = await f.m.create({ harness: 'codex', cwd: f.dir, prompt: 'First' });
    expect(f.m.list()[0]?.agentChildren?.coverage).toBe('unknown');
    expect(f.m.autoCloseCandidates(() => true)[0]?.eligible).toBe(false);
    f.sink().children?.({ key: 'agent:one', nativeId: 'one', toolCallId: null, parentNativeId: null, kind: 'agent', state: 'running', task: 'Sub', observedAt: Date.now(), source: 'live' });
    expect(f.m.autoCloseCandidates(() => false)[0]).toMatchObject({ eligible: false, waitingFor: 'work' });
    expect(await f.m.archiveAutomatic(c.id, () => true)).toBe(false);
    f.sink().children?.({ key: 'agent:one', nativeId: 'one', toolCallId: null, parentNativeId: null, kind: 'agent', state: 'completed', task: 'Sub', observedAt: Date.now() + 1, source: 'live' });
    expect(f.m.autoCloseCandidates(() => false)[0]?.eligible).toBe(true);
    expect(await f.m.archiveAutomatic(c.id, () => true)).toBe(true);
    expect(f.m.list()[0]?.closedBy).toBe('auto');
  });
  it('closes a finished chat restored at start-up (its result is not saved), never an errored, interrupted or unused one', async () => {
    const f = fixture('claude'), done = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'First' });
    const empty = await f.m.create({ harness: 'claude', cwd: f.dir });
    await f.m.shutdown();
    const r = fixture('claude', { userData: f.dir });
    expect(r.m.list().find(x => x.id === done.id)?.state).toBe('closed');
    const eligible = (id: string) => r.m.autoCloseCandidates(() => false).find(x => x.id === id)?.eligible;
    expect(eligible(done.id)).toBe(true);
    expect(eligible(empty.id)).toBe(false);
    expect(await r.m.archiveAutomatic(done.id, () => true)).toBe(true);
    expect(r.m.list().find(x => x.id === done.id)?.closedBy).toBe('auto');
    const g = fixture('claude'), failed = await g.m.create({ harness: 'claude', cwd: g.dir, prompt: 'First' });
    g.sink().item({ kind: 'result', id: 'rx', at: Date.now(), isError: true, costUsd: 0, durationMs: 1, turns: 1 }, false);
    expect(g.m.autoCloseCandidates(() => false).find(x => x.id === failed.id)?.eligible).toBe(false);
    // its saved result goes through the restart: still not finished
    await g.m.shutdown();
    const g2 = fixture('claude', { userData: g.dir });
    expect(g2.m.autoCloseCandidates(() => false).find(x => x.id === failed.id)?.eligible).toBe(false);
  });
  it('keeps a chat open after a restart when its engine died mid-turn or its answer waits for the user', async () => {
    const f = fixture('claude'), cut = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'First' });
    f.sink().changed({ state: 'running' }); f.sink().exit({ code: 0, error: null });
    expect(f.m.autoCloseCandidates(() => false).find(x => x.id === cut.id)?.eligible).toBe(false);
    const asks = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'First' });
    (f.m as unknown as { chats: Map<string, { s: ChatSummary }> }).chats.get(asks.id)!.s.waitsOn = 'user';
    await f.m.shutdown();
    const r = fixture('claude', { userData: f.dir });
    const row = (id: string) => r.m.autoCloseCandidates(() => false).find(x => x.id === id);
    expect(row(cut.id)?.eligible).toBe(false);
    expect(row(asks.id)).toMatchObject({ eligible: false, waitingFor: 'user' });
  });
  it('drops the sub-agents a previous engine never saw end when the chat resumes, so it can close again', async () => {
    const f = fixture('claude'), c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'First' });
    f.sink().children?.({ key: 'agent:ghost', nativeId: 'ghost', toolCallId: null, parentNativeId: null, kind: 'agent', state: 'running', task: 'Ghost', observedAt: Date.now(), source: 'live' });
    await f.m.shutdown();
    const r = fixture('claude', { userData: f.dir });
    expect(r.m.list().find(x => x.id === c.id)?.agentChildren?.children[0]?.state).toBe('unknown');
    await r.m.send(c.id, 'Again');
    expect(r.m.list().find(x => x.id === c.id)?.agentChildren?.children).toEqual([]);
    expect(r.m.autoCloseCandidates(() => false).find(x => x.id === c.id)?.eligible).toBe(true);
  });
  it('does not cancel its own close when a verified-empty provider reports exit bookkeeping', async () => {
    const f = fixture('claude'), c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'First' });
    f.sink().childrenCoverage?.('complete');
    f.close.mockImplementation(async () => { f.sink().childrenCoverage?.('unknown', 'exit'); f.sink().changed({ state: 'closed' }); f.sink().exit({ code: 0, error: null }); });
    const stamp = f.m.autoCloseCandidates(() => false)[0]!.stamp;
    const valid = () => f.m.autoCloseCandidates(() => false).some(x => x.id === c.id && x.eligible && x.stamp === stamp);
    expect(await f.m.archiveAutomatic(c.id, valid)).toBe(true);
    expect(f.m.list()[0]?.closedBy).toBe('auto');
  });
});
