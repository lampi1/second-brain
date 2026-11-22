// agent_assign_task's preset switch inside ChatManager.assignTask (ADR 0336, Sentinel fix): the chat moves to the
// preset's model and effort only after every guard passed (a busy chat or a stale version leaves it untouched), goes
// back when the assignment still fails before it starts, and an effort null takes the chat back to the engine default.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import { AGENT_LABEL } from '../../../src/shared/agent-label';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-preset-switch-')); roots.push(dir);
  const sessions: { busy: boolean; models: (string | null)[] }[] = [];
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, sessionFactory: (_h, _o, s) => {
    const state = { busy: false, models: [] as (string | null)[] };
    sessions.push(state);
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, get busy() { return state.busy; },
      start() { s.changed({ state: 'idle' }); }, send() {},
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async (x: string | null) => { state.models.push(x); }, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  const create = () => m.create({ harness: 'claude', cwd: dir, prompt: 'Primo lavoro', model: 'm-top', effort: 'high' }, 'user',
    { owner: { ...plainOwner('claude', null), source: 'catalog', id: 'scout', version: 1 }, instructions: 'Sei uno scout.', policy: null });
  const summary = (id: string) => m.list().find(x => x.id === id)!;
  const preset = (model: string, effort: 'low' | 'high' | null) => ({ choice: { preset: 'base' as const }, model, switchTo: { model, effort } });
  return { m, sessions, create, summary, preset };
}

describe('ChatManager.assignTask with a preset switch', () => {
  it('a busy chat refuses before any switch: model and effort stay', async () => {
    const f = fixture();
    const c = await f.create();
    f.sessions.at(-1)!.busy = true;
    await expect(f.m.assignTask(c.id, `${AGENT_LABEL}\nAltro`, { mode: 'continue', preset: f.preset('m-low', 'low') })).rejects.toThrow(/busy/);
    expect(f.summary(c.id)).toMatchObject({ model: 'm-top', effort: 'high' });
    expect(f.sessions.at(-1)!.models).toEqual([]);
  });
  it('a stale version refuses before any switch', async () => {
    const f = fixture();
    const c = await f.create();
    await expect(f.m.assignTask(c.id, 'Altro', { mode: 'continue', expectedVersion: 9, preset: f.preset('m-low', 'low') })).rejects.toThrow(/version changed/);
    expect(f.summary(c.id)).toMatchObject({ model: 'm-top', effort: 'high' });
  });
  it('an assignment refused after the switch puts the old model and effort back', async () => {
    const f = fixture();
    const c = await f.create();
    await expect(f.m.assignTask(c.id, 'Altro', { mode: 'continue', doneWhen: [''], preset: f.preset('m-low', 'low') })).rejects.toThrow(/Invalid task criteria/);
    expect(f.summary(c.id)).toMatchObject({ model: 'm-top', effort: 'high' });
  });
  it('switches once the guards pass; effort null = back to the engine default', async () => {
    const f = fixture();
    const c = await f.create();
    await f.m.assignTask(c.id, 'Altro', { mode: 'continue', preset: f.preset('m-mid', null) });
    expect(f.summary(c.id)).toMatchObject({ model: 'm-mid', effort: null });
    expect(f.summary(c.id).run?.model).toBe('m-mid');
  });
});

describe('ChatManager.set effort null', () => {
  it('clears a chosen effort', async () => {
    const f = fixture();
    const c = await f.create();
    await f.m.set(c.id, { effort: null });
    expect(f.summary(c.id).effort).toBeNull();
  });
});
