// The personal browser's saved passwords (Browser page, ADR 0133). Why: the owner, 2026-10-23, wants his passwords in
// the everyday browser («avere le google password manager»); Google Password Manager lives only in Chrome, so the app
// keeps its own: each password encrypted with Electron's safeStorage (DPAPI on Windows, Keychain, the system keyring;
// the same SecretCipher as the engines' API keys, engines/secrets.ts) in <userData>/personal-passwords.json, and an
// import of the CSV that Google Password Manager, Chrome, Edge and Firefox export. The renderer sees only site and user
// name; a password is decrypted only to fill a form of its own site (personal/browser.ts) or for «Copia password»,
// never logged, never given to an agent or the app MCP. Pure apart from the JSON file; unit-tested
// (test/unit/personal-vault.test.ts); used by personal/browser.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { PersonalLogin } from '../../shared/contract';
import type { SecretCipher } from '../engines/secrets';

export const MAX_LOGINS = 5000;
const MAX_FIELD = 1000;

interface Saved { id: string; site: string; user: string; cipher: string; at: number }

/** "https://www.example.com/login?x" → "https://example.com"; null for anything but an http(s) page (android://, about:…).
 *  http only for local hosts: a password is never filled into a plain-text page of a remote site. */
export function siteOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  return `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}`;
}

/** RFC 4180 CSV (quotes, doubled quotes, newlines inside quotes, CRLF), the format every browser exports. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

/** The logins of an exported passwords CSV: columns found by their header (url | origin_url | login_uri, username |
 *  login_username, password | login_password), whatever their order; rows without a web site or a password are skipped. */
export function loginsFromCsv(text: string): { logins: { site: string; user: string; password: string }[]; skipped: number } {
  const rows = parseCsv(text);
  const head = (rows.shift() ?? []).map(h => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex(h => names.includes(h));
  const iu = col('url', 'origin_url', 'login_uri', 'website', 'web site');
  const iname = col('username', 'login_username', 'user', 'login', 'email');
  const ip = col('password', 'login_password');
  if (iu < 0 || ip < 0) throw new Error('Il file non sembra un export di password: servono le colonne url e password (CSV di Google, Chrome, Edge o Firefox).');
  const logins: { site: string; user: string; password: string }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const site = siteOf(r[iu]);
    const secret = r[ip] ?? '';
    const user = iname >= 0 ? (r[iname] ?? '').trim() : '';
    if (!site || !secret || secret.length > MAX_FIELD || user.length > MAX_FIELD) { skipped++; continue; }
    logins.push({ site, user, password: secret });
  }
  return { logins, skipped };
}

export class LoginVault {
  private saved: Saved[] = [];
  private seq = 0;

  constructor(private readonly file: string, private readonly cipher: SecretCipher, private readonly now: () => number = Date.now) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { logins?: unknown };
      for (const x of Array.isArray(raw.logins) ? raw.logins : []) {
        const e = x as Partial<Saved>;
        if (typeof e.id === 'string' && typeof e.site === 'string' && siteOf(e.site) === e.site && typeof e.user === 'string' && typeof e.cipher === 'string') this.saved.push({ id: e.id, site: e.site, user: e.user, cipher: e.cipher, at: typeof e.at === 'number' ? e.at : 0 });
      }
    } catch { /* first run */ }
  }

  /** null = passwords can be saved; else why not (no OS encryption on this PC). */
  unavailable(): string | null { return this.cipher.unavailable(); }

  list(): PersonalLogin[] {
    return this.saved.map(({ id, site, user, at }) => ({ id, site, user, at })).sort((a, b) => a.site.localeCompare(b.site) || a.user.localeCompare(b.user));
  }

  /** The logins of the page's site (its address, www. ignored). */
  forUrl(url: string): PersonalLogin[] {
    const site = siteOf(url);
    return site ? this.list().filter(l => l.site === site) : [];
  }

  /** The password of a login, only for a page of its own site (null otherwise, or when it cannot be decrypted). */
  passwordFor(id: string, pageUrl: string | null): { user: string; password: string } | null {
    const e = this.saved.find(x => x.id === id);
    if (!e || (pageUrl !== null && siteOf(pageUrl) !== e.site)) return null;
    try { return { user: e.user, password: this.cipher.decrypt(Buffer.from(e.cipher, 'base64')) }; } catch { return null; }
  }

  /** Saves (or updates: same site and user) a login. */
  save(url: string, user: string, password: string): { login: PersonalLogin; updated: boolean } {
    const r = this.put(url, user, password);
    this.flush();
    return r;
  }

  /** Many logins at once (the CSV import): one write. */
  saveMany(items: { site: string; user: string; password: string }[]): { added: number; updated: number } {
    let added = 0, updated = 0;
    for (const it of items) { if (this.put(it.site, it.user, it.password).updated) updated++; else added++; }
    this.flush();
    return { added, updated };
  }

  private put(url: string, user: string, password: string): { login: PersonalLogin; updated: boolean } {
    const why = this.cipher.unavailable();
    if (why) throw new Error(`Password non salvata: ${why}.`);
    const site = siteOf(url);
    if (!site) throw new Error('Le password si salvano solo per siti https.');
    if (!password || password.length > MAX_FIELD || user.length > MAX_FIELD) throw new Error('Password non valida.');
    const cipher = this.cipher.encrypt(password).toString('base64');
    const name = user.trim();
    const same = this.saved.find(x => x.site === site && x.user === name);
    if (same) { same.cipher = cipher; same.at = this.now(); return { login: { id: same.id, site, user: name, at: same.at }, updated: true }; }
    if (this.saved.length >= MAX_LOGINS) throw new Error(`Hai già ${MAX_LOGINS} password salvate.`);
    const e: Saved = { id: `l-${this.now().toString(36)}-${(++this.seq).toString(36)}`, site, user: name, cipher, at: this.now() };
    this.saved.push(e);
    return { login: { id: e.id, site, user: name, at: e.at }, updated: false };
  }

  remove(id: string): void { this.saved = this.saved.filter(x => x.id !== id); this.flush(); }

  private flush(): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, logins: this.saved }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ } throw e; }
  }
}
