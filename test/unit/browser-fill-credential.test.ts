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
import { addLoginUrl, Credentials, LinkRefusal, looksProduction } from '../../src/main/browser/logins';
import { Handoffs } from '../../src/main/browser/handoffs';
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
    expect(refusal(creds(), 'luigi', 'https://evil.example.net/login')).toMatch(/is for test-3\.example\.com, and this sign-in form is on evil\.example\.net/);
    // an entry without a url: the user can link this site to it (#429)
    expect(refusal(creds(), 'nourl', 'https://test-3.example.com/login')).toMatch(/without a url.*asked the user.*whether to link test-3\.example\.com/);
    // a port is part of the site: the same name on another port is another site
    expect(refusal(creds(), 'dev', 'http://localhost:9999/login')).toMatch(/is for localhost:4200/);
  });

  it('refuses an unknown account naming the ones of the site, and a site without entries', () => {
    expect(refusal(creds(), 'ghost', 'https://test-3.example.com/login')).toMatch(/no account "ghost".*Entries for test-3\.example\.com: "mario@example\.com", "luigi"/);
    expect(refusal(creds(), '', 'https://nothing.example.net/login')).toMatch(/no entry for nothing\.example\.net.*handoff_to_user/);
    expect(refusal(creds(), 'x', 'about:blank')).toMatch(/not in a web page/);
    expect(refusal(new Credentials(() => null), 'x', 'https://a.example.com/')).toMatch(/no credentials file/);
  });

  it('never types an account that looks like production', () => {
    expect(refusal(creds(), 'boss@example.com', 'https://www.example.com/login')).toMatch(/looks like a production account.*handoff_to_user/);
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
  });
});

// #429, ADR 0317: a test environment that moved host. The refusal offers the user one click to link the page's site to
// the entry; Sì adds the origin to its loginUrl, and the next fill types the account there (and still on the old host).
describe('linking a sign-in page\'s site to an account', () => {
  const writable = (text: string) => {
    const file = { text };
    const c = new Credentials(() => ROOT, () => file.text, (_f, t) => { file.text = t; });
    return { c, file };
  };

  it('a named test account on another host comes with a link offer, never a password; production and twins do not', () => {
    const r = creds().siteCredential('luigi', 'https://test-4.example.com/Account/Login?x=1');
    expect(r).toMatchObject({ link: { user: 'luigi', host: 'test-4.example.com', origin: 'https://test-4.example.com/', sites: ['test-3.example.com'] } });
    expect('refusal' in r && r.refusal).toMatch(/asked the user, with a banner on your tab, whether to link test-4\.example\.com.*handoff_to_user.*Do not navigate to the entry's old host/);
    expect(JSON.stringify(r)).not.toContain('Synthetic-');
    expect(creds().siteCredential('boss@example.com', 'https://test-4.example.com/')).not.toHaveProperty('link');
    const twins = JSON.stringify([{ url: 'https://a.example.com/', username: 'same', password: PW('a') }, { url: 'https://b.example.com/', username: 'same', password: PW('b') }]);
    expect(creds(twins).siteCredential('same', 'https://c.example.com/')).not.toHaveProperty('link');
    expect(refusal(creds(), '', 'https://test-4.example.com/')).toMatch(/call fill_credential with account = its user name: the app asks the user to link/);
    // a production-looking host is never offered: linking it would make the whole entry refused
    expect(creds().siteCredential('luigi', 'https://app.prod.example.com/login')).not.toHaveProperty('link');
  });

  it('Sì writes the origin into that entry\'s loginUrl only; a second site makes it a list; both hosts then sign in', () => {
    const { c, file } = writable(FILE);
    const offer = (c.siteCredential('luigi', 'https://test-4.example.com/login') as { link: { entryId: string; origin: string } }).link;
    expect(c.linkSite(offer.entryId, offer.origin)).toEqual({ ok: true });
    expect(c.siteCredential('luigi', 'https://test-4.example.com/login')).toEqual({ user: 'luigi', password: PW('luigi') });
    expect(c.siteCredential('luigi', 'https://test-3.example.com/login')).toEqual({ user: 'luigi', password: PW('luigi') });
    const luigi = () => (JSON.parse(file.text) as { ExampleApp: { test: Record<string, unknown>[] } }).ExampleApp.test[1]!;
    expect(luigi()).toEqual({ url: 'https://test-3.example.com/', username: 'luigi', password: PW('luigi'), loginUrl: 'https://test-4.example.com/' });
    const again = (c.siteCredential('luigi', 'https://test-5.example.com/') as { link: { entryId: string; origin: string } }).link;
    expect(c.linkSite(again.entryId, again.origin)).toEqual({ ok: true });
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

  it('a file changed meanwhile, or an entry that now looks like production, is not linked', () => {
    const { c, file } = writable(FILE);
    const offer = (c.siteCredential('luigi', 'https://test-4.example.com/login') as { link: { entryId: string; origin: string } }).link;
    file.text = FILE.replace('"luigi"', '"luigi2"');
    expect(c.linkSite(offer.entryId, offer.origin)).toEqual({ error: expect.stringMatching(/changed meanwhile/) });
    expect(new Credentials(() => null).linkSite('x', 'https://a.example.com/')).toEqual({ error: 'there is no credentials file' });
  });

  it('fill_credential opens a «link» banner on the tab and tells the agent to wait on it; the banner holds no password', async () => {
    const { actions: real, tab } = page('https://test-4.example.com/Account/Login');
    let thrown: unknown;
    try { await real.fillCredential(tab, { account: 'luigi', password_ref: 'e12' }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(LinkRefusal);
    const handoffs = new Handoffs(() => {});
    const tabs = { handoffs, tabFor: () => tab, setLastAction: () => {} } as unknown as BrowserTabs;
    const actions = { act: (_t: Tab, _l: string, fn: () => Promise<string>) => fn(), fillCredential: () => Promise.reject(thrown) } as unknown as BrowserActions;
    const tool = browserTools(tabs, actions, () => ({ group: 'chat:c1', owner: 'c1', chatId: 'c1' })).find(t => t.name === 'fill_credential')!;
    await expect(tool.run({ account: 'luigi', password_ref: 'e12' }, { params: {}, signal: new AbortController().signal, progress: () => false } as never)).rejects.toThrow(/handoff_id "h1"/);
    const [h] = handoffs.list();
    expect(h).toMatchObject({ kind: 'link', chatId: 'c1', tabId: 't1', account: { user: 'luigi' }, link: { host: 'test-4.example.com', origin: 'https://test-4.example.com/', sites: ['test-3.example.com'] } });
    expect(JSON.stringify(h)).not.toContain('Synthetic-');
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
      const offer = (c.siteCredential('luigi', 'https://test-4.example.com/') as { link: { entryId: string; origin: string } }).link;
      expect(c.linkSite(offer.entryId, offer.origin)).toEqual({ ok: true });
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(outside, 'utf8')).toContain('https://test-4.example.com/');
      if (process.platform !== 'win32') expect(fs.statSync(outside).mode & 0o777).toBe(0o600);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
