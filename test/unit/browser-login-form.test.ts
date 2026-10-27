// Host routine login rules (login-form.ts) and their Electron call site (site-login.ts) against a small fake DOM that
// mimics Air's AJAX login page (#loginForm without method/action, #btnLogin type=button posting via script) and a
// classic POST form. Checks: AJAX accepted, POST still accepted, foreign origin refused, ok/fail only, no password leak.
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIR_LOGIN_SUCCESS, classifyLoginForm, driveLogin, inspectLoginForm, loginSucceeded, type LoginFormFacts, type LoginPageDriver, type LoginPlan } from '../../src/main/browser/login-form';
import { siteLogin, siteLoginScript } from '../../src/main/browser/site-login';
import { log } from '../../src/main/log';
import type { BrowserTabs, Tab } from '../../src/main/browser/tabs';
import type { SiteVault } from '../../src/main/browser/site-vault';

const AIR = 'https://air.example.test';
const SECRET = ['fixture', 'ajax', 'value'].join('-'); // built at run time: the guard refuses secret-shaped literals

// ---- a minimal DOM: just what inspectLoginForm and the login script touch ----
class El {
  tag: string; attrs: Record<string, string>; form: Form | null = null; text = ''; disabled = false; isConnected = true;
  onclick: (() => void) | null = null; clicks = 0;
  constructor(tag: string, attrs: Record<string, string> = {}) { this.tag = tag; this.attrs = { ...attrs }; }
  get id() { return this.attrs.id ?? ''; }
  get type() { return this.attrs.type ?? (this.tag === 'button' ? 'submit' : 'text'); }
  get textContent() { return this.text; }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k]! : null; }
  hasAttribute(k: string) { return k in this.attrs; }
  getBoundingClientRect() { return { width: 10, height: 10 }; }
  dispatchEvent() { return true; }
  click() { this.clicks++; this.onclick?.(); }
  matches(sel: string): boolean {
    return sel.split(',').some(one => {
      const m = /^(\w+)(?::not\(\[(\w+)\]\)|\[(\w+)="([^"]*)"\])?$/.exec(one.trim());
      if (!m || m[1] !== this.tag) return false;
      if (m[2]) return !this.hasAttribute(m[2]);
      if (m[3]) return m[3] === 'type' ? this.type === m[4] : this.attrs[m[3]] === m[4];
      return true;
    });
  }
}
class Input extends El { private v = ''; get value() { return this.v; } set value(x: string) { this.v = x; } }
class Form extends El {
  children: El[] = []; submitted: El | null = null; base: string;
  constructor(attrs: Record<string, string>, base: string) { super('form', attrs); this.base = base; }
  get method() { return (this.attrs.method ?? 'get').toLowerCase(); }
  get action() { return new URL(this.attrs.action ?? '', this.base).href; }
  get target() { return this.attrs.target ?? ''; }
  querySelectorAll(sel: string) { return this.children.filter(c => c.matches(sel)); }
  add(...els: El[]) { for (const e of els) { e.form = this; this.children.push(e); } return this; }
}

interface Page { world: Record<string, unknown>; form: Form; user: Input; pw: Input; button: El; posted: string[] }
/** Air-like page: the login button's script posts to /api/Authentication/Login and, if `ok`, leaves /Account/Login. */
function airPage(href = `${AIR}/Account/Login?mode=local`, ok = true, extraButtons: El[] = []): Page {
  const form = new Form({ id: 'loginForm' }, href);
  const user = new Input('input', { id: 'txtEmail', type: 'text' }), pw = new Input('input', { id: 'txtPassword', type: 'password' });
  const button = new El('button', { id: 'btnLogin', type: 'button' }); button.text = 'Accedi';
  form.add(user, pw, button, ...extraButtons);
  const posted: string[] = [];
  const location = { href, origin: new URL(href).origin };
  button.onclick = () => { posted.push(`/api/Authentication/Login user=${user.value}`); if (ok) { location.href = `${location.origin}/`; } };
  const world = pageWorld(location, [pw]);
  return { world, form, user, pw, button, posted };
}
function postPage(href = `${AIR}/login`): Page {
  const form = new Form({ method: 'post', action: '/login' }, href);
  const user = new Input('input', { type: 'email' }), pw = new Input('input', { type: 'password' }), button = new El('button', {});
  form.add(user, pw, button);
  const location = { href, origin: new URL(href).origin };
  return { world: pageWorld(location, [pw]), form, user, pw, button, posted: [] };
}
function pageWorld(location: { href: string; origin: string }, passwords: Input[]): Record<string, unknown> {
  class HTMLFormElement { requestSubmit(this: Form, by: El) { this.submitted = by; } }
  return {
    location, URL, Event: class { constructor(..._a: unknown[]) { /* fake */ } },
    document: { querySelectorAll: (sel: string) => (sel === 'input[type="password"]' ? passwords : []) },
    HTMLInputElement: Input, HTMLElement: El, HTMLFormElement,
  };
}
const run = (p: Page, origin = AIR) => vm.runInNewContext(siteLoginScript(origin, 'tester', SECRET), p.world) as unknown;
const factsOf = (p: Page): LoginFormFacts => vm.runInNewContext(`(${inspectLoginForm.toString()})().facts`, p.world) as LoginFormFacts;

