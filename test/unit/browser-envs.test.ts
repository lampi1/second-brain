// Pure parts of environments, the password guard, body redaction, glob matching and the Electron fuse reader.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globMatch } from '../../src/main/browser/glob';
import { isLocalHost, hostOf, passwordRefusal, changesInputType, urlCredentials } from '../../src/main/browser/guard';
import { redact } from '../../src/main/log';
import { EnvStore, computeSession, envColor, envForUrl, envSlug, envPartition, isAuthCookie, isLoginUrl } from '../../src/main/browser/envs';
import { redactBody } from '../../src/main/browser/netlog';
import { FUSE_SENTINEL, cookieEncryptionEnabled, readFuseWire } from '../../src/main/browser/fuses';
// @ts-expect-error plain .mjs script without types
import { ensureCookieEncryption, readFuses } from '../../scripts/fuses.mjs';

describe('globMatch (no regex: no ReDoS on page-controlled URLs)', () => {
  it('matches substrings and anchored globs', () => {
    expect(globMatch('https://a/api/x?y=1', '/api/', false)).toBe(true);
    expect(globMatch('https://a/api/x', '*/api/*', false)).toBe(true);
    expect(globMatch('https://a/api/x', 'https://*/x', true)).toBe(true);
    expect(globMatch('https://a/api/x', 'https://*/y', true)).toBe(false);
    expect(globMatch('https://a/api/x', '*/api', true)).toBe(false);
    expect(globMatch('abc', 'a*b*c', true)).toBe(true);
    expect(globMatch('ac', 'a*b*c', true)).toBe(false);
    expect(globMatch('aXbXc', '*b*', false)).toBe(true);
  });

  it('stays fast on a hostile pattern and a long URL', () => {
    const url = `https://h/${'a/'.repeat(4000)}`;
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) globMatch(url, '*/*/*/*/*/*/*/*X', true);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('password guard', () => {
  it('knows the local stacks where agents may type passwords', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', '::1', 'app.localhost', 'app.example.test', 'http://localhost:4200/x', 'LOCALHOST']) expect(isLocalHost(h), h).toBe(true);
    for (const h of ['127.0.0.2', 'test-3.example.com', 'login.microsoftonline.com', 'localhost.evil.com', 'test.com', 'https://app.test.evil.com/', '']) expect(isLocalHost(h), h).toBe(false);
    expect(hostOf('https://Test-3.Example.com:8443/a')).toBe('test-3.example.com');
    expect(hostOf('about:blank')).toBe('');
  });

  it('refuses with an actionable message', () => {
    const e = passwordRefusal('e12 (input "Password")', 'test-3.example.com', 'example-test-3');
    expect(e.message).toMatch(/^Refused: e12 .* password field on test-3\.example\.com/);
    expect(e.message).toContain('handoff_to_user with kind "login"');
    expect(e.message).toContain('"example-test-3"');
  });

  it('spots scripts that change an input type (password → text)', () => {
    for (const c of ['p.type = "text"', 'p["type"]="text"', "el.setAttribute('type', 'text')", 'el.removeAttribute("type")', 'el.toggleAttribute("type")', 'Object.defineProperty(p, "type", {})'])
      expect(changesInputType(c), c).toBe(true);
    for (const c of ['document.title', 'el.type === "password"', 'el.dataset.type', 'x.type == y']) expect(changesInputType(c), c).toBe(false);
  });

  it('finds credentials in URLs and log redaction hides them', () => {
    const cred = ['mario', 'segreto'].join(':');   // user:password, built here so the source holds no credential URL
    expect(urlCredentials(`https://${cred}@example.com/x`)).toBe('mario:•••');
    expect(urlCredentials('https://mario@example.com/')).toBe('mario');
    expect(urlCredentials('https://example.com/a@b')).toBe('');
    expect(redact(`open https://${cred}@example.com/x now`)).toBe('open https://[redacted]@example.com/x now');
    expect(redact('http://example.com:8080/a@b')).toBe('http://example.com:8080/a@b');
  });
});

describe('environments', () => {
  it('derives the default environment generically from the host', () => {
    expect(envForUrl('https://test-3.example.com/app')).toBe('example-test-3');
    expect(envForUrl('https://www.example.com/')).toBe('example');
    expect(envForUrl('https://example.com/')).toBe('example');
    expect(envForUrl('https://a.b.example.co.uk/')).toBe('example-a');
    expect(envForUrl('https://app.example.test/')).toBe('example-app');
    expect(envForUrl('http://localhost:4200/')).toBe('local');
    expect(envForUrl('http://127.0.0.1:5000/')).toBe('local');
    expect(envForUrl('http://app.localhost/')).toBe('local');
    expect(envForUrl('http://192.0.2.3/')).toBe('ip-192-0-2-3');
    expect(envForUrl('about:blank')).toBe('scratch');
    expect(envForUrl(undefined)).toBe('scratch');
    expect(envPartition('example-test-3')).toBe('persist:env-example-test-3');
  });

  it('normalizes names and gives each environment a stable color', () => {
    expect(envSlug('Example Test 3')).toBe('example-test-3');
    expect(envSlug('--A__b--')).toBe('a-b');
    expect(() => envSlug('***')).toThrow(/Invalid environment name/);
    expect(envColor('example-test-3')).toBe(envColor('example-test-3'));
    expect(envColor('example-test-3')).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(['example-test-1', 'example-test-2', 'example-test-3', 'local', 'example-test-4'].map(envColor)).size).toBeGreaterThan(2);
  });

  it('recognizes auth cookies and sign-in pages', () => {
    for (const n of ['sb_auth', '.AspNetCore.Cookies', '.AspNetCore.Identity.Application', 'ESTSAUTHPERSISTENT', 'JSESSIONID', 'session_id', 'access_token', 'connect.sid']) expect(isAuthCookie(n), n).toBe(true);
    for (const n of ['theme', 'lang', 'author', '_ga', 'consent']) expect(isAuthCookie(n), n).toBe(false);
    for (const u of ['https://x/login', 'https://x/account/login?next=/', 'https://x/signin', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'https://id.x/connect/authorize?client_id=1']) expect(isLoginUrl(u), u).toBe(true);
    for (const u of ['https://x/app', 'https://x/blog/login-tips-2026', 'not a url']) expect(isLoginUrl(u), u).toBe(false);
  });

  it('computes the session status', () => {
    const now = Date.parse('2026-10-11T10:00:00Z');
    expect(computeSession({ authCookies: [], seenAuth: false, loginPage: false, now }).status).toBe('unknown');
    expect(computeSession({ authCookies: [], seenAuth: true, loginPage: false, now }).status).toBe('expired');
    expect(computeSession({ authCookies: [{ expires: now + 3 * 86400e3 }], seenAuth: true, loginPage: true, now }).status).toBe('expired');
    const exp = computeSession({ authCookies: [{ expires: now + 3600e3 }, { expires: now + 5 * 86400e3 }], seenAuth: true, loginPage: false, now });
    expect(exp).toMatchObject({ status: 'expiring', authExpiresAt: now + 3600e3 });
    expect(exp.detail).toMatch(/^l'accesso scade il /);
    expect(computeSession({ authCookies: [{ expires: now + 2 * 86400e3 }], seenAuth: true, loginPage: false, now }).status).toBe('valid');
    expect(computeSession({ authCookies: [{ expires: null }], seenAuth: true, loginPage: false, now })).toMatchObject({ status: 'valid', authExpiresAt: null });
  });

  it('persists the known environments without query strings (no tokens on disk)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-envs-'));
    const file = path.join(dir, 'browser-envs.json');
    let t = 1000;
    const a = new EnvStore(file, () => t);
    a.touch('example-test-3', 'https://test-3.example.com/app/home?token=SECRET#x');
    t = 2000;
    a.markLogin('example-test-3');
    a.markAgent('example-test-3');
    a.touch('local', 'http://localhost:4200/');
    a.flush();
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('SECRET');
    const b = new EnvStore(file);
    expect(b.get('example-test-3')).toMatchObject({ hosts: ['test-3.example.com'], lastUrl: 'https://test-3.example.com/app/home', lastLoginAt: 2000, agents: true });
    expect(b.get('local')?.agents).toBeUndefined();
    expect(b.list().map(e => e.id)).toEqual(['local', 'example-test-3']);
    fs.writeFileSync(file, '{ broken');
    expect(new EnvStore(file).list()).toEqual([]);
  });
});

