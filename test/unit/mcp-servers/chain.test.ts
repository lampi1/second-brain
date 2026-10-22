// A delegated chat's managed MCP access stays bounded by its ancestors' roles (ADR 0086): the chain is frozen at its
// creation and persisted, so closing or pruning the parent never widens a running child; a child saved without that
// chain whose parent is gone fails closed (no managed server). The warm engine's chat is a plain chat before it exists.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { ROLE_DEFAULTS, isWorkRole, type RoleId } from '../../../src/shared/roles';
import type { NewChat } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function manager(dir: string, extra: Partial<ConstructorParameters<typeof ChatManager>[0]> = {}): ChatManager {
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, ...extra,
    resolveAgent: (req: NewChat) => {
      const id = req.roleId as RoleId | undefined;
      if (!id || !isWorkRole(id)) return { request: req, owner: { id: 'plain', name: 'Chat', purpose: '', engine: req.harness, model: null, revision: 0, source: 'plain' as const }, instructions: '', policy: null, skills: [], launches: [] };
      const r = ROLE_DEFAULTS[id];
      return { request: req, owner: { id, name: r.name, purpose: r.summary, engine: 'claude', model: null, revision: 1, source: 'catalog' as const, version: 1 }, instructions: r.instructions,
        policy: { tools: { allow: [...r.tools] }, ceiling: r.ceiling }, skills: [...r.skills], launches: [...r.launches] };
    },
    sessionFactory: extra.sessionFactory ?? ((_h: string, _o: SessionOptions, s: SessionSink) => ({ harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { s.changed({ state: 'idle' }); }, send() {}, close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
      answer: () => true, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as unknown as HarnessSession) });
  managers.push(m);
  return m;
}

