// What the personal browser's address bar means (Browser page, ADR 0133): a web address opens as is, a bare host
// ("example.com", "localhost:3000") gets its scheme, anything else is a Google search. Other schemes (javascript:,
// file:, chrome:, data:) are never opened from the bar. Also the user agent of the personal browser: Chromium's own,
// without "Electron/…" and the app's name, so sites (Google sign-in among them) see a plain Chrome. Pure, unit-tested
// (test/unit/personal-address.test.ts); used by personal/browser.ts.

export const SEARCH_URL = 'https://www.google.com/search?q=';

const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(?::\d{1,5})?(?:[/?#].*)?$/i;
const HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#].*)?$/;

/** The page the address bar's text names. */
export function resolveInput(input: unknown): string {
  const s = String(input ?? '').trim().slice(0, 4000);
  if (!s) return 'about:blank';
  if (/^https?:\/\//i.test(s)) { try { return new URL(s).href; } catch { /* a search then */ } }
  if (s === 'about:blank') return s;
  if (!/\s/.test(s)) {
    if (LOCAL.test(s)) return `http://${s}`;
    if (HOST.test(s) || IPV4.test(s)) return `https://${s}`;
  }
  return `${SEARCH_URL}${encodeURIComponent(s)}`;
}

/** Chromium's user agent without the "Electron/x" and "<app>/x" tokens. */
export function cleanUserAgent(ua: string, appName = 'second-brain'): string {
  const esc = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ua.replace(new RegExp(`\\s(?:Electron|${esc})\\/\\S+`, 'gi'), '').replace(/\s{2,}/g, ' ').trim();
}
