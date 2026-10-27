// The routine browser (packages/routine-runtime/src/browser-mcp.ts) against a local fixture login page, in a real
// headless Chromium: the runtime logs in itself from the stored loginUrl (?mode=local kept after a redirect) before a
// step's first navigation, turns the bare origin into that login, re-logs in after the session ends (the redirect to a
// portal on another origin included), keeps the agent inside the declared origins, refuses password fields, masks the credential
// and saves screenshots into the step's evidence folder + events.jsonl. Skipped when no Chromium/Edge is installed.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bareOrigin, createBrowserSession, credentialFor, launchBrowser, launchOnProfile, loginFailedText, loginFor, loginPageFor, profileHolders, type BrowserServerConfig, type ProfileRecovery } from '../../../packages/routine-runtime/src/browser-mcp';
import { classifyLoginForm, inspectLoginForm, type LoginFormFacts } from '../../../packages/routine-runtime/src/login-form';
import { parseRoutinePackage } from '../../../packages/routine-runtime/src/index';
import { FIXTURE_PASSWORD, FIXTURE_USER, FIXTURE_USER2, startFixtureSite } from './fixture-site';
const TESTER_PASSWORD = 'tester-Pass-5521';
import { tempDir } from './fakes';

const browserAvailable = (() => {
  try {
    const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : path.join(process.env.HOME ?? '', '.cache', 'ms-playwright');
    if (fs.existsSync(local) && fs.readdirSync(local).some(d => d.startsWith('chromium'))) return true;
    return process.platform === 'win32' && fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  } catch { return false; }
})();

type Reply = { result?: { content: { text: string }[]; isError?: boolean } };

describe('routine browser format', () => {
  const base = { format: 'second-brain-routine', schemaVersion: 1 };
  it('a browser step needs routine.browser.origins; origins are origins only', () => {
    const steps = [{ id: 'a', title: 'A', prompt: 'p', browser: true }];
    expect(() => parseRoutinePackage({ ...base, routine: { id: 'r', title: 'R', steps } })).toThrow(/browser.origins/);
    expect(() => parseRoutinePackage({ ...base, routine: { id: 'r', title: 'R', steps, browser: { origins: ['https://a.test/x'] } } })).toThrow(/origin only/);
    const pkg = parseRoutinePackage({ ...base, routine: { id: 'r', title: 'R', steps, browser: { origins: ['https://a.test'] } } });
    expect(pkg.routine.browser).toEqual({ origins: ['https://a.test'] });
    expect(pkg.routine.steps[0]!.browser).toBe(true);
  });
  it('the login page is matched by origin and path, whatever the query', () => {
    const logins = [{ loginUrl: 'https://a.test/Account/Login?mode=local', user: 'u', password: 'p' }];
    expect(loginFor({ logins }, 'https://a.test/Account/Login?ReturnUrl=%2Fhome')).toBe(logins[0]);
    expect(loginFor({ logins }, 'https://a.test/home')).toBeNull();
    expect(loginFor({ logins }, 'https://b.test/Account/Login')).toBeNull();
  });
  it('the portal login (same path, another origin) is a login page of the site the agent wanted', () => {
    const a = { loginUrl: 'https://a.test/Account/Login?mode=local', user: 'u', password: 'p' };
    const b = { loginUrl: 'https://b.test/Account/Login?mode=local', user: 'v', password: 'q' };
    expect(loginPageFor({ logins: [a] }, 'https://portal.test/Account/Login')).toBe(a);
    expect(loginPageFor({ logins: [a, b] }, 'https://portal.test/Account/Login', b)).toBe(b);
    expect(loginPageFor({ logins: [a, b] }, 'https://portal.test/Account/Login')).toBeNull();
    expect(loginPageFor({ logins: [a] }, 'https://portal.test/home')).toBeNull();
    expect(credentialFor({ logins: [a, b] }, 'https://b.test/x')).toBe(b);
    expect(credentialFor({ logins: [a] }, 'https://c.test/')).toBeNull();
    expect(bareOrigin('https://a.test/')).toBe(true);
    expect(bareOrigin('https://a.test')).toBe(true);
    expect(bareOrigin('https://a.test/?x=1')).toBe(false);
    expect(bareOrigin('https://a.test/home')).toBe(false);
  });
});

