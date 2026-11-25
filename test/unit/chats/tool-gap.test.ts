// The tool check through the real ChatManager (ADR 0356): a chat's endpoint list or its engine's loaded list without a
// required tool is acted on by the app, logged, never left to the agent: the engine's gap reloads the session once,
// then the chat is told the fallback command; the app's own list lacking one goes to the fallback at once. Fake engine.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { plainOwner } from '../../../src/main/agents/catalog';
import { log } from '../../../src/main/log';
import type { Harness } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function fixture(o: { env?: NodeJS.ProcessEnv } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-toolgap-')); roots.push(dir);
  const sinks: SessionSink[] = [], sent: string[] = [], envs: NodeJS.ProcessEnv[] = [];
  let closes = 0;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, engineOn: () => true, mcpUrlFor: id => `http://127.0.0.1:4000/mcp/chat/${id}/t`,
    toolCliDir: path.join(dir, 'bin'), env: o.env ?? { CLAUDE_CONFIG_DIR: path.join(dir, 'home'), PATH: '/usr/bin' }, sessionFactory: (harness, o, s) => {
      sinks.push(s); envs.push(o.env ?? {});
      return { harness, sessionId: null, pid: null, root: null, alive: true, busy: false, start() { s.changed({ state: 'idle' }); }, send(text: string) { sent.push(text); },
        close: async () => { closes++; s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => true,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null } as unknown as HarnessSession;
    } });
  managers.push(m);
  const child = async (harness: Harness = 'claude') => {
    const parent = await m.create({ harness, cwd: dir, prompt: 'x' }, 'user');
    return m.create({ harness, cwd: dir, parentId: parent.id, prompt: 'y', delegation: { role: 'scout', goal: 'Cerca', doneWhen: ['Fatto'], at: 1 } }, 'agent',
      { owner: { ...plainOwner(harness, null), id: 'scout', source: 'catalog', version: 1 }, instructions: 'Cerca.', policy: null });
  };
  return { m, dir, sinks, sent, envs, child, closes: () => closes };
}

