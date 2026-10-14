// A tiny external store for React (useSyncExternalStore) with per-component selectors: a component re-renders only
// when what it selected changed (by `eq`, Object.is by default). Optional frame batching coalesces bursts of updates
// (a streaming chat sends ~15 events a second) into one render per frame. Used by store.ts (data) and ui.ts (UI state).
import { useRef, useSyncExternalStore } from 'react';

export interface Store<S> {
  get(): S;
  set(next: S | ((s: S) => S)): void;
  subscribe(fn: () => void): () => void;
  use<T>(sel: (s: S) => T, eq?: (a: T, b: T) => boolean): T;
}

export function createStore<S>(initial: S, opts: { batch?: boolean } = {}): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  let scheduled = false;
  const notify = () => { scheduled = false; for (const l of [...listeners]) l(); };
  const schedule = () => {
    if (!opts.batch) { notify(); return; }
    if (scheduled) return;
    scheduled = true;
    // a frame when visible; a timer as fallback (hidden windows pause animation frames): 250 ms there, nobody sees
    // the renders a minimized window makes for streamed text ("Lag nell'app", 2026-10-12)
    const t = setTimeout(notify, typeof document !== 'undefined' && document.hidden ? 250 : 50);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { clearTimeout(t); if (scheduled) notify(); });
  };
  const store: Store<S> = {
    get: () => state,
    set(next) {
      const n = typeof next === 'function' ? (next as (s: S) => S)(state) : next;
      if (n === state) return;
      state = n;
      schedule();
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    use<T>(sel: (s: S) => T, eq: (a: T, b: T) => boolean = Object.is): T {
      const cache = useRef<{ s: S; sel: (s: S) => T; v: T } | null>(null);
      const get = () => {
        const s = state;
        const c = cache.current;
        if (c && c.s === s && c.sel === sel) return c.v;
        const v = sel(s);
        if (c && eq(c.v, v)) { cache.current = { s, sel, v: c.v }; return c.v; }
        cache.current = { s, sel, v };
        return v;
      };
      return useSyncExternalStore(store.subscribe, get);
    },
  };
  return store;
}
