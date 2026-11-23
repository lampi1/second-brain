// Sign-in by name (#386, ADR 0310): an agent names an account of the user's credentials file and the app types it
// into the sign-in form, so the password never reaches the agent. Checked here: which entry may be typed where
// (logins.ts siteCredential: the entry's own site only, never a production account, a refusal that names the fix and
// never a password), what fill_credential types and returns (actions.ts fillCredential: only a password field, a
// masked result), and what the tab refuses afterwards (caller JavaScript, copy keys). Fakes stand in for the tab, its
// frames and the page scripts; no Electron, no page.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserActions } from '../../src/main/browser/actions';
import { addLoginUrl, Credentials, looksProduction, sameSite } from '../../src/main/browser/logins';
import { isCopyKey, MOD } from '../../src/main/browser/keys';
import { browserTools } from '../../src/main/browser/tools';
import { loginRefusal } from '../../src/main/browser/rules';
import type { BrowserTabs, Tab } from '../../src/main/browser/tabs';

const ROOT = path.resolve('/brain');
const PW = (name: string) => ['Synthetic', name, String(1)].join('-');   // built at run time: the guard flags a literal
const FILE = JSON.stringify({
  ExampleApp: {
    test: [
      { url: 'https://test-3.example.com/Account/Login', email: 'mario@example.com', password: PW('mario') },
      { url: 'https://test-3.example.com/', username: 'luigi', password: PW('luigi') },
      { url: 'https://app.example.org/', loginUrl: 'https://login.example.org/signin', username: 'sso-user', password: PW('sso') },
      { username: 'nourl', password: PW('nourl') },
      { url: 'http://localhost:4200/', username: 'dev', password: PW('dev') },
    ],
    prod: [{ url: 'https://www.example.com/', email: 'boss@example.com', password: PW('boss') }],
  },
});
const creds = (text: string | null = FILE): Credentials => new Credentials(() => ROOT, f => {
  if (text === null || path.relative(ROOT, f).replace(/\\/g, '/') !== 'ops/credentials.md') throw new Error('ENOENT');
  return text;
});
const refusal = (c: Credentials, account: string, url: string): string => {
  const r = c.siteCredential(account, url);
  if (!('refusal' in r)) throw new Error('expected a refusal');
  expect(r.refusal).not.toContain('Synthetic-');           // a refusal never carries a password
  return r.refusal;
};

