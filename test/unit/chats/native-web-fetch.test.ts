// Web reading for work chats (ADR 0333): Claude Code, with its built-in web-fetch agent on, drops its own WebFetch tool
// from a session that has the Agent tool and reads pages only through that agent, which the role gate refuses. The app
// turns the agent off inline (CLAUDE_CODE_WEB_FETCH_AGENT=0), so a role chat with the web class keeps WebSearch and
// WebFetch as plain tools, Code Mode on or off; one without the class gets neither. Runs the real ChatManager and
// ClaudeSession arguments (no engine). Pins chats/claude.ts NATIVE_WEB_FETCH and mergeSettings.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { ClaudeSession, mergeSettings } from '../../../src/main/chats/claude';
import type { HarnessSession, SessionOptions } from '../../../src/main/chats/session';
import type { AgentPolicy } from '../../../src/main/agents/tool-policy';
import { TOOL_CLASSES } from '../../../src/shared/agents';
import { plainOwner } from '../../../src/main/agents/catalog';

const dirs: string[] = [], managers: ChatManager[] = [];
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wf-'))); dirs.push(d); return d; };
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(50); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const EVERY: AgentPolicy = { tools: { allow: [...TOOL_CLASSES] }, ceiling: null };
const NO_WEB: AgentPolicy = { tools: { allow: TOOL_CLASSES.filter(c => c !== 'web') }, ceiling: null };

async function roleChat(codeMode: boolean, policy: AgentPolicy): Promise<SessionOptions> {
  const seen: SessionOptions[] = [];
  const m = new ChatManager({
    userData: tmp(), emitter: { emit: () => {} } as never, brainRoot: () => null,
    mcpUrlFor: id => `http://127.0.0.1:4000/mcp/chat/${id}/token`, codeMode: () => codeMode,
    sessionFactory: (h, options, s): HarnessSession => { seen.push(options); return { harness: h, state: 'idle', sessionId: options.sessionId ?? null, pid: null, root: null, busy: false, alive: true,
      start: () => { s.changed({ state: 'idle' }); }, send: () => {}, answer: () => false, interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {}, setEffort: async () => {},
      rename: async () => {}, contextUsage: async () => null, usage: async () => null, close: async () => {}, killNow: () => {} }; },
  });
  managers.push(m);
  const owner = { ...plainOwner('claude', null), source: 'catalog' as const, id: 'scout', version: 1 };
  const chat = await m.create({ harness: 'claude', cwd: tmp(), title: 'Prova web' }, 'agent', { owner, instructions: 'Cerca sul web.', policy });
  await m.send(chat.id, 'Cerca la pagina.');
  return seen.at(-1)!;
}
const flag = (args: string[], name: string): string[] => { const i = args.lastIndexOf(name); return i < 0 ? [] : args[i + 1]!.split(','); };
const toolsOf = (args: string[]): string[] => (args.find(a => a.startsWith('--tools=')) ?? '--tools=').slice('--tools='.length).split(',');
const envOf = (args: string[]): Record<string, string> => (JSON.parse(args[args.indexOf('--settings') + 1] ?? '{}') as { env?: Record<string, string> }).env ?? {};

describe('a Claude work chat with the web class reads the web with plain tools, Code Mode on and off', () => {
  for (const codeMode of [false, true]) {
    it(`Code Mode ${codeMode ? 'on' : 'off'}: WebSearch and WebFetch launched next to Agent, none hidden, the web-fetch agent off`, async () => {
      const opts = await roleChat(codeMode, EVERY);
      expect(opts.codeMode === true).toBe(codeMode);
      const args = new ClaudeSession(opts, { changed: () => {} } as never).args();
      expect(toolsOf(args)).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch', 'Agent']));
      for (const t of ['WebSearch', 'WebFetch']) expect(flag(args, '--disallowedTools')).not.toContain(t);
      // with the agent on, Claude Code would drop WebFetch here because Agent is present (measured on 2.1.322)
      expect(envOf(args).CLAUDE_CODE_WEB_FETCH_AGENT).toBe('0');
    });
  }

  it('a role without the web class: no WebSearch, no WebFetch', async () => {
    const tools = toolsOf(new ClaudeSession(await roleChat(false, NO_WEB), { changed: () => {} } as never).args());
    for (const t of ['WebFetch', 'WebSearch']) expect(tools).not.toContain(t);
  });

  it('settings a chat brings cannot turn the agent back on; other env keys are kept', () => {
    const args = new ClaudeSession({ chatId: 'c', cwd: '.', sessionId: 'abc12345', stable: false, compactWindowTokens: 300_000, settings: { env: { CLAUDE_CODE_WEB_FETCH_AGENT: '1', FOO: 'x' } } }, { changed: () => {} } as never).args();
    expect(envOf(args)).toEqual({ CLAUDE_CODE_WEB_FETCH_AGENT: '0', FOO: 'x', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' });
    expect(mergeSettings({ env: { A: '1' } }, { env: { B: '2' } }, { env: { A: '3' } })).toEqual({ env: { A: '3', B: '2' } });
  });
});
