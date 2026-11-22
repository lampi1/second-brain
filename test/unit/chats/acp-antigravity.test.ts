// Antigravity CLI ("agy acp", ADR 0332) on the shared ACP adapter, in process: its catalog entry (no permission bypass,
// the model as a config option, http MCP without the capability), the app's tools it names mcp_<server>_<tool> answered
// without a panel (run_code only in Code Mode), its MCP servers passed though initialize announces none, the model
// picker winning over its per-thinking-level "models", its working mode "default", never "auto" or "accept-edits", its
// folder as the long real path, and no read-only chats.
// The session/new answer below is agy 1.5.14's own (real run 2026-11-22). No real engine ever runs here.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { AcpSession, longPath } from '../../../src/main/chats/acp';
import { acpAppTool } from '../../../src/main/chats/app-tool-approval';
import { codeModeFor } from '../../../src/main/code-mode/policy';
import { engineOf } from '../../../src/main/engines/registry';
import { readOnlyRun, sessionFor } from '../../../src/main/engines/sessions';
import { tmp } from './helpers';

const MCP = 'http://127.0.0.1:4329/mcp/chat-1';
const APP = 'http://127.0.0.1:4329/mcp/app';

/** agy 1.5.14's session/new result, trimmed to what the app reads. */
const AGY_NEW = {
  sessionId: 'agy-session-1',
  models: { currentModelId: 'gemini-3.8-flash-high', availableModels: [
    { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }, { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    { modelId: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
  ] },
  modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'accept-edits' }, { id: 'auto' }, { id: 'plan' }] },
  configOptions: [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'gemini-3.8-flash', options: [
      { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }, { value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
    ] },
    { id: 'thought_level', name: 'Thinking Level', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }] },
    { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'default', options: [{ value: 'default' }, { value: 'accept-edits' }, { value: 'auto' }, { value: 'plan' }] },
  ],
};

interface Inside {
  caps: Record<string, unknown>; sessionId: string | null; modes: string[];
  models: { current: string | null; available: string[] } | null; modelOption: string | null; params: { id: string; category?: string }[];
  mcpServers(): { name: string; type: string; url: string }[];
  readState(r: object): void;
  request: (method: string, params: object) => Promise<object>;
  respond: (id: number | string, result: object) => void;
  onAgentRequest(id: number | string, method: string, p: object): Promise<void>;
  pending: (req: object) => void;
}

const open: AcpSession[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });

/** An Antigravity session as engines/sessions.ts builds it; under tests the real CLI never starts (cli.ts engineAllowed). */
function agy(extra: object = {}): Inside {
  const s = new AcpSession({
    engineId: 'antigravity', label: 'Antigravity', args: ['acp', '--disable-telemetry'], acpCommand: 'agy', loginCommand: 'agy acp --login',
    modelOption: true, mcpHttp: true, appAsk: true, chatId: 'c', cwd: tmp('cwd'), mcpUrl: MCP, appMcpUrl: APP, ...extra,
  }, { changed: () => {}, item: () => {}, models: () => {}, pending: () => {} } as never);
  open.push(s);
  return s as unknown as Inside;
}

