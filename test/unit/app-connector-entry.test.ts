// Real loopback HTTP boundary with fake browser/vault: CSRF, one-use routing and direct main-only credential receipt.
import { expect, it, vi } from 'vitest';
import { credentialEntry } from '../../src/modules/onboarding/credential-entry';
it('serves no scripts/secrets and refuses cross-origin submission before a valid one-use save', async () => {
  let reveal!: (url: string) => void;
  const opened = new Promise<string>(resolve => { reveal = resolve; });
  const save = vi.fn(async () => {});
  const abort = new AbortController();
  const operation = credentialEntry(async url => { reveal(url); }, save, abort.signal);
  const url = await opened, origin = new URL(url).origin;
  try {
    const page = await fetch(url);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await page.text()).not.toContain('<script');
    expect((await fetch(`${origin}/unknown`)).status).toBe(404);
    const payload = new URLSearchParams({ site: 'https://example.atlassian.net', email: 'user@example.com', token: 'synthetic-browser-token' });
    expect((await fetch(url, { method: 'POST', headers: { Origin: 'https://attacker.test' }, body: payload })).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
    const response = await fetch(url, { method: 'POST', headers: { Origin: origin }, body: payload });
    expect(response.status).toBe(200); expect(await response.text()).not.toContain('synthetic-browser-token');
    await operation;
    expect(save).toHaveBeenCalledExactlyOnceWith({ site: 'https://example.atlassian.net', email: 'user@example.com', token: 'synthetic-browser-token' });
  } finally { abort.abort(); await operation.catch(() => {}); }
});
it('closes the browser handoff on explicit cancellation without saving', async () => {
  const abort = new AbortController(), save = vi.fn(async () => {});
  await expect(credentialEntry(async () => { abort.abort(); }, save, abort.signal)).rejects.toThrow('annullato');
  expect(save).not.toHaveBeenCalled();
});
it('settles an accepted vault save even when the browser disconnects before its response', async () => {
  let reveal!: (url: string) => void, saving!: () => void, release!: () => void;
  const opened = new Promise<string>(resolve => { reveal = resolve; });
  const received = new Promise<void>(resolve => { saving = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const operation = credentialEntry(async url => { reveal(url); }, async () => { saving(); await gate; });
  const url = await opened, browser = new AbortController();
  const response = fetch(url, { method: 'POST', signal: browser.signal, headers: { Origin: new URL(url).origin }, body: new URLSearchParams({ site: 'https://example.atlassian.net', email: 'user@example.com', token: 'synthetic-browser-token' }) }).catch(() => null);
  await received; browser.abort(); await response; release();
  await expect(operation).resolves.toBeUndefined();
});