describe('redactBody', () => {
  it('masks password and token fields of form bodies in any position', () => {
    const pw = 'password';   // key=value built at runtime: the source holds no literal password assignment
    expect(redactBody(`${pw}=x&username=d`)).toBe(`${pw}=[redacted]&username=d`);
    expect(redactBody('loginfmt=d%40example.com&passwd=Secr3t!&flowToken=abc', 'application/x-www-form-urlencoded')).toBe('loginfmt=d%40example.com&passwd=[redacted]&flowToken=[redacted]');
    expect(redactBody('SAMLResponse=PHNhbWw%2B&RelayState=x')).toBe('SAMLResponse=[redacted]&RelayState=x');
    expect(redactBody('grant_type=refresh_token&client_secret=s3&code=xyz')).toBe('grant_type=refresh_token&client_secret=[redacted]&code=[redacted]');
  });

  it('masks JSON keys at any depth and leaves clean bodies untouched', () => {
    expect(JSON.parse(redactBody('{"pwd":"x","user":{"name":"d","access_token":"opaque","refresh_token":"r"},"items":[{"apiKey":"k"}]}', 'application/json')))
      .toEqual({ pwd: '[redacted]', user: { name: 'd', access_token: '[redacted]', refresh_token: '[redacted]' }, items: [{ apiKey: '[redacted]' }] });
    const clean = '{ "items": ["uno", "due"], "count": 2 }';
    expect(redactBody(clean, 'application/json')).toBe(clean);
    expect(redactBody('<input name="x" value="1"> "password": "abc"')).toBe('<input name="x" value="1"> "password": "[redacted]"');
  });

  it('masks multipart/form-data parts by name, without regex backtracking', () => {
    const b = '------x1\r\nContent-Disposition: form-data; name="user"\r\n\r\nmario\r\n------x1\r\nContent-Disposition: form-data; name="password"\r\n\r\nSecr3t!\r\n' +
      '------x1\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n------x1--\r\n';
    const out = redactBody(b, 'multipart/form-data; boundary=----x1');
    expect(out).toContain('name="user"\r\n\r\nmario\r\n');
    expect(out).toContain('name="password"\r\n\r\n[redacted]\r\n');
    expect(out).not.toContain('Secr3t!');
    expect(out).toContain('hello');
    expect(redactBody(b)).not.toContain('Secr3t!');                // detected without the content type too
    const big = `------x1\r\nContent-Disposition: form-data; name="a"\r\n\r\n${'x'.repeat(60000)}`;
    const t0 = Date.now();
    redactBody(big, 'multipart/form-data');
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('Electron fuses', () => {
  const fake = (wire: string) => Buffer.concat([Buffer.alloc(3000, 7), Buffer.from(FUSE_SENTINEL), Buffer.from([1, wire.length]), Buffer.from(wire, 'latin1'), Buffer.alloc(100, 0)]);

  it('reads the fuse wire and the cookie-encryption fuse from a binary', async () => {
    expect(readFuseWire(fake('101100011'))).toBe('101100011');
    expect(readFuseWire(Buffer.from('nothing here'))).toBeNull();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fuse-'));
    const off = path.join(dir, 'off.exe'), on = path.join(dir, 'on.exe'), none = path.join(dir, 'none.exe');
    fs.writeFileSync(off, fake('101100011'));
    fs.writeFileSync(on, fake('111100011'));
    fs.writeFileSync(none, Buffer.alloc(5000, 1));
    expect(await cookieEncryptionEnabled(off)).toBe(false);
    expect(await cookieEncryptionEnabled(on)).toBe(true);
    expect(await cookieEncryptionEnabled(none)).toBeNull();
    expect(await cookieEncryptionEnabled(path.join(dir, 'missing.exe'))).toBeNull();
  });

  it('scripts/fuses.mjs turns cookie encryption on, idempotently, without touching RunAsNode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fuse-'));
    const exe = path.join(dir, 'electron.exe');
    fs.writeFileSync(exe, fake('101100011'));
    expect(readFuses(exe)).toMatchObject({ RunAsNode: '1', EnableCookieEncryption: '0' });
    expect(ensureCookieEncryption(exe)).toBe('enabled');
    expect(ensureCookieEncryption(exe)).toBe('already');
    expect(readFuses(exe)).toMatchObject({ RunAsNode: '1', EnableCookieEncryption: '1', GrantFileProtocolExtraPrivileges: '1' });
    fs.writeFileSync(exe, Buffer.alloc(100));
    expect(() => ensureCookieEncryption(exe)).toThrow(/sentinel not found/);
  });

  it('finds the sentinel across read chunks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fuse-'));
    const exe = path.join(dir, 'big.exe');
    // the sentinel straddles the 8 MB chunk boundary of the streaming reader
    const pre = Buffer.alloc(8 * 1024 * 1024 - 10, 3);
    fs.writeFileSync(exe, Buffer.concat([pre, Buffer.from(FUSE_SENTINEL), Buffer.from([1, 9]), Buffer.from('111100011', 'latin1'), Buffer.alloc(64)]));
    expect(await cookieEncryptionEnabled(exe)).toBe(true);
  });
});