describe('classifyLoginForm', () => {
  it('accepts the AJAX form (no method/action, one type=button login button)', () => {
    expect(classifyLoginForm(factsOf(airPage()), AIR)).toEqual({ mode: 'ajax', button: 0 });
  });
  it('still accepts a classic same-origin POST form', () => {
    expect(classifyLoginForm(factsOf(postPage()), AIR)).toEqual({ mode: 'post' });
  });
  it('refuses a form on a foreign origin', () => {
    expect(classifyLoginForm(factsOf(airPage('https://evil.example.test/Account/Login')), AIR)).toBeNull();
    expect(classifyLoginForm(factsOf(postPage('https://evil.example.test/login')), AIR)).toBeNull();
  });
  it('refuses AJAX look-alikes that could send the password elsewhere or are ambiguous', () => {
    const withAttr = (k: string, v: string) => { const p = airPage(); p.form.attrs[k] = v; return classifyLoginForm(factsOf(p), AIR); };
    expect(withAttr('method', 'get')).toBeNull();          // a GET form would put the password in the URL
    expect(withAttr('action', '/x')).toBeNull();
    expect(withAttr('target', '_blank')).toBeNull();
    const cross = postPage(); cross.form.attrs.action = 'https://evil.example.test/login';
    expect(classifyLoginForm(factsOf(cross), AIR)).toBeNull();
    const eye = new El('button', { id: 'btnShow', type: 'button' }), help = new El('button', { id: 'btnHelp', type: 'button' });
    expect(classifyLoginForm(factsOf(airPage(undefined, true, [eye])), AIR)).toEqual({ mode: 'ajax', button: 0 }); // "Accedi" wins
    const p = airPage(undefined, true, [eye, help]); p.button.text = ''; p.button.attrs.id = 'go';
    expect(classifyLoginForm(factsOf(p), AIR)).toBeNull();
  });
});

describe('loginSucceeded', () => {
  it('Air: done when the URL leaves /Account/Login on the same origin', () => {
    expect(loginSucceeded({ url: `${AIR}/Account/Login?mode=local` }, AIR_LOGIN_SUCCESS, AIR)).toBe(false);
    expect(loginSucceeded({ url: `${AIR}/account/login` }, AIR_LOGIN_SUCCESS, AIR)).toBe(false);
    expect(loginSucceeded({ url: `${AIR}/` }, AIR_LOGIN_SUCCESS, AIR)).toBe(true);
    expect(loginSucceeded({ url: 'https://sso.example.test/' }, AIR_LOGIN_SUCCESS, AIR)).toBe(false);
  });
  it('selector rule', () => {
    expect(loginSucceeded({ url: `${AIR}/`, selectorFound: true }, { selector: '#userMenu' }, AIR)).toBe(true);
    expect(loginSucceeded({ url: `${AIR}/`, selectorFound: false }, { selector: '#userMenu' }, AIR)).toBe(false);
  });
});

