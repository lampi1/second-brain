// The four facts of a chat's effort (requested, submitted, effective, session default) and how the manager keeps
// them from its engine's reports (issue #100: the tiles show the effective one).
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { initialEffort, observeEffort, selectEffort, submitEffort } from '../../../src/main/chats/effort';
describe('Effort request and observed state', () => {
  it('never labels the CLI default or unsupported engines medium', () => {
    expect(initialEffort(true, null)).toMatchObject({ requested: null, effective: null, submitted: null, sessionDefault: null, pending: false });
    expect(initialEffort(false, null)).toMatchObject({ supported: false, effective: null, pending: false });
  });
  it('preserves the current effective report when a different next-turn value is selected', () => {
    const current = { ...initialEffort(true, 'xhigh'), submitted: 'xhigh', effective: 'xhigh', effectiveSource: 'provider' as const, pending: false };
    const next = selectEffort(current, 'medium');
    expect(next).toMatchObject({ requested: 'medium', effective: 'xhigh', submitted: 'xhigh', pending: true });
    expect(submitEffort(next, 'medium')).toMatchObject({ requested: 'medium', submitted: 'medium', effective: null, effectiveSource: 'unknown', pending: false });
  });
  it('maps the actual submitted value without claiming provider resolution and preserves newer requests', () => {
    expect(submitEffort(initialEffort(true, 'max'), 'xhigh')).toMatchObject({ submitted: 'xhigh', effective: null, pending: false });
    expect(submitEffort(initialEffort(true, 'high'), 'medium').pending).toBe(true);
  });
  it('keeps the reported effort on a later turn sent without one, and drops it only for a different value (turn 2)', () => {
    const reported = observeEffort(initialEffort(true, 'low'), 'low');
    const turn2 = submitEffort(reported, null);
    expect(turn2).toMatchObject({ effective: 'low', effectiveSource: 'provider', submitted: null, pending: false });
    expect(submitEffort(turn2, 'low')).toMatchObject({ effective: 'low', effectiveSource: 'provider', submitted: 'low', pending: false });
    const changed = submitEffort(selectEffort(turn2, 'high'), 'high');
    expect(changed).toMatchObject({ requested: 'high', submitted: 'high', effective: null, effectiveSource: 'unknown', pending: false });
  });
  it('takes the engine\'s own report as the effective effort, and an unreadable one as unknown (issue #100)', () => {
    const asked = initialEffort(true, 'low');
    expect(observeEffort(asked, 'low')).toMatchObject({ effective: 'low', effectiveSource: 'provider', pending: false });
    expect(observeEffort(initialEffort(true, 'max'), 'xhigh')).toMatchObject({ effective: 'xhigh', pending: false });
    expect(observeEffort(asked, 'high')).toMatchObject({ effective: 'high', pending: true });
    expect(observeEffort({ ...asked, effective: 'low', effectiveSource: 'provider' }, null)).toMatchObject({ effective: null, effectiveSource: 'unknown' });
  });
});

describe('the manager keeps the effort its engine reports', () => {
  const roots: string[] = [], managers: ChatManager[] = [];
  afterEach(async () => {
    for (const m of managers.splice(0)) await m.shutdown();
    for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  it('effortObserved becomes the effective effort of the chat, and a later report replaces it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-effort-')); roots.push(dir);
    let sink!: SessionSink;
    const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, sessionFactory: (_h, _o, s) => {
      sink = s;
      return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send() {},
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
    managers.push(m);
    const c = await m.create({ harness: 'claude', cwd: dir, prompt: 'x', effort: 'low' }, 'user');
    const status = () => m.list().find(x => x.id === c.id)?.effortStatus;
    expect(status()).toMatchObject({ requested: 'low', effective: null });
    sink.changed({ effortObserved: 'low' });
    expect(status()).toMatchObject({ requested: 'low', effective: 'low', effectiveSource: 'provider', pending: false });
    sink.changed({ effortObserved: 'high' }); // a mid-chat change the engine reports
    expect(status()).toMatchObject({ effective: 'high' });
  });
});
