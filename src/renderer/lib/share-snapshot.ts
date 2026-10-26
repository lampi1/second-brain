// Reuse unchanged JSON subtrees received over IPC. Routines emit whole snapshots; unrelated UI should not render
// a 600 KB catalog again for an automation heartbeat. Every field is compared, including approval revisions.
export function shareSnapshot<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) return next;
  const old = previous as Record<string, unknown>, fresh = next as Record<string, unknown>;
  const keys = Object.keys(fresh);
  let equal = Object.keys(old).length === keys.length;
  const entries = keys.map(key => {
    const value = shareSnapshot(old[key], fresh[key]);
    if (!Object.hasOwn(old, key) || value !== old[key]) equal = false;
    return [key, value] as const;
  });
  if (equal) return previous;
  return (Array.isArray(next) ? entries.map(([, value]) => value) : Object.fromEntries(entries)) as T;
}
