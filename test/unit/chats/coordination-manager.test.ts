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

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); closeAppDbs(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const question: Omit<PendingRequest, 'chatId'> = { id: 'exact-question', type: 'question', tool: 'AskUserQuestion', title: 'Proceed?', detail: '', input: {}, at: 100,
  questions: [{ question: 'Proceed?', header: 'Scope', multiSelect: false, options: [{ label: 'Sì (consigliato)', description: 'Continue' }, { label: 'No', description: 'Stop' }] }] };
async function fixture(options: { away?: boolean; failDelivery?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-coord-manager-')); roots.push(dir);
  const store = new CoordinationStore(path.join(dir, 'app.db'));
  let resolveExposed!: () => void, resolveAnswered!: () => void, calls = 0;
  const exposed = new Promise<void>(r => { resolveExposed = r; });
  const answered = new Promise<void>(r => { resolveAnswered = r; });
  const m = new ChatManager({ userData: dir, coldEveryMs: 0, runEveryMs: 0, checkpoints: () => false, away: () => !!options.away,
    emitter: { emit(channel) { if (channel === 'pending:added') { expect(store.requests()[0]!.state).toBe('pending'); resolveExposed(); } } },
    sessionFactory: (_h, _o, sink: SessionSink) => ({ harness: 'claude', sessionId: 'session', pid: null, root: null, alive: true, busy: false,
      start() { sink.changed({ state: 'idle' }); }, send() { sink.pending(question); },
      answer(id: string) {
        calls++;
        expect(store.requests()[0]).toMatchObject({ state: 'accepted', delivery: { state: 'dispatching' } });
        resolveAnswered();
        if (options.failDelivery) throw new Error('Lost transport');
        sink.resolved(id); return true;
      },
      close: async () => { sink.changed({ state: 'closed' }); sink.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as never });
  managers.push(m);
  const chat = await m.create({ harness: 'claude', cwd: dir, prompt: 'Ask one scoped question', orchestrator: true });
  await (options.away ? answered : exposed);
  return { m, store, chat, calls: () => calls };
}
describe('request receipts through ChatManager', () => {
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
