// Main-only Jira vault, protected by the OS cipher. Only ciphertext is persisted in private app userData.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SecretCipher } from '../../main/engines/secrets';
import type { ConnectorVault, JiraCredential } from './app-service';
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
