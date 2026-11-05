// The Telegram bot token of the phone bridge (ADR 0219, rules.md rule 2): one encrypted slot of its own, modelled on
// the Connettori tokens (mcp-servers/store.ts, ADR 0086), not the engines' SecretStore (bound to an engine). The user
// types it once in Impostazioni → Telefono; it is encrypted with Electron's safeStorage into <userData>/phone-token.json,
// never in clear on disk, never returned to the renderer, an engine, a chat or an agent. The token is part of every
// Telegram API URL, so it joins the logs' redaction whenever it is loaded or set, and it is never logged. Used by the
// phone bridge (src/main/phone/bridge.ts: getPhoneToken right before a call to api.telegram.org) and its IPC handlers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addRedaction, log } from '../log';
import type { SecretCipher } from '../engines/secrets';

/** A BotFather token: "<bot id>:<secret>". */
export const PHONE_TOKEN_SHAPE = /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/;

interface Saved { version: 1; cipher: string }

export class PhoneTokenStore {
  private readonly file: string;
  private saved: Saved | null = null;
  /** decrypted once, on first use: in memory only */
  private plain: string | null = null;

  constructor(userData: string, private readonly cipher: SecretCipher) {
    this.file = path.join(userData, 'phone-token.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Saved>;
      if (raw && raw.version === 1 && typeof raw.cipher === 'string' && raw.cipher) this.saved = { version: 1, cipher: raw.cipher };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('phone', 'phone-token.json unreadable: no bot token loaded', { cause: (e as Error).message, hint: 'type the token again in Impostazioni → Telefono' });
    }
  }

  has(): boolean { return !!this.saved; }

  /** The token, or null (none saved, or the OS cipher cannot read it). Redacted from the logs from now on. */
  get(): string | null {
    if (this.plain) return this.plain;
    if (!this.saved) return null;
    try {
      const v = this.cipher.decrypt(Buffer.from(this.saved.cipher, 'base64'));
      if (!PHONE_TOKEN_SHAPE.test(v)) throw new Error('decrypted value has not the shape of a bot token');
      addRedaction(v);
      this.plain = v;
      return v;
    } catch (e) {
      log.warn('phone', 'bot token unreadable', { cause: (e as Error).message, hint: 'type the token again in Impostazioni → Telefono' });
      return null;
    }
  }

  /** Saves a new token (replaces the old one). Throws, in Italian, on a wrong shape or no OS cipher; never echoes it. */
  set(token: unknown): void {
    const why = this.cipher.unavailable();
    if (why) throw new Error(`Token non salvato: ${why}.`);
    const v = typeof token === 'string' ? token.trim() : '';
    if (!PHONE_TOKEN_SHAPE.test(v)) throw new Error('Questo non sembra un token di BotFather (numero:codice). Copialo di nuovo da BotFather.');
    addRedaction(v);
    this.saved = { version: 1, cipher: this.cipher.encrypt(v).toString('base64') };
    this.plain = v;
    writeAtomic(this.file, this.saved);
    log.info('phone', 'bot token saved');
  }

  clear(): void {
    this.plain = null;
    if (!this.saved) return;
    this.saved = null;
    fs.rmSync(this.file, { force: true });
    log.info('phone', 'bot token deleted');
  }
}

const writeAtomic = (file: string, data: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, { force: true }); }
};

// The app's one slot, set at start by the integrator (wiring: initPhoneTokenStore(userData, safeStorageCipher(safeStorage))).
let store: PhoneTokenStore | null = null;
export const initPhoneTokenStore = (userData: string, cipher: SecretCipher): PhoneTokenStore => (store = new PhoneTokenStore(userData, cipher));
const need = (): PhoneTokenStore => { if (!store) throw new Error('phone token store not initialised'); return store; };
export const getPhoneToken = (): string | null => store?.get() ?? null;
export const setPhoneToken = (token: string): void => need().set(token);
export const clearPhoneToken = (): void => { store?.clear(); };
export const hasPhoneToken = (): boolean => store?.has() ?? false;
