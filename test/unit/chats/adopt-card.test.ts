// A role chat given new work takes its card as it is now (ChatManager.adoptCard via assignTask, ADR 0352): a card
// changed since the chat started never stops the work; tools and permissions become the card's, never wider than the
// parent's for a delegated chat; the engine relaunches on the same history only when they changed; engine and model stay.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import type { AgentPolicy } from '../../../src/main/agents/tool-policy';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-adopt-card-')); roots.push(dir);
  const starts: SessionOptions[] = [];
  const card = { version: 2, revision: 20, policy: { tools: { allow: ['read', 'write'] }, ceiling: null } as AgentPolicy | null, fail: false };
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') },
    resolveAgent: req => {
      if (card.fail) throw new Error('card unreadable');
      return { request: { ...req, harness: 'codex', model: 'card-model' }, owner: { ...plainOwner('codex', 'card-model'), source: 'catalog', id: 'scout', name: 'Scout', version: card.version, revision: card.revision },
        instructions: 'Nuove istruzioni.', policy: card.policy, skills: [], launches: [] };
    },
    sessionFactory: (_h, o, s) => {
      starts.push(o);
      return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send() {},
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  const owner = { ...plainOwner('claude', 'own-model'), source: 'catalog' as const, id: 'scout', name: 'Scout', version: 1, revision: 1 };
  const create = (policy: AgentPolicy | null = { tools: { allow: ['read'] }, ceiling: null }) => m.create({ harness: 'claude', cwd: dir, prompt: 'Primo lavoro', model: 'own-model' }, 'user', { owner, instructions: 'Sei uno scout.', policy });
  const summary = (id: string) => m.list().find(x => x.id === id)!;
  return { m, dir, starts, card, create, summary, owner };
}

describe('a reused role chat takes its card as it is now', () => {
  it('takes the card\'s tools and version, relaunches once on the same history, keeps its engine and model', async () => {
    const f = fixture();
    const c = await f.create();
    const before = f.starts.length;
    await f.m.assignTask(c.id, 'Secondo lavoro', { mode: 'continue' });
    expect(f.m.agentPolicy(c.id)).toEqual({ tools: { allow: ['read', 'write'] }, ceiling: null });
    expect(f.summary(c.id).agent).toMatchObject({ version: 2, revision: 20, engine: 'claude', model: 'own-model' });
    expect(f.summary(c.id)).toMatchObject({ harness: 'claude', model: 'own-model' });
    expect(f.starts.length).toBe(before + 1);                       // the engine started again for the new tools
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read', 'write'] } });
    // the same card again: no relaunch
    await f.m.assignTask(c.id, 'Terzo lavoro', { mode: 'continue' });
    expect(f.starts.length).toBe(before + 1);
  });

  it('a card that changed only its version takes the version, without a relaunch', async () => {
    const f = fixture();
    f.card.policy = { tools: { allow: ['read'] }, ceiling: null };
    const c = await f.create();
    const before = f.starts.length;
    await f.m.assignTask(c.id, 'Secondo', { mode: 'continue' });
    expect(f.summary(c.id).agent).toMatchObject({ version: 2, revision: 20 });
    expect(f.starts.length).toBe(before);
  });

  it('a card that cannot be read leaves the chat as it was, and the work still goes', async () => {
    const f = fixture();
    const c = await f.create();
    f.card.fail = true;
    await f.m.assignTask(c.id, 'Secondo', { mode: 'continue' });
    expect(f.summary(c.id).agent).toMatchObject({ version: 1, revision: 1 });
    expect(f.m.agentPolicy(c.id)).toEqual({ tools: { allow: ['read'] }, ceiling: null });
  });

  it('a delegated chat never gets more than its parent: the card is narrowed to the parent\'s tools and mode', async () => {
    const f = fixture();
    const parent = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', { owner: { ...f.owner, id: 'strategist', name: 'Strategist' }, instructions: 'Pianifica.', policy: { tools: { allow: ['read'] }, ceiling: null } });
    const child = await f.m.create({ harness: 'claude', cwd: f.dir, parentId: parent.id, prompt: 'Cerca', delegation: { role: 'scout', goal: 'Cerca', doneWhen: ['Fatto'], at: 1 } }, 'agent',
      { owner: f.owner, instructions: 'Sei uno scout.', policy: { tools: { allow: ['read'] }, ceiling: null } });
    await f.m.set(parent.id, { permissionMode: 'plan' });
    await f.m.assignTask(child.id, 'Altro', { mode: 'continue' });
    const policy = f.m.agentPolicy(child.id)!;
    expect(policy.tools?.allow).toEqual(['read']);                  // the card's write is not the parent's
    expect(policy.ceiling).toBe('plan');                            // nor is a mode above the parent's
    expect(f.summary(child.id).agent).toMatchObject({ version: 2 });
  });
});
