// The CLI contracts (ADR 0055): what the app reads from Claude Code's stream-json, from every ACP engine and from Codex
// app-server (ADR 0060: its fixture is synthesized from the protocol schema until a real run is recorded), checked
// without spending a token. The sanitizer keeps only protocol words; drift() reports each unknown shape once; the
// recorder keeps a few samples per shape; the parsers report what they do not know; and every recorded real stream
// in test/fixtures/cli/<cli>/<version>.jsonl (scripts/cli-fixtures.mjs) replays through the real parsers with no
// drift and no error. A CLI update that renames or adds something fails here, not in the user's chats.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ClaudeSession, claudeKey } from '../../../src/main/chats/claude';
import { AcpSession, acpKey } from '../../../src/main/chats/acp';
import { CodexSession } from '../../../src/main/chats/codex';
import { RECORD_PER_KEY, drift, drifts, record, resetDrift, sanitize, setRecorder } from '../../../src/main/chats/drift';
import { log } from '../../../src/main/log';
import { recSink, tmp } from './helpers';

const FIXTURES = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'cli');
const line = (s: { line(raw: string): void }, m: unknown): void => s.line(JSON.stringify(m));
const claude = (): ClaudeSession => new ClaudeSession({ chatId: 'c_contract', cwd: '.', sessionId: '11111111-2222-4333-8444-555555555555' }, recSink());
const codex = (): CodexSession => new CodexSession({ engineId: 'codex', label: 'Codex', args: ['app-server'], chatId: 'c_contract', cwd: '.' }, recSink());
const acp = (engineId = 'cursor'): AcpSession => new AcpSession({ engineId, label: engineId, args: ['acp'], chatId: 'c_contract', cwd: '.' }, recSink());

afterEach(() => { resetDrift(); setRecorder(null); });

describe('sanitize', () => {
  it('keeps protocol words, numbers and the nesting; hides every other string', () => {
    const out = sanitize({ type: 'assistant', session_id: 'abc-123', message: { content: [{ type: 'text', text: 'la password è x' }] }, total_cost_usd: 0.5, is_error: false, x: null });
    expect(out).toEqual({ type: 'assistant', session_id: 's:7', message: { content: [{ type: 'text', text: 's:15' }] }, total_cost_usd: 0.5, is_error: false, x: null });
  });

  it('a protocol key holding a path or a sentence is content after all', () => {
    expect(sanitize({ type: 'C:\\Users\\x' })).toEqual({ type: 's:10' });
    expect(sanitize({ status: 'two words' })).toEqual({ status: 's:9' });
    expect(sanitize({ name: 'x'.repeat(65) })).toEqual({ name: 's:65' });
  });

  it('names stay only when they are Claude Code built-in tools (MCP servers and project commands are the user\'s)', () => {
    expect(sanitize({ tool_name: 'AskUserQuestion', mcp_servers: [{ name: 'stripe-prod', status: 'connected' }], commands: [{ name: 'deploy-staging' }] }))
      .toEqual({ tool_name: 'AskUserQuestion', mcp_servers: [{ name: 's:11', status: 'connected' }], commands: [{ name: 's:14' }] });
  });

  it('arrays keep at most 5 items and deep nesting stops', () => {
    expect((sanitize({ a: [1, 2, 3, 4, 5, 6, 7] }) as { a: number[] }).a).toHaveLength(5);
    let deep: unknown = 'x';
    for (let i = 0; i < 20; i++) deep = { d: deep };
    expect(JSON.stringify(sanitize(deep))).toContain('…');
  });
});

describe('drift', () => {
  it('reports each (cli, version, kind, what) once', () => {
    drift('claude', '2.1.283', 'message type', 'new_thing', { type: 'new_thing', prompt: 'x' });
    drift('claude', '2.1.283', 'message type', 'new_thing', {});
    drift('claude', '2.1.284', 'message type', 'new_thing', {});
    drift('cursor', null, 'session update', 'new_update');
    expect(drifts()).toEqual([
      { cli: 'claude', version: '2.1.283', kind: 'message type', what: 'new_thing' },
      { cli: 'claude', version: '2.1.284', kind: 'message type', what: 'new_thing' },
      { cli: 'cursor', version: '?', kind: 'session update', what: 'new_update' },
    ]);
    const w = log.recent.filter(e => e.scope === 'drift' && e.lvl === 'warn').at(-3);
    expect(w?.cause).toBe('claude 2.1.283: message type "new_thing"');
    expect(w?.hint).toMatch(/cli-contract\.test\.ts/);
    expect(w?.data).toMatchObject({ sample: { type: 'new_thing', prompt: 's:1' } }); // the sample is sanitized
  });
});

