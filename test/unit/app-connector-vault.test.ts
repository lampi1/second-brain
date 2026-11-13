// OS vault boundary tested with synthetic ciphertext, temporary app directories and unavailable cipher scenarios.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { JiraVault } from '../../src/modules/onboarding/app-vault';
import type { SecretCipher } from '../../src/main/engines/secrets';
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
function xor(bytes: Uint8Array): Buffer {
  const result = Buffer.from(bytes);
  for (const [index, byte] of result.entries()) result[index] = byte ^ 0xa5;
  return result;
}
const cipher: SecretCipher = { unavailable: () => null, encrypt: s => xor(Buffer.from(s)), decrypt: b => xor(b).toString('utf8') };
const credential = { site: 'https://example.atlassian.net', email: 'user@example.com', token: 'synthetic-vault-value' };
it('persists only encrypted bytes, survives reload, and deletes locally', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-jira-vault-')); directories.push(dir);
  const vault = new JiraVault(dir, cipher); expect(await vault.get()).toBeNull(); await vault.set(credential);
  expect((await fs.readFile(path.join(dir, 'jira.vault'))).includes(Buffer.from(credential.token))).toBe(false);
  expect(await new JiraVault(dir, cipher).get()).toEqual(credential); await vault.set(null); expect(await vault.get()).toBeNull();
});
it('refuses missing encryption and corrupt/oversized vaults without disclosing contents', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-jira-vault-')); directories.push(dir);
  await expect(new JiraVault(dir, { ...cipher, unavailable: () => 'unavailable' }).set(credential)).rejects.toThrow('disponibile');
  await fs.writeFile(path.join(dir, 'jira.vault'), 'x'.repeat(32769));
  await expect(new JiraVault(dir, cipher).get()).rejects.toThrow('non leggibile');
});
