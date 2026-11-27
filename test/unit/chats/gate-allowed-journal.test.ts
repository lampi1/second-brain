// A permission the app's own gate allows (auto-permit) reaches its engine with no row in the coordination journal
// (ADR 0368: four sync transactions per tool call grew the journal every projection read); a request that goes to the
// user is still journaled before it is shown. Real ChatManager with an in-process fake session.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { SessionSink } from '../../../src/main/chats/session';
import type { Answer, PendingRequest } from '../../../src/shared/contract';
import { CoordinationStore } from '../../../src/main/coordination/store';
import { closeAppDbs } from '../../../src/main/app-db';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); closeAppDbs(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

async function fixture(req: Omit<PendingRequest, 'chatId'>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-gate-journal-')); roots.push(dir);
  const store = new CoordinationStore(path.join(dir, 'app.db'));
  const answers: { id: string; answer: Answer }[] = [];
  let shown!: () => void, answered!: () => void;
  const exposed = new Promise<void>(r => { shown = r; }), delivered = new Promise<void>(r => { answered = r; });
  const m = new ChatManager({ userData: dir, coldEveryMs: 0, runEveryMs: 0, checkpoints: () => false,
    emitter: { emit(channel) { if (channel === 'pending:added') shown(); } },
    sessionFactory: (_h, _o, sink: SessionSink) => ({ harness: 'claude', sessionId: 'session', pid: null, root: null, alive: true, busy: false,
      start() { sink.changed({ state: 'idle' }); }, send() { sink.pending(req); },
      answer(id: string, answer: Answer) { answers.push({ id, answer }); sink.resolved(id); answered(); return true; },
      close: async () => { sink.changed({ state: 'closed' }); sink.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as never });
  managers.push(m);
  await m.create({ harness: 'claude', cwd: dir, prompt: 'Work' });
  return { m, store, answers, exposed, delivered };
}

describe('journal of gate-allowed permissions', () => {
  it('an auto-permitted tool call is answered with no journal row', async () => {
    const f = await fixture({ id: 'toolu_1', type: 'permission', tool: 'Read', title: 'Read a file', detail: '', input: { file_path: 'README.md' }, at: 100 });
    await f.delivered;
    expect(f.answers).toEqual([{ id: 'toolu_1', answer: { kind: 'permission', allow: true } }]);
    expect(f.store.requests()).toEqual([]);
    expect(f.m.pending()).toEqual([]);
  });
  it('a question for the user is journaled before it shows', async () => {
    const f = await fixture({ id: 'ask_1', type: 'question', tool: 'AskUserQuestion', title: 'Proceed?', detail: '', input: {}, at: 100,
      questions: [{ question: 'Proceed?', header: 'Go', multiSelect: false, options: [{ label: 'Sì', description: '' }, { label: 'No', description: '' }] }] });
    await f.exposed;
    expect(f.store.requests().map(r => [r.key.originalRequestId, r.state])).toEqual([['ask_1', 'pending']]);
  });
});
