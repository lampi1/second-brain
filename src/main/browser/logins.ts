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
// Sign-in by name (#386, ADR 0310): siteCredential() gives the browser's fill_credential tool the user name and the
// password of an entry, only for the site the entry is for (the host of its url, or of an optional loginUrl when the
// sign-in page lives on another host) and never for an entry that looks like production. The agent names the account;
// the value goes from the file to the page's password field, never to the agent.
// Linking a site (#429): when the named account's entry is for another host (a test environment that moved), the
// refusal carries a link offer; the browser shows the user a Sì/No banner on the tab (hand-off kind "link": the user's
// click only, never an agent or the Orchestrator), and Sì makes linkSite() add the page's origin to the entry's loginUrl
// (a string, or a list once it has several). Only that key of that entry changes; the password is never read for it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CredentialEntry, HandoffAccount } from '../../shared/contract';
import { ToolRefusal } from '../mcp/refusal';

export const DEFAULT_CREDENTIALS_FILE = 'ops/credentials.md';
const USER_KEYS = ['email', 'username', 'user', 'login'] as const;

/** group: the keys that lead to the entry ("ExampleApp · test"), array indexes left out. */
interface Entry { user: string; password: string; url?: string; loginUrls?: string[]; note?: string; group: string }

/** An entry fill_credential could use on this page once the user links the page's site to it (#429). */
export interface LinkOffer { entryId: string; user: string; group: string; sites: string[]; host: string; origin: string }

/** fill_credential's refusal that comes with a link the user can allow (tools.ts opens the banner). */
export class LinkRefusal extends ToolRefusal {
  constructor(message: string, readonly link: LinkOffer) { super(message); }
}

/** What fill_credential may type, or why not (a text for the agent, with the fix; never a password), and maybe the link
 *  the user can allow with one click. */
export type SiteCredential = { user: string; password: string } | { refusal: string; link?: LinkOffer };

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);
const hostOf = (u: string | undefined): string => { try { return u ? new URL(u).host.toLowerCase() : ''; } catch { return ''; } };
/** "https://test-4.example.com/" of a page URL ('' for a page that is not http or https). */
const originOf = (u: string): string => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? `${x.origin}/` : ''; } catch { return ''; } };

/** The JSON documents of a file's text: the whole text, else each JSON code block of a Markdown file, with where the
 *  block's body sits (start, end) so linkSite can write it back in place. */
function documents(text: string): { doc: unknown; start: number; end: number }[] {
  const t = text.replace(/^\uFEFF/, ''), bom = text.length - t.length;
  try { return [{ doc: JSON.parse(t), start: bom, end: text.length }]; } catch { /* Markdown */ }
  const out: { doc: unknown; start: number; end: number }[] = [];
  for (const m of t.matchAll(/```[a-z]*\r?\n([\s\S]*?)```/gi)) {
    try { const start = bom + m.index! + m[0].length - 3 - m[1]!.length; out.push({ doc: JSON.parse(m[1]!), start, end: start + m[1]!.length }); } catch { /* not JSON */ }
  }
  return out;
}

const httpList = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && /^https?:\/\//i.test(x));

/** Every entry object of a document, in order (pre-order, as parseEntries reads them), with the keys that lead to it. */
function walkEntries(doc: unknown, visit: (o: Record<string, unknown>, keys: string[]) => void): void {
  const walk = (v: unknown, depth: number, keys: string[]): void => {
    if (depth > 12 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1, keys); return; }
    const o = v as Record<string, unknown>;
    const key = USER_KEYS.find(k => typeof o[k] === 'string' && (o[k] as string).trim());
    if (key && typeof o.password === 'string' && o.password) visit(o, keys);
    for (const [k, x] of Object.entries(o)) walk(x, depth + 1, [...keys, k]);
  };
  walk(doc, 0, []);
}

