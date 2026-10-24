// The user's credentials file, read only for login hand-offs: an agent names an account (user name or e-mail), the
// banner shows that entry's user, URL and note, and the password is read again only when the user clicks "Copia
// password" (service.ts puts it on the clipboard). So a password never travels in a tool argument, an agent's context,
// the renderer or a log (the user, 2026-10-11: the chat had written the credentials only in its reasoning; ADR 0012).
// The file lives in the brain folder: `credentialsFile` in <brain>/brain-settings.json (a path inside the brain), else
// ops/credentials.md. Format: a .json file, or a .md/.txt file with JSON code blocks; every object with a string
// "password" and one of email | username | user | login is an entry (optional url, note). Pure (no Electron), unit-tested;
// used by browser/tabs.ts (owner), browser/tools.ts (lookup) and browser/service.ts (copy).
// The "Credenziali" panel (the user asked "dammi url e credenziali di test X" ~12 times in 6 days) lists every entry the
// same way: list() gives group, user, URL and note with an id, byId(id) reads the file again at the Copia click.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CredentialEntry, HandoffAccount } from '../../shared/contract';

export const DEFAULT_CREDENTIALS_FILE = 'ops/credentials.md';
const USER_KEYS = ['email', 'username', 'user', 'login'] as const;

/** group: the keys that lead to the entry ("ExampleApp · test"), array indexes left out. */
interface Entry { user: string; password: string; url?: string; note?: string; group: string }

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);
const hostOf = (u: string | undefined): string => { try { return u ? new URL(u).host.toLowerCase() : ''; } catch { return ''; } };

/** Every entry of the file's text (a JSON document, or the JSON code blocks of a Markdown file). */
export function parseEntries(text: string): Entry[] {
  const docs: unknown[] = [];
  const t = text.replace(/^﻿/, '');
  try { docs.push(JSON.parse(t)); } catch {
    for (const m of t.matchAll(/```[a-z]*\r?\n([\s\S]*?)```/gi)) { try { docs.push(JSON.parse(m[1]!)); } catch { /* not JSON */ } }
  }
  const out: Entry[] = [];
  const walk = (v: unknown, depth: number, keys: string[]): void => {
    if (depth > 12 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1, keys); return; }
    const o = v as Record<string, unknown>;
    const key = USER_KEYS.find(k => typeof o[k] === 'string' && (o[k] as string).trim());
    if (key && typeof o.password === 'string' && o.password) {
      out.push({
        user: (o[key] as string).trim(), password: o.password, group: oneLine(keys.join(' · '), 120),
        ...(typeof o.url === 'string' && /^https?:\/\//i.test(o.url) ? { url: o.url } : {}),
        ...(typeof o.note === 'string' && o.note.trim() ? { note: oneLine(o.note, 200) } : {}),
      });
    }
    for (const [k, x] of Object.entries(o)) walk(x, depth + 1, [...keys, k]);
  };
  for (const d of docs) walk(d, 0, []);
  return out;
}

/** A stable id for the panel: position, group, user, URL and note (never the password), so a Copia after the file
 *  changed finds no entry instead of the wrong one (byId also refuses an id two entries share). */
export function entryId(e: Entry, index: number): string {
  return crypto.createHash('sha256').update(JSON.stringify([index, e.group, e.user, e.url ?? '', e.note ?? ''])).digest('hex').slice(0, 16);
}

/** What the panel shows of each entry (never the password). */
export function publicEntries(entries: Entry[]): CredentialEntry[] {
  return entries.map((e, i) => ({ id: entryId(e, i), group: e.group, user: e.user, ...(e.url ? { url: e.url } : {}), ...(e.note ? { note: e.note } : {}) }));
}

/** The entry for an account: same user name (case-insensitive); with several, the one whose URL host is the page's. */
export function pick(entries: Entry[], account: string, pageUrl: string): Entry | undefined {
  const want = account.trim().toLowerCase();
  const same = entries.filter(e => e.user.toLowerCase() === want);
  const host = hostOf(pageUrl);
  return same.find(e => host && hostOf(e.url) === host) ?? same[0];
}

export class Credentials {
  private copiedUntil = 0;

  constructor(private root: () => string | null = () => null, private readonly read: (f: string) => string = f => fs.readFileSync(f, 'utf8')) {}

  setRoot(fn: () => string | null): void { this.root = fn; }

  /** A password went to the clipboard: agents may not paste (Ctrl+V) until it is cleared, or they could read it back. */
  markCopied(ms: number, now = Date.now()): void { this.copiedUntil = now + ms; }
  cleared(): void { this.copiedUntil = 0; }
  pasteBlocked(now = Date.now()): boolean { return now < this.copiedUntil; }

  /** Absolute path of the credentials file, or null (no brain, or a configured path outside the brain). */
  file(): string | null {
    const root = this.root();
    if (!root) return null;
    let rel = DEFAULT_CREDENTIALS_FILE;
    try {
      const j = JSON.parse(this.read(path.join(root, 'brain-settings.json')).replace(/^﻿/, '')) as { credentialsFile?: unknown };
      if (typeof j.credentialsFile === 'string' && j.credentialsFile.trim()) rel = j.credentialsFile.trim();
    } catch { /* no brain settings: the default */ }
    const abs = path.resolve(root, rel);
    const inside = path.relative(path.resolve(root), abs);
    return inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? abs : null;
  }

  /** For messages to the agent: where the file is expected (relative to the brain), never its content. */
  describe(): string {
    const f = this.file();
    const root = this.root();
    return f && root ? path.relative(root, f).replace(/\\/g, '/') : 'no credentials file';
  }

  private entries(): Entry[] {
    const f = this.file();
    if (!f) return [];
    try { return parseEntries(this.read(f)); } catch { return []; }
  }

  /** What the banner shows for an account (never the password). */
  lookup(account: string, pageUrl: string): HandoffAccount {
    const e = pick(this.entries(), account, pageUrl);
    if (!e) return { user: oneLine(account, 200), found: false };
    return { user: e.user, found: true, ...(e.url ? { url: e.url } : {}), ...(e.note ? { note: e.note } : {}) };
  }

  /** User names of the entries whose URL host (with port) is the page's: the accounts meant for this site (rules.ts). */
  accountsFor(pageUrl: string): string[] {
    const host = hostOf(pageUrl);
    return host ? [...new Set(this.entries().filter(e => hostOf(e.url) === host).map(e => e.user))] : [];
  }

  /** Every entry for the "Credenziali" panel: group, user, URL, note and an id (never the password). */
  list(): CredentialEntry[] { return publicEntries(this.entries()); }

  /** A panel entry by id, read from the file now: its user name and password (for the clipboard only). */
  byId(id: string): { user: string; password: string } | null {
    const all = this.entries();
    const hits = all.filter((e, n) => entryId(e, n) === id);
    return hits.length === 1 ? { user: hits[0]!.user, password: hits[0]!.password } : null;
  }

  /** The password of an account, read from the file now (for the clipboard only). */
  password(account: string, pageUrl: string): string | null {
    return pick(this.entries(), account, pageUrl)?.password ?? null;
  }
}
