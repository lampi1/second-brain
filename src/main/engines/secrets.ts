// The API keys the user types in Settings → Motori (ADR 0046, AGENTS.md rule 2). Why: the owner, 14/10, "un punto chiaro
// nelle configurazioni per impostare api key normali", cross-OS ("in futuro quest app voglio farla cross OS"). Each key
// is encrypted with Electron's safeStorage (DPAPI on Windows, Keychain on macOS, the system keyring on Linux) into
// <userData>/secrets.json; never in clear on disk, never in the brain or the settings. Write-only from the UI: the
// renderer sends a key once and from then on sees only its mask; no IPC and no MCP tool ever returns it. A key is bound
// to the fingerprint of its engine's start definition (registry.ts): a changed command, URL or variable stops its use.
// Every key read is added to the logs' redaction. Used by wiring.ts (the engines' start) and index.ts (secrets:*).
import fs from 'node:fs';
import path from 'node:path';
import type { Harness, SecretsStatus } from '../../shared/contract';
import { addRedaction, log } from '../log';
import { ENGINE_ID } from './registry';

/** The OS encryption the store uses: Electron's safeStorage in the app, a fake in the tests. */
export interface SecretCipher {
  /** null = usable; else why not, in Italian, for the Settings page */
  unavailable(): string | null;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

/** Electron's safeStorage. On Linux without a keyring its backend is `basic_text` (a fixed password): refused. */
export function safeStorageCipher(ss: {
  isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string; getSelectedStorageBackend?(): string;
}, platform: NodeJS.Platform = process.platform): SecretCipher {
  return {
    unavailable: () => {
      if (!ss.isEncryptionAvailable()) return 'il sistema non offre una cifratura per le chiavi su questo PC';
      if (platform === 'linux' && ss.getSelectedStorageBackend?.() === 'basic_text') return 'manca un portachiavi di sistema (gnome-keyring o kwallet): senza, le chiavi non sarebbero protette';
      return null;
    },
    encrypt: s => ss.encryptString(s),
    decrypt: b => ss.decryptString(b),
  };
}

interface Saved { cipher: string; mask: string; bound: string }

const MAX_KEY = 4096;

/** "sk-…a1b2": its vendor prefix and last 4, enough to recognise a key, too little to use it. */
export function maskOf(key: string): string {
  if (key.length < 16) return '…';
  return `${/^[A-Za-z]{2,4}-/.exec(key)?.[0] ?? ''}…${key.slice(-4)}`;
}

export class SecretStore {
  private readonly file: string;
  private saved: Record<string, Saved> = {};

  constructor(userData: string, private readonly cipher: SecretCipher) {
    this.file = path.join(userData, 'secrets.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { keys?: Record<string, Saved> };
      for (const [id, s] of Object.entries(raw.keys ?? {})) {
        if (ENGINE_ID.test(id) && s && typeof s.cipher === 'string' && typeof s.mask === 'string' && typeof s.bound === 'string') this.saved[id] = s;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('secrets', 'secrets.json unreadable: no API key loaded', { cause: (e as Error).message, hint: 'type the keys again in Impostazioni → Motori' });
    }
  }

  /** What the Settings page shows: whether keys can be stored, and each stored key's mask (never the key). */
  status(boundOf: (id: Harness) => string | null): SecretsStatus {
    const why = this.cipher.unavailable();
    return {
      available: why === null, ...(why ? { why } : {}),
      keys: Object.fromEntries(Object.entries(this.saved).map(([id, s]) => [id, { mask: s.mask, stale: boundOf(id) !== s.bound }])),
    };
  }

  /** Stores the user's key for an engine, bound to its start definition's fingerprint. */
  set(id: Harness, key: unknown, bound: string): void {
    if (!ENGINE_ID.test(id)) throw new Error('motore non valido');
    const why = this.cipher.unavailable();
    if (why) throw new Error(`Chiave non salvata: ${why}.`);
    const k = typeof key === 'string' ? key.trim() : '';
    if (!k) throw new Error('chiave vuota');
    if (k.length > MAX_KEY || /\s/.test(k)) throw new Error('la chiave non sembra valida (spazi o troppo lunga)');
    addRedaction(k);
    const next = { ...this.saved, [id]: { cipher: this.cipher.encrypt(k).toString('base64'), mask: maskOf(k), bound } };
    this.write(next);
    this.saved = next;
    log.info('secrets', 'API key saved', { data: { engine: id } });
  }

  delete(id: Harness): void {
    if (!(id in this.saved)) return;
    const next = { ...this.saved };
    delete next[id];
    this.write(next);
    this.saved = next;
    log.info('secrets', 'API key deleted', { data: { engine: id } });
  }

  /** Main only, right before an engine starts or calls: the key, or null (none, or its engine's definition changed). */
  get(id: Harness, bound: string): string | null {
    const s = this.saved[id];
    if (!s) return null;
    if (s.bound !== bound) { log.warn('secrets', 'API key not used: its engine changed since it was saved', { data: { engine: id }, hint: 'type the key again in Impostazioni → Motori' }); return null; }
    if (this.cipher.unavailable()) return null;
    try {
      const k = this.cipher.decrypt(Buffer.from(s.cipher, 'base64'));
      addRedaction(k);
      return k;
    } catch (e) {
      log.warn('secrets', 'API key could not be decrypted', { data: { engine: id }, cause: (e as Error).message, hint: 'type the key again in Impostazioni → Motori (another user or PC?)' });
      return null;
    }
  }

  private write(keys: Record<string, Saved>): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, keys }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
