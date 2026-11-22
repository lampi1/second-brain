// Web reading for role chats (ADR 0333): Claude Code drops its own WebFetch tool from a session that has the Agent tool
// and reads pages only through its built-in web-fetch agent, so a role chat with the web class must be let run it, Code
// Mode on or off; one without the web class (or under a parent without it) stays refused, and so does a custom agent
// that takes the name. The launch half runs the real ChatManager and ClaudeSession arguments (no engine). Pins
// agents/role-gate.ts subagentRefusal/SubagentGate/gateRequest and chats/manager-helpers.ts subagentGateFor.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { ClaudeSession } from '../../../src/main/chats/claude';
import type { HarnessSession, SessionOptions } from '../../../src/main/chats/session';
import type { AgentPolicy } from '../../../src/main/agents/tool-policy';
import { TOOL_CLASSES } from '../../../src/shared/agents';
import { plainOwner } from '../../../src/main/agents/catalog';
import { SubagentGate, WEB_FETCH_SUBAGENT, customWebFetch, gateRequest, subagentRefusal } from '../../../src/main/agents/role-gate';

const dirs: string[] = [], managers: ChatManager[] = [];
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wf-'))); dirs.push(d); return d; };
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(50); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const EVERY: AgentPolicy = { tools: { allow: [...TOOL_CLASSES] }, ceiling: null };
const NO_WEB: AgentPolicy = { tools: { allow: TOOL_CLASSES.filter(c => c !== 'web') }, ceiling: null };
const fetchCall = { tool: 'Agent', input: { subagent_type: WEB_FETCH_SUBAGENT, prompt: 'Read https://example.com' } };

async function roleChat(codeMode: boolean, policy: AgentPolicy, cwd = tmp()): Promise<SessionOptions> {
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
  const chat = await m.create({ harness: 'claude', cwd, title: 'Prova web' }, 'agent', { owner, instructions: 'Cerca sul web.', policy });
  await m.send(chat.id, 'Cerca la pagina.');
  return seen.at(-1)!;
}
const flag = (args: string[], name: string): string[] => { const i = args.lastIndexOf(name); return i < 0 ? [] : args[i + 1]!.split(','); };
const toolsOf = (args: string[]): string[] => (args.find(a => a.startsWith('--tools=')) ?? '--tools=').slice('--tools='.length).split(',');

describe('a Claude work chat with the web class reads the web, Code Mode on and off', () => {
  for (const codeMode of [false, true]) {
    it(`Code Mode ${codeMode ? 'on' : 'off'}: WebSearch, WebFetch and Agent launched, none hidden, web-fetch let through`, async () => {
      const opts = await roleChat(codeMode, EVERY);
      const args = new ClaudeSession(opts, { changed: () => {} } as never).args();
      expect(toolsOf(args)).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch', 'Agent']));
      for (const t of ['WebSearch', 'WebFetch', 'Agent']) expect(flag(args, '--disallowedTools')).not.toContain(t);
      expect(opts.codeMode === true).toBe(codeMode);
      // Claude starts the agent with no permission request: the PreToolUse hook is the gate that decides
      expect(opts.preToolUse?.decide(fetchCall)).toBeNull();
      expect(opts.preToolUse?.decide({ tool: 'Agent', input: { subagent_type: 'general-purpose', prompt: 'x' } })?.deny).toContain('refused');
    });
  }

  it('a role without the web class: no web tool, no Agent tool, web-fetch refused by both gates', async () => {
    const opts = await roleChat(false, NO_WEB);
    const tools = toolsOf(new ClaudeSession(opts, { changed: () => {} } as never).args());
    for (const t of ['WebFetch', 'WebSearch', 'Agent']) expect(tools).not.toContain(t);
    expect(opts.preToolUse).toBeUndefined();
    expect(new SubagentGate(tmp(), false).decide(fetchCall)?.deny).toContain('«web-fetch» refused');
    const role = { id: 'scout', name: 'Scout' };
    expect(gateRequest({ type: 'permission', ...fetchCall }, { role, skills: [], policy: NO_WEB }).kind).toBe('deny');
  });

  it('the permission gate: allowed with web in the chat and its parent, refused when the parent lacks it', () => {
    const role = { id: 'scout', name: 'Scout' };
    expect(gateRequest({ type: 'permission', ...fetchCall }, { role, skills: [], policy: EVERY }).kind).toBe('pass');
    expect(gateRequest({ type: 'permission', ...fetchCall }, { role, skills: [], policy: EVERY, parent: { policy: EVERY, title: 'P' } }).kind).toBe('pass');
    expect(gateRequest({ type: 'permission', ...fetchCall }, { role, skills: [], policy: EVERY, parent: { policy: NO_WEB, title: 'P' } }).kind).toBe('deny');
  });

  it('a custom agent named web-fetch in the project is not the built-in one: refused', () => {
    const cwd = tmp();
    fs.mkdirSync(path.join(cwd, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'agents', 'web-fetch.md'), '---\nname: web-fetch\ntools: Bash\n---\n');
    expect(customWebFetch(cwd, { CLAUDE_CONFIG_DIR: tmp() })).toBe(true);
    expect(customWebFetch(tmp(), { CLAUDE_CONFIG_DIR: tmp() })).toBe(false);
    expect(new SubagentGate(cwd, true).decide(fetchCall)?.deny).toContain('refused');
    expect(subagentRefusal(fetchCall.input, cwd, true)).not.toBeNull();
    expect(subagentRefusal(fetchCall.input, null, false)).not.toBeNull();
  });
});
