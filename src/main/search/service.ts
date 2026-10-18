// The Ctrl+K full-text search ('search:query', ADR 0023): an in-memory index of the chats of the last 30 days (title and
// messages, open and closed), the git branches of their folders and the brain folder's markdown files. Built lazily on
// the first query and brought up to date only when the user searches (at most every 2 s; the brain's file list at most
// every 30 s): only appended transcript bytes and changed files are read again. No timer, no watcher: at rest it costs
// nothing (feat/lag-app: the app under 0.1 core). Read-only everywhere. Used by main/index.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { ChatItem, ChatSummary, SearchHit, SearchResult } from '../../shared/contract';
import type { HybridSearch } from './hybrid/service';
import { errText, log } from '../log';
import { listMarkdown, readAppended, transcriptParts, type TailState } from './sources';
import { fold, part, searchDocs, snippet, terms, type Doc, type Part } from './text-index';

export interface SearchDeps {
  chats: () => ChatSummary[];
  /** a chat's live items (used when it has no transcript: Cursor, the demo) */
  items: (chatId: string) => ChatItem[];
  /** a chat's Claude transcript file, null = none (then its live items are indexed) */
  transcriptOf: (c: ChatSummary) => string | null;
  brainRoot: () => string | null;
  branchOf: (cwd: string) => Promise<string | null>;
  /** the date for the 30-day window and recency (the demo's frozen clock) */
  now?: () => number;
  /** ms for the pauses between refreshes (default performance.now: never frozen) */
  clock?: () => number;
  /** brain files from the hybrid search (SPEC 23); null or a failure = the palette's own file index */
  brainHits?: (q: string) => Promise<SearchHit[] | null>;
}

const DAY = 86_400_000;
const WINDOW = 30 * DAY;
const CHAT_CHARS = 2_000_000;       // per chat, newest kept
const FILE_BYTES = 1024 * 1024;     // a bigger markdown file is not indexed
const REFRESH_MS = 2_000;
const FILES_MS = 30_000;
const BRANCH_MS = 30_000;

interface ChatRec { parts: Part[]; chars: number; tail: TailState | null; file: string | null; missAt: number; liveSig: string }
interface FileRec { size: number; mtimeMs: number; doc: Doc }

