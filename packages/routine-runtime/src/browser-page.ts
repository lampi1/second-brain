// The routine browser's page side (ADR 0175): the LoginPageDriver over a Playwright page (so `driveLogin` fills the
// package's site logins host-side, never through the agent) and the snapshot script that names a page's interactive
// elements with refs (`data-routine-ref`) for the `routine-browser` MCP tools. Used by browser-mcp.ts; Playwright itself
// is loaded there, this file only needs the few Page methods below (tests pass a real page).
import { inspectLoginForm, type LoginFormFacts, type LoginPageDriver, type LoginPlan } from './login-form';

/** The Playwright Page methods the routine browser uses. */
export interface BrowserPage {
  url(): string;
  title(): Promise<string>;
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state?: 'load' | 'domcontentloaded', options?: { timeout?: number }): Promise<void>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  locator(selector: string): {
    count(): Promise<number>;
    click(options?: { timeout?: number }): Promise<void>;
    fill(value: string, options?: { timeout?: number }): Promise<void>;
    selectOption(value: string, options?: { timeout?: number }): Promise<unknown>;
    evaluate<T>(fn: (el: Element) => T): Promise<T>;
  };
}

const INSPECT = `(${inspectLoginForm.toString()})`;

/** Sets an input of the login form through the native setter (+ input/change events), like the app's site login. */
function fillScript(field: 'user' | 'password', value: string): string {
  return `(() => { const i = ${INSPECT}(); const el = i[${JSON.stringify(field)}]; if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
}

function pressScript(plan: LoginPlan): string {
  return `(() => { const i = ${INSPECT}(); const plan = ${JSON.stringify(plan)};
    if (plan.mode === 'post') { const s = i.submits[0]; if (!i.form || !s) return false; HTMLFormElement.prototype.requestSubmit.call(i.form, s); return true; }
    const b = i.buttons[plan.button]; if (!b) return false; HTMLElement.prototype.click.call(b); return true; })()`;
}

/** driveLogin's page operations over a Playwright page. */
export function playwrightLoginDriver(page: BrowserPage): LoginPageDriver {
  return {
    url: async () => page.url(),
    navigate: async url => { await page.goto(url, { waitUntil: 'load', timeout: 30_000 }); },
    facts: async () => page.evaluate<LoginFormFacts | null>(`(() => { try { return ${INSPECT}().facts; } catch { return null; } })()`),
    fill: async (field, value) => { if (!await page.evaluate<boolean>(fillScript(field, value))) throw new Error('login field missing'); },
    press: async plan => { if (!await page.evaluate<boolean>(pressScript(plan))) throw new Error('login control missing'); },
    has: async selector => (await page.locator(selector).count()) > 0,
    wait: ms => page.waitForTimeout(ms),
  };
}

/** Names the visible interactive elements `e1..eN` (attribute data-routine-ref) and returns the page as text. Password
 *  inputs never show their value. */
export const SNAPSHOT_SCRIPT = `(() => {
  const visible = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[onclick],[contenteditable="true"]')].filter(visible).slice(0, 400);
  document.querySelectorAll('[data-routine-ref]').forEach(e => e.removeAttribute('data-routine-ref'));
  const clip = (s, n) => { s = (s || '').replace(/\\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const lines = els.map((e, i) => {
    const ref = 'e' + (i + 1); e.setAttribute('data-routine-ref', ref);
    const tag = e.tagName.toLowerCase(), type = (e.getAttribute('type') || '').toLowerCase();
    const label = clip(e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.getAttribute('placeholder') || e.getAttribute('title') || e.textContent || e.getAttribute('name') || e.id, 80);
    let value = '';
    if (tag === 'input' || tag === 'textarea') value = type === 'password' ? (e.value ? '***' : '') : clip(e.value, 60);
    if (tag === 'select') value = clip(e.selectedOptions[0] ? e.selectedOptions[0].textContent : '', 60) + ' | options: ' + clip([...e.options].map(o => o.value + '=' + o.textContent).join('; '), 200);
    return '[' + ref + '] ' + tag + (type ? '[' + type + ']' : '') + (label ? ' "' + label + '"' : '') + (value ? ' = ' + value : '') + (e.disabled ? ' (disabled)' : '');
  });
  // Air-like pages may render inside iframes or keep the body hidden while loading: say so instead of an empty page
  const frames = [...document.querySelectorAll('iframe,frame')].filter(visible).slice(0, 10).map(f => {
    let doc = null; try { doc = f.contentDocument; } catch (e) { doc = null; }
    const src = clip(f.getAttribute('src') || '', 120);
    return doc && doc.body ? '[frame ' + src + ', elements inside are not clickable by ref]\\n' + clip(doc.body.innerText || doc.body.textContent, 5000) : '[cross-origin frame ' + src + ', not readable]';
  });
  const body = document.body ? clip(document.body.innerText || document.body.textContent, 15000) : '';
  return { url: location.href, title: document.title, text: [body, ...frames].filter(Boolean).join('\\n\\n'), elements: lines };
})()`;
