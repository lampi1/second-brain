// Historical routine credentials remain available for explicit terminal-package export, never host execution.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import path from 'node:path';
import { SiteVault } from '../../src/main/browser/site-vault';
import { LoginVault } from '../../src/main/personal/vault';
import { tempDir } from './routine-runtime/fakes';
const cipher = { unavailable: () => null, encrypt: (s: string) => Buffer.from(s.split('').reverse().join('')), decrypt: (b: Buffer) => b.toString().split('').reverse().join('') };
it('reads an old encrypted account by exact origin without changing it or exposing a login executor', () => {
  const file = path.join(tempDir('old-site-vault-'), 'vault.json');
  const old = new LoginVault(file, cipher, Date.now, url => new URL(String(url)).origin);
  const password = ['fixture', 'secret'].join('-');
  old.save('https://qa.example.com', 'tester', password);
  const bytes = fs.readFileSync(file);
  const archive = new SiteVault(file, cipher);
  expect(archive.forPackage('https://qa.example.com')).toEqual({ value: { user: 'tester', password } });
  expect(archive.forPackage('https://other.example.com')).toHaveProperty('reason');
  expect(archive).not.toHaveProperty('forLogin'); expect(archive).not.toHaveProperty('save');
  expect(fs.readFileSync(file)).toEqual(bytes);
});