const yieldNow = (): Promise<void> => new Promise(res => setImmediate(res));
const folderName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export class SearchService {
  private chatRecs = new Map<string, ChatRec>();
  private files = new Map<string, FileRec>();
  private filesRoot: string | null = null;
  private filesAt = 0;
  private branches = new Map<string, { name: string | null; at: number }>();
  private refreshedAt = 0;
  private running: Promise<void> | null = null;
  private chatDocs: Doc[] = [];
  private branchDocs: Doc[] = [];
  private now: () => number;
  private clock: () => number;

  constructor(private deps: SearchDeps) { this.now = deps.now ?? Date.now; this.clock = deps.clock ?? (() => performance.now()); }

  async query(q: string): Promise<SearchResult> {
    const t0 = performance.now();
    const text = typeof q === 'string' ? q.slice(0, 200) : '';
    if (fold(text).trim().length < 2) return { q: text, hits: [], ms: 0, indexed: { chats: this.chatRecs.size, files: this.files.size } };
    const [, brain] = await Promise.all([this.refresh(), this.deps.brainHits?.(text).catch(() => null) ?? Promise.resolve(null)]);
    const own = searchDocs([...this.chatDocs, ...this.branchDocs, ...(brain ? [] : [...this.files.values()].map(f => f.doc))], text, { now: this.now() });
    const hits = brain ? [...own, ...brain] : own;
    const ms = Math.round(performance.now() - t0);
    return { q: text, hits, ms, indexed: { chats: this.chatRecs.size, files: this.files.size } };
  }

  /** Brings the index up to date (joined when one is already running; skipped if done less than 2 s ago). */
  refresh(force = false): Promise<void> {
    if (this.running) return this.running;
    if (!force && this.refreshedAt && this.clock() - this.refreshedAt < REFRESH_MS) return Promise.resolve();
    this.running = this.doRefresh().catch(e => log.warn('search', 'index not updated', { cause: errText(e), hint: 'the search shows what it had; it retries on the next query' }))
      .finally(() => { this.refreshedAt = this.clock(); this.running = null; });
    return this.running;
  }

  private async doRefresh(): Promise<void> {
    const t0 = performance.now();
    const now = this.now();
    const chats = this.deps.chats().filter(c => !c.closedAt || Math.max(c.updatedAt, c.closedAt) >= now - WINDOW);
    const keep = new Set(chats.map(c => c.id));
    for (const id of [...this.chatRecs.keys()]) if (!keep.has(id)) this.chatRecs.delete(id);
    // one chat at a time, yielding between files: a first index of hundreds of MB of transcripts never holds the main
    // process (IPC, the other chats) nor its memory for long
    for (const c of chats) { await this.updateChat(c); await yieldNow(); }
    this.chatDocs = chats.map(c => {
      const r = this.chatRecs.get(c.id);
      return {
        key: `chat:${c.id}`, kind: 'chat' as const, title: c.title, titleLow: fold(c.title), at: c.closedAt ?? c.updatedAt, parts: r?.parts ?? [],
        sub: folderName(c.cwd), chatId: c.id, ...(c.closedAt ? { closed: true } : {}),
      };
    });
    await this.updateBranches(chats, this.clock());
    await this.updateFiles(this.clock());
    const ms = Math.round(performance.now() - t0);
    if (ms > 300) log.info('search', 'index updated', { data: { ms, chats: this.chatRecs.size, files: this.files.size } });
  }

  private async updateChat(c: ChatSummary): Promise<void> {
    let r = this.chatRecs.get(c.id);
    if (!r) { r = { parts: [], chars: 0, tail: null, file: null, missAt: 0, liveSig: '' }; this.chatRecs.set(c.id, r); }
    // a transcript not found is looked up again at most once a minute (the lookup may list every project folder)
    if (!r.file && (!r.missAt || this.clock() - r.missAt >= 60_000)) { r.file = this.deps.transcriptOf(c); if (!r.file) r.missAt = this.clock(); }
    if (r.file) {
      try {
        const got = await readAppended(r.file, r.tail);
        if (!got) return;
        if (got.reset) { r.parts = []; r.chars = 0; }
        r.tail = got.state;
        for (let i = 0; i < got.lines.length; i += 400) {
          this.add(r, transcriptParts(got.lines.slice(i, i + 400)));
          if (i + 400 < got.lines.length) await yieldNow();
        }
      } catch (e) {
        // moved or deleted: look it up again next time
        r.file = null; r.tail = null;
        log.warn('search', 'transcript not readable', { chat: c.id, cause: errText(e), hint: 'the chat is searched by its title only until the file is back' });
      }
      return;
    }
    const items = this.deps.items(c.id);
    const last = items[items.length - 1];
    const sig = `${items.length}:${last?.id ?? ''}:${last && 'text' in last ? last.text.length : 0}`;
    if (sig === r.liveSig) return;
    r.liveSig = sig;
    r.parts = []; r.chars = 0;
    this.add(r, items.filter(i => (i.kind === 'user' || i.kind === 'assistant') && i.text.trim()).map(i => part(i.at, (i as { text: string }).text)));
  }

  private add(r: ChatRec, parts: Part[]): void {
    for (const p of parts) { r.parts.push(p); r.chars += p.text.length; }
    while (r.chars > CHAT_CHARS && r.parts.length > 1) r.chars -= r.parts.shift()!.text.length;
  }

  private async updateBranches(chats: ChatSummary[], tick: number): Promise<void> {
    const cwds = [...new Set(chats.map(c => c.cwd).filter(Boolean))];
    await Promise.all(cwds.map(async cwd => {
      const b = this.branches.get(cwd);
      if (b && tick - b.at < BRANCH_MS) return;
      let name: string | null = null;
      try { name = await this.deps.branchOf(cwd); } catch { /* no repository */ }
      this.branches.set(cwd, { name, at: tick });
    }));
    const by = new Map<string, ChatSummary[]>();
    for (const c of chats) {
      const name = this.branches.get(c.cwd)?.name;
      if (!name) continue;
      const k = `${name}\n${c.cwd}`;
      by.set(k, [...(by.get(k) ?? []), c]);
    }
    this.branchDocs = [...by].map(([k, list]) => {
      const [name = '', cwd = ''] = k.split('\n');
      // Enter opens the open chat touched last on the branch, else the last closed one
      const pick = [...list].sort((a, b) => Number(!!a.closedAt) - Number(!!b.closedAt) || b.updatedAt - a.updatedAt)[0]!;
      return {
        key: `branch:${name}:${cwd}`, kind: 'branch' as const, title: name, titleLow: fold(name), at: Math.max(...list.map(c => c.updatedAt)), parts: [],
        sub: `${folderName(cwd)} · ${list.map(c => c.title).join(', ')}`, chatId: pick.id, ...(pick.closedAt ? { closed: true } : {}),
      };
    });
  }

  private async updateFiles(tick: number): Promise<void> {
    const root = this.deps.brainRoot();
    if (root !== this.filesRoot) { this.files.clear(); this.filesRoot = root; this.filesAt = 0; }
    if (!root || (this.filesAt && tick - this.filesAt < FILES_MS)) return;
    this.filesAt = tick;
    if (!fs.existsSync(root)) { this.files.clear(); return; }
    const list = await listMarkdown(root);
    const seen = new Set<string>();
    for (const f of list) {
      seen.add(f.rel);
      const old = this.files.get(f.rel);
      if (old && old.size === f.size && old.mtimeMs === f.mtimeMs) continue;
      let text = '';
      if (f.size <= FILE_BYTES) { try { text = await fs.promises.readFile(path.join(root, f.rel), 'utf8'); } catch { continue; } }
      this.files.set(f.rel, {
        size: f.size, mtimeMs: f.mtimeMs,
        doc: { key: `brain:${f.rel}`, kind: 'brain', title: f.rel, titleLow: fold(f.rel), at: f.mtimeMs, parts: text ? [part(f.mtimeMs, text)] : [], path: f.rel },
      });
    }
    for (const k of [...this.files.keys()]) if (!seen.has(k)) this.files.delete(k);
  }
}

