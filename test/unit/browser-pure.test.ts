// Pure parts of the browser module: refs, keys, network log, evidence paths, hand-offs, URL normalization.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import vm from 'node:vm';
import { parseRef, parseFrame, refPrefix } from '../../src/main/browser/refs';
import { charKey, parseKeys, parseModifiers, strokeEvents, MOD } from '../../src/main/browser/keys';
import { NetLog, formatEntry, formatDetail, redactHeaders } from '../../src/main/browser/netlog';
import { evidencePath, groupFolder, stampName } from '../../src/main/browser/evidence';
import { Handoffs } from '../../src/main/browser/handoffs';
import { normalizeUrl } from '../../src/main/browser/actions';
import { pageCall } from '../../src/main/browser/page';
import type { BrowserHandoff } from '../../src/shared/contract';

describe('refs', () => {
  it('parses top-frame and iframe refs, with Claude-pane aliases', () => {
    expect(parseRef('e12')).toEqual({ frame: 0, ref: 'e12' });
    expect(parseRef('f3e7')).toEqual({ frame: 3, ref: 'f3e7' });
    expect(parseRef('ref_12')).toEqual({ frame: 0, ref: 'e12' });
    expect(parseRef('[e5]')).toEqual({ frame: 0, ref: 'e5' });
    expect(parseRef(' F2E09 ')).toEqual({ frame: 2, ref: 'f2e9' });
    expect(() => parseRef('button')).toThrow(/Invalid ref/);
    expect(() => parseRef(undefined)).toThrow(/Invalid ref/);
    expect(refPrefix(0)).toBe('e');
    expect(refPrefix(4)).toBe('f4e');
  });

  it('parses frame ids', () => {
    expect(parseFrame(undefined)).toBe(0);
    expect(parseFrame('top')).toBe(0);
    expect(parseFrame('f2')).toBe(2);
    expect(parseFrame('3')).toBe(3);
    expect(() => parseFrame('x1')).toThrow(/Invalid frame/);
  });
});

