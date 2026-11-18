// `relogin: false` on a routine browser call (issue #434, ADR 0321; packages/routine-runtime/src/browser-mcp.ts): the
// call never signs in, a page that lands on a login page is left there and the reply says so; the login page can be
// read (screenshot with its password fields emptied first) but never scripted; the next call without the flag signs in
// again as always, and the declared origins still hold. The session runs on a fake page (no browser, no port, no
// timer): a site with one login page whose session the test ends as a sign-out in another tab would.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLEAR_PASSWORDS_SCRIPT, createBrowserSession, LEFT_ON_LOGIN, type BrowserServerConfig } from '../../../packages/routine-runtime/src/browser-mcp';
import type { BrowserPage } from '../../../packages/routine-runtime/src/browser-page';
import { tempDir } from './fakes';

const LOGIN = 'https://app.test/Account/Login', HOME = 'https://app.test/home';

/** The fake site and the session on it. `sso`: the login page signs in by itself and leaves (so no form is driven). */
function open() {
  const s = { session: false, sso: true, url: 'about:blank', gotos: [] as string[], cleared: 0, clearOk: true, onClick: () => {} };
  const land = (url: string) => {
    if (url.split('?')[0] === LOGIN) { if (s.sso) s.session = true; s.url = s.session ? HOME : url; }
    else s.url = s.session ? url : `${LOGIN}?ReturnUrl=%2Fhome`;
  };
  const page = {
    url: () => s.url, title: async () => 'App',
    goto: async (url: string) => { s.gotos.push(url); land(url); },
    reload: async () => { land(s.url); }, goBack: async () => { land(s.url); }, goForward: async () => { land(s.url); },
    waitForLoadState: async () => {}, waitForTimeout: async () => {},
    evaluate: async (script: string) => (script === CLEAR_PASSWORDS_SCRIPT ? (s.cleared += 1, s.clearOk) : { marked: [] }),
    screenshot: async (o: { path?: string }) => { if (o.path) fs.writeFileSync(o.path, 'png'); return Buffer.from('png'); },
    locator: () => ({ click: async () => { s.onClick(); } }),
    context: () => ({ clearCookies: async () => { s.session = false; }, pages: () => [page], on: () => undefined }),
    on: () => undefined, isClosed: () => false,
  };
  const dir = tempDir('routine-relogin-');
  const config: BrowserServerConfig = { origins: ['https://app.test'], profileDir: path.join(dir, 'profile'), evidence: path.join(dir, 'evidence'), headless: true, logins: [{ loginUrl: LOGIN, user: 'u', password: 'p-secret' }] };
  const session = createBrowserSession(config, { page: async () => page as unknown as BrowserPage });
  let id = 0;
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> => {
    const r = await session.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) as { result: { content: { text: string }[]; isError?: boolean } };
    return { text: r.result.content[0]!.text, isError: r.result.isError === true };
  };
  /** the session ends as a sign-out in another tab would: the next page of the site is its login page, which stays */
  const signOut = () => { s.session = false; s.sso = false; };
  return { s, call, signOut, dir };
}

describe('routine browser: relogin false leaves the login page to be read', () => {
  it('a reload after the session ended stays on the login page and says so; nothing signs in', async () => {
    const { s, call, signOut, dir } = open();
    expect((await call('navigate', { url: HOME })).text).toContain(`Now at ${HOME}`);
    expect(s.gotos).toEqual([LOGIN, HOME]);
    signOut();
    const r = await call('history', { action: 'reload', relogin: false });
    expect(r.isError).toBe(false);
    expect(r.text).toContain(`Now at ${LOGIN}`);
    expect(r.text.endsWith(LEFT_ON_LOGIN)).toBe(true);
    expect(s.gotos).toEqual([LOGIN, HOME]);
    // the login page is read, never scripted
    expect(await call('eval', { expression: 'document.title' })).toMatchObject({ isError: true, text: expect.stringMatching(/never runs on a login page/) });
    const shot = await call('screenshot', { name: 'login-seen' });
    expect(shot.isError).toBe(false);
    expect(s.cleared).toBe(1);
    expect(fs.existsSync(path.join(dir, 'evidence', 'login-seen.png'))).toBe(true);
    s.clearOk = false;
    expect(await call('screenshot', { name: 'login-held' })).toMatchObject({ isError: true, text: expect.stringMatching(/could not be emptied/) });
    expect(fs.existsSync(path.join(dir, 'evidence', 'login-held.png'))).toBe(false);
    expect(s.gotos).toEqual([LOGIN, HOME]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('navigate with relogin false opens the URL as the site serves it, the login page included, inside the declared origins', async () => {
    const { s, call, signOut, dir } = open();
    signOut();
    const home = await call('navigate', { url: HOME, relogin: false });
    expect(home.text).toContain(`Now at ${LOGIN}`);
    expect(home.text.endsWith(LEFT_ON_LOGIN)).toBe(true);
    const own = await call('navigate', { url: LOGIN, relogin: false });
    expect(own.text.endsWith(LEFT_ON_LOGIN)).toBe(true);
    // each URL opened once, as asked: no visit to the login page on the runtime's own account
    expect(s.gotos).toEqual([HOME, LOGIN]);
    expect(await call('navigate', { url: 'https://other.test/', relogin: false })).toMatchObject({ isError: true, text: expect.stringMatching(/Not allowed/) });
    expect(s.gotos).toEqual([HOME, LOGIN]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the flag holds for one call: the next call signs in again, and a signed-in page gets no note', async () => {
    const { s, call, signOut, dir } = open();
    await call('navigate', { url: HOME });
    // signed in: relogin false changes nothing and adds nothing to the reply
    const still = await call('history', { action: 'reload', relogin: false });
    expect(still.text).toContain(`Now at ${HOME}`);
    expect(still.text).not.toContain('login page');
    signOut();
    await call('history', { action: 'reload', relogin: false });
    expect(s.url.startsWith(LOGIN)).toBe(true);
    s.sso = true;
    const back = await call('navigate', { url: HOME });
    expect(back).toMatchObject({ isError: false, text: expect.stringContaining(`Now at ${HOME}`) });
    expect(back.text).not.toContain('login page');
    expect(s.gotos).toEqual([LOGIN, HOME, HOME, LOGIN]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a click that ends the session: left on the login page with relogin false, signed in again without it', async () => {
    const { s, call, dir } = open();
    await call('navigate', { url: HOME });
    s.onClick = () => { s.session = false; s.url = `${LOGIN}?ReturnUrl=%2Fhome`; };
    const out = await call('click', { ref: 'e1', relogin: false });
    expect(out).toMatchObject({ isError: false, text: expect.stringContaining('Clicked') });
    expect(out.text.endsWith(LEFT_ON_LOGIN)).toBe(true);
    expect(s.gotos).toEqual([LOGIN, HOME]);
    // the same click as always: the runtime signs in again from the stored login page
    const again = await call('click', { ref: 'e1' });
    expect(again.isError).toBe(false);
    expect(again.text).not.toContain('login page');
    expect(s.gotos).toEqual([LOGIN, HOME, LOGIN]);
    expect(s.session).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
