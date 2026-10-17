// An agent's tool policy and ceiling on its chats (A2): frozen at start, passed to the engine, clamping the mode, refused
// above the ceiling, kept across restarts and continues, failing closed when the stored copy is damaged.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { compatibleOwner } from '../../../src/main/agents/catalog';
import { FAIL_CLOSED, type AgentPolicy } from '../../../src/main/agents/tool-policy';
import type { PermissionMode } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(extra: Partial<ChatManagerOptions> = {}) {
  const dir = extra.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-policy-'));
  if (!extra.userData) roots.push(dir);
  const home = path.join(dir, 'home');
  const starts: SessionOptions[] = [], modes: PermissionMode[] = [];
  let sink!: SessionSink;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, env: { CLAUDE_CONFIG_DIR: home }, ...extra, sessionFactory: (_h, o, s) => {
    sink = s; starts.push(o);
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { sink.changed({ state: 'idle' }); }, send() {},
      close: async () => { sink.changed({ state: 'closed' }); sink.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async (pm: PermissionMode) => { modes.push(pm); }, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  return { m, dir, home, starts, modes, sink: () => sink };
}
const agent = (policy: AgentPolicy) => ({ owner: compatibleOwner('claude', null), instructions: 'Sei un revisore.', policy });
const reviewer: AgentPolicy = { tools: { allow: ['read'] }, ceiling: 'default' };

describe('agent policy on chats', () => {
  it('passes the policy to the engine and clamps an explicit mode to the ceiling', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, permissionMode: 'bypassPermissions', prompt: 'x' }, 'user', agent(reviewer));
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'default', permissionMode: 'default' });
    expect(f.m.list().find(x => x.id === c.id)?.permissionMode).toBe('default');
  });

  it('a Claude agent without a chosen mode runs at the ceiling when Brother’s settings default is higher', async () => {
    const f = fixture();
    fs.mkdirSync(f.home, { recursive: true });
    fs.writeFileSync(path.join(f.home, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }));
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    expect(f.starts.at(-1)?.permissionMode).toBe('default');
    fs.writeFileSync(path.join(f.home, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'plan' } }));
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'y' }, 'user', agent(reviewer));
    expect(f.starts.at(-1)?.permissionMode).toBeNull(); // below the ceiling: his settings decide, as for any chat
  });

  it('refuses a mode above the ceiling and allows one within it', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    await expect(f.m.set(c.id, { permissionMode: 'acceptEdits' })).rejects.toThrow(/limite la modalità «default»/);
    await f.m.set(c.id, { permissionMode: 'plan' });
    expect(f.modes).toEqual(['plan']);
  });

  it('sets the engine back when it reports a mode above the ceiling on its own', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    f.sink().changed({ permissionMode: 'acceptEdits' });
    await vi.waitFor(() => expect(f.modes).toEqual(['default']));
    expect(f.m.list().find(x => x.id === c.id)?.permissionMode).toBe('default');
  });

  it('a chat without an agent policy is untouched', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, permissionMode: 'bypassPermissions', prompt: 'x' });
    expect(f.starts.at(-1)?.permissionMode).toBe('bypassPermissions');
    expect(f.starts.at(-1)?.toolPolicy).toBeUndefined();
    expect(f.m.browserAllowed(c.id)).toBe(true);
  });

  it('hides the browser for an agent without the browser class', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    const b = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent({ tools: { allow: ['read', 'browser'] }, ceiling: null }));
    expect(f.m.browserAllowed(c.id)).toBe(false);
    expect(f.m.browserAllowed(b.id)).toBe(true);
  });

  it('a renewed Orchestrator and the chats an agent opens never run wider than their origin', async () => {
    const f = fixture();
    const regia = await f.m.create({ harness: 'claude', cwd: f.dir, regia: true }, 'user', agent(reviewer));
    const renewed = await f.m.create({ harness: 'claude', cwd: f.dir, regia: true, replaces: regia.id });
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'default' });
    const work = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'modifica X', regiaOf: renewed.id, permissionMode: 'acceptEdits' }, 'agent');
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'default', permissionMode: 'default' });
    expect(f.m.browserAllowed(work.id)).toBe(false);
    // an agent chosen for the work is narrowed by its opener too
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'y', regiaOf: renewed.id }, 'agent', agent({ tools: { allow: ['read', 'edit', 'browser'] }, ceiling: 'acceptEdits' }));
    expect(f.starts.at(-1)).toMatchObject({ toolPolicy: { allow: ['read'] }, ceiling: 'default' });
    // a chat Brother opens himself is his own
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'z', regiaOf: renewed.id });
    expect(f.starts.at(-1)?.toolPolicy).toBeUndefined();
  });

  it('a fork of an agent chat keeps its policy', async () => {
    const f = fixture();
    const src = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    expect(src.sessionId).toBeTruthy();
    await f.m.create({ harness: 'claude', cwd: f.dir, resumeSessionId: src.sessionId!, fork: true, prompt: 'continue', permissionMode: 'bypassPermissions' });
    expect(f.starts.at(-1)).toMatchObject({ fork: true, toolPolicy: { allow: ['read'] }, ceiling: 'default', permissionMode: 'default' });
  });

  it('keeps the policy across a restart, and a damaged stored copy fails closed', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', agent(reviewer));
    await f.m.shutdown();
    const file = path.join(f.dir, 'chats.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { chats?: { id: string; agentPolicy?: unknown }[] } | { id: string; agentPolicy?: unknown }[];
    const rows = Array.isArray(stored) ? stored : stored.chats ?? [];
    expect(rows.find(r => r.id === c.id)?.agentPolicy).toEqual(reviewer);
    const again = fixture({ userData: f.dir });
    await expect(again.m.set(c.id, { permissionMode: 'acceptEdits' })).rejects.toThrow(/limite/);
    await again.m.shutdown();
    rows.find(r => r.id === c.id)!.agentPolicy = { tools: { allow: ['everything'] }, ceiling: 'default' };
    fs.writeFileSync(file, JSON.stringify(stored));
    const damaged = fixture({ userData: f.dir });
    await expect(damaged.m.set(c.id, { permissionMode: 'default' })).rejects.toThrow(/limite la modalità «plan»/);
    expect(damaged.m.browserAllowed(c.id)).toBe(false);
    expect(FAIL_CLOSED.ceiling).toBe('plan');
  });
});
