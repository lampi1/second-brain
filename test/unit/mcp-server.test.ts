// MCP helpers: content blocks, the port from the environment and the per-chat endpoint tokens. The protocol tests over a
// real HTTP port were removed with the other port tests (docs/tests/load-sensitive-removed.md).
import { describe, expect, it } from 'vitest';
import { mcpPortFromEnv, toContent } from '../../src/main/mcp/server';
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
