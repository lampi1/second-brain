// `relogin: false` on a routine browser call (issue #434, ADR 0321; packages/routine-runtime/src/browser-mcp.ts): the
// call never signs in, a page that lands on a login page is left there and the reply says so; the login page can be
// read (screenshot with its password fields emptied first) but never scripted; the next call without the flag signs in
// again as always, and the declared origins still hold. And the host side of the guards on a password `fill_secret`
// wrote: the field is marked before it is filled, and a marked field is a password field for type, press, the
// accessibility snapshot and the screenshot; and after an eval no password is written until the only tab is loaded anew. The session runs on a fake page (no browser, no port, no timer): a site
// with one login page whose session the test ends as a sign-out in another tab would; the in-page scripts are answered
// by the fake.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBrowserSession, LEFT_ON_LOGIN, type BrowserServerConfig } from '../../../packages/routine-runtime/src/browser-mcp';
import { CLEAR_PASSWORDS_SCRIPT, PASSWORD_HELD_SCRIPT, SECRET_FOCUS_SCRIPT, SECRET_MARK, SECRET_SHOWN_SCRIPT, type BrowserPage } from '../../../packages/routine-runtime/src/browser-page';
import { tempDir } from './fakes';

const LOGIN = 'https://app.test/Account/Login', HOME = 'https://app.test/home';
// a made-up value of the named credential, built at run time (the repo guard refuses secret-shaped literals)
const FAKE = ['fake', 'value', String(process.pid)].join('-');