describe('the required tools of a chat, checked at every start (ADR 0356)', () => {
  it('a child requires show_ui, agent_report and agent_ask_parent; its engine finds sb-tool with its endpoint', async () => {
    const f = fixture(), c = await f.child();
    expect(f.m.requiredToolsOf(c.id)).toEqual(['show_ui', 'agent_report', 'agent_ask_parent']);
    const env = f.envs.at(-1)!;
    expect(env.SB_CHAT_TOOLS).toBe(`http://127.0.0.1:4000/mcp/chat/${c.id}/t`);
    expect(String(env.PATH).split(path.delimiter)[0]).toBe(path.join(f.dir, 'bin'));
  });

  it('the endpoint served a list without agent_report: the chat is told the fallback command at once, and it is logged', async () => {
    const warn = vi.spyOn(log, 'warn');
    const f = fixture(), c = await f.child();
    f.m.toolsServed(c.id, ['show_ui', 'agent_ask_parent']);
    await vi.waitFor(() => expect(f.sent.some(t => t.includes("sb-tool agent_report '<argomenti JSON>'"))).toBe(true));
    expect(f.m.items(c.id).some(i => i.kind === 'system' && (i as { code?: string }).code === 'toolsFallback')).toBe(true);
    expect(warn).toHaveBeenCalledWith('chats', 'required tools missing: fallback command given', expect.objectContaining({ chat: c.id }));
    // once per session
    const n = f.sent.length;
    f.m.toolsServed(c.id, ['show_ui']);
    expect(f.sent.length).toBe(n);
  });

  it('the engine loaded fewer than it was served: one reload of the session, then the fallback', async () => {
    const f = fixture(), c = await f.child();
    f.m.toolsServed(c.id, ['show_ui', 'agent_report', 'agent_ask_parent']);
    f.sinks.at(-1)!.toolsLoaded?.(['mcp__second-brain__show_ui', 'mcp__second-brain__agent_ask_parent']);
    await vi.waitFor(() => expect(f.closes()).toBe(1));
    expect(f.m.items(c.id).some(i => i.kind === 'system' && (i as { code?: string }).code === 'toolsReloaded')).toBe(true);
    await f.m.send(c.id, 'continua');
    f.sinks.at(-1)!.toolsLoaded?.(['mcp__second-brain__show_ui']);
    await vi.waitFor(() => expect(f.sent.some(t => t.includes('sb-tool agent_report'))).toBe(true));
  });

  it('the engine\'s PATH is the app\'s own with the command first, also when the options name none (review of ADR 0356)', async () => {
    const f = fixture({ env: {} }), c = await f.child();
    const env = { ...process.env, ...f.envs.at(-1)! };
    const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH')!;
    const parts = String(env[key]).split(path.delimiter);
    expect(parts[0]).toBe(path.join(f.dir, 'bin'));
    for (const p of String(process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean)) expect(parts).toContain(p);
    expect(c.id).toBeTruthy();
  });

  it('an ACP engine not known to take the endpoint is never reloaded for a list it never read', async () => {
    const f = fixture(), c = await f.child('cursor');
    f.sinks.at(-1)!.item({ kind: 'result', id: 'r1', at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
    await new Promise(r => setImmediate(r));
    expect(f.closes()).toBe(0);
    expect(f.m.items(c.id).some(i => i.kind === 'system' && (i as { code?: string }).code === 'toolsReloaded')).toBe(false);
  });

  it('Claude that ended a turn without ever reading the endpoint is reloaded once', async () => {
    const f = fixture(), c = await f.child('claude');
    f.sinks.at(-1)!.item({ kind: 'result', id: 'r1', at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
    await vi.waitFor(() => expect(f.m.items(c.id).some(i => i.kind === 'system' && (i as { code?: string }).code === 'toolsReloaded')).toBe(true));
  });

  it('an app job that owes its report keeps agent_report after «Riprendi» (review of ADR 0356)', async () => {
    const f = fixture();
    const job = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'Rivedi', doneWhen: ['Fatto'] }, 'app',
      { owner: { ...plainOwner('claude', null), id: 'sentinel', source: 'catalog', version: 1 }, instructions: 'Rivedi.', policy: null });
    expect(f.m.requiredToolsOf(job.id)).toContain('agent_report');
    const next = await f.m.continueChat(job.id, { ask: false, on: { harness: 'cursor', model: null, effort: null } });
    expect(next.run?.taskContract).toMatchObject({ reportExpected: true, doneWhen: ['Fatto'] });
    expect(f.m.requiredToolsOf(next.id)).toContain('agent_report');
  });

  it('Antigravity: the fallback goes with the first message, and a model that says a tool is missing gets it again', async () => {
    const f = fixture(), c = await f.child('antigravity');
    expect(f.sent.some(t => t.includes("sb-tool agent_report '<argomenti JSON>'"))).toBe(true);
    const n = f.sent.length;
    f.m.toolsServed(c.id, ['show_ui', 'agent_report', 'agent_ask_parent', 'ask_user']);
    const sink = f.sinks.at(-1)!;
    sink.item({ kind: 'assistant', id: 'a1', at: Date.now(), text: 'Lo strumento agent_report non è disponibile nella mia sessione: mi fermo.' }, false);
    sink.item({ kind: 'result', id: 'r1', at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
    await vi.waitFor(() => expect(f.sent.length).toBeGreaterThan(n));
    expect(f.sent.at(-1)).toContain('Al tuo motore mancano strumenti');
    expect(f.closes()).toBe(0);
  });

  it('Claude gets no fallback line in its first message', async () => {
    const f = fixture();
    await f.child('claude');
    expect(f.sent.some(t => t.includes('sb-tool'))).toBe(false);
  });

  it('the fallback for a model\'s words goes once per session, and never on Claude (its loaded list is seen)', async () => {
    const f = fixture(), c = await f.child('antigravity');
    const sink = f.sinks.at(-1)!;
    const turn = (n: number) => {
      sink.item({ kind: 'assistant', id: `a${n}`, at: Date.now(), text: 'Lo strumento agent_report non è disponibile nella mia sessione.' }, false);
      sink.item({ kind: 'result', id: `r${n}`, at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
    };
    turn(1);
    await vi.waitFor(() => expect(f.sent.filter(t => t.includes('Al tuo motore mancano')).length).toBe(1));
    await f.m.send(c.id, 'continua');
    turn(2);
    await new Promise(r => setImmediate(r));
    expect(f.sent.filter(t => t.includes('Al tuo motore mancano')).length).toBe(1);
    const g = fixture(), k = await g.child('claude');
    g.m.toolsServed(k.id, ['show_ui', 'agent_report', 'agent_ask_parent']);
    g.sinks.at(-1)!.toolsLoaded?.(['mcp__second-brain__show_ui', 'mcp__second-brain__agent_report', 'mcp__second-brain__agent_ask_parent']);
    g.sinks.at(-1)!.item({ kind: 'assistant', id: 'a1', at: Date.now(), text: 'Lo strumento agent_report non è disponibile nella mia sessione.' }, false);
    g.sinks.at(-1)!.item({ kind: 'result', id: 'r1', at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
    await new Promise(r => setImmediate(r));
    expect(g.sent.some(t => t.includes('Al tuo motore mancano'))).toBe(false);
  });
});