describe('record', () => {
  it('keeps at most RECORD_PER_KEY sanitized samples per shape and version, also across restarts', () => {
    const dir = tmp('rec');
    setRecorder(dir);
    for (let i = 0; i < 5; i++) record('claude', '2.1.283', 'system/init', { type: 'system', subtype: 'init', cwd: 'C:\\secret' });
    record('claude', '2.1.284', 'system/init', { type: 'system' });
    setRecorder(dir); // a restart reads the counts back
    record('claude', '2.1.283', 'system/init', { type: 'system' });
    const lines = fs.readFileSync(path.join(dir, 'claude.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { version: string; key: string; msg: Record<string, unknown> });
    expect(lines.filter(l => l.version === '2.1.283')).toHaveLength(RECORD_PER_KEY);
    expect(lines.filter(l => l.version === '2.1.284')).toHaveLength(1);
    expect(lines[0]?.msg).toEqual({ type: 'system', subtype: 'init', cwd: 's:9' });
  });

  it('is off until the dev wiring turns it on', () => {
    record('claude', '1', 'x', {}); // no folder: nothing happens, nothing throws
    expect(drifts()).toEqual([]);
  });
});

describe('Claude parser: what it does not know is reported', () => {
  it('names the shape of each message for the recorder', () => {
    expect(claudeKey({ type: 'system', subtype: 'init' })).toBe('system/init');
    expect(claudeKey({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta' } } })).toBe('stream_event/content_block_delta/text_delta');
    expect(claudeKey({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } })).toBe('assistant/tool_use');
    expect(claudeKey({ type: 'control_request', request: { subtype: 'can_use_tool' } })).toBe('control_request/can_use_tool');
  });

  it('unknown message types, subtypes, events, deltas, states and task statuses: one drift each', () => {
    const s = claude();
    line(s, { type: 'system', subtype: 'init', session_id: 'x', claude_code_version: '9.9.9' });
    line(s, { type: 'brand_new' });
    line(s, { type: 'system', subtype: 'brand_new_sub' });
    line(s, { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1' } } });
    line(s, { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    line(s, { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_v2', value: 'x' } } });
    line(s, { type: 'stream_event', parent_tool_use_id: null, event: { type: 'brand_new_event' } });
    line(s, { type: 'system', subtype: 'session_state_changed', state: 'sleeping' });
    line(s, { type: 'system', subtype: 'task_updated', task_id: 't', patch: { status: 'archived' } });
    line(s, { type: 'result', subtype: 'success', duration_ms: 1, num_turns: 1 });
    expect(drifts().map(d => `${d.version} ${d.kind} ${d.what}`)).toEqual([
      '9.9.9 message type brand_new',
      '9.9.9 system subtype brand_new_sub',
      '9.9.9 stream delta text_v2',
      '9.9.9 stream event brand_new_event',
      '9.9.9 session state sleeping',
      '9.9.9 task status archived',
      '9.9.9 result field total_cost_usd',
      '9.9.9 result field usage',
    ]);
  });

  it('what it knowingly ignores is no drift', () => {
    const s = claude();
    for (const type of ['keep_alive', 'auth_status', 'tool_progress', 'rate_limit_event']) line(s, { type });
    line(s, { type: 'system', subtype: 'hook_started' });
    for (const subtype of ['thinking_tokens', 'background_tasks_changed', 'vcs_state_changed']) line(s, { type: 'system', subtype }); // CLI 2.1.283, #155
    line(s, { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_stop' } });
    line(s, { type: 'system', subtype: 'task_updated', task_id: 't', patch: { status: 'running' } });
    line(s, { type: 'system', subtype: 'session_state_changed', state: 'idle' });
    line(s, { type: 'result', subtype: 'success', total_cost_usd: 0.1, usage: {} });
    expect(drifts()).toEqual([]);
  });
});

describe('ACP parser: what it does not know is reported', () => {
  it('names the shape of each message for the recorder', () => {
    expect(acpKey({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'tool_call' } } })).toBe('update/tool_call');
    expect(acpKey({ jsonrpc: '2.0', id: 3, method: 'session/request_permission' })).toBe('request/session/request_permission');
    expect(acpKey({ jsonrpc: '2.0', id: 3, result: {} }, 'session/new')).toBe('result/session/new');
    expect(acpKey({ jsonrpc: '2.0', method: 'x/y' })).toBe('notify/x/y');
  });

  it('unknown updates, notifications, requests and tool kinds: one drift each, named by engine', () => {
    const s = acp('kimi');
    const up = (update: unknown): void => line(s, { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'x', update } });
    up({ sessionUpdate: 'brand_new_update' });
    up({ sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'teleport', title: 'x', status: 'pending' });
    line(s, { jsonrpc: '2.0', method: 'kimi/brand_new' });
    line(s, { jsonrpc: '2.0', id: 7, method: 'kimi/ask_something', params: {} });
    expect(drifts().map(d => `${d.cli} ${d.kind} ${d.what}`)).toEqual([
      'kimi session update brand_new_update',
      'kimi tool kind teleport',
      'kimi notification kimi/brand_new',
      'kimi agent request kimi/ask_something',
    ]);
  });

  it('known updates and ignored ones are no drift', () => {
    const s = acp();
    const up = (update: unknown): void => line(s, { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'x', update } });
    up({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ciao' } });
    up({ sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'execute', title: 'ls', status: 'pending' });
    up({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    up({ sessionUpdate: 'usage_update', used: 10, size: 100 });
    up({ sessionUpdate: 'session_info_update' });
    expect(drifts()).toEqual([]);
  });
});

describe('Codex parser: what it does not know is reported', () => {
  it('unknown notifications, item types, turn statuses and server requests: one drift each', () => {
    const s = codex();
    line(s, { method: 'thread/brandNew', params: {} });
    line(s, { method: 'item/completed', params: { item: { type: 'teleport', id: 'x' } } });
    line(s, { method: 'turn/completed', params: { turn: { id: 't', status: 'paused' } } });
    line(s, { id: 9, method: 'item/brandNew/requestApproval', params: {} });
    expect(drifts().map(d => `${d.cli} ${d.kind} ${d.what}`)).toEqual([
      'codex notification thread/brandNew',
      'codex item type teleport',
      'codex turn status paused',
      'codex server request item/brandNew/requestApproval',
    ]);
  });

  it('known and knowingly ignored shapes are no drift, with or without the jsonrpc field', () => {
    const s = codex();
    line(s, { method: 'thread/status/changed', params: {} });
    line(s, { jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { itemId: 'a', delta: 'x' } });
    line(s, { method: 'skills/changed', params: {} });
    expect(drifts()).toEqual([]);
  });
});

/** Every recorded real stream: test/fixtures/cli/<cli>/<version>.jsonl, one {key, msg} per line. */
function recordings(): { cli: string; version: string; file: string }[] {
  if (!fs.existsSync(FIXTURES)) return [];
  return fs.readdirSync(FIXTURES).flatMap(cli => fs.readdirSync(path.join(FIXTURES, cli)).filter(f => f.endsWith('.jsonl'))
    .map(f => ({ cli, version: f.slice(0, -'.jsonl'.length), file: path.join(FIXTURES, cli, f) })));
}

describe('recorded real streams replay with no drift', () => {
  const list = recordings();
  it.skipIf(list.length > 0)('no recordings yet (the dev instance records them: node scripts/cli-fixtures.mjs)', () => {
    expect(list).toEqual([]);
  });
  it.each(list)('$cli $version', ({ cli, file }) => {
    const s = cli === 'claude' ? claude() : cli === 'codex' ? codex() : acp(cli);
    const msgs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => (JSON.parse(l) as { msg: unknown }).msg);
    expect(msgs.length).toBeGreaterThan(0);
    const before = log.recent.length;
    for (const m of msgs) line(s, m);
    expect(drifts()).toEqual([]);
    expect(log.recent.slice(before).filter(e => e.lvl === 'error' && /not understood/.test(e.msg))).toEqual([]);
  });
});
