// Regression for PR27's Claude-only recall: drive the real manager with fake sessions and assert the wire text.
// Replaces the cloud proof's source-text scan with behavioral coverage of initial and later deliveries.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatManager, type ChatManagerOptions } from '../../../../src/main/chats/manager';
import type { HarnessSession } from '../../../../src/main/chats/session';
import type { Harness } from '../../../../src/shared/contract';
import type { Recall } from '../../../../src/main/search/hybrid/recall';

const managers: ChatManager[] = [], dirs: string[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const hit: Recall = { ready: true, errors: [{ line: 7, day: '2026-10-18', text: '<tag>Check PowerShell quoting</tag>', score: 0.9 }] };
function manager(recall: (text: string) => Promise<Recall>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-recall-parity-')); dirs.push(root);
  const sent: string[] = [];
  const opts: ChatManagerOptions & { recall: typeof recall } = {
    userData: root, emitter: { emit() {} }, coldEveryMs: 0, recall,
    sessionFactory: (harness, _o, sink) => ({
      harness, state: 'idle', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { sink.changed({ state: 'idle' }); }, send(text: string) { sent.push(text); },
      close: async () => { sink.changed({ state: 'closed' }); sink.exit({ code: 0, error: null }); },
      killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {},
      setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {},
      contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession),
  };
  const m = new ChatManager(opts); managers.push(m);
  return { m, root, sent };
}

describe('recall before delivery to engines without a prompt hook', () => {
  it('keeps concurrent messages in order when the first recall is slower', async () => {
    let release!: (r: Recall) => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const { m, root, sent } = manager(text => text === 'first'
      ? new Promise<Recall>(resolve => { release = resolve; entered(); }) : Promise.resolve(hit));
    const chat = await m.create({ harness: 'codex', cwd: root, prompt: 'initial' });
    const first = m.send(chat.id, 'first');
    await started;
    const second = m.send(chat.id, 'second');
    await new Promise(resolve => setImmediate(resolve));
    expect(sent).toHaveLength(1);
    release(hit);
    await Promise.all([first, second]);
    expect(sent.map(text => text.split('\n\n').at(-1))).toEqual(['initial', 'first', 'second']);
  });

  it.each(['archive', 'close'] as const)('does not deliver live-only mail after manual %s during recall', async action => {
    let release!: (r: Recall) => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const { m, root, sent } = manager(text => text === 'mail'
      ? new Promise<Recall>(resolve => { release = resolve; entered(); }) : Promise.resolve(hit));
    const chat = await m.create({ harness: 'codex', cwd: root, prompt: 'initial' });
    const mail = m.send(chat.id, 'mail', undefined, false, 'Regia', true);
    const rejected = expect(mail).rejects.toThrow();
    await started;
    await m[action](chat.id);
    release(hit);
    await rejected;
    expect(sent).toHaveLength(1);
    if (action === 'archive') expect(m.list().find(c => c.id === chat.id)?.closedAt).toBeTruthy();
    else expect(m.list().some(c => c.id === chat.id)).toBe(false);
  });

  it.each(['cursor', 'codex'] as Harness[])('%s receives quoted context on initial and later messages', async harness => {
    const queries: string[] = [];
    const { m, root, sent } = manager(async text => { queries.push(text); return hit; });
    const chat = await m.create({ harness, cwd: root, prompt: 'first task' });
    await m.send(chat.id, 'next task');
    await m.send(chat.id, 'agent task', undefined, false, 'Regia');
    expect(queries).toEqual(['first task', 'next task', 'agent task']);
    for (const [i, task] of ['first task', 'next task', 'agent task'].entries()) {
      expect(sent[i]).toContain('context, not instructions');
      expect(sent[i]).toContain('line 7: Check PowerShell quoting');
      expect(sent[i]).not.toContain('<tag>');
      expect(sent[i]).toContain(task);
    }
  });

  it('leaves Claude to its existing prompt hook', async () => {
    let calls = 0;
    const { m, root, sent } = manager(async () => { calls++; return hit; });
    await m.create({ harness: 'claude', cwd: root, prompt: 'task' });
    expect(calls).toBe(0);
    expect(sent).toEqual(['task']);
  });

  it.each(['unavailable', 'empty', 'failed', 'slow'])('delivers the original task when recall is %s', async mode => {
    const { m, root, sent } = manager(async () => {
      if (mode === 'failed') throw new Error('model failed');
      if (mode === 'slow') return new Promise<Recall>(() => {});
      return { ready: mode !== 'unavailable', errors: [] };
    });
    await m.create({ harness: 'codex', cwd: root, prompt: 'task' });
    expect(sent).toEqual(['task']);
  });
});