describe.skipIf(!browserAvailable)('routine browser over a node that redirects to its portal (Air without ?mode=local)', () => {
  let site: Awaited<ReturnType<typeof startFixtureSite>>;
  let browser: Awaited<ReturnType<typeof launchBrowser>>;
  let config: BrowserServerConfig;
  let seq = 0;
  const callOn = async (session: ReturnType<typeof createBrowserSession>, name: string, args: Record<string, unknown> = {}) => {
    const r = await session.handle({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } }) as Reply;
    return { text: r.result!.content[0]!.text, isError: r.result!.isError === true };
  };
  const newStep = () => createBrowserSession(config, { page: async () => browser.page });

  beforeAll(async () => {
    site = await startFixtureSite({ portal: true });
    const dir = tempDir();
    config = {
      origins: [site.origin], profileDir: path.join(dir, 'profile'), evidence: path.join(dir, 'evidence'),
      headless: true, logins: [{ loginUrl: `${site.origin}/Account/Login?mode=local`, user: FIXTURE_USER, password: FIXTURE_PASSWORD }],
    };
    browser = await launchBrowser(config);
  }, 60_000);
  afterAll(async () => { await browser?.close(); await site?.close(); }, 30_000);

  it('a navigate to the bare origin with no session is the login via ?mode=local, never the portal', async () => {
    const nav = await callOn(newStep(), 'navigate', { url: `${site.origin}/` });
    expect(nav.isError).toBe(false);
    expect(nav.text).toContain(`${site.origin}/home`);
    expect(site.logins).toBe(1);
    expect(site.portalHits).toBe(0);
  }, 60_000);

  it("a step's first navigation logs in from the loginUrl first, then opens the page", async () => {
    const nav = await callOn(newStep(), 'navigate', { url: `${site.origin}/form` });
    expect(nav.isError).toBe(false);
    expect(nav.text).toContain(`${site.origin}/form`);
    expect(site.logins).toBe(2);
    expect(site.portalHits).toBe(0);
  }, 60_000);

  it('a landing on the portal login (another origin) logs in again via ?mode=local and returns to the page', async () => {
    const step = newStep();
    expect((await callOn(step, 'navigate', { url: `${site.origin}/home` })).isError).toBe(false);
    expect(site.logins).toBe(3);
    await callOn(step, 'navigate', { url: `${site.origin}/logout` });
    const nav = await callOn(step, 'navigate', { url: `${site.origin}/form` });
    expect(site.portalHits).toBe(1); // the redirect really went to the portal
    expect(nav.isError).toBe(false);
    expect(nav.text).toContain(`${site.origin}/form`);
    expect(site.logins).toBe(4);
    expect((await callOn(step, 'snapshot')).text).not.toContain('Login - Portal');
  }, 60_000);

  it('a wrong credential is a login error on the node, never a page left on the portal', async () => {
    const bad = createBrowserSession({ ...config, logins: [{ ...config.logins[0]!, password: 'wrong' }] }, { page: async () => browser.page });
    await callOn(newStep(), 'navigate', { url: `${site.origin}/logout` });
    const nav = await callOn(bad, 'navigate', { url: `${site.origin}/form` });
    expect(nav.isError).toBe(true);
    expect(nav.text).toMatch(/login failed \[still-on-login\]/);
    expect(nav.text).not.toContain(FIXTURE_USER);
    expect(nav.text).not.toContain('wrong');
  }, 60_000);

  it('a failed login saves one screenshot to evidence/ with the password field already emptied', async () => {
    const bad = createBrowserSession({ ...config, logins: [{ ...config.logins[0]!, password: 'wrong-again' }] }, { page: async () => browser.page });
    await callOn(newStep(), 'navigate', { url: `${site.origin}/logout` });
    const nav = await callOn(bad, 'navigate', { url: `${site.origin}/form` });
    const file = /Screenshot of the page: (.+?\.png)\./.exec(nav.text)?.[1];
    expect(file && path.dirname(file)).toBe(config.evidence);
    expect(fs.statSync(file!).size).toBeGreaterThan(1000);
    expect(browser.page.url()).toContain('/Account/Login');
    expect(await browser.page.evaluate<string>('document.getElementById("txtPassword").value')).toBe('');
  }, 60_000);
});

