import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addRedaction, log, redact } from '../../src/main/log';

describe('log', () => {
  it('redacts secrets and per-chat MCP tokens', () => {
    expect(redact('key sk-abcdefghijklmnopqrstuv end')).toBe('key [redacted] end');
    expect(redact('http://127.0.0.1:4319/mcp/chat/c1/AbCdEfGh12345678')).toBe('http://127.0.0.1:4319/mcp/chat/c1/[redacted]');
    expect(redact('url?token=xyz&a=1')).toBe('url?token=[redacted]&a=1');
    expect(redact('{"password":"hunter2"}')).toBe('{"password":"[redacted]"}');
    expect(redact('Authorization: Bearer abc.def')).toBe('Authorization: [redacted]');
  });

  it('writes one JSON line per entry with cause and hint on errors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-log-'));
    log.init(dir);
    log.info('test', 'hello', { chat: 'c1', data: { n: 1 } });
    log.error('test', 'boom', { cause: 'claude.exe not found', hint: 'install Claude Code or set SB_CLAUDE_PATH' });
    const file = fs.readdirSync(path.join(dir, 'logs'))[0]!;
    const lines = fs.readFileSync(path.join(dir, 'logs', file), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines.at(-2)).toMatchObject({ lvl: 'info', scope: 'test', msg: 'hello', chat: 'c1', data: { n: 1 } });
    expect(lines.at(-1)).toMatchObject({ lvl: 'error', cause: 'claude.exe not found', hint: expect.stringContaining('SB_CLAUDE_PATH') });
    expect(log.recent.at(-1)?.msg).toBe('boom');
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
