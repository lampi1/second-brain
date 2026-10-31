// Saved passwords (browser/login-vault.ts, ADR 0133, 0212): encrypted at rest, given back only for a page of their
// own site, refused without OS encryption, and imported from the CSV that Google Password Manager, Chrome, Edge and
// Firefox export.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SecretCipher } from '../../src/main/engines/secrets';
import { LoginVault, loginsFromCsv, parseCsv, siteOf } from '../../src/main/browser/login-vault';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-vault-')), 'personal-passwords.json');
/** a reversible fake: what is on disk is never the password itself */
const cipher = (off: string | null = null): SecretCipher => ({
  unavailable: () => off,
  encrypt: s => Buffer.from(`enc:${Buffer.from(s).reverse().toString('hex')}`),
  decrypt: b => Buffer.from(b.toString().slice(4), 'hex').reverse().toString(),
});

describe('siteOf', () => {
  it('is the scheme and host, www. ignored; https only, http only for local hosts', () => {
    expect(siteOf('https://www.Example.com/login?x=1')).toBe('https://example.com');
    expect(siteOf('https://accounts.google.com/signin')).toBe('https://accounts.google.com');
    expect(siteOf('http://localhost:3000/a')).toBe('http://localhost:3000');
    expect(siteOf('http://example.com')).toBeNull();
    expect(siteOf('android://com.example.app')).toBeNull();
    expect(siteOf('nonsense')).toBeNull();
  });
});

describe('CSV import', () => {
  it('parses quotes, doubled quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  });

  it('reads Google Password Manager and Firefox exports by their headers', () => {
    const google = 'name,url,username,password,note\nEsempio,https://www.example.com/login,user-at-example,s3cr3t,\nApp,android://com.example.app,me,p,\nVuota,https://b.com,me,,\n';
    expect(loginsFromCsv(google)).toEqual({ logins: [{ site: 'https://example.com', user: 'user-at-example', password: 's3cr3t' }], skipped: 2 });
    const firefox = '"url","username","password","httpRealm"\n"https://c.com","u","p,1",""\n';
    expect(loginsFromCsv(firefox).logins).toEqual([{ site: 'https://c.com', user: 'u', password: 'p,1' }]);
    expect(() => loginsFromCsv('a,b\n1,2\n')).toThrow(/url e password/);
  });
});

describe('LoginVault', () => {
  it('stores only ciphertext and lists site and user name only', () => {
    const f = tmp();
    const v = new LoginVault(f, cipher());
    v.save('https://www.example.com/login', 'user-at-example', 'hunter2');
    expect(fs.readFileSync(f, 'utf8')).not.toContain('hunter2');
    expect(v.list()).toEqual([expect.objectContaining({ site: 'https://example.com', user: 'user-at-example' })]);
    expect(JSON.stringify(v.list())).not.toContain('hunter2');
  });

  it('gives a password back only for a page of its own site', () => {
    const v = new LoginVault(tmp(), cipher());
    const { login } = v.save('https://example.com', 'me', 'pw');
    expect(v.passwordFor(login.id, 'https://www.example.com/x')).toEqual({ user: 'me', password: 'pw' });
    expect(v.passwordFor(login.id, 'https://evil.com/example.com')).toBeNull();
    expect(v.passwordFor(login.id, 'https://example.com.evil.com/')).toBeNull();
    expect(v.passwordFor(login.id, 'http://example.com/')).toBeNull();
    expect(v.forUrl('https://example.com/a').map(l => l.id)).toEqual([login.id]);
  });

  it('updates the same site and user, survives a restart, removes', () => {
    const f = tmp();
    const v = new LoginVault(f, cipher());
    const a = v.save('https://a.com', 'me', 'one');
    const b = v.save('https://a.com/x', 'me', 'two');
    expect(b.updated).toBe(true);
    expect(b.login.id).toBe(a.login.id);
    const r = v.saveMany([{ site: 'https://a.com', user: 'me', password: 'three' }, { site: 'https://b.com', user: 'you', password: 'x' }]);
    expect(r).toEqual({ added: 1, updated: 1 });
    const back = new LoginVault(f, cipher());
    expect(back.passwordFor(a.login.id, 'https://a.com')?.password).toBe('three');
    back.remove(a.login.id);
    expect(back.list().map(l => l.site)).toEqual(['https://b.com']);
  });

  it('refuses to save without OS encryption, and plain http sites', () => {
    const off = new LoginVault(tmp(), cipher('manca un portachiavi di sistema'));
    expect(off.unavailable()).toMatch(/portachiavi/);
    expect(() => off.save('https://a.com', 'me', 'pw')).toThrow(/portachiavi/);
    const v = new LoginVault(tmp(), cipher());
    expect(() => v.save('http://a.com', 'me', 'pw')).toThrow(/https/);
  });
});
