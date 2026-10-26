// Host-only login into an exact approved origin. Isolated-world fill/submit; no password in tool arguments/results.
import type { Tab, BrowserTabs } from './tabs';
import type { SiteVault } from './site-vault';
import { assertBrowserOrigin } from './routine-policy';
import { addRedaction } from '../log';
export const SITE_LOGIN_WORLD = 1014;
/** Refuse ambiguous forms, cross-origin actions, two-step/SSO/CAPTCHA flows: hand those to the user. */
export function siteLoginScript(origin: string, user: string, password: string): string {
  return `(() => {
    if (location.origin !== ${JSON.stringify(origin)}) return false;
    const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled; };
    const pws = [...document.querySelectorAll('input[type="password"]')].filter(visible);
    if (pws.length !== 1) return false;
    const pw = pws[0], form = pw.form;
    if (!form || form.method.toLowerCase() !== 'post' || new URL(form.action, location.href).origin !== location.origin) return false;
    const users = [...form.querySelectorAll('input[autocomplete="username"],input[type="email"],input[type="text"]')].filter(visible);
    const submits = [...form.querySelectorAll('button:not([type]),button[type="submit"],input[type="submit"]')].filter(visible);
    if (users.length !== 1 || submits.length !== 1 || (submits[0].formAction && new URL(submits[0].formAction, location.href).origin !== location.origin)) return false;
    const valid = () => (!((submits[0].getAttribute('formtarget') || form.target)) || (submits[0].getAttribute('formtarget') || form.target) === '_self') && location.origin === ${JSON.stringify(origin)} && form.isConnected && pw.isConnected && pw.type === 'password' && pw.form === form && submits[0].form === form && (submits[0].getAttribute('formmethod') || form.method).toLowerCase() === 'post' && new URL(submits[0].getAttribute('formaction') || form.action, location.href).origin === location.origin;
    if (!valid()) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const set = (el, val) => { setter.call(el, val); el.dispatchEvent(new Event('input', { bubbles:true })); el.dispatchEvent(new Event('change', { bubbles:true })); };
    globalThis.__sbRoutineLoginPrivate = true;
    let submitted = false;
    try {
      set(users[0], ${JSON.stringify(user)});
      if (!valid()) return false;
      set(pw, ${JSON.stringify(password)});
      if (!valid()) return false;
      HTMLFormElement.prototype.requestSubmit.call(form, submits[0]);
      submitted = true;
      return true;
    } finally { if (!submitted) { setter.call(pw, ''); setter.call(users[0], ''); } }

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
      const reload = await tab.wc.executeJavaScriptInIsolatedWorld(SITE_LOGIN_WORLD, [{ code: `globalThis.__sbRoutineLoginPrivate === true && ![...document.querySelectorAll('input[type="password"]')].some(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0; })` }]).catch(() => false);
      if (reload) { tabs.assertRoutine(tab, true); tab.wc.reload(); }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  } catch { return false; } // never propagate Electron's script/error text (it may carry a literal)
}
