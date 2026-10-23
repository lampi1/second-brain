// The personal browser's own data (Browser page, ADR 0133): bookmarks, saved sessions (a named set of tabs), the
// history of visited pages and the tabs open at the last close, in <userData>/personal-browser.json. Why: the owner,
// 2026-10-23, wants a browser for every day inside the app «con la possibilità di salvare sessioni e preferiti»,
// apart from the agents' browsers. Nothing here is ever given to an agent, the app MCP or the logs. Only http(s) pages
// are kept. Writes are debounced and atomic (temp file + rename). Pure apart from the JSON file; unit-tested
// (test/unit/personal-store.test.ts); used by personal/browser.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { PersonalBookmark, PersonalSession, PersonalVisit } from '../../shared/contract';

export const MAX_HISTORY = 2000;
export const MAX_BOOKMARKS = 500;
export const MAX_SESSIONS = 50;
const MAX_SESSION_TABS = 40;
const MAX_URL = 4000;
const MAX_TITLE = 300;

interface Data { version: 1; bookmarks: PersonalBookmark[]; sessions: PersonalSession[]; history: PersonalVisit[]; lastTabs: { url: string; title: string }[] }

const empty = (): Data => ({ version: 1, bookmarks: [], sessions: [], history: [], lastTabs: [] });

/** A page worth keeping: http(s) only (no about:, data:, file: or chrome: pages), not absurdly long. */
export function keepable(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > MAX_URL) return false;
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}

const title = (t: unknown, url: string): string => (typeof t === 'string' && t.trim() ? t.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : url.slice(0, MAX_TITLE));
const tabsOf = (x: unknown): { url: string; title: string }[] =>
  (Array.isArray(x) ? x : []).flatMap(t => (t && keepable((t as { url?: unknown }).url) ? [{ url: (t as { url: string }).url, title: title((t as { title?: unknown }).title, (t as { url: string }).url) }] : [])).slice(0, MAX_SESSION_TABS);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const sid = (x: unknown): string | null => (typeof x === 'string' && /^[a-z0-9-]{1,40}$/.test(x) ? x : null);

/** Whatever the file holds, only well-formed entries survive (a hand-edited or truncated file never breaks the page). */
export function parse(raw: unknown): Data {
  const d = empty();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  for (const b of Array.isArray(r.bookmarks) ? r.bookmarks : []) {
    const id = sid((b as { id?: unknown })?.id);
    if (id && keepable((b as { url?: unknown }).url)) d.bookmarks.push({ id, url: (b as { url: string }).url, title: title((b as { title?: unknown }).title, (b as { url: string }).url), at: num((b as { at?: unknown }).at) });
  }
  for (const s of Array.isArray(r.sessions) ? r.sessions : []) {
    const id = sid((s as { id?: unknown })?.id);
    const name = (s as { name?: unknown })?.name;
    const tabs = tabsOf((s as { tabs?: unknown })?.tabs);
    if (id && typeof name === 'string' && name.trim() && tabs.length) d.sessions.push({ id, name: name.trim().slice(0, 80), at: num((s as { at?: unknown }).at), tabs });
  }
  for (const h of Array.isArray(r.history) ? r.history : []) {
    if (keepable((h as { url?: unknown })?.url)) d.history.push({ url: (h as { url: string }).url, title: title((h as { title?: unknown }).title, (h as { url: string }).url), at: num((h as { at?: unknown }).at) });
  }
  d.bookmarks = d.bookmarks.slice(0, MAX_BOOKMARKS);
  d.sessions = d.sessions.slice(0, MAX_SESSIONS);
  d.history = d.history.sort((a, b) => b.at - a.at).slice(0, MAX_HISTORY);
  d.lastTabs = tabsOf(r.lastTabs);
  return d;
}

export class PersonalStore {
  private data: Data;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(private readonly file: string, private readonly now: () => number = Date.now) {
    let raw: unknown = null;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run, or unreadable: start empty */ }
    this.data = parse(raw);
  }

  private id(prefix: string): string { return `${prefix}-${this.now().toString(36)}-${(++this.seq).toString(36)}`; }

  bookmarks(): PersonalBookmark[] { return this.data.bookmarks; }
  sessions(): PersonalSession[] { return this.data.sessions; }
  history(limit = 300): PersonalVisit[] { return this.data.history.slice(0, limit); }
  lastTabs(): { url: string; title: string }[] { return this.data.lastTabs; }

  /** Adds a bookmark (the same address twice keeps one, with the newer title), newest first. */
  addBookmark(url: string, name: string): PersonalBookmark {
    if (!keepable(url)) throw new Error('Si possono salvare solo pagine web (http o https).');
    const same = this.data.bookmarks.find(b => b.url === url);
    if (same) { same.title = title(name, url); this.save(); return same; }
    if (this.data.bookmarks.length >= MAX_BOOKMARKS) throw new Error(`Hai già ${MAX_BOOKMARKS} preferiti: togline qualcuno.`);
    const b: PersonalBookmark = { id: this.id('b'), url, title: title(name, url), at: this.now() };
    this.data.bookmarks.unshift(b);
    this.save();
    return b;
  }

  removeBookmark(id: string): void { this.data.bookmarks = this.data.bookmarks.filter(b => b.id !== id); this.save(); }

  /** Saves the given tabs under a name; a session with the same name is replaced. */
  saveSession(name: string, tabs: { url: string; title: string }[]): PersonalSession {
    const n = String(name ?? '').trim().slice(0, 80);
    if (!n) throw new Error('Dai un nome alla sessione.');
    const kept = tabsOf(tabs);
    if (!kept.length) throw new Error('Nessuna scheda con una pagina web da salvare.');
    const s: PersonalSession = { id: this.id('s'), name: n, at: this.now(), tabs: kept };
    this.data.sessions = [s, ...this.data.sessions.filter(x => x.name.toLowerCase() !== n.toLowerCase())].slice(0, MAX_SESSIONS);
    this.save();
    return s;
  }

  session(id: string): PersonalSession | null { return this.data.sessions.find(s => s.id === id) ?? null; }
  removeSession(id: string): void { this.data.sessions = this.data.sessions.filter(s => s.id !== id); this.save(); }

  /** A visit: the same address as the newest entry only refreshes it (reloads, in-page hops do not pile up). */
  visit(url: string, name: string): void {
    if (!keepable(url)) return;
    const top = this.data.history[0];
    if (top && top.url === url) { top.title = title(name, url); top.at = this.now(); this.save(); return; }
    this.data.history.unshift({ url, title: title(name, url), at: this.now() });
    if (this.data.history.length > MAX_HISTORY) this.data.history.length = MAX_HISTORY;
    this.save();
  }

  /** The page's title arrived after the visit: set it on the newest entry of that address. */
  retitle(url: string, name: string): void {
    const h = this.data.history.find(x => x.url === url);
    if (h && typeof name === 'string' && name.trim()) { h.title = title(name, url); this.save(); }
  }

  clearHistory(): void { this.data.history = []; this.save(); }

  /** The tabs open right now, kept for the next start («Riapri le schede»). */
  setLastTabs(tabs: { url: string; title: string }[]): void {
    const next = tabsOf(tabs);
    if (JSON.stringify(next) === JSON.stringify(this.data.lastTabs)) return;
    this.data.lastTabs = next;
    this.save();
  }

  private save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 400);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ } }
  }
}