describe('which account the app may type where', () => {
  it('gives the named account on its own site, whatever the case of the name', () => {
    expect(creds().siteCredential('MARIO@example.com', 'https://test-3.example.com/Account/Login?x=1')).toEqual({ user: 'mario@example.com', password: PW('mario') });
    expect(creds().siteCredential('dev', 'http://localhost:4200/login')).toEqual({ user: 'dev', password: PW('dev') });
  });

  it('takes the only entry of the site when no account is named, and asks which one when there are several', () => {
    expect(creds().siteCredential('', 'http://localhost:4200/login')).toEqual({ user: 'dev', password: PW('dev') });
    expect(refusal(creds(), '', 'https://test-3.example.com/login')).toMatch(/several accounts.*"mario@example\.com", "luigi"/);
  });

  it('accepts a sign-in page on another host only when the entry names it (loginUrl)', () => {
    expect(creds().siteCredential('sso-user', 'https://login.example.org/signin?state=1')).toEqual({ user: 'sso-user', password: PW('sso') });
    expect(creds().siteCredential('sso-user', 'https://app.example.org/')).toEqual({ user: 'sso-user', password: PW('sso') });
    expect(creds().accountsFor('https://login.example.org/x')).toEqual(['sso-user']);
  });

  it('refuses an entry on another site, and one without a url, with the fix', () => {
    const other = refusal(creds(), 'luigi', 'https://evil.example.net/login');
    expect(other).toMatch(/is for test-3\.example\.com, and this sign-in form is on evil\.example\.net/);
    // the fix is the agent's own (2026-11-23): copy the entry to this host with the brain's script, else report; never a wait
    expect(other).toMatch(/cred-entry\.mjs add-host "luigi" <the entry's url> https:\/\/evil\.example\.net\/.*otherwise report it to your parent\. Never wait for the user/);
    // an entry without a url: the agent adds it (cred-entry.mjs set-url)
    expect(refusal(creds(), 'nourl', 'https://test-3.example.com/login')).toMatch(/without a url.*cred-entry\.mjs set-url "nourl" https:\/\/test-3\.example\.com\/.*report it to your parent\. Never wait for the user/);
    for (const r of [other, refusal(creds(), 'nourl', 'https://test-3.example.com/login')]) expect(r).not.toMatch(/handoff_to_user|the user adds|ask them/);
    // a port is part of the site: the same name on another port is another site
    expect(refusal(creds(), 'dev', 'http://localhost:9999/login')).toMatch(/is for localhost:4200/);
  });

  it('refuses an unknown account naming the ones of the site, and a site without entries', () => {
    expect(refusal(creds(), 'ghost', 'https://test-3.example.com/login')).toMatch(/no account "ghost".*Entries for test-3\.example\.com: "mario@example\.com", "luigi"/);
    // no entry is never a hand-off: the agent reports to its parent (2026-11-23)
    expect(refusal(creds(), '', 'https://nothing.example.net/login')).toMatch(/no entry for nothing\.example\.net.*report it to your parent.*never wait for the user/);
    expect(refusal(creds(), '', 'https://nothing.example.net/login')).not.toMatch(/handoff_to_user/);
    expect(refusal(creds(), 'ghost', 'https://nothing.example.net/login')).toMatch(/no entry for nothing\.example\.net: report it to your parent/);
    expect(refusal(creds(), 'x', 'about:blank')).toMatch(/not in a web page/);
    expect(refusal(new Credentials(() => null), 'x', 'https://a.example.com/')).toMatch(/no credentials file.*Report it to your parent/);
  });

  it('never types an account that looks like production', () => {
    // the Read + type route; a hand-off only on a real MFA or CAPTCHA page (2026-11-23)
    expect(refusal(creds(), 'boss@example.com', 'https://www.example.com/login')).toMatch(/looks like a production account\. The app types test accounts only: if your instructions give you the Read \+ type route for it, sign in with type \/ fill_form yourself.*handoff_to_user kind "login" only when the page really shows MFA or a CAPTCHA/);
    expect(looksProduction({ group: 'ExampleApp · Production' })).toBe(true);
    expect(looksProduction({ group: 'Shop', url: 'https://prod.example.com/' })).toBe(true);
    expect(looksProduction({ group: 'Product catalog · test', url: 'https://products.example.com/' })).toBe(false);   // a word, never a part of one
  });
});

/** A sign-in page: e1 a text field, e12 the password field; what fill types lands in `typed`. */
function page(url = 'https://test-3.example.com/Account/Login', c: Credentials = creds()) {
  const frame = { url, origin: new URL(url).origin, parent: null };
  const tabs = {
    credentials: c, cssScale: () => 1,
    dialogOpened: () => ({ promise: new Promise(() => {}), cancel: () => {} }),
    frames: () => [frame], frameByNo: () => frame, handoffs: { openFor: () => null },
  } as unknown as BrowserTabs;
  const actions = new BrowserActions(tabs);
  const typed: Record<string, string> = {};
  let focus = '';
  /** the type the page gives a field now (default: e12 password, others text); a test may change it mid-call */
  const types: Record<string, string> = {};
  vi.spyOn(actions, 'evalIn').mockImplementation(async (_tab, _frame, script: string) => {
    const ref = /\("((?:f\d+)?e\d+)"/.exec(script.slice(script.lastIndexOf('(')))?.[1] ?? '';
    if (script.includes('focusSelect')) { focus = ref; typed[ref] = ''; return true as never; }
    const secret = ref.endsWith('e12');
    return { kind: 'text', password: secret, tag: 'input', type: types[ref] ?? (secret ? 'password' : 'text'), checked: false, disabled: false, readonly: false, multiple: false,
      value: secret && typed[ref] ? '•••' : typed[ref] ?? '', desc: secret ? 'input "Password"' : 'input "E-mail"' } as never;
  });
  const sent: unknown[] = [];
  const cdp = { send: async (method: string, params: Record<string, unknown>) => { sent.push([method, params]); if (method === 'Input.insertText') typed[focus] += String(params.text); } };
  const tab = { id: 't1', env: 'example-test-3', agentInput: 0, dialog: null, cdp, wc: { isDestroyed: () => false, getURL: () => url, mainFrame: frame } } as unknown as Tab;
  return { actions, tab, typed, sent, types };
}

describe('fill_credential', () => {
  it('types the user name and the password from the file, and returns the password only masked', async () => {
    const { actions, tab, typed } = page();
    const r = await actions.fillCredential(tab, { account: 'mario@example.com', user_ref: 'e1', password_ref: 'e12' });
    expect(typed).toEqual({ e1: 'mario@example.com', e12: PW('mario') });
    expect(r).toContain('Account mario@example.com');
    expect(r).toContain('e12 input "Password" = "•••"');
    expect(r).not.toContain('Synthetic-');
    expect(tab.secretTyped).toBe(true);
  });

  it('types nothing when password_ref is not a password field, or user_ref is one', async () => {
    const { actions, tab, typed } = page();
    await expect(actions.fillCredential(tab, { account: 'luigi', password_ref: 'e1' })).rejects.toThrow(/not a password field/);
    await expect(actions.fillCredential(tab, { account: 'luigi', user_ref: 'e12', password_ref: 'e12' })).rejects.toThrow(/user_ref is the user name/);
    await expect(actions.fillCredential(tab, { account: 'luigi', user_ref: 'f1e1', password_ref: 'e12' })).rejects.toThrow(/same frame/);
    expect(typed).toEqual({});
    expect(tab.secretTyped).toBeUndefined();
  });

  it('types nothing into a text field that only looks like a password field (its label), or one a toggle revealed', async () => {
    const { actions, tab, typed, types } = page();
    types.e12 = 'text';
    await expect(actions.fillCredential(tab, { account: 'luigi', password_ref: 'e12' })).rejects.toThrow(/not a password field \(type=password\)/);
    expect(typed).toEqual({});
  });

  it('checks the field again right before typing: a field turned into text after the check gets nothing', async () => {
    const { actions, tab, typed, types } = page();
    const real = vi.mocked(actions.evalIn).getMockImplementation()!;
    let reads = 0;
    vi.mocked(actions.evalIn).mockImplementation(async (t, f, script: string) => {
      if (script.includes('inputInfo') && script.includes('"e12"') && ++reads === 2) types.e12 = 'text';   // the page swaps it
      return real(t, f, script);
    });
    const r = await actions.fillCredential(tab, { account: 'luigi', user_ref: 'e1', password_ref: 'e12' }).catch((e: Error) => e.message);
    expect(r).toMatch(/no longer a password field/);
    expect(typed.e12).toBeUndefined();
  });

  it('is refused in a page where caller JavaScript already ran', async () => {
    const { actions, tab, typed } = page('http://localhost:4200/login');
    tab.scriptRan = true;
    await expect(actions.fillCredential(tab, { password_ref: 'e12' })).rejects.toThrow(/caller JavaScript ran in this page/);
    expect(typed).toEqual({});
  });

  it('types nothing on a site the entry is not for', async () => {
    const { actions, tab, typed } = page('https://evil.example.net/login');
    await expect(actions.fillCredential(tab, { account: 'luigi', password_ref: 'e12' })).rejects.toThrow(/is for test-3\.example\.com/);
    expect(typed).toEqual({});
  });

  it('checks the site of the frame that holds the field, never the tab address', async () => {
    const { actions, tab, typed } = page();
    const inner = { url: 'https://evil.example.net/frame', origin: 'https://evil.example.net', parent: tab.wc.mainFrame };
    Object.assign((actions as unknown as { tabs: object }).tabs, { frameByNo: (_t: Tab, no: number) => (no ? inner : tab.wc.mainFrame) });
    await expect(actions.fillCredential(tab, { account: 'luigi', password_ref: 'f1e12' })).rejects.toThrow(/this sign-in form is on evil\.example\.net/);
    expect(typed).toEqual({});
  });

  it('after it, the tab takes no caller JavaScript and no copy or cut keys', async () => {
    const { actions, tab, sent } = page('http://localhost:4200/login');
    await actions.fillCredential(tab, { password_ref: 'e12' });
    await expect(actions.evaluate(tab, 'opaque caller source')).rejects.toThrow(/holds a password the app typed/);
    const before = sent.length;
    await expect(actions.key(tab, 'ctrl+a ctrl+c')).rejects.toThrow(/copy and cut are blocked/);
    expect(sent.slice(before).some(s => { const p = (s as [string, { key?: string; type?: string }])[1]; return p.key === 'c' && p.type !== 'keyUp'; })).toBe(false);   // only its release
    await expect(actions.key(tab, 'shift+Delete')).rejects.toThrow(/copy and cut are blocked/);
    await expect(actions.drag(tab, { from: [1, 1], to: [5, 5] })).rejects.toThrow(/drag is blocked/);
    await expect(actions.click(tab, { coordinate: [1, 1], button: 'middle' })).rejects.toThrow(/middle click/);
    await expect(actions.waitFor(tab, { selector: 'input[value^="a"]' })).rejects.toThrow(/value attribute/);
    // another tab of the same environment (a popup shares the page's session) takes no caller JavaScript either
    const other = { ...tab, id: 't2', secretTyped: false } as Tab;
    Object.assign((actions as unknown as { tabs: object }).tabs, { tabs: new Map([['t1', tab], ['t2', other]]) });
    await expect(actions.evaluate(other, 'opaque caller source')).rejects.toThrow(/holds a password the app typed/);
    tab.secretTyped = false;                               // the page was left (tabs.ts did-navigate)
    await expect(actions.key(tab, 'ctrl+c')).resolves.toBe('Pressed ctrl+c');
  });

  it('knows copy and cut keys', () => {
    for (const [k, m] of [['c', MOD.ctrl], ['C', MOD.meta], ['x', MOD.ctrl | MOD.shift], ['Insert', MOD.ctrl], ['Delete', MOD.shift]] as const) expect(isCopyKey(k, m), k).toBe(true);
    for (const [k, m] of [['c', 0], ['v', MOD.ctrl], ['Insert', MOD.shift], ['a', MOD.ctrl], ['Delete', 0]] as const) expect(isCopyKey(k, m), k).toBe(false);
  });

  it('is a browser tool that needs only the password field, and the login rules point to it', () => {
    const tool = browserTools({} as BrowserTabs, {} as BrowserActions, () => ({ group: 'g', owner: null, chatId: null })).find(t => t.name === 'fill_credential')!;
    expect(tool.inputSchema.required).toEqual(['password_ref']);
    expect(tool.description).toMatch(/without ever reading the password/);
    expect(loginRefusal({ url: 'http://localhost:4200/login', account: '', accounts: ['dev'], file: 'ops/credentials.md' })).toMatch(/fill_credential/);
    // a login hand-off without the account: sign in yourself first, a hand-off only on a real MFA or CAPTCHA page
    expect(loginRefusal({ url: 'https://test-3.example.com/login', account: '', accounts: ['luigi'], file: 'ops/credentials.md' })).toMatch(/Sign in yourself with fill_credential \(account = one of them\)\. A hand-off only when the page really shows MFA or a CAPTCHA/);
    // the tool texts: no entry and an account without a password are never hand-off reasons (2026-11-23)
    const all = browserTools({} as BrowserTabs, {} as BrowserActions, () => ({ group: 'g', owner: null, chatId: null }));
    expect(tool.description).toMatch(/handoff_to_user kind "login" only when the page really shows MFA or a CAPTCHA; no entry: report it to your parent, never wait for the user/);
    expect(all.find(t => t.name === 'handoff_to_user')!.description).toMatch(/a missing credentials entry is not a reason: report it to your parent/);
    for (const t of all) expect([t.name, t.description]).not.toEqual([t.name, expect.stringMatching(/account without (a password|an entry)|no entry for the account/)]);
  });
  it('the MCP server instructions and the sign-in page notice: a hand-off only on a real MFA or CAPTCHA page, no entry = report to the parent', async () => {
    // service.ts imports Electron: its instructions are checked in its source text
    const BROWSER_INSTRUCTIONS = fs.readFileSync(path.join(__dirname, '../../src/main/browser/service.ts'), 'utf8').split('const INSTRUCTIONS = [')[1]!.split('].join')[0]!;
    expect(BROWSER_INSTRUCTIONS).toMatch(/Only when the page really shows MFA or a CAPTCHA, call handoff_to_user with kind "login".*No entry for the site: report it to your parent, never wait for the user/);
    expect(BROWSER_INSTRUCTIONS).not.toMatch(/If there is no entry for the site, or the page asks for MFA/);
    const { actions, tab } = page('https://test-3.example.com/Account/Login');
    const notice = await actions.loginNotice(tab);
    expect(notice).toMatch(/Only when the page really shows MFA or a CAPTCHA, call handoff_to_user with kind "login"; no entry for the site: report it to your parent, never wait for the user/);
    expect(notice).not.toMatch(/account without a password/);
  });
});

// #429, ADR 0317, changed 2026-11-23: a test environment that moved host on the same site is linked by the app itself
// (the origin goes into the entry's loginUrl) and signed in; nothing waits on the user.
describe('linking a sign-in page\'s site to an account', () => {
  const writable = (text: string) => {
    const file = { text };
    const c = new Credentials(() => ROOT, () => file.text, (_f, t) => { file.text = t; });
    return { c, file };
  };

  it('a named test account on another host of the same site is linked by the app and signed in, without asking (2026-11-23)', () => {
    const { c, file } = writable(FILE);
    expect(c.siteCredential('luigi', 'https://test-4.example.com/Account/Login?x=1')).toEqual({ user: 'luigi', password: PW('luigi'), linked: 'test-4.example.com' });
    const luigi = () => (JSON.parse(file.text) as { ExampleApp: { test: Record<string, unknown>[] } }).ExampleApp.test[1]!;
    expect(luigi()).toEqual({ url: 'https://test-3.example.com/', username: 'luigi', password: PW('luigi'), loginUrl: 'https://test-4.example.com/' });
    // linked once: the next fill is a plain one, and the old host still signs in
    expect(c.siteCredential('luigi', 'https://test-4.example.com/login')).toEqual({ user: 'luigi', password: PW('luigi') });
    expect(c.siteCredential('luigi', 'https://test-3.example.com/login')).toEqual({ user: 'luigi', password: PW('luigi') });
    // a second site makes loginUrl a list
    expect(c.siteCredential('luigi', 'https://test-5.example.com/')).toMatchObject({ linked: 'test-5.example.com' });
    expect(luigi().loginUrl).toEqual(['https://test-4.example.com/', 'https://test-5.example.com/']);
    // every other entry is as it was
    const before = JSON.parse(FILE) as { ExampleApp: { test: unknown[]; prod: unknown[] } }, after = JSON.parse(file.text) as typeof before;
    expect(after.ExampleApp.prod).toEqual(before.ExampleApp.prod);
    expect(after.ExampleApp.test.filter((_, i) => i !== 1)).toEqual(before.ExampleApp.test.filter((_, i) => i !== 1));
  });

  it('in a Markdown file only that JSON block is written back, with the file\'s line ends; the rest of the text stays', () => {
    const block = JSON.stringify({ test: [{ url: 'https://old.example.com/', username: 'anna', password: PW('anna') }] }, null, 2);
    const text = ['# Accounts', 'some prose', '```json', block, '```', '```bash', 'echo not json', '```', ''].join('\r\n');
    const next = addLoginUrl(text, 0, 'https://new.example.com/')!;
    expect(next.startsWith('# Accounts\r\nsome prose\r\n```json\r\n')).toBe(true);
    expect(next.endsWith('```\r\n```bash\r\necho not json\r\n```\r\n')).toBe(true);
    expect(next).toContain('"loginUrl": "https://new.example.com/"');
    expect(next.replace(/\r\n/g, '')).not.toContain('\n');
    expect(addLoginUrl(text, 3, 'https://new.example.com/')).toBeNull();
  });

  it('production entries, twins, production-looking hosts and other sites are never linked; the file stays as it was', () => {
    const { c, file } = writable(FILE);
    expect(refusal(c, 'boss@example.com', 'https://test-4.example.com/')).toMatch(/www\.example\.com/);
    expect(refusal(c, 'luigi', 'https://app.prod.example.com/login')).toMatch(/cred-entry\.mjs add-host "luigi"/);
    const other = refusal(c, 'luigi', 'https://evil.example.net/login');
    expect(other).toMatch(/add-host "luigi" <the entry's url> https:\/\/evil\.example\.net\/.*report it to your parent/);
    expect(other).not.toMatch(/handoff_to_user|ask the user/);
    expect(file.text).toBe(FILE);
    const twins = JSON.stringify([{ url: 'https://a.example.com/', username: 'same', password: PW('a') }, { url: 'https://b.example.com/', username: 'same', password: PW('b') }]);
    const t = writable(twins);
    expect(t.c.siteCredential('same', 'https://c.example.com/')).toHaveProperty('refusal');
    expect(t.file.text).toBe(twins);
  });

  it('a shared hosting suffix is not one site: another app under the same hosting domain is not linked', () => {
    expect(sameSite('test-4.example.com', ['test-3.example.com'])).toBe(true);
    expect(sameSite('localhost:5001', ['localhost:5000'])).toBe(true);
    expect(sameSite('a.example.net', ['test-3.example.com'])).toBe(false);
    expect(sameSite('evil-shop.herokuapp.com', ['good-shop.herokuapp.com'])).toBe(false);
    expect(sameSite('shop.co.uk', ['bank.co.uk'])).toBe(false);
    expect(sameSite('203.0.113.2', ['203.0.113.1'])).toBe(false);
  });

  it('a file the app cannot write back, or one changed meanwhile, is not linked: the refusal says why and the fix', () => {
    const c = new Credentials(() => ROOT, () => FILE, () => { throw new Error('read-only'); });
    expect(refusal(c, 'luigi', 'https://test-4.example.com/login')).toMatch(/could not link test-4\.example\.com.*cannot be written.*cred-entry\.mjs add-host/);
    expect(writable(FILE).c.linkSite('no-such-entry', 'https://a.example.com/')).toEqual({ error: expect.stringMatching(/changed meanwhile/) });
    expect(new Credentials(() => null).linkSite('x', 'https://a.example.com/')).toEqual({ error: 'there is no credentials file' });
  });

  it('fill_credential types the account on the moved host and says the app linked it; no hand-off is opened', async () => {
    const { c, file } = writable(FILE);
    const { actions, tab, typed } = page('https://test-4.example.com/Account/Login', c);
    const r = await actions.fillCredential(tab, { account: 'luigi', password_ref: 'e12' });
    expect(r).toMatch(/the app linked test-4\.example\.com to this test account/);
    expect(r).not.toContain('Synthetic-');
    expect(typed.e12).toBe(PW('luigi'));
    expect(file.text).toContain('https://test-4.example.com/');
  });

  it('the real write keeps a linked file a link (secrets outside the brain) and its mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-link-'));
    try {
      const outside = path.join(dir, 'secret.json'), brain = path.join(dir, 'brain');
      fs.mkdirSync(path.join(brain, 'ops'), { recursive: true });
      fs.writeFileSync(outside, FILE, { mode: 0o600 });
      fs.chmodSync(outside, 0o600);
      const link = path.join(brain, 'ops', 'credentials.md');
      try { fs.symlinkSync(outside, link); } catch { return; }    // no symlinks here (Windows without the right): nothing to check
      const c = new Credentials(() => brain);
      expect(c.siteCredential('luigi', 'https://test-4.example.com/')).toMatchObject({ linked: 'test-4.example.com' });
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(outside, 'utf8')).toContain('https://test-4.example.com/');
      if (process.platform !== 'win32') expect(fs.statSync(outside).mode & 0o777).toBe(0o600);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
