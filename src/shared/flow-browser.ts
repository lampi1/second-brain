// Exact browser-origin declarations and reported effects shared by routine validation, UI and browser guards.
export interface BrowserWriteResult { outcome: 'done' | 'partial' | 'not-done'; evidence: string[] }
/** Origins only, never patterns, credentials, paths, queries, fragments or opaque URLs. */
export function browserOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 16) throw new Error('browserTargets: 1–16 exact HTTPS origins (HTTP only on localhost)');
  const out = value.map(raw => {
    if (typeof raw !== 'string' || raw.length > 300) throw new Error('browserTargets: invalid origin');
    let u: URL; try { u = new URL(raw); } catch { throw new Error('browserTargets: invalid origin'); }
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || raw !== u.origin || u.hostname.includes('*') ||
      !(u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('browserTargets: exact HTTPS origins only, without paths, credentials or wildcards (HTTP only on localhost)');
    return u.origin;
  });
  if (new Set(out).size !== out.length) throw new Error('browserTargets: duplicate origin');
  return out;
}
export function browserWriteResult(value: unknown): BrowserWriteResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('browserWrite: outcome and read-back/screenshot evidence required');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['outcome', 'evidence'].includes(k)) || !['done', 'partial', 'not-done'].includes(String(v.outcome)) ||
    !Array.isArray(v.evidence) || !v.evidence.length || v.evidence.length > 12 || v.evidence.some(e => typeof e !== 'string' || !e.trim() || e.length > 2000)) throw new Error('browserWrite: outcome done|partial|not-done and 1–12 nonempty evidence strings (max 2000 chars each)');
  return { outcome: v.outcome as BrowserWriteResult['outcome'], evidence: v.evidence.map(e => (e as string).trim()) };
}
