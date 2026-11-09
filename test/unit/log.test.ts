// Structured log serialization and CLI readers preserve UTF-8 text while redacting secrets for app diagnostics.
import { describe, expect, it } from 'vitest';
import { addRedaction, log, redact } from '../../src/main/log';

describe('log', () => {
  it('redacts secrets and per-chat MCP tokens', () => {
    expect(redact('key sk-abcdefghijklmnopqrstuv end')).toBe('key [redacted] end');
    expect(redact('http://127.0.0.1:4319/mcp/chat/c1/AbCdEfGh12345678')).toBe('http://127.0.0.1:4319/mcp/chat/c1/[redacted]');
    expect(redact('url?token=xyz&a=1')).toBe('url?token=[redacted]&a=1');
    expect(redact('{"password":"hunter2"}')).toBe('{"password":"[redacted]"}');
    expect(redact('Authorization: Bearer abc.def')).toBe('Authorization: [redacted]');
  });
});

describe('log redaction of known values', () => {
  it('hides a value added at run time, raw and JSON-escaped; ignores short ones', () => {
    addRedaction('Zq9"opaque-vendor-secret');
    expect(redact('got Zq9"opaque-vendor-secret here')).toBe('got [redacted] here');
    expect(redact(JSON.stringify({ k: 'Zq9"opaque-vendor-secret' }))).not.toContain('opaque-vendor-secret');
    addRedaction('short');
    expect(redact('a short word')).toBe('a short word');
  });
});

it('redacts short punctuation passwords without corrupting structured JSON log keys', () => {
  addRedaction('"', true);
  expect(() => log.info('test', 'a " secret', { data: { value: '"' } })).not.toThrow();
  expect(log.recent.at(-1)).toMatchObject({ lvl: 'info', data: { value: '[redacted]' } });
});

it('redacts sensitive structured keys including unregistered values and nested containers', () => {
  log.info('test', 'fixture', { data: { password: 'unknown-fixture-value', nested: { token: { value: 'another-fixture' } }, ordinary: 'visible' } });
  expect(log.recent.at(-1)?.data).toEqual({ password: '[redacted]', nested: { token: '[redacted]' }, ordinary: 'visible' });
});