describe('Antigravity engine (ADR 0332)', () => {
  it('is a catalog proposal that starts agy acp without any permission bypass, off and untrusted until the user turns it on', () => {
    const e = engineOf('antigravity')!;
    expect(e).toMatchObject({ kind: 'acp', command: 'agy', args: ['acp', '--disable-telemetry'], login: ['acp', '--login'], modelOption: true, mcpHttp: true, realCwd: true, noReadOnly: true, defaultOn: false, source: 'catalog', trusted: false });
    expect(e.modelFlag).toBeUndefined();
    expect(e.args!.join(' ')).not.toMatch(/dangerously|skip-permissions|yolo/);
    expect(e.catalog).toMatchObject({ signIn: 'agy acp --login', installUrl: 'https://antigravity.google' });
  });

  it("answers the app's own tools by their mcp_<server>_<tool> name; any other server, or run_code outside Code Mode, still asks", () => {
    expect(acpAppTool('mcp_second-brain_agent_report', MCP, APP)).toBe(true);
    expect(acpAppTool('mcp_second-brain_ask_user', MCP, APP, true)).toBe(true);
    expect(acpAppTool('mcp_second-brain_agent_report', MCP, APP, true)).toBe(false);
    expect(acpAppTool('mcp_second-brain-app_app_state', MCP, APP)).toBe(true);
    expect(acpAppTool('mcp_second-brain-app_app_state', MCP, null)).toBe(false);
    expect(acpAppTool('mcp_second-brain_navigate', MCP, APP)).toBe(false);
    expect(acpAppTool('mcp_second-brain-evil_agent_report', MCP, APP)).toBe(false);
    expect(acpAppTool('mcp_outlook_send_email', MCP, APP)).toBe(false);
    expect(acpAppTool('mcp_second-brain_run_code', MCP, APP)).toBe(false);
    expect(acpAppTool('mcp_second-brain_run_code', MCP, APP, false, true)).toBe(true);
    expect(acpAppTool('mcp_second-brain_run_code', MCP, APP, true, true)).toBe(false);
    expect(acpAppTool('mcp_second-brain_run_code', 'http://example.com/mcp/x', APP, false, true)).toBe(false);
  });

  it("a permission request for an app tool goes back allowed with no panel; a write still reaches the app's gates", async () => {
    const s = agy();
    const answers: [number | string, object][] = [], panels: object[] = [];
    s.respond = (id, r) => { answers.push([id, r]); };
    s.pending = req => { panels.push(req); };
    const options = [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }];
    await s.onAgentRequest('1', 'session/request_permission', { sessionId: 'x', options, toolCall: { toolCallId: 'a', name: 'mcp_second-brain_agent_report', kind: 'other', title: 'Run mcp_second-brain_agent_report', rawInput: {} } });
    expect(answers).toEqual([['1', { outcome: { outcome: 'selected', optionId: 'allow' } }]]);
    await s.onAgentRequest('2', 'session/request_permission', { sessionId: 'x', options, toolCall: { toolCallId: 'b', name: 'write_file', kind: 'edit', title: 'Write notes.md', rawInput: { path: 'notes.md' } } });
    await s.onAgentRequest('3', 'session/request_permission', { sessionId: 'x', options, toolCall: { toolCallId: 'c', name: 'mcp_second-brain_run_code', kind: 'other', title: 'Run mcp_second-brain_run_code', rawInput: {} } });
    expect(answers).toHaveLength(1);
    expect(panels).toHaveLength(2);
  });

  it("passes the app's http MCP servers though initialize announces no mcpCapabilities; another engine without it gets none", () => {
    const s = agy();
    s.caps = { loadSession: true };
    expect(s.mcpServers().map(x => [x.name, x.type, x.url])).toEqual([['second-brain', 'http', MCP], ['second-brain-app', 'http', APP]]);
    const other = agy({ mcpHttp: false });
    other.caps = { loadSession: true };
    expect(other.mcpServers()).toEqual([]);
  });

  it('reads the model from its "model" option, not from models (one id per thinking level), with thought_level as the effort', () => {
    const s = agy();
    s.readState(AGY_NEW);
    expect(s.modelOption).toBe('model');
    expect(s.models).toEqual({ current: 'gemini-3.8-flash', available: ['gemini-3.8-flash', 'claude-sonnet-4-6'] });
    expect(s.params.find(p => p.category === 'thought_level')?.id).toBe('thought_level');
    expect(s.modes).toEqual(['default', 'accept-edits', 'auto', 'plan']);
  });

  it('works in "default", never in "auto" or "accept-edits"; an engine with only self-approving modes is refused', async () => {
    const s = agy();
    const sent: [string, object][] = [];
    s.request = async (m, p) => { sent.push([m, p]); return {}; };
    s.sessionId = 'sid';
    s.modes = ['accept-edits', 'auto', 'default', 'plan'];
    await (s as unknown as AcpSession).setPermissionMode('default' as never);
    expect(sent).toEqual([['session/set_mode', { sessionId: 'sid', modeId: 'default' }]]);
    s.modes = ['accept-edits', 'auto', 'plan'];
    await expect((s as unknown as AcpSession).setPermissionMode('default' as never)).rejects.toThrow(/non ha la modalità/);
  });

  it('opens its session in the long real path of the chat folder (8.3 short names expanded), the path as given when it cannot be resolved', async () => {
    const dir = tmp('cwd');
    expect(longPath(dir)).toBe(fs.realpathSync.native(dir));
    expect(longPath(dir + '-missing')).toBe(dir + '-missing');
    const s = agy({ cwd: dir, realCwd: true });
    const sent: [string, Record<string, unknown>][] = [];
    s.request = async (m, p) => { sent.push([m, p as Record<string, unknown>]); return AGY_NEW; };
    s.caps = {};
    await (s as unknown as { openSession(): Promise<void> }).openSession();
    expect(sent[0]![0]).toBe('session/new');
    expect(sent[0]![1].cwd).toBe(fs.realpathSync.native(dir));
    expect((s as unknown as { cwd: string }).cwd).toBe(fs.realpathSync.native(dir));
  });

  it('never runs a read-only chat: a comparison side, the ceiling «plan», or a role without edits, commands or brain writes', () => {
    expect(readOnlyRun({ readOnly: true })).toBe(true);
    expect(readOnlyRun({ ceiling: 'plan' })).toBe(true);
    expect(readOnlyRun({ toolPolicy: { allow: ['read', 'shell-read', 'web'] } })).toBe(true);
    expect(readOnlyRun({ toolPolicy: { allow: ['read', 'edit'] } })).toBe(false);
    expect(readOnlyRun({ ceiling: 'default', toolPolicy: null })).toBe(false);
    const e = engineOf('antigravity')!;
    const sink = { changed: () => {}, item: () => {}, models: () => {}, pending: () => {} } as never;
    expect(() => sessionFor(e, { chatId: 'c', cwd: tmp('cwd'), toolPolicy: { allow: ['read', 'shell-read'] } } as never, sink, {} as never)).toThrow(/sola lettura/);
  });

  it('stays out of Code Mode: agy does not hand run_code to its model (ADR 0332)', () => {
    expect(codeModeFor({ harness: 'antigravity', isOrchestrator: false, research: false } as never, true)).toBe(false);
    expect(codeModeFor({ harness: 'antigravity', isOrchestrator: true, research: false } as never, true)).toBe(false);
  });
});
