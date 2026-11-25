// A delegated chat through the real ChatManager (ADR 0355, #472): whatever tool classes its contract names, on every
// engine that asks the gate, in a shared folder and in its own copy, a read runs with no panel; a database write, a
// production release and a cloud write wait for the user; a saved tool list stays at load when it cannot be told from
// the role; what the gate leaves to the user logs why. No engine runs: a fake session.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import { FAIL_CLOSED } from '../../../src/main/agents/tool-policy';
import { autoPermit } from '../../../src/main/chats/auto-permit';
import { log } from '../../../src/main/log';
import type { Harness } from '../../../src/shared/contract';
import type { ToolClass } from '../../../src/shared/agents';

const roots: string[] = [], managers: ChatManager[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-delegated-')); roots.push(d); return d; };
afterEach(async () => { vi.restoreAllMocks(); for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function fixture(extra: Partial<ChatManagerOptions> = {}) {
  const dir = extra.userData ?? tmp(), starts: SessionOptions[] = [], answers: { id: string; answer: { allow?: boolean; message?: string } }[] = [];
  let sink!: SessionSink;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, engineOn: () => true, codeMode: () => true, mcpUrlFor: id => `http://127.0.0.1:4000/mcp/chat/${id}`,
    env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, ...extra, sessionFactory: (harness, o, s) => {
      sink = s; starts.push(o);
      return { harness, sessionId: null, pid: null, root: null, alive: true, busy: false, start() { s.changed({ state: 'idle' }); }, send() {},
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: (id: string, answer: never) => { answers.push({ id, answer }); return true; },
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
        toolContext: () => ({ files: [], inline: null, cwd: o.cwd, env: {} }) } as unknown as HarnessSession;
    } });
  managers.push(m);
  const child = async (harness: Harness, tools?: ToolClass[], isolated?: string) => {
    const parent = await m.create({ harness, cwd: dir, prompt: 'x' }, 'user');
    return m.create({ harness, cwd: isolated ?? dir, parentId: parent.id, prompt: 'y', delegation: { role: 'scout', goal: 'Cerca', doneWhen: ['Fatto'], at: 1, ...(tools ? { tools } : {}) } }, 'agent',
      { owner: { ...plainOwner(harness, null), id: 'scout' }, instructions: 'Cerca.', policy: null });
  };
  let n = 0;
  /** what the app did with the request: allowed, refused, or left to the user */
  const ask = (command: string, tool = 'Bash', input: unknown = { command }): 'allow' | 'deny' | 'user' => {
    const id = `q${++n}`;
    sink.pending({ id, type: 'permission', tool, title: `${tool}: ${command}`, detail: command, input, at: 1, alwaysRules: ['Bash(x:*)'] }, input);
    const a = answers.find(x => x.id === id);
    return a ? a.answer.allow ? 'allow' : 'deny' : 'user';
  };
  return { m, dir, starts, answers, child, ask };
}

const READS = ['az webapp list -o table', 'for s in a b; do az webapp show -n "$s" -o tsv; done', 'node -e "console.log(require(\'fs\').readFileSync(\'a.json\',\'utf8\'))"', 'cd src && ls', 'git -C ../other log --oneline -3'];
const HELD = ['sqlcmd -S srv -Q "update t set a=1"', './deploy.sh --env production', 'az webapp restart -n x'];
const TOOLS: (ToolClass[] | undefined)[] = [undefined, ['read'], ['read', 'shell-read', 'web'], ['read', 'edit', 'shell']];

describe('a delegated chat (#472)', () => {
  it.each(['claude', 'codex', 'cursor', 'opencode'] as Harness[])('%s: reads run with no panel and the three writes wait, whatever the contract names, shared or isolated', async harness => {
    for (const tools of TOOLS) for (const own of [false, true]) {
      const isolated = own ? tmp() : undefined;
      const f = fixture(isolated ? { prepareDelegation: async p => ({ cwd: isolated, parentRunId: p.run?.runId, parentTaskVersion: p.run?.taskVersion }) } : {});
      const c = await f.child(harness, tools);
      expect(c.cwd).toBe(isolated ?? f.dir);
      const where = `${tools ?? 'role'} ${own ? 'own copy' : 'shared'}`;
      expect(f.m.agentPolicy(c.id)?.tools ?? null, where).toBeNull();
      for (const tool of ['Bash', 'Command']) {
        for (const r of READS) expect(f.ask(r, tool), `${where}: ${r}`).toBe('allow');
        for (const h of HELD) expect(f.ask(h, tool), `${where}: ${h}`).toBe('user');
      }
      const left = f.m.pending().filter(p => p.chatId === c.id);
      expect(left).toHaveLength(HELD.length * 2);
      // never «always», and not answerable from the phone as a rule of the user's would be
      for (const p of left) { expect(p.noAlways).toBe(true); expect(p.alwaysRules).toBeUndefined(); expect(p.heldBy).toBeUndefined(); }
    }
  });

  it('the rules of the brain are unchanged: they refuse first, with their own message', async () => {
    const f = fixture({ brainRoot: () => path.join(__dirname, '..', '..', 'fixtures', 'brain-policy') });
    await f.child('claude', ['read', 'shell-read']);
    for (const r of READS) expect(f.ask(r), r).toBe('allow');
    expect(f.ask('az webapp restart -n x')).toBe('deny');
    expect(f.answers.at(-1)!.answer.message).toMatch(/user's rule "azure-write"/);
    expect(f.ask('x', 'mcp__Gmail__send_message')).toBe('user');
  });

  // ADR 0356 (owner, 2026-11-25: «permessi uguali su ogni harness: tutto automatico tranne scritture DB, release su nodi di
  // produzione e scritture Azure, che aspettano Esegui»): the three wait in every chat, not only a delegated one
  it.each(['claude', 'codex', 'cursor', 'opencode', 'antigravity'] as Harness[])('%s: a chat that is not delegated runs its reads and leaves the three writes to the user too', async harness => {
    const f = fixture();
    await f.m.create({ harness, cwd: f.dir, prompt: 'x' }, 'user');
    for (const r of READS) expect(f.ask(r), r).toBe('allow');
    for (const h of HELD) expect(f.ask(h), h).toBe('user');
  });

  it('a limit the parent really has still goes down: the user\'s own plan mode', async () => {
    const f = fixture();
    const parent = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user');
    await f.m.set(parent.id, { permissionMode: 'plan' });
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, parentId: parent.id, prompt: 'y', delegation: { role: 'artisan', goal: 'g', doneWhen: ['Fatto'], at: 1, tools: ['read'] } }, 'agent',
      { owner: { ...plainOwner('claude', null), id: 'artisan' }, instructions: 'Fai.', policy: null });
    expect(f.m.agentPolicy(c.id)).toEqual({ tools: null, ceiling: 'plan' });
  });

  it('run_code (Code Mode) meets the same: a read runs, the three writes wait', async () => {
    const f = fixture(), c = await f.child('claude', ['read']);
    for (const command of READS) expect((await f.m.decideFor(c.id, 'Bash', { command })).kind, command).toBe('allow');
    for (const command of HELD) {
      const stop = new AbortController();
      const verdict = f.m.decideFor(c.id, 'Bash', { command }, { signal: stop.signal });
      await vi.waitFor(() => expect(f.m.pending().some(p => p.chatId === c.id)).toBe(true));
      stop.abort();
      expect((await verdict).kind).not.toBe('allow');
    }
  });

  it('a saved allow list stays at load when it cannot be told from the role; a damaged policy, the ceiling and an orphan keep theirs', async () => {
    const f = fixture();
    const narrowed = await f.child('claude', ['read', 'shell-read', 'web']), capped = await f.child('claude', ['read']), damaged = await f.child('claude', ['read']), orphan = await f.child('claude', ['read']);
    const nested = await f.m.create({ harness: 'claude', cwd: f.dir, parentId: narrowed.id, prompt: 'z', delegation: { role: 'scout', goal: 'g', doneWhen: ['Fatto'], at: 1 } }, 'agent', { owner: { ...plainOwner('claude', null), id: 'scout' }, instructions: 'Cerca.', policy: null });
    await f.m.shutdown();
    const file = path.join(f.dir, 'chats.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { chats: { id: string; parentId?: string; agentPolicy?: unknown }[] };
    const old = { tools: { allow: ['read', 'shell-read', 'web'] }, ceiling: null };
    for (const c of saved.chats) {
      if (c.id === narrowed.id || c.id === nested.id) c.agentPolicy = old;
      if (c.id === capped.id) c.agentPolicy = { ...old, ceiling: 'acceptEdits' };
      if (c.id === damaged.id) c.agentPolicy = { tools: 'broken' };
      if (c.id === orphan.id) { c.agentPolicy = old; c.parentId = 'gone'; }
    }
    // a child before its parent in the file is read after it all the same
    saved.chats.reverse();
    fs.writeFileSync(file, JSON.stringify(saved));
    const g = fixture({ userData: f.dir });
    const cappedPolicy = { ...old, ceiling: 'acceptEdits' as const };
    expect(g.m.agentPolicy(narrowed.id)).toEqual(old);
    expect(g.m.agentPolicy(nested.id)).toEqual(old);
    expect(g.m.agentPolicy(capped.id)).toEqual(cappedPolicy);
    expect(g.m.agentPolicy(damaged.id)).toEqual(FAIL_CLOSED);
    expect(g.m.agentPolicy(orphan.id)).toEqual(old);
    await g.m.send(narrowed.id, 'continua');
    expect(g.starts.at(-1)?.toolPolicy).toEqual(old.tools);
    await g.m.shutdown();
    const after = JSON.parse(fs.readFileSync(file, 'utf8')) as { chats: { id: string; agentPolicy?: unknown }[] };
    expect(after.chats.find(c => c.id === narrowed.id)!.agentPolicy).toEqual(old);
    const h = fixture({ userData: f.dir });
    expect(h.m.agentPolicy(narrowed.id)).toEqual(old);
    expect(h.m.agentPolicy(nested.id)).toEqual(old);
    expect(h.m.agentPolicy(capped.id)).toEqual(cappedPolicy);
  });

  it('a restart keeps a restricted role (tools and MCP servers), and a contract does not widen it', async () => {
    const role = { tools: { allow: ['read', 'mcp'] as ToolClass[], mcp: ['docs'] }, ceiling: null };
    const f = fixture();
    const parent = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user');
    const own = { owner: { ...plainOwner('claude', null), id: 'scout' }, instructions: 'Cerca.', policy: role };
    const delegation = { role: 'scout' as const, goal: 'Cerca', doneWhen: ['Fatto'], at: 1 };
    const plain = await f.m.create({ harness: 'claude', cwd: f.dir, parentId: parent.id, prompt: 'y', delegation }, 'agent', own);
    const limited = await f.m.create({ harness: 'claude', cwd: f.dir, parentId: parent.id, prompt: 'z', delegation: { ...delegation, tools: ['read'] } }, 'agent', own);
    // a new child keeps the role (belowParent), contract classes included
    expect(f.m.agentPolicy(plain.id)).toEqual(role);
    expect(f.m.agentPolicy(limited.id)).toEqual(role);
    await f.m.shutdown();
    const g = fixture({ userData: f.dir });
    expect(g.m.agentPolicy(plain.id)).toEqual(role);
    expect(g.m.agentPolicy(limited.id)).toEqual(role);
    await g.m.shutdown();
    const h = fixture({ userData: f.dir });
    expect(h.m.agentPolicy(plain.id)).toEqual(role);
    expect(h.m.agentPolicy(limited.id)).toEqual(role);
  });

  it('a saved allow list inside the contract stays: it cannot be told from the role, and a second load does not change it', async () => {
    const f = fixture();
    const c = await f.child('claude', ['read', 'shell-read', 'web']);
    await f.m.shutdown();
    const file = path.join(f.dir, 'chats.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { chats: { id: string; agentPolicy?: unknown }[] };
    const old = { tools: { allow: ['read', 'shell-read', 'web'] }, ceiling: null };
    saved.chats.find(x => x.id === c.id)!.agentPolicy = old;
    fs.writeFileSync(file, JSON.stringify(saved));
    const g = fixture({ userData: f.dir });
    expect(g.m.agentPolicy(c.id)).toEqual(old);
    await g.m.shutdown();
    const h = fixture({ userData: f.dir });
    expect(h.m.agentPolicy(c.id)).toEqual(old);
  });

  it('what the gate leaves to the user logs a reason', async () => {
    const info = vi.spyOn(log, 'info');
    const reasons = () => info.mock.calls.filter(c => c[1] === 'the gate leaves a request to the user').map(c => String((c[2]?.data as { reason?: string })?.reason));
    const f = fixture();
    await f.child('claude', ['read']);
    for (const h of HELD) f.ask(h);
    expect(reasons()).toEqual([expect.stringMatching(/^db-write: /), expect.stringMatching(/^prod-release: /), expect.stringMatching(/^cloud-write: /)]);
    // a class the chat was not given, and the limit of a chat
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', { owner: plainOwner('claude', null), instructions: 'i', policy: { tools: { allow: ['read'] }, ceiling: null } });
    f.ask('npm test');
    await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'x' }, 'user', { owner: plainOwner('claude', null), instructions: 'i', policy: { tools: null, ceiling: 'default' } });
    f.ask('npm test');
    expect(reasons().slice(3)).toEqual(['tool class not given to the chat: shell', 'the chat\'s limit: default']);
    // the user's brain rule
    const g = fixture({ brainRoot: () => path.join(__dirname, '..', '..', 'fixtures', 'brain-policy') });
    await g.child('claude');
    g.ask('x', 'mcp__Gmail__send_message');
    expect(reasons().at(-1)).toMatch(/^brain rule: /);
    // every other request auto-permit sends to the user says why
    for (const req of [{ type: 'question', tool: 'AskUserQuestion' }, { type: 'permission', tool: 'ExitPlanMode' }]) expect(autoPermit(req as never, { cwd: f.dir, ceiling: null })).toMatchObject({ kind: 'ask', reason: expect.stringMatching(/\w/) });
    for (const req of [{ command: '' }, { command: 'cp a … (+9)' }]) expect(autoPermit({ type: 'permission', tool: 'Bash', input: req } as never, { cwd: f.dir, ceiling: null, policy: { state: 'broken', error: 'x' } as never })).toMatchObject({ kind: 'ask', reason: expect.stringMatching(/\w/) });
  });
});