/** The fake site and the session on it. `sso`: the login page signs in by itself and leaves (so no form is driven). */
function open() {
  const s = { session: false, sso: true, url: 'about:blank', gotos: [] as string[], cleared: 0, clearOk: true, onClick: () => {},
    keys: [] as string[], onKey: () => {}, held: false, shown: false, focusSecret: false, reloads: 0, onReload: () => {},
    /** the other open tabs: whether each holds a password, and whether it was closed */
    tabs: [] as { held: boolean; closed: boolean }[],
    /** the one field the fake locator finds: its attributes, its value, and what was done to it in order */
    field: { attrs: { type: 'text' } as Record<string, string>, value: '', did: [] as string[] } };
  const land = (url: string) => {
    if (url.split('?')[0] === LOGIN) { if (s.sso) s.session = true; s.url = s.session ? HOME : url; }
    else s.url = s.session ? url : `${LOGIN}?ReturnUrl=%2Fhome`;
  };
  const element = { tagName: 'INPUT', getAttribute: (k: string) => s.field.attrs[k] ?? null, hasAttribute: (k: string) => k in s.field.attrs,
    setAttribute: (k: string, v: string) => { s.field.attrs[k] = v; s.field.did.push(`mark ${k}`); } };
  const scripts = new Map<string, () => unknown>([[CLEAR_PASSWORDS_SCRIPT, () => (s.cleared += 1, s.clearOk)], [PASSWORD_HELD_SCRIPT, () => s.held], [SECRET_SHOWN_SCRIPT, () => s.shown], [SECRET_FOCUS_SCRIPT, () => s.focusSecret]]);
  const page = {
    url: () => s.url, title: async () => 'App',
    goto: async (url: string) => { s.gotos.push(url); land(url); },
    reload: async () => { s.reloads += 1; land(s.url); s.onReload(); }, goBack: async () => { land(s.url); }, goForward: async () => { land(s.url); },
    waitForLoadState: async () => {}, waitForTimeout: async () => {},
    evaluate: async (script: string) => (scripts.get(script) ?? (() => ({ marked: [] })))(),
    ariaSnapshot: async () => '- textbox',
    screenshot: async (o: { path?: string }) => { if (o.path) fs.writeFileSync(o.path, 'png'); return Buffer.from('png'); },
    keyboard: { press: async (key: string) => { s.keys.push(key); s.onKey(); } },
    locator: () => ({
      click: async () => { s.onClick(); }, setChecked: async () => { s.onClick(); },
      evaluate: async (fn: (e: unknown) => unknown) => fn(element),
      press: async (key: string) => { s.keys.push(`field:${key}`); },
      fill: async (value: string) => { s.field.value = value; s.field.did.push('fill'); },
      dragTo: async () => { s.field.did.push('drag'); },
      pressSequentially: async (text: string) => { s.field.value += text; },
    }),
    context: () => ({ clearCookies: async () => { s.session = false; }, on: () => undefined,
      pages: () => [page, ...s.tabs.map(tab => ({ isClosed: () => tab.closed, close: async () => { tab.closed = true; }, evaluate: async () => tab.held }))] }),
    on: () => undefined, isClosed: () => false,
  };
  const dir = tempDir('routine-relogin-');
  const config: BrowserServerConfig = { origins: ['https://app.test'], profileDir: path.join(dir, 'profile'), evidence: path.join(dir, 'evidence'), headless: true,
    logins: [{ loginUrl: LOGIN, user: 'u', password: 'p-secret' }, { id: 'admin', loginUrl: LOGIN, user: 'a', password: FAKE }] };
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
    // that login counts as signed out: the navigation starts from its login page, as a step's first visit does
    expect(s.gotos).toEqual([LOGIN, HOME, LOGIN, HOME]);
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

  it('press takes the flag too; a tool that does not take it signs in as always; a failed call drops the flag', async () => {
    const { s, call, dir } = open();
    await call('navigate', { url: HOME });
    const end = () => { s.session = false; s.url = `${LOGIN}?ReturnUrl=%2Fhome`; };
    s.onKey = end;
    const pressed = await call('press', { key: 'Enter', relogin: false });
    expect(pressed.text.endsWith(LEFT_ON_LOGIN)).toBe(true);
    expect(s.gotos).toEqual([LOGIN, HOME]);
    // check is not one of the five: the flag is ignored and the runtime signs in again
    s.session = true; s.url = HOME; s.onClick = end;
    const checked = await call('check', { ref: 'e1', relogin: false });
    expect(checked).toMatchObject({ isError: false, text: expect.stringContaining('Checked') });
    expect(checked.text).not.toContain('login page');
    expect(s.gotos).toEqual([LOGIN, HOME, LOGIN]);
    // a call that fails with the flag leaves no flag behind: the next reload signs in again
    s.onClick = () => { throw new Error('element is not visible'); };
    expect(await call('click', { ref: 'e1', relogin: false })).toMatchObject({ isError: true, text: expect.stringContaining('element is not visible') });
    s.session = false;
    const reloaded = await call('history', { action: 'reload' });
    expect(reloaded).toMatchObject({ isError: false, text: expect.stringContaining(`Now at ${HOME}`) });
    expect(s.gotos).toEqual([LOGIN, HOME, LOGIN, LOGIN]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('routine browser: a password fill_secret wrote stays unreadable', () => {
  it('fill_secret marks the field before it fills it, and never fills a text field', async () => {
    const { s, call, dir } = open();
    expect(await call('fill_secret', { ref: 'e1', credential: 'admin' })).toMatchObject({ isError: true, text: expect.stringMatching(/only password fields/) });
    expect(s.field.did).toEqual([]);
    s.field.attrs.type = 'password';
    const filled = await call('fill_secret', { ref: 'e1', credential: 'admin' });
    expect(filled.isError).toBe(false);
    expect(filled.text).not.toContain(FAKE);
    expect(s.field.did).toEqual([`mark ${SECRET_MARK}`, 'fill']);
    expect(s.field.value).toBe(FAKE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a marked field is a password field even as a text field: no typing, only Tab, Enter and Escape', async () => {
    const { s, call, dir } = open();
    // the page's "show password" toggle made it a text field; the mark stays
    s.field.attrs = { type: 'text', [SECRET_MARK]: '' };
    expect(await call('type', { ref: 'e1', text: 'x' })).toMatchObject({ isError: true, text: expect.stringMatching(/password fields are filled only/) });
    expect(await call('press', { ref: 'e1', key: 'Backspace' })).toMatchObject({ isError: true, text: expect.stringMatching(/only Tab, Shift\+Tab, Enter or Escape/) });
    expect((await call('press', { ref: 'e1', key: 'Enter' })).isError).toBe(false);
    // by focus too: fill leaves the focus in the field
    s.focusSecret = true;
    expect(await call('press', { key: 'Backspace' })).toMatchObject({ isError: true, text: expect.stringMatching(/only Tab, Shift\+Tab, Enter or Escape/) });
    expect(await call('press', { key: 'Control+c' })).toMatchObject({ isError: true });
    expect((await call('press', { key: 'Tab' })).isError).toBe(false);
    expect(s.keys).toEqual(['field:Enter', 'Tab']);
    expect(s.field.value).toBe('');
    // an ordinary field takes both
    s.focusSecret = false; s.field.attrs = { type: 'text' };
    expect((await call('press', { ref: 'e1', key: 'Backspace' })).isError).toBe(false);
    expect((await call('type', { ref: 'e1', text: 'hello' })).isError).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('no accessibility tree while a password is held, no screenshot while one shows in clear', async () => {
    const { s, call, dir } = open();
    expect((await call('snapshot', { aria: true })).isError).toBe(false);
    s.held = true;
    expect(await call('snapshot', { aria: true })).toMatchObject({ isError: true, text: expect.stringMatching(/accessibility tree would show it/) });
    expect(await call('eval', { expression: '1' })).toMatchObject({ isError: true });
    s.shown = true;
    expect(await call('screenshot', { name: 'shown' })).toMatchObject({ isError: true, text: expect.stringMatching(/shown in clear/) });
    expect(fs.existsSync(path.join(dir, 'evidence', 'shown.png'))).toBe(false);
    s.shown = false;
    expect((await call('screenshot', { name: 'hidden' })).isError).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('routine browser: no password is written beside code an eval may have left', () => {
  it('after an eval fill_secret is refused until the only tab is reloaded', async () => {
    const { s, call, dir } = open();
    await call('navigate', { url: HOME });
    s.field.attrs = { type: 'password' };
    expect(await call('eval', { expression: '1' })).toMatchObject({ isError: false });
    expect(await call('fill_secret', { ref: 'e1', credential: 'admin' })).toMatchObject({ isError: true, text: expect.stringMatching(/eval ran in this browser/) });
    expect(s.field.did).toEqual([]);
    // a second tab is open: the reload of this one is not enough (that tab may hold a handle to it)
    s.tabs.push({ held: false, closed: false });
    await call('history', { action: 'reload' });
    expect((await call('fill_secret', { ref: 'e1', credential: 'admin' })).isError).toBe(true);
    s.tabs[0]!.closed = true;
    await call('history', { action: 'reload' });
    expect(await call('fill_secret', { ref: 'e1', credential: 'admin' })).toMatchObject({ isError: false });
    expect(s.field.value).toBe(FAKE);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a reload during which a tab opens does not count', async () => {
    const { s, call, dir } = open();
    await call('navigate', { url: HOME });
    s.field.attrs = { type: 'password' };
    await call('eval', { expression: '1' });
    s.onReload = () => { s.tabs.push({ held: false, closed: false }); s.onReload = () => {}; };
    await call('history', { action: 'reload' });
    expect((await call('fill_secret', { ref: 'e1', credential: 'admin' })).isError).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a login after an eval closes the other tabs and loads its page anew before it signs in', async () => {
    const { s, call, dir } = open();
    await call('navigate', { url: HOME });
    s.tabs.push({ held: false, closed: false }, { held: false, closed: false });
    await call('eval', { expression: '1' });
    const before = s.reloads;
    expect(await call('login', { credential: 'admin' })).toMatchObject({ isError: false });
    expect(s.tabs.map(tab => tab.closed)).toEqual([true, true]);
    expect(s.reloads).toBe(before + 1);
    // clean again: fill_secret works
    s.field.attrs = { type: 'password' };
    expect((await call('fill_secret', { ref: 'e1', credential: 'admin' })).isError).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a login is not done while tabs keep opening beside it; without an eval the other tabs stay', async () => {
    const { s, call, dir } = open();
    await call('navigate', { url: HOME });
    s.tabs.push({ held: false, closed: false });
    expect((await call('login', { credential: 'admin' })).isError).toBe(false);
    expect(s.tabs[0]!.closed).toBe(false);
    await call('eval', { expression: '1' });
    s.onReload = () => { s.tabs.push({ held: false, closed: false }); };
    expect(await call('login', { credential: 'admin' })).toMatchObject({ isError: true, text: expect.stringMatching(/Login not done/) });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('eval is refused while another open tab holds a password; a password field is never dragged; Shift+Tab leaves it', async () => {
    const { s, call, dir } = open();
    await call('navigate', { url: HOME });
    s.tabs.push({ held: true, closed: false });
    expect(await call('eval', { expression: '1' })).toMatchObject({ isError: true, text: expect.stringMatching(/another open tab holds a value/) });
    s.field.attrs = { type: 'text', [SECRET_MARK]: '' };
    expect(await call('drag', { from: 'e1', to: 'e2' })).toMatchObject({ isError: true, text: expect.stringMatching(/never dragged/) });
    expect(s.field.did).toEqual([]);
    expect((await call('press', { ref: 'e1', key: 'Shift+Tab' })).isError).toBe(false);
    s.field.attrs = { type: 'text' };
    expect((await call('drag', { from: 'e1', to: 'e2' })).isError).toBe(false);
    expect(s.field.did).toEqual(['drag']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
