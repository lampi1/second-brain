// The phone bridge's bot token slot (ADR 0219, src/main/phone/token-store.ts) with a fake safeStorage: only cipher
// bytes on disk, the BotFather shape checked, the token redacted from logs once set or loaded, refused without an OS
// cipher, cleared for good.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PHONE_TOKEN_SHAPE, PhoneTokenStore } from '../../src/main/phone/token-store';
import { redact } from '../../src/main/log';
import type { SecretCipher } from '../../src/main/engines/secrets';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-phone-token-')); dirs.push(d); return d; };
const xor = (b: Uint8Array) => { const r = Buffer.from(b); for (const [i, x] of r.entries()) r[i] = x ^ 0x5a; return r; };
const cipher: SecretCipher = { unavailable: () => null, encrypt: s => xor(Buffer.from(s)), decrypt: b => xor(b).toString('utf8') };
// synthetic, the right shape only
const fake = (tail: string) => `1234567:${tail.padEnd(35, 'x')}`;

it('stores only cipher bytes and reads the token back after a restart', () => {
  const dir = tmp(), token = fake('AAsynthetic_first-value');
  const store = new PhoneTokenStore(dir, cipher);
  expect(store.has()).toBe(false);
  expect(store.get()).toBeNull();
  store.set(`  ${token}  `);
  expect(store.has()).toBe(true);
  const onDisk = fs.readFileSync(path.join(dir, 'phone-token.json'), 'utf8');
  expect(onDisk).not.toContain(token);
  expect(JSON.parse(onDisk)).toMatchObject({ version: 1 });
  expect(new PhoneTokenStore(dir, cipher).get()).toBe(token);
});

it('redacts the token from logs once it is set', () => {
  const store = new PhoneTokenStore(tmp(), cipher), token = fake('AAsynthetic_redacted-value');
  store.set(token);
  expect(redact(`GET https://api.telegram.org/bot${token}/getUpdates`)).not.toContain(token);
});

it('redacts a token loaded from disk', () => {
  const dir = tmp(), token = fake('AAsynthetic_loaded-later');
  fs.writeFileSync(path.join(dir, 'phone-token.json'), JSON.stringify({ version: 1, cipher: cipher.encrypt(token).toString('base64') }));
  expect(new PhoneTokenStore(dir, cipher).get()).toBe(token);
  expect(redact(`x ${token} y`)).not.toContain(token);
});

it('refuses a value without the BotFather shape, without echoing it', () => {
  const store = new PhoneTokenStore(tmp(), cipher);
  for (const bad of ['', 'hello', '123:short', 'abc:' + 'x'.repeat(35), 42]) {
    let msg = '';
    try { store.set(bad); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/BotFather/);
    if (typeof bad === 'string' && bad) expect(msg).not.toContain(bad);
  }
  expect(store.has()).toBe(false);
});

it('refuses to save without an OS cipher', () => {
  const store = new PhoneTokenStore(tmp(), { ...cipher, unavailable: () => 'cifratura non disponibile' });
  expect(() => store.set(fake('AAsynthetic'))).toThrow(/non salvato/);
  expect(store.has()).toBe(false);
});

it('returns null for an undecryptable or wrong-shaped file', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'phone-token.json'), JSON.stringify({ version: 1, cipher: cipher.encrypt('not a token').toString('base64') }));
  expect(new PhoneTokenStore(dir, cipher).get()).toBeNull();
  fs.writeFileSync(path.join(dir, 'phone-token.json'), '{not json');
  expect(new PhoneTokenStore(dir, cipher).has()).toBe(false);
});

it('clear removes the file and the token in memory', () => {
  const dir = tmp(), store = new PhoneTokenStore(dir, cipher);
  store.set(fake('AAsynthetic_to-clear'));
  store.clear();
  expect(store.has()).toBe(false);
  expect(store.get()).toBeNull();
  expect(fs.existsSync(path.join(dir, 'phone-token.json'))).toBe(false);
});

it('the shape accepts BotFather tokens only', () => {
  expect(PHONE_TOKEN_SHAPE.test(fake('AA_-09'))).toBe(true);
  expect(PHONE_TOKEN_SHAPE.test(`${fake('AA')}\n`)).toBe(false);
  expect(PHONE_TOKEN_SHAPE.test(`1234:${'x'.repeat(35)}`)).toBe(false);
});
