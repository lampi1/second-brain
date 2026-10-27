// Host-only login into an exact approved origin. Isolated-world fill/submit; no password in tool arguments/results.
import type { Tab, BrowserTabs } from './tabs';
import type { SiteVault } from './site-vault';
import { assertBrowserOrigin } from './routine-policy';
import { addRedaction } from '../log';
import { classifyLoginForm, inspectLoginForm } from './login-form';
export const SITE_LOGIN_WORLD = 1014;
/** Refuse ambiguous forms, cross-origin actions, two-step/SSO/CAPTCHA flows: hand those to the user (rules: login-form.ts). */
export function siteLoginScript(origin: string, user: string, password: string): string {
  return `(() => {
    if (location.origin !== ${JSON.stringify(origin)}) return false;
    const inspect = ${inspectLoginForm.toString()};
    const classify = ${classifyLoginForm.toString()};
    const first = inspect(), plan = classify(first.facts, ${JSON.stringify(origin)});
    if (!plan || !first.user || !first.password) return false;
    const pw = first.password, userEl = first.user, control = plan.mode === 'post' ? first.submits[0] : first.buttons[plan.button];
    const valid = () => { const now = inspect(), again = classify(now.facts, ${JSON.stringify(origin)}); return location.origin === ${JSON.stringify(origin)} && !!again && JSON.stringify(again) === JSON.stringify(plan) && now.password === pw && now.user === userEl && (plan.mode === 'post' ? now.submits[0] : now.buttons[plan.button]) === control; };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const set = (el, val) => { setter.call(el, val); el.dispatchEvent(new Event('input', { bubbles:true })); el.dispatchEvent(new Event('change', { bubbles:true })); };
    globalThis.__sbRoutineLoginPrivate = true;
    if (plan.mode === 'ajax') globalThis.__sbRoutineLoginAjax = true;
    let submitted = false;
    try {
      set(userEl, ${JSON.stringify(user)});
      if (!valid()) return false;
      set(pw, ${JSON.stringify(password)});
      if (!valid()) return false;
      if (plan.mode === 'post') HTMLFormElement.prototype.requestSubmit.call(first.form, control);
      else HTMLElement.prototype.click.call(control); // the page's own script posts the credentials (same origin)
      submitted = true;
      return true;
    } finally { if (!submitted) { setter.call(pw, ''); setter.call(userEl, ''); } }

  })()`;
}
export async function siteLogin(tabs: BrowserTabs, tab: Tab, vault: SiteVault): Promise<boolean> {
  const policy = tabs.assertRoutine(tab, true);
  if (!policy) throw new Error('browser_login is available only to an approved browser-write routine step');
  const origin = new URL(tab.wc.getURL()).origin;
  assertBrowserOrigin(policy, origin);
  if (!tabs.hostLoginAllowed(tab)) return false;
  const credential = vault.forLogin(origin);
  if (!credential) return false;
  // Add log masking before any page script can emit a value. Short passwords are never captured either.
  for (const value of [credential.password, encodeURIComponent(credential.password), JSON.stringify(credential.password).slice(1, -1)]) addRedaction(value, true);
  tabs.protectLogin(tab, credential.password, origin);
  try {
    tabs.assertRoutine(tab, true)?.dispatch();
    const submitted = await tab.wc.executeJavaScriptInIsolatedWorld(SITE_LOGIN_WORLD, [{ code: siteLoginScript(origin, credential.user, credential.password) }]) === true;
    if (!submitted) return false;
    for (let attempt = 0; attempt < 40; attempt++) {
      tabs.assertRoutine(tab, true);
      try { await tabs.assertLoginReadable(tab); return true; } catch { /* login document still active */ }
      const reload = await tab.wc.executeJavaScriptInIsolatedWorld(SITE_LOGIN_WORLD, [{ code: `globalThis.__sbRoutineLoginPrivate === true && globalThis.__sbRoutineLoginAjax !== true && ![...document.querySelectorAll('input[type="password"]')].some(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0; })` }]).catch(() => false);
      if (reload) { tabs.assertRoutine(tab, true); tab.wc.reload(); }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    // An AJAX login that never left its page keeps the filled form: empty it before the user's handoff.
    await tab.wc.executeJavaScriptInIsolatedWorld(SITE_LOGIN_WORLD, [{ code: `globalThis.__sbRoutineLoginAjax === true && document.querySelectorAll('input[type="password"]').forEach(e => { e.value = ''; })` }]).catch(() => false);
    return false;
  } catch { return false; } // never propagate Electron's script/error text (it may carry a literal)
}