describe.skipIf(!browserAvailable)('routine browser over a fixture login page', () => {
  let site: Awaited<ReturnType<typeof startFixtureSite>>;
  let browser: Awaited<ReturnType<typeof launchBrowser>>;
  let config: BrowserServerConfig;
  let session: ReturnType<typeof createBrowserSession>;
  let dir: string;
  let seq = 0;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await session.handle({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } }) as Reply;
    return { text: r.result!.content[0]!.text, isError: r.result!.isError === true };
  };

  beforeAll(async () => {
    site = await startFixtureSite();
    dir = tempDir();
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
    config = {
      origins: [site.origin], profileDir: path.join(dir, 'profile'), evidence: path.join(dir, 'evidence'), events: { file: path.join(dir, 'events.jsonl'), n: 1 },
      headless: true, logins: [{ loginUrl: `${site.origin}/Account/Login?mode=local`, user: FIXTURE_USER, password: FIXTURE_PASSWORD },
        { id: 'tester', loginUrl: `${site.origin}/Account/Login?mode=local`, user: 'set-by-the-step', password: TESTER_PASSWORD }],
    };
    browser = await launchBrowser(config);
    session = createBrowserSession(config, { page: async () => browser.page, now: () => 42 });
  }, 60_000);
  afterAll(async () => { await browser?.close(); await site?.close(); }, 30_000);

  it('logs in by itself (stored ?mode=local), lands where the agent asked, masks the password', async () => {
    const nav = await call('navigate', { url: `${site.origin}/home` });
    expect(nav.isError).toBe(false);
    expect(nav.text).toContain(`${site.origin}/home`);
    expect(site.logins).toBe(1);
    const snap = await call('snapshot');
    expect(snap.text).toContain('Agenda');
    expect(snap.text).toContain('debug: ***');
    expect(snap.text).not.toContain(FIXTURE_PASSWORD);
  }, 60_000);

  it('re-logs in after the session ended', async () => {
    await call('navigate', { url: `${site.origin}/logout` });
    const nav = await call('navigate', { url: `${site.origin}/form` });
    expect(nav.isError).toBe(false);
    expect(nav.text).toContain(`${site.origin}/form`);
    expect(site.logins).toBe(2);
  }, 60_000);

  it('types text, refuses password fields, selects options', async () => {
    const snap = await call('snapshot');
    const ref = (label: string) => new RegExp(`\\[(e\\d+)\\] [^\\n]*${label}`).exec(snap.text)?.[1];
    expect(await call('type', { ref: ref('Note'), text: 'hello' })).toMatchObject({ isError: false });
    expect(await call('type', { ref: ref('New password'), text: 'x' })).toMatchObject({ isError: true });
    expect(await call('select_option', { ref: ref('select'), value: 'b' })).toMatchObject({ isError: false });
    expect((await call('snapshot')).text).toMatch(/= hello/);
  }, 60_000);

  it('stays inside the declared origins', async () => {
    const other = site.origin.replace('127.0.0.1', 'localhost');
    expect(await call('navigate', { url: `${other}/home` })).toMatchObject({ isError: true });
    expect(await call('navigate', { url: 'file:///C:/Windows/win.ini' })).toMatchObject({ isError: true });
  }, 60_000);

  it('saves a screenshot into the evidence folder and events.jsonl', async () => {
    const shot = await call('screenshot', { name: 'form page' });
    const file = path.join(config.evidence, 'form_page.png');
    expect(shot.text).toContain(file);
    expect(fs.statSync(file).size).toBeGreaterThan(1000);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim())).toEqual({ type: 'screenshot', at: 42, n: 1, path: file });
  }, 60_000);

  it("recognises Air's real login form (<input type=button> login button) in a real browser", async () => {
    await browser.page.goto(`${site.origin}/Account/Login?mode=local`, { waitUntil: 'load' });
    const facts = await browser.page.evaluate<LoginFormFacts>(`(${inspectLoginForm.toString()})().facts`);
    expect(facts).toMatchObject({ passwords: 1, users: 1, bare: true, submits: [], buttons: ['btnlogin access'] });
    expect(classifyLoginForm(facts, site.origin)).toEqual({ mode: 'ajax', button: 0 });
    expect(classifyLoginForm({ ...facts, buttons: [] }, site.origin)).toBeNull(); // what the runtime saw before the fix
  }, 60_000);

  it('a second user: toggles a hidden checkbox, sets its password with fill_secret, logs in as it, next step is the default again', async () => {
    await call('navigate', { url: `${site.origin}/users` });
    const ref = (text: string, label: string) => new RegExp(`\\[(e\\d+)\\] [^\\n]*${label}`).exec(text)?.[1];
    const snap = (await call('snapshot')).text;
    expect(snap).toMatch(/input\[checkbox\] "Stampa" = on/);
    await call('click', { ref: ref(snap, 'Stampa') });
    expect((await call('snapshot')).text).toMatch(/"Stampa" = off/);
    expect(await call('fill_secret', { ref: ref(snap, 'Password of'), credential: 'nope' })).toMatchObject({ isError: true });
    expect(await call('fill_secret', { ref: ref(snap, 'Save'), credential: 'tester' })).toMatchObject({ isError: true });
    const filled = await call('fill_secret', { ref: ref(snap, 'Password of'), credential: 'tester' });
    expect(filled).toEqual({ isError: false, text: `Filled ${ref(snap, 'Password of')} with the password of credential tester.` });
    await call('click', { ref: ref(snap, 'Save') });
    for (let i = 0; i < 40 && await browser.page.evaluate<string>('document.getElementById("saved").textContent') !== 'saved'; i++) await browser.page.waitForTimeout(100);
    const as = await call('login', { credential: 'tester', user: FIXTURE_USER2 });
    expect(as.isError).toBe(false);
    expect(as.text).toContain(`Signed in as ${FIXTURE_USER2}`);
    await call('navigate', { url: `${site.origin}/home` });
    const home = (await call('snapshot')).text;
    expect(home).toContain(`Welcome ${FIXTURE_USER2}`);
    expect(home + as.text + filled.text).not.toContain(TESTER_PASSWORD);
    const next = createBrowserSession(config, { page: async () => browser.page });
    const callOn = async (s: typeof next, name: string, args: Record<string, unknown> = {}) => ((await s.handle({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } })) as Reply).result!.content[0]!;
    await callOn(next, 'navigate', { url: `${site.origin}/home` });
    expect((await callOn(next, 'snapshot')).text).toContain(`Welcome ${FIXTURE_USER} `);
  }, 60_000);
});