describe('the MCP role chain of a delegated chat', () => {
  it('is frozen at creation: closing the parent keeps the child bounded; saved and restored with it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mcp-chain-'));
    roots.push(dir);
    const m = manager(dir);
    const parent = await m.create({ harness: 'claude', cwd: dir, roleId: 'strategist', title: 'Root', prompt: 'x' }, 'user');
    const child = await m.create({ harness: 'claude', cwd: dir, roleId: 'scout', parentId: parent.id, title: 'Scout', prompt: 'x' }, 'agent');
    expect(m.mcpContext(child.id)?.roles).toEqual(['scout', 'strategist']);
    await m.close(parent.id);
    expect(m.mcpContext(child.id)?.roles).toEqual(['scout', 'strategist']);
    await m.shutdown();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'chats.json'), 'utf8')) as { chats: { id: string; mcpAncestors?: unknown }[] };
    expect(saved.chats.find(c => c.id === child.id)?.mcpAncestors).toEqual(['strategist']);
    expect(manager(dir).mcpContext(child.id)?.roles).toEqual(['scout', 'strategist']);

    // saved before the chain existed, its parent gone: fail closed (null = no managed server), never [scout] alone
    const file = path.join(dir, 'chats.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { chats: Record<string, unknown>[] };
    for (const c of data.chats) delete c.mcpAncestors;
    fs.writeFileSync(file, JSON.stringify(data));
    expect(manager(dir).mcpContext(child.id)).toBeNull();
    // a damaged chain is dropped on load, so it fails closed the same way
    for (const c of data.chats) if (c.id === child.id) c.mcpAncestors = ['bad role!'];
    fs.writeFileSync(file, JSON.stringify(data));
    expect(manager(dir).mcpContext(child.id)).toBeNull();
  });

  it('the warm engine spawned ahead is a plain chat while it launches, so it gets the managed servers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mcp-warm-'));
    roots.push(dir);
    const asked: { id: string; ctx: unknown }[] = [];
    let m: ChatManager | null = null;
    m = manager(dir, { prewarm: true, prewarmDelayMs: 0, extMcp: id => { asked.push({ id, ctx: m?.mcpContext(id) ?? 'none' }); return { servers: [], denied: [] }; } });
    const first = await m.create({ harness: 'claude', cwd: dir, title: 'Prima', prompt: 'x' }, 'user');
    for (let i = 0; i < 50 && !asked.some(a => a.id !== first.id); i++) await new Promise(r => setTimeout(r, 20));
    const warm = asked.filter(a => a.id !== first.id);
    expect(warm.length).toBeGreaterThan(0);
    for (const a of warm) expect(a.ctx).toEqual({ roles: [null], policy: null });
  });

  it('a delegated chat leaves an engine launched as a child under the same chain; the next such child adopts it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mcp-warm-child-'));
    roots.push(dir);
    const asked: { id: string; ctx: unknown }[] = [];
    let m: ChatManager | null = null;
    m = manager(dir, { prewarm: true, prewarmDelayMs: 0, extMcp: id => { asked.push({ id, ctx: m?.mcpContext(id) ?? 'none' }); return { servers: [], denied: [] }; } });
    const parent = await m.create({ harness: 'claude', cwd: dir, roleId: 'strategist', title: 'Root', prompt: 'x' }, 'user');
    const first = await m.create({ harness: 'claude', cwd: dir, roleId: 'scout', parentId: parent.id, title: 'Scout 1', prompt: 'x' }, 'agent');
    const known = new Set([parent.id, first.id]);
    const isChildEngine = (a: { ctx: unknown }) => JSON.stringify((a.ctx as { roles?: unknown }).roles) === JSON.stringify(['scout', 'strategist']);
    for (let i = 0; i < 50 && !asked.some(a => !known.has(a.id) && isChildEngine(a)); i++) await new Promise(r => setTimeout(r, 20));
    const waiting = asked.find(a => !known.has(a.id) && isChildEngine(a))?.id;
    // bounded by the parent's chain like a cold child, and it lists the child's own tool
    expect(waiting).toBeDefined();
    expect(m.chatToolShown(waiting!, 'agent_ask_parent')).toBe(true);
    const second = await m.create({ harness: 'claude', cwd: dir, roleId: 'scout', parentId: parent.id, title: 'Scout 2', prompt: 'y' }, 'agent');
    expect(second.id).toBe(waiting);
    expect(m.mcpContext(second.id)?.roles).toEqual(['scout', 'strategist']);
    // a root chat of the same role never takes a child's engine (another launch digest)
    for (let i = 0; i < 50 && !asked.some(a => ![...known, second.id].includes(a.id) && isChildEngine(a)); i++) await new Promise(r => setTimeout(r, 20));
    const next = asked.find(a => ![...known, second.id].includes(a.id) && isChildEngine(a))?.id;
    expect(next).toBeDefined();
    const root = await m.create({ harness: 'claude', cwd: dir, roleId: 'scout', title: 'Scout root', prompt: 'z' }, 'user');
    expect(root.id).not.toBe(next);
  });

  it('a delegated chat that adopts a waiting engine runs at its ceiling (the parent\'s mode), not the user\'s default above it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mcp-warm-mode-'));
    roots.push(dir);
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }));
    const modes: { chatId: string; mode: string }[] = [];
    const m = manager(dir, { prewarm: true, prewarmDelayMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'none') },
      sessionFactory: (_h: string, o: SessionOptions, s: SessionSink) => ({ harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false, ready: Promise.resolve(),
        start() { s.changed({ state: 'idle' }); }, send() {}, close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
        answer: () => true, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async (mode: string) => { modes.push({ chatId: o.chatId, mode }); },
        contextUsage: async () => null, usage: async () => null,
      }) as unknown as HarnessSession });
    const parent = await m.create({ harness: 'claude', cwd: dir, roleId: 'strategist', title: 'Root', prompt: 'x', permissionMode: 'plan' }, 'user');
    await m.create({ harness: 'claude', cwd: dir, roleId: 'scout', parentId: parent.id, title: 'Scout 1', prompt: 'x' }, 'agent');
    await new Promise(r => setTimeout(r, 200));
    const second = await m.create({ harness: 'claude', cwd: dir, roleId: 'scout', parentId: parent.id, title: 'Scout 2', prompt: 'y' }, 'agent');
    for (let i = 0; i < 50 && !modes.some(x => x.chatId === second.id); i++) await new Promise(r => setTimeout(r, 20));
    expect(modes.filter(x => x.chatId === second.id).map(x => x.mode)).toEqual(['plan']);
  });
});
