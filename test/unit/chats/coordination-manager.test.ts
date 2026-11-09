// The actual ChatManager boundary: journal before exposure/engine delivery, phone provenance, policy separation and failures.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { SessionSink } from '../../../src/main/chats/session';
import type { PendingRequest } from '../../../src/shared/contract';
import { CoordinationStore } from '../../../src/main/coordination/store';
import { closeAppDbs } from '../../../src/main/app-db';
import { Workflows } from '../../../src/main/workflows/service';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); closeAppDbs(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const question: Omit<PendingRequest, 'chatId'> = { id: 'exact-question', type: 'question', tool: 'AskUserQuestion', title: 'Proceed?', detail: '', input: {}, at: 100,
  questions: [{ question: 'Proceed?', header: 'Scope', multiSelect: false, options: [{ label: 'Sì (consigliato)', description: 'Continue' }, { label: 'No', description: 'Stop' }] }] };
async function fixture(options: { away?: boolean; failDelivery?: boolean; acknowledgement?: Promise<boolean> } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-coord-manager-')); roots.push(dir);
  const store = new CoordinationStore(path.join(dir, 'app.db'));
  let resolveExposed!: () => void, resolveAnswered!: () => void, calls = 0;
  const resolved: unknown[] = [], recaps: unknown[] = [];
  const exposed = new Promise<void>(r => { resolveExposed = r; });
  const answered = new Promise<void>(r => { resolveAnswered = r; });
  const m = new ChatManager({ userData: dir, coldEveryMs: 0, runEveryMs: 0, checkpoints: () => false, away: () => !!options.away,
    onAway: recap => { recaps.push(recap); },
    emitter: { emit(channel, event) {
      if (channel === 'pending:resolved') resolved.push(event);
      if (channel === 'pending:added') { expect(store.requests()[0]!.state).toBe('pending'); resolveExposed(); }
    } },
    sessionFactory: (_h, _o, sink: SessionSink) => ({ harness: 'claude', sessionId: 'session', pid: null, root: null, alive: true, busy: false,
      start() { sink.changed({ state: 'idle' }); }, send() { sink.pending(question); },
      answer(id: string) {
        if (options.acknowledgement) throw new Error('Remote answers must await consumption');
        calls++;
        expect(store.requests()[0]).toMatchObject({ state: 'accepted', delivery: { state: 'dispatching' } });
        resolveAnswered();
        if (options.failDelivery) throw new Error('Lost transport');
        sink.resolved(id); return true;
      },
      ...(options.acknowledgement ? { answerConsumed() {
        calls++;
        expect(store.requests()[0]).toMatchObject({ state: 'accepted', delivery: { state: 'dispatching' } });
        resolveAnswered();
        return options.acknowledgement;
      } } : {}),
      close: async () => { sink.changed({ state: 'closed' }); sink.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as never });
  managers.push(m);
  const chat = await m.create({ harness: 'claude', cwd: dir, prompt: 'Ask one scoped question', orchestrator: true });
  await (options.away ? answered : exposed);
  return { m, store, chat, answered, resolved, recaps, calls: () => calls };
}
function acknowledgement() {
  let resolve!: (value: boolean) => void, reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe('request receipts through ChatManager', () => {
  it('waits for remote consumption before recording delivery, preserving phone provenance and rejecting duplicates', async () => {
    const ack = acknowledgement(), f = await fixture({ acknowledgement: ack.promise });
    const answer = { kind: 'question', answers: { 'Proceed?': 'No' } } as const;
    const sending = f.m.answer(f.chat.id, question.id, answer, 'phone');
    await f.answered;
    expect(f.store.requests()[0]!.delivery!.state).toBe('dispatching');
    expect(f.m.pending()).toHaveLength(1);
    expect(f.resolved).toEqual([]);
    await expect(f.m.answer(f.chat.id, question.id, answer)).rejects.toThrow(/already answered/);
    ack.resolve(true); await sending;
    expect(f.store.requests()[0]!.delivery!.state).toBe('delivered');
    expect(f.m.pending()).toEqual([]);
    expect(f.resolved).toEqual([expect.objectContaining({ by: 'phone' })]);
    expect(f.calls()).toBe(1);
  });
  it.each(['failed', 'uncertain'] as const)('records a remote %s result without retrying consent', async state => {
    const ack = acknowledgement(), f = await fixture({ acknowledgement: ack.promise });
    const answer = { kind: 'question', answers: { 'Proceed?': 'No' } } as const;
    const sending = f.m.answer(f.chat.id, question.id, answer);
    await f.answered;
    if (state === 'uncertain') {
      const rejected = expect(sending).rejects.toThrow('Host disconnected');
      ack.reject(new Error('Host disconnected')); await rejected;
    } else { ack.resolve(false); await sending; }
    expect(f.store.requests()[0]).toMatchObject({ state: 'accepted', delivery: { state } });
    await expect(f.m.answer(f.chat.id, question.id, answer)).rejects.toThrow();
    expect(f.calls()).toBe(1);
  });
  it.each([true, false] as const)('waits for the remote night-mode acknowledgement (%s) before a success recap', async accepted => {
    const ack = acknowledgement(), f = await fixture({ away: true, acknowledgement: ack.promise });
    expect(f.store.requests()[0]).toMatchObject({ decision: { actor: { kind: 'policy', policy: 'away' } }, delivery: { state: 'dispatching' } });
    expect(f.recaps).toEqual([]);
    ack.resolve(accepted);
    // Drain the acknowledgement chain, not a wall-clock deadline.
    await ack.promise; await Promise.resolve(); await Promise.resolve();
    expect(f.store.requests()[0]!.delivery!.state).toBe(accepted ? 'delivered' : 'failed');
    expect(f.recaps).toHaveLength(accepted ? 1 : 0);
    expect(f.calls()).toBe(1);
  });
  it('does not resend an accepted policy decision when night mode is settled again during delivery', async () => {
    const ack = acknowledgement(), options = { away: false, acknowledgement: ack.promise };
    const f = await fixture(options);
    options.away = true;
    expect(f.m.settleForAway()).toBe(1);
    expect(f.m.pending()).toHaveLength(1);
    expect(f.m.settleForAway()).toBe(0);
    expect(f.calls()).toBe(1);
    ack.resolve(true);
    await ack.promise; await Promise.resolve(); await Promise.resolve();
    expect(f.store.requests()[0]!.delivery!.state).toBe('delivered');
    expect(f.m.pending()).toEqual([]);
    expect(f.recaps).toHaveLength(1);
  });
  it.each(['create', 'attach'] as const)('answers the original question after workflow %s without rebinding consent', async mode => {
    const f = await fixture();
    const original = f.store.original(f.chat.id, question.id)!;
    const works = new Workflows(path.join(path.dirname(f.store.file), 'work.json'), undefined, undefined, undefined,
      { store: f.store, chats: () => f.m.list(), pending: () => f.m.pending() });
    const work = works.create({ title: 'Organize existing work', profile: 'investigation', priority: 'normal', chatIds: mode === 'create' ? [f.chat.id] : [] });
    if (mode === 'attach') works.report({ id: work.id, expectedVersion: work.version, action: 'update', summary: 'Attach existing chat', chatIds: [f.chat.id] });
    expect(f.store.jobFor(f.chat.id)).toBe(work.id);
    await f.m.answer(f.chat.id, question.id, { kind: 'question', answers: { 'Proceed?': 'No' } }, 'phone');
    expect(f.store.original(f.chat.id, question.id)).toMatchObject({ key: original.key, state: 'accepted',
      decision: { key: original.key, actor: { kind: 'user', channel: 'phone' } }, delivery: { state: 'delivered' } });
    expect(f.store.requests(work.id)).toEqual([]);
    expect(f.calls()).toBe(1);
  });
  it('commits phone consent before delivery and rejects a duplicate', async () => {
    const f = await fixture();
    const answer = { kind: 'question', answers: { 'Proceed?': 'No' } } as const;
    await f.m.answer(f.chat.id, question.id, answer, 'phone');
    expect(f.store.requests()[0]).toMatchObject({ state: 'accepted', decision: { actor: { kind: 'user', channel: 'phone' }, answer }, delivery: { state: 'delivered' } });
    await expect(f.m.answer(f.chat.id, question.id, answer, 'phone')).rejects.toThrow(/non è più aperta/);
    expect(f.calls()).toBe(1);
  });
  it('rejects a relay and malformed answer without consuming the question', async () => {
    const f = await fixture();
    await expect(f.m.answer(f.chat.id, question.id, { kind: 'question', answers: { 'Proceed?': 'Yes' } }, 'relay')).rejects.toThrow(/non è una decisione/);
    await expect(f.m.answer(f.chat.id, question.id, { kind: 'permission', allow: true })).rejects.toThrow(/non valida/);
    expect(f.store.requests()[0]!.state).toBe('pending'); expect(f.calls()).toBe(0);
  });
  it('keeps accepted consent when delivery throws, without allowing another attempt', async () => {
    const f = await fixture({ failDelivery: true });
    const answer = { kind: 'question', answers: { 'Proceed?': 'No' } } as const;
    await expect(f.m.answer(f.chat.id, question.id, answer)).rejects.toThrow('Lost transport');
    expect(f.store.requests()[0]).toMatchObject({ state: 'accepted', delivery: { state: 'uncertain' } });
    await expect(f.m.answer(f.chat.id, question.id, answer)).rejects.toThrow(/already answered/);
    expect(f.calls()).toBe(1);
  });
  it('records night-mode choices as policy, never the user', async () => {
    const f = await fixture({ away: true });
    expect(f.store.requests()[0]).toMatchObject({ state: 'accepted', decision: { actor: { kind: 'policy', policy: 'away' } }, delivery: { state: 'delivered' } });
    expect(f.m.pending()).toEqual([]);
  });
});
