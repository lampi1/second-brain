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
    s.set('anthropic', `  ${KEY}\n`, 'fp1');
    const disk = fs.readFileSync(path.join(d, 'secrets.json'), 'utf8');
    expect(disk).not.toContain(KEY);
    expect(disk).not.toContain('0123456789');
    expect(s.status(() => 'fp1')).toEqual({ available: true, keys: { anthropic: { mask: 'sk-…WXYZ', stale: false } } });
    expect(new SecretStore(d, fake()).get('anthropic', 'fp1')).toBe(KEY);
  });

  it('does not use a key whose engine changed since it was saved, and says so', () => {
    const s = new SecretStore(dir(), fake());
    s.set('anthropic', KEY, 'fp1');
    expect(s.get('anthropic', 'fp2')).toBeNull();
    expect(s.status(() => 'fp2').keys.anthropic?.stale).toBe(true);
    expect(s.status(() => null).keys.anthropic?.stale).toBe(true);
  });

  it('redacts a key in the logs once saved or read', () => {
    new SecretStore(dir(), fake()).set('kimi', 'opaque-token-for-redaction-1', 'fp');
    expect(redact('sent opaque-token-for-redaction-1')).toBe('sent [redacted]');
  });

  it('refuses empty, spaced, too long keys and bad ids; deletes', () => {
    const s = new SecretStore(dir(), fake());
    expect(() => s.set('anthropic', '', 'fp')).toThrow(/vuota/);
    expect(() => s.set('anthropic', 42, 'fp')).toThrow(/vuota/);
    expect(() => s.set('anthropic', 'sk-a b-cdefghijklmnop', 'fp')).toThrow(/valida/);
    expect(() => s.set('anthropic', 'x'.repeat(5000), 'fp')).toThrow(/valida/);
    expect(() => s.set('../x', KEY, 'fp')).toThrow(/motore/);
    s.set('anthropic', KEY, 'fp');
    s.delete('anthropic');
    expect(s.get('anthropic', 'fp')).toBeNull();
    expect(s.status(() => 'fp').keys).toEqual({});
  });

  it('without OS encryption saves nothing and says why', () => {
    const s = new SecretStore(dir(), fake('niente cifratura'));
    expect(() => s.set('anthropic', KEY, 'fp')).toThrow(/niente cifratura/);
    expect(s.status(() => 'fp')).toMatchObject({ available: false, why: 'niente cifratura' });
  });

  it('a key it cannot decrypt (another user or PC) is null, not an error', () => {
    const d = dir();
    new SecretStore(d, fake()).set('anthropic', KEY, 'fp');
    expect(new SecretStore(d, { ...fake(), decrypt: () => { throw new Error('bad'); } }).get('anthropic', 'fp')).toBeNull();
  });

  it('erases at load the key of an engine the app removed (Gemini, ADR 0046), keeps the others', () => {
    const d = dir();
    new SecretStore(d, fake()).set('anthropic', KEY, 'fp');
    const f = path.join(d, 'secrets.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(f, JSON.stringify({ ...j, keys: { ...j.keys, gemini: { ...j.keys.anthropic } } }));
    const s = new SecretStore(d, fake());
    expect(Object.keys(s.status(() => 'fp').keys)).toEqual(['anthropic']);
    expect(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).keys)).toEqual(['anthropic']);
    expect(s.get('anthropic', 'fp')).toBe(KEY);
  });

  it('erases at load the Cursor Cloud Agents key of the removed cloud agents (ADR 0201)', () => {
    const d = dir();
    new SecretStore(d, fake()).set('anthropic', KEY, 'fp');
    const f = path.join(d, 'secrets.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(f, JSON.stringify({ ...j, keys: { ...j.keys, 'cursor-cloud': { ...j.keys.anthropic, bound: 'cloud:https://api.cursor.com/v1' } } }));
    const s = new SecretStore(d, fake());
    expect(Object.keys(s.status(() => 'fp').keys)).toEqual(['anthropic']);
    expect(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).keys)).toEqual(['anthropic']);
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
