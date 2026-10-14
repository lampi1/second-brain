// The engine registry and the session factory (src/main/engines, ADR 0046): known ids, caps instead of names, the tests'
// command overrides from SB_<ID>_PATH, and each kind getting its own adapter.
import { describe, expect, it } from 'vitest';
import { brainEngine, engineInfos, engineLabel, engineOf, engineOrThrow, enginePathsFromEnv, engines, ENGINE_ID, setBrainEngines } from '../../../src/main/engines/registry';
import { sessionFor } from '../../../src/main/engines/sessions';
import { ApiSession } from '../../../src/main/chats/api';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { AcpSession } from '../../../src/main/chats/acp';
import type { SessionOptions, SessionSink } from '../../../src/main/chats/session';

const sink: SessionSink = { item: () => {}, pending: () => {}, resolved: () => {}, changed: () => {}, exit: () => {} };
const opts: SessionOptions = { chatId: 'c_x', cwd: process.cwd(), model: null, effort: null, permissionMode: null, title: null, sessionId: null, resume: false, fork: false, worktree: false, mcpConfig: null, costBaseUsd: 0, compactWindowTokens: 0 };

describe('engine registry', () => {
  it('knows Claude, Cursor and the presets, in display order, by caps', () => {
    expect(engines().map(e => e.id)).toEqual(['claude', 'cursor', 'kimi', 'gemini']);
    expect(engineOf('claude')?.caps.effort).toBe(true);
    expect(engineOf('cursor')?.caps.effort).toBe(false);
    expect(engineOf('cursor')?.kind).toBe('acp');
    expect(engineOf('nope')).toBeNull();
    expect(() => engineOrThrow('nope')).toThrow(/Motore sconosciuto: nope/);
    expect(engineLabel('cursor')).toBe('Cursor');
    expect(engineLabel('gone')).toBe('gone');
  });

  it('gives the renderer no start details', () => {
    expect(engineInfos()[0]).toEqual({ id: 'claude', label: 'Claude', name: 'Claude Code', kind: 'claude', caps: engineOf('claude')!.caps, source: 'app', key: 'none', runs: 'Claude Code (incorporato)', trusted: true });
    for (const k of ['login', 'command', 'args', 'keyEnv', 'baseUrl']) expect(Object.keys(engineInfos()[1]!)).not.toContain(k);
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
    const api = brainEngine('local', { kind: 'api', label: 'Locale', baseUrl: 'http://127.0.0.1:1/v1', protocol: 'openai' });
    if (typeof api === 'string') throw new Error(api);
    setBrainEngines([api]);
    try { expect(sessionFor(engineOrThrow('local'), opts, sink, ctx)).toBeInstanceOf(ApiSession); } finally { setBrainEngines([]); }
  });
});