describe('driveLogin (page-driver flow for a terminal runtime)', () => {
  const driver = (p: Page, calls: unknown[]): LoginPageDriver => ({
    url: async () => (p.world.location as { href: string }).href,
    navigate: async url => { calls.push(['navigate', url]); },
    facts: async () => factsOf(p),
    fill: async (field, value) => { calls.push(['fill', field]); (field === 'user' ? p.user : p.pw).value = value; },
    press: async (plan: LoginPlan) => { calls.push(['press', plan]); if (plan.mode === 'ajax') p.button.click(); },
    has: async () => false,
    wait: async () => undefined,
  });
  it('AJAX page: fills, presses the login button, ok when the URL leaves /Account/Login; result is a bare boolean', async () => {
    const p = airPage(), calls: unknown[] = [];
    const ok = await driveLogin(driver(p, calls), AIR, { user: 'tester', password: SECRET }, AIR_LOGIN_SUCCESS, { timeoutMs: 50, pollMs: 10 });
    expect(ok).toBe(true);
    expect(p.posted).toEqual(['/api/Authentication/Login user=tester']);
    expect(JSON.stringify(calls)).not.toContain(SECRET);
  });
  it('wrong password (page stays): fail; foreign origin: nothing filled', async () => {
    expect(await driveLogin(driver(airPage(undefined, false), []), AIR, { user: 'tester', password: SECRET }, AIR_LOGIN_SUCCESS, { timeoutMs: 30, pollMs: 10 })).toBe(false);
    const evil = airPage('https://evil.example.test/Account/Login'), calls: unknown[] = [];
    expect(await driveLogin(driver(evil, calls), AIR, { user: 'tester', password: SECRET }, AIR_LOGIN_SUCCESS)).toBe(false);
    expect(calls).toEqual([]); expect(evil.pw.value).toBe('');
  });
});

describe('siteLoginScript (Electron isolated world)', () => {
  it('AJAX page: fills both fields and clicks #btnLogin; the page script posts', () => {
    const p = airPage();
    expect(run(p)).toBe(true);
    expect(p.button.clicks).toBe(1); expect(p.posted).toHaveLength(1); expect(p.pw.value).toBe(SECRET);
    expect(p.world.__sbRoutineLoginAjax).toBe(true);
  });
  it('POST page still uses requestSubmit with its single submit button', () => {
    const p = postPage();
    expect(run(p)).toBe(true); expect(p.form.submitted).toBe(p.button); expect(p.world.__sbRoutineLoginAjax).toBeUndefined();
  });
  it('foreign origin or a form changed after the user field: refused, fields left empty', () => {
    const evil = airPage('https://evil.example.test/Account/Login');
    expect(run(evil)).toBe(false); expect(evil.pw.value).toBe(''); expect(evil.button.clicks).toBe(0);
    const p = airPage(); p.user.dispatchEvent = () => { p.form.attrs.action = 'https://evil.example.test/'; return true; }; // the page reacts to the input event
    expect(run(p)).toBe(false); expect(p.pw.value).toBe(''); expect(p.button.clicks).toBe(0);
  });
});

describe('siteLogin on an AJAX page', () => {
  afterEach(() => vi.restoreAllMocks());
  const harness = (p: Page) => {
    const location = p.world.location as { href: string };
    let navigated = false;
    const tab = { owner: 'worker', wc: {
      getURL: () => location.href,
      executeJavaScriptInIsolatedWorld: async (_w: number, [s]: { code: string }[]) => vm.runInNewContext(s!.code, p.world),
      reload: vi.fn(),
    } } as unknown as Tab;
    const startHref = location.href;
    const tabs = {
      hostLoginAllowed: () => true, assertRoutine: () => ({ targets: [AIR], dispatch: () => undefined }), protectLogin: vi.fn(),
      // stands in for tabs.ts: readable once the login document is gone (Air navigates on success)
      assertLoginReadable: async () => { navigated = location.href !== startHref; if (!navigated) throw new Error('protected'); },
    } as unknown as BrowserTabs;
    const vault = { forLogin: (o: string) => (o === AIR ? { user: 'tester', password: SECRET } : null) } as unknown as SiteVault;
    return { tab, tabs, vault };
  };
  it('logs in, returns ok only; no password in the result or in any log call', async () => {
    const writes = vi.spyOn(log, 'write'), out = vi.spyOn(console, 'log');
    const p = airPage(), { tab, tabs, vault } = harness(p);
    const result = await siteLogin(tabs, tab, vault);
    expect(result).toBe(true);
    expect(p.posted).toHaveLength(1);
    expect(JSON.stringify([result, writes.mock.calls, out.mock.calls])).not.toContain(SECRET);
  });
  it('wrong password: fail, never reloads mid-request, and empties the password before the handoff', async () => {
    vi.useFakeTimers();
    try {
      const writes = vi.spyOn(log, 'write');
      const p = airPage(undefined, false), { tab, tabs, vault } = harness(p);
      const pending = siteLogin(tabs, tab, vault);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result).toBe(false);
      expect(tab.wc.reload).not.toHaveBeenCalled();
      expect(p.pw.value).toBe('');
      expect(JSON.stringify([result, writes.mock.calls])).not.toContain(SECRET);
    } finally { vi.useRealTimers(); }
  });
});
