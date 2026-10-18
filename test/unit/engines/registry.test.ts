// The engine registry and the session factory (src/main/engines, ADR 0046): known ids, caps instead of names, the tests'
// command overrides from SB_<ID>_PATH, and each kind getting its own adapter.
import { describe, expect, it } from 'vitest';
import { anthropicApi, brainEngine, engineInfos, engineLabel, engineOf, engineOrThrow, enginePathsFromEnv, engines, ENGINE_ID, priceEnginesOf, setBrainEngines } from '../../../src/main/engines/registry';
import { sessionFor } from '../../../src/main/engines/sessions';
import { ApiSession } from '../../../src/main/chats/api';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { AcpSession } from '../../../src/main/chats/acp';
import { CodexSession } from '../../../src/main/chats/codex';
import type { SessionOptions, SessionSink } from '../../../src/main/chats/session';

const sink: SessionSink = { item: () => {}, pending: () => {}, resolved: () => {}, changed: () => {}, exit: () => {} };
const opts: SessionOptions = { chatId: 'c_x', cwd: process.cwd(), model: null, effort: null, permissionMode: null, title: null, sessionId: null, resume: false, fork: false, worktree: false, mcpConfig: null, costBaseUsd: 0, compactWindowTokens: 0 };

describe('engine registry', () => {
  it('knows Claude, Cursor and the presets, in display order, by caps', () => {
    expect(engines().map(e => e.id)).toEqual(['claude', 'cursor', 'codex', 'kimi', 'anthropic']);
    expect(engineOf('claude')?.caps.effort).toBe(true);
    expect(engineOf('cursor')?.caps.effort).toBe(false);
    expect(engineOf('cursor')?.kind).toBe('acp');
    expect(engineOf('nope')).toBeNull();
    expect(() => engineOrThrow('nope')).toThrow(/Motore sconosciuto: nope/);
    expect(engineLabel('cursor')).toBe('Cursor');
    expect(engineLabel('gone')).toBe('gone');
  });

  it('has the Anthropic API as an off preset on the Messages API, priced like Claude (ADR 0052)', () => {
    const a = anthropicApi();
    expect(a).toMatchObject({ id: 'anthropic', kind: 'api', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', defaultOn: false, key: 'required', trusted: false });
    expect(a!.caps.tools).toBe(false);
    expect(priceEnginesOf(a!)).toEqual(['anthropic', 'claude']);
    expect(priceEnginesOf(engineOrThrow('kimi'))).toEqual(['kimi']);
    // a brain entry with that id but another protocol is no Anthropic Messages endpoint
    const other = brainEngine('anthropic', { kind: 'api', label: 'Altro', baseUrl: 'https://example.com/v1', protocol: 'openai' });
    if (typeof other === 'string') throw new Error(other);
    setBrainEngines([other]);
    try { expect(anthropicApi()).toBeNull(); } finally { setBrainEngines([]); }
  });

  it('gives the renderer no start details', () => {
    expect(engineInfos()[0]).toEqual({ id: 'claude', label: 'Claude', name: 'Claude Code', kind: 'claude', caps: engineOf('claude')!.caps, source: 'app', key: 'none', runs: 'Claude Code (incorporato)', trusted: true });
    for (const k of ['login', 'command', 'args', 'keyEnv', 'baseUrl']) expect(Object.keys(engineInfos()[1]!)).not.toContain(k);
  });

  it('has Codex as an immutable built-in over app-server, with model and effort per turn (ADR 0060)', () => {
    const c = engineOrThrow('codex');
    expect(c).toMatchObject({ kind: 'codex', command: 'codex', args: ['app-server'], keyEnv: 'CODEX_API_KEY', login: ['login'], defaultOn: true, key: 'optional', trusted: true, runs: 'codex app-server · accesso: codex login' });
    expect(brainEngine('codex', { kind: 'acp', command: 'untrusted' })).toEqual(expect.any(String));
    expect(c.caps).toMatchObject({ effort: true, liveModel: true, tools: true, transcript: false, cost: false, permissionMode: false });
    expect(enginePathsFromEnv({ SB_CODEX_PATH: 'x.mjs' })).toEqual({ codex: 'x.mjs' });
    expect(brainEngine('codex2', { kind: 'codex', label: 'C', command: 'codex' })).toEqual(expect.any(String));
  });

  it('reads each engine\'s override from SB_<ID>_PATH only', () => {
    expect(enginePathsFromEnv({ SB_CLAUDE_PATH: 'a.mjs', SB_CURSOR_PATH: 'b.mjs', SB_KIMI_PATH: 'k.mjs', SB_OTHER_PATH: 'c' })).toEqual({ claude: 'a.mjs', cursor: 'b.mjs', kimi: 'k.mjs' });
    expect(enginePathsFromEnv({})).toEqual({});
  });

  it('accepts only id-shaped engine ids', () => {
    expect(ENGINE_ID.test('kimi')).toBe(true);
    expect(ENGINE_ID.test('open-router2')).toBe(true);
    for (const bad of ['', 'Kimi', '../x', 'a b', '1x']) expect(ENGINE_ID.test(bad)).toBe(false);
  });

  it('builds each kind\'s own adapter (not started)', () => {
    const ctx = { userData: process.cwd(), mcpUrl: null, appMcpUrl: null, showReplay: false, acpModelConfig: null, key: () => null };
    expect(sessionFor(engineOrThrow('claude'), opts, sink, ctx)).toBeInstanceOf(ClaudeSession);
    expect(sessionFor(engineOrThrow('cursor'), opts, sink, ctx)).toBeInstanceOf(AcpSession);
    expect(sessionFor(engineOrThrow('kimi'), opts, sink, ctx)).toBeInstanceOf(AcpSession);
    expect(sessionFor(engineOrThrow('codex'), opts, sink, ctx)).toBeInstanceOf(CodexSession);
    const api = brainEngine('local', { kind: 'api', label: 'Locale', baseUrl: 'http://127.0.0.1:1/v1', protocol: 'openai' });
    if (typeof api === 'string') throw new Error(api);
    setBrainEngines([api]);
    try { expect(sessionFor(engineOrThrow('local'), opts, sink, ctx)).toBeInstanceOf(ApiSession); } finally { setBrainEngines([]); }
  });
});
