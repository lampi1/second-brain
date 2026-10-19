// Data access of the brain pages: every read goes through window.sb.invoke('brain:api', { path }) (main proxies GET to
// the brain's own data server). A small stale-while-revalidate cache shared by all pages: a page opens at once with the
// last answer, refetches in the background when older than 20 s, and a page that asks for fresh data adds ?fresh=1
// (the server recomputes). The server's slow sources (now, cost, day, map) answer { value, at, refreshing, error }: they
// are unwrapped here, and while the server says "refreshing" the client asks again a few times so the new value shows
// up by itself. A brain file change (feed:events) marks /api/tables stale. BrainClient is DOM-free and unit-tested
// (test/unit/brain-ui/api.test.ts); useBrain is the React hook the pages use.
import { useEffect, useMemo, useReducer } from 'react';
import type { BrainApiResult } from '@shared/contract';

export type Invoke = (path: string) => Promise<BrainApiResult>;
export interface Entry {
  data: unknown;
  /** when the server computed the value (ms) */
  at: number | null;
  error: string | null;
  loading: boolean;
  /** the server is recomputing in the background (a newer value is coming) */
  refreshing: boolean;
  fetchedAt: number;
}

const WRAPPED = new Set(['/api/now', '/api/cost', '/api/day', '/api/map', '/api/improve']);
const pathname = (p: string) => p.split('?')[0] ?? p;
export const withFresh = (p: string): string => `${p}${p.includes('?') ? '&' : '?'}fresh=1`;

/** A proxied answer → the entry the pages read. */
export function unwrap(path: string, r: BrainApiResult, now: number): Entry {
  if (!r.ok) return { data: null, at: null, error: r.error, loading: false, refreshing: false, fetchedAt: now };
  if (!WRAPPED.has(pathname(path))) return { data: r.data, at: now, error: null, loading: false, refreshing: false, fetchedAt: now };
  const w = (r.data ?? {}) as { value?: unknown; at?: number; refreshing?: boolean; error?: string | null };
  const has = w.value !== undefined && w.value !== null;
  return { data: has ? w.value : null, at: typeof w.at === 'number' ? w.at : null, error: has ? null : (w.error || 'nessun dato dal cervello'), loading: false, refreshing: !!w.refreshing, fetchedAt: now };
}

export class BrainClient {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry>>();
  private subs = new Map<string, Set<() => void>>();
  private retries = new Map<string, number>();
  constructor(private invoke: Invoke, private clock: () => number = Date.now, private retryMs = 5000, private maxRetries = 8) {}

  peek(path: string): Entry | undefined { return this.entries.get(path); }

  subscribe(path: string, fn: () => void): () => void {
    let s = this.subs.get(path);
    if (!s) this.subs.set(path, (s = new Set()));
    s.add(fn);
    return () => { s.delete(fn); };
  }
  private emit(path: string) { for (const fn of this.subs.get(path) ?? []) fn(); }

  /** Fetch (deduplicated); the old value stays visible while a new one is loading. */
  get(path: string, { fresh = false } = {}): Promise<Entry> {
    const key = path;
    const running = this.inflight.get(key);
    if (running && !fresh) return running;
    const old = this.entries.get(key);
    this.entries.set(key, { ...(old ?? { data: null, at: null, error: null, refreshing: false, fetchedAt: 0 }), loading: true });
    this.emit(key);
    const p = this.invoke(fresh ? withFresh(path) : path)
      .catch((e: unknown): BrainApiResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .then(r => {
        const e = unwrap(path, r, this.clock());
        // a failed refresh keeps the last good value on screen, with the error beside it
        const next = e.error && old?.data != null ? { ...old, error: e.error, loading: false, fetchedAt: e.fetchedAt } : e;
        this.entries.set(key, next);
        this.inflight.delete(key);
        this.emit(key);
        this.scheduleRetry(path, next);
        return next;
      });
    this.inflight.set(key, p);
    return p;
  }

  private scheduleRetry(path: string, e: Entry) {
    const n = this.retries.get(path) ?? 0;
    if (!e.refreshing || n >= this.maxRetries) { if (!e.refreshing) this.retries.delete(path); return; }
    this.retries.set(path, n + 1);
    setTimeout(() => { if (this.subs.get(path)?.size) void this.get(path); }, this.retryMs);
  }

  /** Fetch when missing or older than maxAgeMs. */
  ensure(path: string, maxAgeMs = 20e3): void {
    const e = this.entries.get(path);
    if (!e || (!e.loading && this.clock() - e.fetchedAt > maxAgeMs) || (e.error && !e.loading && this.clock() - e.fetchedAt > 3e3)) void this.get(path);
  }

  /** Mark every path starting with prefix stale and refetch the ones on screen. */
  invalidate(prefix: string): void {
    for (const [k, e] of this.entries) if (k.startsWith(prefix)) {
      this.entries.set(k, { ...e, fetchedAt: 0 });
      if (this.subs.get(k)?.size) void this.get(k);
    }
  }
}

// ── the app's client (window.sb) ──────────────────────────────────────────────────────────────────────────────────
let client: BrainClient | null = null;
export function brainClient(): BrainClient {
  if (client) return client;
  client = new BrainClient(path => window.sb.invoke('brain:api', { path }));
  // a brain file changed (idea, error, diary, now.md…): the tables are stale
  try { window.sb.on('feed:events', () => client?.invalidate('/api/tables')); } catch { /* no bridge (tests) */ }
  // a procedure file changed (main's brain watcher): the Procedure page's list and the open procedure
  try { window.sb.on('procedures:changed', () => client?.invalidate('/api/procedure')); } catch { /* no bridge (tests) */ }
  return client;
}

export interface Loaded<T> {
  data: T | null;
  at: number | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** fetch again; fresh = ask the server to recompute */
  reload: (fresh?: boolean) => void;
}

/** Read one API path (null = nothing yet). `norm` turns the raw answer into the page's shape; pollMs refetches. */
export function useBrain<T>(path: string | null, norm: (v: unknown) => T, { pollMs = 0, maxAgeMs = 20e3 }: { pollMs?: number; maxAgeMs?: number } = {}): Loaded<T> {
  const c = brainClient();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!path) return;
    const off = c.subscribe(path, bump);
    c.ensure(path, maxAgeMs);
    const t = pollMs ? setInterval(() => { if (!document.hidden) void c.get(path); }, pollMs) : null;
    return () => { off(); if (t) clearInterval(t); };
  }, [c, path, pollMs, maxAgeMs]);
  const e = path ? c.peek(path) : undefined;
  const raw = e?.data;
  const data = useMemo(() => (raw == null ? null : norm(raw)), [raw, norm]);
  return {
    data, at: e?.at ?? null, error: e?.error ?? null, loading: !!path && (!e || e.loading), refreshing: !!e?.refreshing,
    reload: (fresh = false) => { if (path) void c.get(path, { fresh }); },
  };
}

/** Several reads at once: loading while any loads, the first error. */
export function combine(...ls: Loaded<unknown>[]): { loading: boolean; error: string | null } {
  return { loading: ls.some(l => l.loading && l.data == null), error: ls.find(l => l.error && l.data == null)?.error ?? null };
}
