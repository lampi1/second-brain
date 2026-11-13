// ApiSession (ADR 0046, engine kind "api"): plain http refused off this computer and URLs with credentials, and a
// session on such a URL ends at start without sending anything. The streaming tests against a local HTTP server were
// removed with the other port tests (docs/tests/load-sensitive-removed.md).
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { ApiSession, checkBaseUrl, type ApiOptions } from '../../../src/main/chats/api';
import { recSink, tmp, type RecSink } from './helpers';

const KEY = 'sk-test-SECRET-0123456789abcdef';

const open: ApiSession[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close())); });

function start(extra: Partial<ApiOptions> = {}): { s: ApiSession; sink: RecSink; historyFile: string } {
  const historyFile = extra.historyFile ?? path.join(tmp('api'), 'history.json');
  const sink = recSink();
  const s = new ApiSession({
    chatId: 'c_api', cwd: tmp('cwd'), engineId: 'deepseek', protocol: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'deepseek-chat',
    apiKey: () => KEY, historyFile, pricesOf: () => ({ inputPerMTok: 2, outputPerMTok: 10 }), ...extra,
  }, sink);
  open.push(s);
  s.start();
  return { s, sink, historyFile };
}

describe('base URL check', () => {
  it('refuses plain http off this computer and URLs with credentials', () => {
    expect(checkBaseUrl('https://api.deepseek.com/v1')).toHaveProperty('url');
    expect(checkBaseUrl('http://127.0.0.1:8080/v1')).toHaveProperty('url');
    expect(checkBaseUrl('http://localhost/v1')).toHaveProperty('url');
    expect(checkBaseUrl('http://[::1]:9000/v1')).toHaveProperty('url');
    expect(checkBaseUrl('http://api.example.com/v1')).toHaveProperty('error');
    expect(checkBaseUrl('http://127.0.0.1.evil.com/v1')).toHaveProperty('error');
    expect(checkBaseUrl('https://user:pw@localhost/v1')).toHaveProperty('error');
    expect(checkBaseUrl('ftp://api.example.com')).toHaveProperty('error');
    expect(checkBaseUrl('not a url')).toHaveProperty('error');
  });

  it('a session on a non-local http URL ends at start with an error and sends nothing', () => {
    const { s, sink } = start({ baseUrl: 'http://api.example.com/v1' });
    expect(sink.exited?.error).toMatch(/Indirizzo non sicuro/);
    expect(s.state).toBe('error');
    expect(() => s.send('x')).toThrow();
  });
});
