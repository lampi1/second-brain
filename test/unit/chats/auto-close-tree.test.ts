// A delegation tree closes as one (owner, 2026-10-21): a finished chat of a tree waits while another chat of its tree
// still works, and every chat of the tree counts its delay from the tree's last activity, which never goes back when a
// member closes first (ChatManager.autoCloseCandidates). A tree due at once closes from its leaves up: a child never
// outlives its parent for a moment (it would jump out as a strip of its own, 2026-10-22).
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { AutoCloseService, autoCloseNow } from '../../../src/main/chats/auto-close';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import type { ChatSummary } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-auto-tree-')); roots.push(dir);
  let seq = 0;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, sessionFactory: (_h, _o, sink: SessionSink) => {
    let state = 'idle';
    return { harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, get busy() { return state === 'running'; },
      start() { sink.changed({ state: 'idle' }); },
      send() { state = 'running'; sink.changed({ state: 'running' }); sink.item({ kind: 'assistant', id: `a${++seq}`, at: Date.now(), text: 'Fatto' }, false); sink.item({ kind: 'result', id: `r${seq}`, at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false); state = 'idle'; sink.changed({ state: 'idle' }); },
      close: async () => { sink.changed({ state: 'closed' }); sink.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } }); managers.push(m);
  return { m, dir };
}
type Internal = { chats: Map<string, { s: ChatSummary; autoActivityAt?: number }> };

describe('auto-close of a delegation tree', () => {
  it('holds a finished child while its parent still waits, then gives the whole tree its last activity', async () => {
    const f = fixture();
    const parent = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'Lavoro' });
    const child = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'Parte' });
    const lone = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'Altro' });
    const internal = f.m as unknown as Internal;
    internal.chats.get(child.id)!.s.parentId = parent.id;
    const own = (id: string) => f.m.autoCloseCandidates(() => false).find(c => c.id === id)!;
    expect(own(child.id).eligible).toBe(true);
    expect(own(lone.id).eligible).toBe(true);

    internal.chats.get(parent.id)!.s.waitsOn = 'user';
    expect(own(parent.id).eligible).toBe(false);
    expect(own(child.id).eligible).toBe(false);
    expect(own(child.id).reason).toMatch(/albero/);
    expect(own(lone.id).eligible).toBe(true); // a chat outside the tree is untouched

    delete internal.chats.get(parent.id)!.s.waitsOn;
    const t = autoCloseNow();
    internal.chats.get(parent.id)!.autoActivityAt = t + 5_000;
    internal.chats.get(child.id)!.autoActivityAt = t + 9_000;
    expect(own(parent.id)).toMatchObject({ eligible: true, activityAt: t + 9_000 });
    expect(own(child.id)).toMatchObject({ eligible: true, activityAt: t + 9_000 });

    // the child closes first: the parent's clock does not go back to its own older activity
    internal.chats.get(child.id)!.s.closedAt = Date.now();
    expect(own(parent.id)).toMatchObject({ eligible: true, activityAt: t + 9_000 });
  });

  it('does not let a member that ended with an error keep the rest of its tree open', async () => {
    const f = fixture();
    const parent = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'Lavoro' });
    const child = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'Parte' });
    const internal = f.m as unknown as Internal;
    internal.chats.get(child.id)!.s.parentId = parent.id;
    internal.chats.get(child.id)!.s.lastError = 'engine crashed';
    const own = (id: string) => f.m.autoCloseCandidates(() => false).find(c => c.id === id)!;
    expect(own(child.id).eligible).toBe(false);
    expect(own(parent.id).eligible).toBe(true);
  });

  it('closes a finished tree from its leaves up, in one pass', async () => {
    const f = fixture();
    const parent = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'Lavoro' });
    const child = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'Parte' });
    const grandchild = await f.m.create({ harness: 'anthropic', cwd: f.dir, model: 'known', prompt: 'Pezzo' });
    const internal = f.m as unknown as Internal;
    internal.chats.get(child.id)!.s.parentId = parent.id;
    internal.chats.get(grandchild.id)!.s.parentId = child.id;
    let clock = autoCloseNow();
    const order: string[] = [];
    const name = (id: string) => id === parent.id ? 'parent' : id === child.id ? 'child' : 'grandchild';
    const scheduler = new AutoCloseService({ now: () => clock, delayMs: () => 1, candidates: () => f.m.autoCloseCandidates(() => false),
      archive: async (id, _permit, valid) => { const ok = await f.m.archiveAutomatic(id, valid); if (ok) order.push(`${name(id)}@${clock}`); return ok; }, emit() {} });
    const ids = [parent.id, child.id, grandchild.id];
    for (let i = 0; i <= 13 && order.length < 3; i++) {
      scheduler.setPresence(ids.map(id => {
        const row = scheduler.state().find(r => r.chatId === id);
        return { chatId: id, draft: false, shown: false, browser: false, queued: 0, touchedAt: 0, ...(row?.deadline != null ? { ackGeneration: row.generation, ackDeadline: row.deadline } : {}) };
      }));
      await scheduler.tick();
      clock += 10_000;
    }
    expect(order.map(o => o.split('@')[0])).toEqual(['grandchild', 'child', 'parent']);
    expect(new Set(order.map(o => o.split('@')[1])).size).toBe(1); // the same pass: the tree leaves the screen together
  });
});
