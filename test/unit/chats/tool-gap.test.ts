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

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-toolgap-')); roots.push(dir);
  const sinks: SessionSink[] = [], sent: string[] = [], envs: NodeJS.ProcessEnv[] = [];
  let closes = 0;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, engineOn: () => true, mcpUrlFor: id => `http://127.0.0.1:4000/mcp/chat/${id}/t`,
    toolCliDir: path.join(dir, 'bin'), env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home'), PATH: '/usr/bin' }, sessionFactory: (harness, o, s) => {
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
});
