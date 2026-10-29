// Single-entry caches for values derived from the store's immutable state. Why: every store notify (about once a frame
// while a chat streams) re-runs every subscriber's selector, and many selectors walk all of `s.chats` (archived chats
// included); keyed by the arguments' identity, N components share one computation per state change, and a notify that
// changed only `items` (streamed text) costs a reference compare. The arguments must be immutable (the store's state
// is): a mutated object would read its old result. Used by lib/chat-derived.ts, lib/child-requests.ts; pinned by
// test/unit/memo.test.ts.

/** `fn` remembered for its last arguments (compared with Object.is, one by one). */
export function memoLast<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { args: A; value: R } | null = null;
  return (...args: A): R => {
    if (last && last.args.length === args.length && last.args.every((a, i) => Object.is(a, args[i]))) return last.value;
    const value = fn(...args);
    last = { args, value };
    return value;
  };
}

/** `fn(o, key)` remembered per key for the last `o` only (a new `o` starts an empty table): one tree, N tiles. */
export function memoPerKey<O extends object, R>(fn: (o: O, key: string) => R): (o: O, key: string) => R {
  let last: { o: O; values: Map<string, R> } | null = null;
  return (o: O, key: string): R => {
    if (!last || last.o !== o) last = { o, values: new Map() };
    if (last.values.has(key)) return last.values.get(key)!;
    const value = fn(o, key);
    last.values.set(key, value);
    return value;
  };
}

/** Records equal key by key (values by identity): for selectors that build a small map. */
export function sameRecord<V>(a: Readonly<Record<string, V>>, b: Readonly<Record<string, V>>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
}