/** Ctrl+K's brain hits from the hybrid search: the best place of each file (at most 6), the query word marked. Null
 *  (= the palette's own file index) when it fails or is slow (the first search, while the worker starts). */
export function brainHitsFrom(h: Pick<HybridSearch, 'query'>, waitMs = 1500): (q: string) => Promise<SearchHit[] | null> {
  return async q => {
    const seen = new Set<string>();
    const { words } = terms(q);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>(r => { timer = setTimeout(() => r(null), waitMs); });
    const hits = await Promise.race([h.query(q, { limit: 30 }).catch(() => null), late]).finally(() => clearTimeout(timer));
    if (!hits) return null;
    return hits.filter(x => !seen.has(x.path) && seen.add(x.path)).slice(0, 6).map(x => {
      const low = fold(x.text);
      const w = words.find(t => low.includes(t));
      const sn = snippet(x.text, w ? low.indexOf(w) : 0, w?.length ?? 0);
      return { kind: 'brain' as const, key: `brain:${x.path}`, title: x.path, snippet: sn.snippet, mark: w ? sn.mark : null, at: x.at, path: x.path, line: x.line };
    });
  };
}

/** Demo (SB_DEMO): fixed branches for the demo's folders, so the palette shows the kind without a repository. */
export const DEMO_BRANCHES: Record<string, string> = { 'alfa-e2e': 'fix/rimborsi-sconto', 'alfa-shop': 'feat/totale-ordine', brain: 'main' };
export const demoBranchOf = async (cwd: string): Promise<string | null> => DEMO_BRANCHES[folderName(cwd)] ?? null;