/** Every entry of the file's text (a JSON document, or the JSON code blocks of a Markdown file). */
export function parseEntries(text: string): Entry[] {
  const out: Entry[] = [];
  for (const { doc } of documents(text)) walkEntries(doc, (o, keys) => {
    const key = USER_KEYS.find(k => typeof o[k] === 'string' && (o[k] as string).trim())!;
    const logins = httpList(o.loginUrl);
    out.push({
      user: (o[key] as string).trim(), password: o.password as string, group: oneLine(keys.join(' · '), 120),
      ...(typeof o.url === 'string' && /^https?:\/\//i.test(o.url) ? { url: o.url } : {}),
      ...(logins.length ? { loginUrls: logins } : {}),
      ...(typeof o.note === 'string' && o.note.trim() ? { note: oneLine(o.note, 200) } : {}),
    });
  });
  return out;
}

/** The file's text with `origin` added to the loginUrl of its index-th entry (a string, then a list), or null when that
 *  entry is not there. Only that key changes; the document (or its Markdown block) is written back as 2-space JSON with
 *  the file's own line ends. Pure. */
export function addLoginUrl(text: string, index: number, origin: string): string | null {
  let n = 0;
  for (const d of documents(text)) {
    let hit: Record<string, unknown> | null = null;
    walkEntries(d.doc, o => { if (n++ === index) hit = o; });
    if (!hit) continue;
    const o = hit as Record<string, unknown>, have = httpList(o.loginUrl);
    if (!have.some(u => hostOf(u) === hostOf(origin))) o.loginUrl = have.length ? [...have, origin] : origin;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let body = JSON.stringify(d.doc, null, 2).replace(/\n/g, eol);
    const old = text.slice(d.start, d.end);
    if (/\r?\n$/.test(old)) body += eol;
    return text.slice(0, d.start) + body + text.slice(d.end);
  }
  return null;
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

/** The hosts (with port) an entry signs in on: its url and its loginUrl. */
const hostsOf = (e: Entry): string[] => [hostOf(e.url), ...(e.loginUrls ?? []).map(hostOf)].filter(Boolean);

/** The entry for an account: same user name (case-insensitive); with several, the one whose URL host is the page's. */
export function pick(entries: Entry[], account: string, pageUrl: string): Entry | undefined {
  const want = account.trim().toLowerCase();
  const same = entries.filter(e => e.user.toLowerCase() === want);
  const host = hostOf(pageUrl);
  return same.find(e => host && hostsOf(e).includes(host)) ?? same[0];
}

/** An entry that looks like a production account: "prod", "production" or "produzione" as a word of its group (the
 *  keys that lead to it) or a label of its hosts. The app types only test accounts (#386). */
export function looksProduction(e: Pick<Entry, 'group' | 'url' | 'loginUrls'>): boolean {
  const word = /(?:^|[^a-z0-9])(?:prod|production|produzione)(?:[^a-z0-9]|$)/i;
  return word.test(e.group) || [hostOf(e.url), ...(e.loginUrls ?? []).map(hostOf)].some(h => word.test(h));
}

/** Writes the file where it really is (a link to a file outside the brain stays a link, the secrets stay out of the
 *  brain) with its own mode, through a temporary file beside it and a rename. */
function writeKeeping(f: string, text: string): void {
  const real = fs.realpathSync(f), mode = fs.statSync(real).mode & 0o777, tmp = `${real}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, text, { mode }); fs.chmodSync(tmp, mode); fs.renameSync(tmp, real); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* none */ } throw e; }
}

export class Credentials {
  private copiedUntil = 0;

  constructor(private root: () => string | null = () => null, private readonly read: (f: string) => string = f => fs.readFileSync(f, 'utf8'),
    private readonly write: (f: string, text: string) => void = writeKeeping) {}

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

  /** User names of the entries whose host (url or loginUrl, with port) is the page's: the accounts meant for this site (rules.ts). */
  accountsFor(pageUrl: string): string[] {
    const host = hostOf(pageUrl);
    return host ? [...new Set(this.entries().filter(e => hostsOf(e).includes(host)).map(e => e.user))] : [];
  }

  /** The account fill_credential types into a sign-in form of the page at pageUrl (the frame that holds the password
   *  field), read from the file now. account '' = the only entry for that host. Refused, with the fix, when the entry
   *  is for another site, has no url, looks like production, or cannot be told apart. */
  siteCredential(account: string, pageUrl: string): SiteCredential {
    const host = hostOf(pageUrl), file = this.describe(), all = this.entries();
    if (!host) return { refusal: 'Refused: the password field is not in a web page (http or https). Open the sign-in page first.' };
    if (!this.file()) return { refusal: 'Refused: there is no credentials file (no brain folder, or credentialsFile points outside it). Use handoff_to_user kind "login".' };
    const here = all.filter(e => hostsOf(e).includes(host));
    const names = [...new Set(here.map(e => e.user))].map(u => `"${u}"`).join(', ');
    const want = account.trim().toLowerCase();
    let e: Entry | undefined;
    if (want) {
      const same = all.filter(x => x.user.toLowerCase() === want);
      e = same.find(x => hostsOf(x).includes(host));
      if (!e && same.length) {
        const sites = [...new Set(same.flatMap(hostsOf))];
        const head = `Refused: account "${account.trim()}" in the user's credentials file (${file}) is ${sites.length ? `for ${sites.join(', ')}` : 'without a url'}, and this sign-in form is on ${host}.`;
        // one test entry with that name: the user can link this site to it with one click (#429)
        const linkable = same.map(x => ({ x, i: all.indexOf(x) })).filter(({ x }) => !looksProduction(x));
        const origin = originOf(pageUrl);
        // a production-looking host is never linked: it would turn the whole entry into one the app refuses
        if (linkable.length === 1 && origin && !looksProduction({ group: '', loginUrls: [origin] })) {
          const { x, i } = linkable[0]!;
          return { refusal: `${head} The app asked the user, with a banner on your tab, whether to link ${host} to this account: wait for the answer (handoff_to_user with the handoff_id below). On Sì call fill_credential again; on No sign in another way (handoff_to_user kind "login"). Do not navigate to the entry's old host meanwhile.`,
            link: { entryId: entryId(x, i), user: x.user, group: x.group, sites: hostsOf(x), host, origin } };
        }
        return { refusal: `${head} The app types a password only on the site of its entry${sites.length ? ': open that site' : ''}; if ${host} is its sign-in page, the user adds "${sites.length ? 'loginUrl' : 'url'}": "https://${host}/…" to the entry (ask them in one line, never for the password).` };
      }
      if (!e) return { refusal: `Refused: no account "${account.trim()}" in the user's credentials file (${file}). ${names ? `Entries for ${host}: ${names}.` : `It has no entry for ${host}: the user adds one ({ "user", "password", "url" }), or use handoff_to_user kind "login".`}` };
    } else {
      if (!here.length) return { refusal: `Refused: the user's credentials file (${file}) has no entry for ${host}. If one of its accounts is meant for this site, call fill_credential with account = its user name: the app asks the user to link the site to it. Otherwise the user adds one ({ "user", "password", "url": "https://${host}/…" }), or use handoff_to_user kind "login". Never ask for a password in chat.` };
      if (new Set(here.map(x => x.user.toLowerCase())).size > 1) return { refusal: `Refused: several accounts for ${host} in the user's credentials file (${file}): ${names}. Call fill_credential again with account = one of them.` };
      e = here[0]!;
    }
    if (looksProduction(e)) return { refusal: `Refused: account "${e.user}"${e.group ? ` (${e.group})` : ''} looks like a production account. The app types test accounts only: use handoff_to_user kind "login" with this account.` };
    return { user: e.user, password: e.password };
  }

  /** The user said Sì to linking a site (#429): the origin goes into the loginUrl of the entry with that id, read from
   *  the file now. Refused when the file changed so that the id names no entry (or two), or the entry looks like
   *  production. Never reads or writes the password. */
  linkSite(id: string, origin: string): { ok: true } | { error: string } {
    const f = this.file();
    if (!f) return { error: 'there is no credentials file' };
    let text: string;
    try { text = this.read(f); } catch (e) { return { error: `the credentials file cannot be read: ${e instanceof Error ? e.message : String(e)}` }; }
    const all = parseEntries(text), idx = all.map((e, n) => (entryId(e, n) === id ? n : -1)).filter(n => n >= 0);
    if (idx.length !== 1) return { error: 'the credentials file changed meanwhile: the entry is no longer there' };
    if (looksProduction(all[idx[0]!]!)) return { error: 'the entry looks like a production account' };
    const next = addLoginUrl(text, idx[0]!, origin);
    if (next === null) return { error: 'the entry could not be found in the file' };
    try { this.write(f, next); } catch (e) { return { error: `the credentials file cannot be written: ${e instanceof Error ? e.message : String(e)}` }; }
    return { ok: true };
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