describe('keys', () => {
  it('turns combos into CDP key events with modifiers held around the key', () => {
    const [s] = parseKeys('ctrl+a');
    expect(s!.modifiers).toBe(MOD.ctrl);
    const ev = strokeEvents(s!);
    expect(ev.map(e => `${e.type}:${e.key}`)).toEqual(['rawKeyDown:Control', 'rawKeyDown:a', 'keyUp:a', 'keyUp:Control']);
    expect(ev[1]).toMatchObject({ code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: MOD.ctrl });
    expect(ev[1]!.text).toBeUndefined();                    // ctrl+a must not type an "a"
  });

  it('types printable keys with text, Enter as \\r, shift upper-cases', () => {
    const [enter] = parseKeys('Enter');
    expect(strokeEvents(enter!)[0]).toMatchObject({ type: 'keyDown', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    const [shiftA] = parseKeys('shift+a');
    expect(strokeEvents(shiftA!)[1]).toMatchObject({ type: 'keyDown', text: 'A', modifiers: MOD.shift });
    const [tab] = parseKeys('shift+Tab');
    expect(strokeEvents(tab!)[1]).toMatchObject({ type: 'rawKeyDown', key: 'Tab' });
  });

  it('parses sequences, named keys, "ctrl++" and rejects unknown names', () => {
    expect(parseKeys('ctrl+a Backspace  Delete').map(s => s.def.key)).toEqual(['a', 'Backspace', 'Delete']);
    expect(parseKeys('ArrowDown PageDown F5 esc').map(s => s.def.key)).toEqual(['ArrowDown', 'PageDown', 'F5', 'Escape']);
    const [plus] = parseKeys('ctrl++');
    expect(plus).toMatchObject({ modifiers: MOD.ctrl, def: { key: '+' } });
    expect(() => parseKeys('Enterr')).toThrow(/Unknown key "Enterr"/);
    expect(() => parseKeys('hyper+a')).toThrow(/Unknown modifier/);
    expect(() => parseKeys('  ')).toThrow(/No keys/);
  });

  it('maps characters to keys (null when there is no key: insertText)', () => {
    expect(charKey('7')).toMatchObject({ code: 'Digit7', vk: 55, text: '7' });
    expect(charKey('.')).toMatchObject({ code: 'Period', text: '.' });
    expect(charKey('\n')).toMatchObject({ key: 'Enter' });
    expect(charKey('é')).toBeNull();
    expect(charKey('€')).toBeNull();
  });

  it('parses click modifiers', () => {
    expect(parseModifiers('ctrl+shift')).toBe(MOD.ctrl | MOD.shift);
    expect(parseModifiers(['alt', 'meta'])).toBe(MOD.alt | MOD.meta);
    expect(parseModifiers(undefined)).toBe(0);
    expect(() => parseModifiers('fn')).toThrow(/Unknown modifier/);
  });
});

describe('NetLog', () => {
  const clock = () => { let t = 1000; const now = () => t; return { now, at: (v: number) => { t = v; } }; };

  it('tracks a request from start to finish, with redacted headers', () => {
    const c = clock();
    const n = new NetLog(500, c.now);
    n.onEvent('Network.requestWillBeSent', { requestId: '1', type: 'XHR', request: { url: 'https://x/api?token=abc123secret', method: 'POST', headers: { Authorization: 'Bearer zzz', Accept: 'json' }, postData: '{"a":1}' } });
    expect(n.inflight()).toBe(1);
    c.at(1040);
    n.onEvent('Network.responseReceived', { requestId: '1', type: 'XHR', response: { status: 201, statusText: 'Created', mimeType: 'application/json', headers: { 'Set-Cookie': 'sid=1' } } });
    n.onEvent('Network.loadingFinished', { requestId: '1', encodedDataLength: 2048 });
    expect(n.inflight()).toBe(0);
    const [e] = n.list();
    expect(e).toMatchObject({ id: 'r1', status: 201, size: 2048, requestHeaders: { Authorization: '[redacted]', Accept: 'json' }, responseHeaders: { 'Set-Cookie': '[redacted]' } });
    expect(formatEntry(e!)).toBe('r1 201 POST XHR https://x/api?token=[redacted] 40ms 2.0KB');
    expect(formatDetail(e!)).toContain('Request body: {"a":1}');
  });

  it('records failures and >= 400 since a time, and filters', () => {
    const c = clock();
    const n = new NetLog(500, c.now);
    n.onEvent('Network.requestWillBeSent', { requestId: 'a', type: 'Fetch', request: { url: 'http://h/api/ok', method: 'GET' } });
    n.onEvent('Network.responseReceived', { requestId: 'a', response: { status: 200 } });
    n.onEvent('Network.loadingFinished', { requestId: 'a' });
    c.at(2000);
    n.onEvent('Network.requestWillBeSent', { requestId: 'b', type: 'Fetch', request: { url: 'http://h/api/fail', method: 'GET' } });
    n.onEvent('Network.responseReceived', { requestId: 'b', response: { status: 500 } });
    n.onEvent('Network.loadingFinished', { requestId: 'b' });
    n.onEvent('Network.requestWillBeSent', { requestId: 'c', type: 'Script', request: { url: 'http://h/x.js', method: 'GET' } });
    n.onEvent('Network.loadingFailed', { requestId: 'c', errorText: 'net::ERR_CONNECTION_REFUSED' });
    n.onEvent('Network.requestWillBeSent', { requestId: 'd', type: 'Image', request: { url: 'http://h/i.png', method: 'GET' } });
    n.onEvent('Network.loadingFailed', { requestId: 'd', canceled: true });
    expect(n.failuresSince(1500).map(e => e.url)).toEqual(['http://h/api/fail', 'http://h/x.js']);
    expect(n.list({ status: 'error' }).map(e => e.id)).toEqual(['r2', 'r3']);
    expect(n.list({ status: '5xx' }).map(e => e.id)).toEqual(['r2']);
    expect(n.list({ status: 200 }).map(e => e.id)).toEqual(['r1']);
    expect(n.list({ status: 'failed' }).map(e => e.id)).toEqual(['r3', 'r4']);
    expect(n.list({ type: 'fetch' })).toHaveLength(2);
    expect(n.list({ urlPattern: '/api/*' })).toHaveLength(2);
    expect(n.list({ urlPattern: 'x.js' })).toHaveLength(1);
    expect(n.list({ limit: 1 }).map(e => e.id)).toEqual(['r4']);
    expect(formatEntry(n.get('r3')!)).toContain('FAILED(net::ERR_CONNECTION_REFUSED)');
    expect(() => n.list({ status: 'weird' })).toThrow(/Invalid status filter/);
  });

  it('splits redirects into hops and finishes iframe documents on the iframe session', () => {
    const n = new NetLog();
    n.onEvent('Network.requestWillBeSent', { requestId: 'L1', type: 'Document', request: { url: 'http://a/start', method: 'GET' } });
    n.onEvent('Network.requestWillBeSent', { requestId: 'L1', type: 'Document', request: { url: 'http://a/final', method: 'GET' }, redirectResponse: { status: 302 } });
    expect(n.list().map(e => `${e.url} ${e.status ?? '-'}`)).toEqual(['http://a/start 302', 'http://a/final -']);
    // an out-of-process iframe: the request starts on the page's session, the response arrives on the iframe's own one
    n.onEvent('Network.requestWillBeSent', { requestId: 'F9', type: 'Document', request: { url: 'http://b/frame', method: 'GET' } });
    n.onEvent('Network.responseReceived', { requestId: 'F9', response: { status: 200 } }, 'child-1');
    n.onEvent('Network.loadingFinished', { requestId: 'F9' }, 'child-1');
    expect(n.get('r3')).toMatchObject({ status: 200 });
    n.onEvent('Network.loadingFinished', { requestId: 'L1' });
    expect(n.inflight()).toBe(0);
  });

  it('ignores long-lived channels and stale requests for idle detection, and caps its size', () => {
    const c = clock();
    const n = new NetLog(3, c.now);
    n.onEvent('Network.requestWillBeSent', { requestId: 'ws', type: 'WebSocket', request: { url: 'ws://h', method: 'GET' } });
    n.onEvent('Network.requestWillBeSent', { requestId: 'poll', type: 'XHR', request: { url: 'http://h/poll', method: 'GET' } });
    expect(n.inflight()).toBe(1);
    c.at(1000 + 11_000);
    expect(n.inflight()).toBe(0);
    for (let i = 0; i < 5; i++) n.onEvent('Network.requestWillBeSent', { requestId: `x${i}`, request: { url: `http://h/${i}` } });
    expect(n.list({ limit: 500 })).toHaveLength(3);
    n.clear();
    expect(n.list()).toHaveLength(0);
  });

  it('redactHeaders hides auth, cookies and token-like headers', () => {
    expect(redactHeaders({ Cookie: 'a=b', 'X-Api-Key': 'k', 'x-session-id': 's', 'Content-Type': 'json' })).toEqual({ Cookie: '[redacted]', 'X-Api-Key': '[redacted]', 'x-session-id': '[redacted]', 'Content-Type': 'json' });
    expect(redactHeaders(null)).toEqual({});
  });
});

describe('evidence', () => {
  const dir = path.resolve('/tmp/ev/chat-c1');

  it('names group folders', () => {
    expect(groupFolder('chat:c_12')).toBe('chat-c_12');
    expect(groupFolder('mcp:0123abcd-ffff')).toBe('external-0123abcd');
    expect(groupFolder('user')).toBe('user');
  });

  it('keeps agent file names inside the evidence folder', () => {
    expect(evidencePath(dir, 'step-1', '.png')).toBe(path.join(dir, 'step-1.png'));
    expect(evidencePath(dir, 'TC-12/step 3.PNG', '.png')).toBe(path.join(dir, 'TC-12', 'step_3.PNG'));
    expect(() => evidencePath(dir, '../x.png', '.png')).toThrow(/"\." or "\.\."/);
    expect(() => evidencePath(dir, 'C:\\Windows\\x.png', '.png')).toThrow(/absolute/);
    expect(() => evidencePath(dir, '/etc/x.png', '.png')).toThrow(/absolute/);
    expect(() => evidencePath(dir, '', '.png')).toThrow(/empty/);
    expect(stampName('shot', '.png', new Date('2026-10-11T10:02:03.123Z'))).toBe('shot-2026-10-11T10-02-03-123Z.png');
  });
});

describe('Handoffs', () => {
  const make = () => { const events: BrowserHandoff[] = []; return { events, h: new Handoffs(e => events.push(e), () => 5) }; };
  const req = { tabId: 't1', chatId: 'c1', reason: 'Login', instructions: 'accedi', url: 'https://x' };

  it('opens one hand-off per tab and resolves waiters when the user answers', async () => {
    const { h, events } = make();
    const a = h.open(req);
    expect(h.open(req).id).toBe(a.id);
    expect(h.list()).toHaveLength(1);
    const waiting = h.wait(a.id, 10_000);
    h.resolve(a.id, 'done', 'fatto');
    expect(await waiting).toMatchObject({ state: 'done', note: 'fatto', resolvedAt: 5 });
    expect(events.map(e => e.state)).toEqual(['open', 'done']);
    expect(h.list()).toHaveLength(0);
    expect(h.resolve(a.id, 'failed').state).toBe('done');      // already answered: unchanged
  });

  it('wait returns the still-open hand-off after the timeout or on abort', async () => {
    vi.useFakeTimers();
    try {
      const { h } = make();
      const a = h.open(req);
      const p = h.wait(a.id, 1000);
      vi.advanceTimersByTime(1000);
      expect((await p).state).toBe('open');
      const ac = new AbortController();
      const q = h.wait(a.id, 60_000, ac.signal);
      ac.abort();
      expect((await q).state).toBe('open');
    } finally { vi.useRealTimers(); }
  });

  it('cancels the hand-offs of a closed tab', async () => {
    const { h } = make();
    const a = h.open(req);
    const w = h.wait(a.id, 10_000);
    h.cancelTab('t1');
    expect((await w).state).toBe('cancelled');
    await expect(h.wait('nope', 10)).rejects.toThrow(/No hand-off/);
  });
});

describe('normalizeUrl and pageCall', () => {
  it('adds schemes and refuses non-http schemes', () => {
    expect(normalizeUrl('example.com/x')).toBe('https://example.com/x');
    expect(normalizeUrl('localhost:4200/app')).toBe('http://localhost:4200/app');
    expect(normalizeUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizeUrl('http://a.b')).toBe('http://a.b');
    expect(normalizeUrl('about:blank')).toBe('about:blank');
    expect(() => normalizeUrl('file:///C:/x')).toThrow(/Only http/);
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow(/Only http/);
    expect(() => normalizeUrl('')).toThrow(/empty/);
  });

  it('serializes a page function with JSON arguments, after the password kit', () => {
    const fn = (a: number, b: string) => `${a}${b}`;
    const code = pageCall(fn as never, 1, 'x"y', undefined);
    expect(code).toMatch(/\(1, "x\\"y", undefined\)$/);
    const win: Record<string, unknown> = {};
    expect(vm.runInNewContext(code, { window: win, WeakSet, Object, Array })).toBe('1x"y');
    expect(Object.keys(win)).toEqual([]);                      // __sbPw is non-enumerable...
    expect(typeof (win.__sbPw as { is?: unknown } | undefined)?.is).toBe('function');   // ...and installed once
    vm.runInNewContext(code, { window: win, WeakSet, Object, Array });
  });
});
