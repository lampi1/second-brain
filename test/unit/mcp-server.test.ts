// MCP helpers: content blocks, the port from the environment and the per-chat endpoint tokens. The protocol tests over a
// real HTTP port were removed with the other port tests (docs/tests/load-sensitive-removed.md).
import { describe, expect, it } from 'vitest';
import { listenWithRetry, mcpPortFromEnv, toContent } from '../../src/main/mcp/server';
import { EndpointTokens } from '../../src/main/mcp/tokens';

describe('MCP helpers', () => {
  it('toContent maps outputs to MCP content blocks', () => {
    expect(toContent('')).toEqual([{ type: 'text', text: 'ok' }]);
    expect(toContent({ text: 'x' })).toEqual([{ type: 'text', text: 'x' }]);
  });

  it('mcpPortFromEnv: default 4319, 0 for tests, invalid falls back', () => {
    expect(mcpPortFromEnv({})).toBe(4319);
    expect(mcpPortFromEnv({ SB_MCP_PORT: '0' })).toBe(0);
    expect(mcpPortFromEnv({ SB_MCP_PORT: '5000' })).toBe(5000);
    expect(mcpPortFromEnv({ SB_MCP_PORT: 'abc' })).toBe(4319);
    expect(mcpPortFromEnv({ SB_MCP_PORT: '70000' })).toBe(4319);
  });

  it('EndpointTokens: stable per key, unguessable, constant-time check, revocable', () => {
    const t = new EndpointTokens();
    const a = t.tokenFor('a');
    expect(a).toBe(t.tokenFor('a'));
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(t.tokenFor('b')).not.toBe(a);
    expect(t.check('a', a)).toBe(true);
    expect(t.check('a', `${a}x`)).toBe(false);
    expect(t.check('b', a)).toBe(false);
    expect(t.check('zzz', a)).toBe(false);
    t.revoke('a');
    expect(t.check('a', a)).toBe(false);
  });
});

describe('listenWithRetry (#348: the restarted app waits for the old instance to free 4319)', () => {
  const inUse = () => Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
  it('retries a port in use, then binds it', async () => {
    let calls = 0; const waits: number[] = [];
    const port = await listenWithRetry(async p => { if (++calls < 3) throw inUse(); return p; }, 4319, 6, 500, async ms => { waits.push(ms); });
    expect(port).toBe(4319);
    expect(waits).toEqual([500, 500]);
  });
  it('gives up after the last try, and never retries another error or port 0', async () => {
    let calls = 0;
    await expect(listenWithRetry(async () => { calls++; throw inUse(); }, 4319, 3, 1, async () => {})).rejects.toThrow('EADDRINUSE');
    expect(calls).toBe(3);
    calls = 0;
    await expect(listenWithRetry(async () => { calls++; throw new Error('EACCES'); }, 4319, 3, 1, async () => {})).rejects.toThrow('EACCES');
    expect(calls).toBe(1);
    calls = 0;
    await expect(listenWithRetry(async () => { calls++; throw inUse(); }, 0, 3, 1, async () => {})).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
