// The API key store (src/main/engines/secrets.ts, ADR 0046): encrypted at rest, only masks out, bound to its engine's
// definition, every key read added to the logs' redaction; safeStorage refused where it would not protect anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskOf, safeStorageCipher, SecretStore, type SecretCipher } from '../../../src/main/engines/secrets';
import { redact } from '../../../src/main/log';

/** A reversible fake: the stored bytes never contain the key in clear. */
const fake = (why: string | null = null): SecretCipher => ({
  unavailable: () => why,
  encrypt: s => Buffer.from(s.split('').reverse().join(''), 'utf8').map(b => b ^ 0x5a) as Buffer,
  decrypt: b => Buffer.from(b.map(x => x ^ 0x5a)).toString('utf8').split('').reverse().join(''),
});
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-secrets-'));
const KEY = 'sk-test-0123456789abcdefWXYZ';

describe('SecretStore', () => {
  it('stores a key encrypted, shows only its mask, gives it back to main for the same definition', () => {
    const d = dir();
    const s = new SecretStore(d, fake());
    s.set('gemini', `  ${KEY}\n`, 'fp1');
    const disk = fs.readFileSync(path.join(d, 'secrets.json'), 'utf8');
    expect(disk).not.toContain(KEY);
    expect(disk).not.toContain('0123456789');
    expect(s.status(() => 'fp1')).toEqual({ available: true, keys: { gemini: { mask: 'sk-…WXYZ', stale: false } } });
    expect(new SecretStore(d, fake()).get('gemini', 'fp1')).toBe(KEY);
  });

  it('does not use a key whose engine changed since it was saved, and says so', () => {
    const s = new SecretStore(dir(), fake());
    s.set('gemini', KEY, 'fp1');
    expect(s.get('gemini', 'fp2')).toBeNull();
    expect(s.status(() => 'fp2').keys.gemini?.stale).toBe(true);
    expect(s.status(() => null).keys.gemini?.stale).toBe(true);
  });

  it('redacts a key in the logs once saved or read', () => {
    new SecretStore(dir(), fake()).set('kimi', 'opaque-token-for-redaction-1', 'fp');
    expect(redact('sent opaque-token-for-redaction-1')).toBe('sent [redacted]');
  });

  it('refuses empty, spaced, too long keys and bad ids; deletes', () => {
    const s = new SecretStore(dir(), fake());
    expect(() => s.set('gemini', '', 'fp')).toThrow(/vuota/);
    expect(() => s.set('gemini', 42, 'fp')).toThrow(/vuota/);
    expect(() => s.set('gemini', 'sk-a b-cdefghijklmnop', 'fp')).toThrow(/valida/);
    expect(() => s.set('gemini', 'x'.repeat(5000), 'fp')).toThrow(/valida/);
    expect(() => s.set('../x', KEY, 'fp')).toThrow(/motore/);
    s.set('gemini', KEY, 'fp');
    s.delete('gemini');
    expect(s.get('gemini', 'fp')).toBeNull();
    expect(s.status(() => 'fp').keys).toEqual({});
  });

  it('without OS encryption saves nothing and says why', () => {
    const s = new SecretStore(dir(), fake('niente cifratura'));
    expect(() => s.set('gemini', KEY, 'fp')).toThrow(/niente cifratura/);
    expect(s.status(() => 'fp')).toMatchObject({ available: false, why: 'niente cifratura' });
  });

  it('a key it cannot decrypt (another user or PC) is null, not an error', () => {
    const d = dir();
    new SecretStore(d, fake()).set('gemini', KEY, 'fp');
    expect(new SecretStore(d, { ...fake(), decrypt: () => { throw new Error('bad'); } }).get('gemini', 'fp')).toBeNull();
  });
});

describe('maskOf', () => {
  it('keeps a vendor prefix and the last 4, nothing of a short key', () => {
    expect(maskOf('sk-test-abcdefghijklmnop1234')).toBe('sk-…1234');
    expect(maskOf('AIzaSyAbcdefghijklmnopqr9876')).toBe('…9876');
    expect(maskOf('short-key')).toBe('…');
  });
});

describe('safeStorageCipher', () => {
  const ss = (available: boolean, backend?: string) => ({
    isEncryptionAvailable: () => available, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString(),
    ...(backend ? { getSelectedStorageBackend: () => backend } : {}),
  });
  it('refuses no encryption, and Linux basic_text; accepts a real backend', () => {
    expect(safeStorageCipher(ss(false), 'win32').unavailable()).toMatch(/cifratura/);
    expect(safeStorageCipher(ss(true, 'basic_text'), 'linux').unavailable()).toMatch(/portachiavi/);
    expect(safeStorageCipher(ss(true, 'gnome_libsecret'), 'linux').unavailable()).toBeNull();
    expect(safeStorageCipher(ss(true), 'win32').unavailable()).toBeNull();
  });
});
