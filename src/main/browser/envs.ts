// Browser environments: by default the app's browsers do not share cookies and sessions, so several environments can
// be tested at the same time. Each tab belongs to one environment = its own persistent session partition
// `persist:env-<id>` (cookies, storage, cache apart). The default environment is derived generically from the host
// (test-3.example.com → example-test-3, localhost → local); any other naming comes from the caller or the user's own
// configuration, so two users on the same host, or tabs that share one session, are an explicit, visible choice. The known environments (ids,
// hosts, last use and last login, never cookies or secrets) are kept in <userData>/browser-envs.json. Session status
// per environment: valid / expiring (auth cookie expires within 24 h) / expired (login page, or the auth cookie that
// was there is gone) / unknown. Pure apart from the JSON file; unit-tested; used by browser/tabs.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserSessionStatus } from '../../shared/contract';
import { uiLocale } from '../locale';

export interface EnvRecord { id: string; createdAt: number; lastUsedAt: number; lastLoginAt: number | null; hosts: string[]; lastUrl?: string; agents?: boolean }

const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#2fa8a8', '#f032e6', '#8a9a1f', '#9a6324', '#800000', '#469990', '#000075'];

/** "Example Test 3" → "example-test-3". Throws when nothing usable is left. */
export function envSlug(name: unknown): string {
  const s = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  if (!s) throw new Error(`Invalid environment name "${String(name ?? '')}": use letters, digits and dashes, e.g. "example-test-3".`);
  return s;
}

/** The default environment of a URL, generic: localhost-like → local, an IPv4 → ip-a-b-c-d, else <site>-<first
 *  subdomain> (test-3.example.com → example-test-3; example.com and www.example.com → example; a.example.co.uk →
 *  example-a). */
export function envForUrl(url?: string | null): string {
  let host = '';
  try { host = url ? new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '') : ''; } catch { host = ''; }
  if (!host) return 'scratch';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) return 'local';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return `ip-${host.replace(/\./g, '-')}`;
  if (host.includes(':')) return `ip-${envSlug(host)}`;
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 1) return envSlug(labels[0]);
  // the site label sits before the public suffix; "co.uk"-like suffixes (2-letter TLD after a short label) take two
  let site = labels.length - 2;
  if (labels.length >= 3 && labels[labels.length - 1]!.length === 2 && labels[labels.length - 2]!.length <= 3) site = labels.length - 3;
  const sub = labels.slice(0, site).filter(l => l !== 'www');
  return envSlug(sub.length ? `${labels[site]}-${sub[0]}` : labels[site]);
}

export const envPartition = (id: string): string => `persist:env-${id}`;

/** A stable color per environment (same id → same color, every run). */
export function envColor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return PALETTE[h % PALETTE.length]!;
}

/** Cookie names that usually carry a sign-in (ASP.NET, Entra/MSAL, OIDC, JWT, generic session ids). */
export function isAuthCookie(name: string): boolean {
  return /(?:^|[._-])(?:auth|authn|session|sess|sid|token|jwt|identity|login|oidc|saml|msal|estsauth\w*|aspxauth)(?:$|[._-])/i.test(name)
    || /^\.AspNetCore\.(?:Cookies|Identity)/i.test(name) || /^(?:JSESSIONID|PHPSESSID|connect\.sid)$/i.test(name);
}

/** URLs that look like a sign-in page. */
export function isLoginUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(?:^|\/)(?:login|log-in|signin|sign-in|sign_in|logon|authenticate|auth\/realms|oauth2\/v2\.0\/authorize|oauth2\/authorize|connect\/authorize|saml2?|sso)(?:[/.?#]|$)/i.test(u.pathname)
      || /^login\.(?:microsoftonline|live|windows)\./i.test(u.hostname);
  } catch { return false; }
}

const DAY = 24 * 3600 * 1000;
const hhmm = (t: number) => new Date(t).toLocaleString(uiLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Session status from what is known: auth cookies (expiry in ms, null = until the app closes), whether an auth cookie
 *  was seen before in this environment, and whether its last page was a sign-in page. Detail in Italian (shown in the UI). */
export function computeSession(i: { authCookies: Array<{ expires: number | null }>; seenAuth: boolean; loginPage: boolean; now: number }): { status: BrowserSessionStatus; detail: string; authExpiresAt: number | null } {
  if (i.loginPage) return { status: 'expired', detail: "l'ultima pagina è una pagina di accesso: rifai l'accesso", authExpiresAt: null };
  if (!i.authCookies.length) {
    return i.seenAuth
      ? { status: 'expired', detail: "il cookie di accesso non c'è più: rifai l'accesso", authExpiresAt: null }
      : { status: 'unknown', detail: 'nessun accesso rilevato in questo ambiente', authExpiresAt: null };
  }
  const dated = i.authCookies.map(c => c.expires).filter((e): e is number => typeof e === 'number');
  if (!dated.length) return { status: 'valid', detail: "accesso valido finché l'app resta aperta (cookie di sessione)", authExpiresAt: null };
  const min = Math.min(...dated);
  if (min - i.now < DAY) return { status: 'expiring', detail: `l'accesso scade il ${hhmm(min)}`, authExpiresAt: min };
  return { status: 'valid', detail: `accesso valido fino al ${hhmm(min)}`, authExpiresAt: min };
}

/** The list of known environments, persisted as JSON (atomic writes). */
export class EnvStore {
  private envs = new Map<string, EnvRecord>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string, private readonly now: () => number = Date.now) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { envs?: EnvRecord[] };
      for (const e of raw.envs ?? []) {
        if (!e || typeof e.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(e.id)) continue;
        this.envs.set(e.id, {
          id: e.id, createdAt: Number(e.createdAt) || this.now(), lastUsedAt: Number(e.lastUsedAt) || 0, lastLoginAt: typeof e.lastLoginAt === 'number' ? e.lastLoginAt : null,
          hosts: Array.isArray(e.hosts) ? e.hosts.filter(h => typeof h === 'string').slice(0, 20) : [], ...(typeof e.lastUrl === 'string' ? { lastUrl: e.lastUrl } : {}), ...(e.agents === true ? { agents: true } : {}),
        });
      }
    } catch { /* first run or unreadable: start empty */ }
  }

  get(id: string): EnvRecord | undefined { return this.envs.get(id); }
  list(): EnvRecord[] { return [...this.envs.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt); }

  ensure(id: string): EnvRecord {
    let e = this.envs.get(id);
    if (!e) { e = { id, createdAt: this.now(), lastUsedAt: this.now(), lastLoginAt: null, hosts: [] }; this.envs.set(id, e); this.save(); }
    return e;
  }

  /** A page of the environment loaded: remember host and a query-free URL (no tokens), for "reopen" and the list. */
  touch(id: string, url: string): void {
    const e = this.ensure(id);
    e.lastUsedAt = this.now();
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return;
      if (!e.hosts.includes(u.host)) e.hosts = [u.host, ...e.hosts].slice(0, 20);
      e.lastUrl = `${u.origin}${u.pathname}`;
    } catch { /* not a URL */ }
    this.save();
  }

  markLogin(id: string): void { this.ensure(id).lastLoginAt = this.now(); this.save(); }

  /** An agent tab used the environment (until then its hosts are the user's own business: hidden from agents). */
  markAgent(id: string): void { const e = this.ensure(id); if (!e.agents) { e.agents = true; this.save(); } }

  save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, envs: this.list() }, null, 1));
      fs.renameSync(tmp, this.file);
    } catch { /* disk full or locked: the list is a convenience, keep running */ }
  }
}
