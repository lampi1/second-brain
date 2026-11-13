// Main-only connector vaults (Jira's credential; GitHub's token from a tool tile, ADR 0119), protected by the OS
// cipher. Only ciphertext is persisted in private app userData. Used by app-host.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SecretCipher } from '../../main/engines/secrets';
import type { ConnectorVault, JiraCredential, TokenVault } from './app-service';
import { jiraCredential } from './app-service';
import { addRedaction } from '../../main/log';
export class JiraVault implements ConnectorVault {
  private readonly file: string;
  constructor(userData: string, private readonly cipher: SecretCipher) { this.file = path.join(userData, 'jira.vault'); }
  available() { return this.cipher.unavailable() === null; }
  async get(): Promise<JiraCredential | null> {
    if (!this.available()) throw new Error('Portachiavi cifrato non disponibile');
    try {
      if ((await fs.stat(this.file)).size > 32768) throw new Error('Vault too large');
      const value = jiraCredential(JSON.parse(this.cipher.decrypt(await fs.readFile(this.file))) as JiraCredential); addRedaction(value.token); return value;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Portachiavi Jira non leggibile; ricollega l’account'); }
  }
  async set(value: JiraCredential | null) {
    if (value === null) { await fs.rm(this.file, { force: true }); return; }
    if (!this.available()) throw new Error('Portachiavi cifrato non disponibile');
    addRedaction(value.token);
    const encrypted = this.cipher.encrypt(JSON.stringify(jiraCredential(value)));
    if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > 32768) throw new Error('Cifratura non disponibile');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, this.file); }
    finally { await fs.rm(temporary, { force: true }); }
  }
}
/** GitHub's token typed in a tool tile (ADR 0119): ciphertext only, private app userData. */
export class GithubVault implements TokenVault {
  private readonly file: string;
  constructor(userData: string, private readonly cipher: SecretCipher) { this.file = path.join(userData, 'github.vault'); }
  available() { return this.cipher.unavailable() === null; }
  async get(): Promise<string | null> {
    if (!this.available()) return null;
    try {
      if ((await fs.stat(this.file)).size > 8192) throw new Error('Vault too large');
      const value = this.cipher.decrypt(await fs.readFile(this.file)).trim(); addRedaction(value); return value || null;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Token GitHub non leggibile; ricollega l’account'); }
  }
  async set(value: string | null) {
    if (value === null) { await fs.rm(this.file, { force: true }); return; }
    if (!this.available()) throw new Error('Portachiavi cifrato non disponibile');
    addRedaction(value);
    const encrypted = this.cipher.encrypt(value);
    if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > 8192) throw new Error('Cifratura non disponibile');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, this.file); }
    finally { await fs.rm(temporary, { force: true }); }
  }
}