describe('login failure text', () => {
  it('names the reason code and its detail, never a value', () => {
    expect(loginFailedText({ ok: false, reason: 'unrecognised-form', detail: 'no visible login button in the form' }, 'C:/e/login-failed.png'))
      .toBe('The site login failed [unrecognised-form]: the login form is not one the runtime may fill (no visible login button in the form). Screenshot of the page: C:/e/login-failed.png. Report it as needs-human.');
    expect(loginFailedText({ ok: false, reason: 'driver-error' })).toMatch(/^The site login failed \[driver-error\]: [^(]+\. Report it as needs-human\.$/);
  });
});

describe('launch on a profile held by a leftover browser', () => {
  const recovery = (held: number[][], killed: number[]): ProfileRecovery => ({
    holders: async () => held.shift() ?? [],
    kill: pid => { killed.push(pid); },
    wait: async () => undefined,
  });
  const closed = () => new Error('browserType.launchPersistentContext: Target page, context or browser has been closed\nlogs…');

  it('ends the leftover browser of this profile, removes the stale lock and retries once', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'lockfile'), '');
    const killed: number[] = [];
    let launches = 0;
    const ctx = await launchOnProfile(dir, async () => { if (++launches === 1) throw closed(); return 'context'; }, recovery([[4242, 4243], []], killed));
    expect(ctx).toBe('context');
    expect(launches).toBe(2);
    expect(killed).toEqual([4242, 4243]);
    expect(fs.existsSync(path.join(dir, 'lockfile'))).toBe(false);
  });

  it('a stale lock alone is removed and retried; still failing = one clear error, no third launch', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'lockfile'), '');
    let launches = 0;
    await expect(launchOnProfile(dir, async () => { launches++; throw closed(); }, recovery([], [])))
      .rejects.toThrow(/found a stale lock \(lockfile\), removed, retried once, still failing: browserType.launchPersistentContext: Target page, context or browser has been closed\. Close any browser/);
    expect(launches).toBe(2);
  });

  it('nothing holds the profile: no retry, the error names the profile', async () => {
    const dir = tempDir();
    let launches = 0;
    await expect(launchOnProfile(dir, async () => { launches++; throw closed(); }, recovery([], [])))
      .rejects.toThrow(/no leftover browser or lock file found there/);
    expect(launches).toBe(1);
  });

  it('matches only browsers opened on exactly this profile folder', () => {
    const dir = path.join(tempDir(), 'profile');
    const win = dir.replace(/\//g, '\\');
    expect(profileHolders([
      { pid: 1, cmd: `"msedge.exe" --user-data-dir=${win} --remote-debugging-pipe` },
      { pid: 2, cmd: `"msedge.exe" "--user-data-dir=${win}" --type=renderer` },
      { pid: 3, cmd: `"msedge.exe" --user-data-dir=${win}2 --remote-debugging-pipe` },
      { pid: 4, cmd: '"msedge.exe" --profile-directory=Default' },
      { pid: 5, cmd: `chrome --user-data-dir=${dir}` },
    ], dir)).toEqual([1, 2, 5]);
  });
});
