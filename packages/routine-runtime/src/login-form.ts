// Login form rules for the host-only routine login (ADR 0165, moved to the shared runtime by ADR 0175): which forms the host may fill, which control it presses
// and when the login counts as done. Pure and Electron-free so the same rules can run under any page driver
// (Electron's isolated world today via site-login.ts, Playwright from a terminal later). inspectLoginForm and
// classifyLoginForm are self-contained (no outer references) because site-login.ts serializes them into the page.
// Two shapes are accepted: a classic same-origin POST form with one submit control, and an AJAX form (no method, no
// action, no submit control, one login button whose script posts the credentials, e.g. Air's /Account/Login, whose
// button is `<input type="button" id="btnLogin" value="Access">`). driveLogin says why a login failed with a reason code
// (never a filled value), so a run's error names its cause.

export interface LoginSubmitFacts { method: string; actionOrigin: string; target: string }
export interface LoginFormFacts {
  pageOrigin: string;
  passwords: number;            // visible, enabled password inputs in the page
  inForm: boolean;              // the password input belongs to a form
  users: number;                // visible user/e-mail inputs in that form
  method: string;               // form.method, lower case ('get' when the attribute is absent)
  bare: boolean;                // not a POST form and has neither a method nor an action attribute (AJAX candidate)
  actionOrigin: string;         // origin of the resolved form action
  target: string;               // form target ('' = same tab)
  submits: LoginSubmitFacts[];  // visible submit controls of the form, with their formmethod/formaction/formtarget applied
  buttons: string[];            // visible button[type=button] / input[type=button] of the form: id, name, text and value, lower case
}
export type LoginPlan = { mode: 'post' } | { mode: 'ajax'; button: number };
export interface LoginInspection<E = unknown> {
  facts: LoginFormFacts;
  form: E | null; user: E | null; password: E | null; submits: E[]; buttons: E[];
}

/** Collects the facts of the page's single login form (runs in the page: document and location are the page's). */
export function inspectLoginForm(): LoginInspection<Element> {
  const visible = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !(e as HTMLInputElement).disabled; };
  const originOf = (u: string): string => { try { return new URL(u, location.href).origin; } catch { return ''; } };
  const pws = [...document.querySelectorAll('input[type="password"]')].filter(visible) as HTMLInputElement[];
  const pwField = pws.length === 1 ? pws[0]! : null;
  const form = pwField && pwField.type === 'password' ? pwField.form : null;
  const users = form ? [...form.querySelectorAll('input[autocomplete="username"],input[type="email"],input[type="text"]')].filter(visible) : [];
  const submits = form ? ([...form.querySelectorAll('button:not([type]),button[type="submit"],input[type="submit"]')].filter(visible) as HTMLButtonElement[]).filter(s => s.form === form) : [];
  const buttons = form ? ([...form.querySelectorAll('button[type="button"],input[type="button"]')].filter(visible) as HTMLButtonElement[]).filter(b => b.form === form) : [];
  const method = form ? String(form.method).toLowerCase() : '';
  return {
    facts: {
      pageOrigin: location.origin,
      passwords: pws.length,
      inForm: !!form && form.isConnected,
      users: users.length,
      method,
      bare: !!form && method !== 'post' && !form.hasAttribute('method') && !form.hasAttribute('action'),
      actionOrigin: form ? originOf(form.action) : '',
      target: form ? form.target || '' : '',
      submits: form ? submits.map(s => ({ method: (s.getAttribute('formmethod') || method).toLowerCase(), actionOrigin: originOf(s.getAttribute('formaction') || form.action), target: s.getAttribute('formtarget') || form.target || '' })) : [],
      buttons: buttons.map(b => [b.id, b.getAttribute('name'), b.textContent, b.value].filter(Boolean).join(' ').toLowerCase()),
    },
    form, user: users.length === 1 ? users[0]! : null, password: pwField, submits, buttons,
  };
}

/** What the host may press, or null: anything ambiguous, cross-origin, popup-bound or GET goes to the user's handoff. */
export function classifyLoginForm(f: LoginFormFacts, origin: string): LoginPlan | null {
  const sameTab = (t: string): boolean => t === '' || t === '_self';
  if (f.pageOrigin !== origin || f.passwords !== 1 || !f.inForm || f.users !== 1 || !sameTab(f.target)) return null;
  if (f.method === 'post') {
    const s = f.submits.length === 1 ? f.submits[0]! : null;
    return f.actionOrigin === origin && s && s.method === 'post' && s.actionOrigin === origin && sameTab(s.target) ? { mode: 'post' } : null;
  }
  // AJAX: the form itself can never submit the credentials anywhere; its page script posts them (same-origin page).
  if (!f.bare || f.submits.length !== 0 || f.buttons.length === 0) return null;
  if (f.buttons.length === 1) return { mode: 'ajax', button: 0 };
  const login = f.buttons.flatMap((label, i) => /\b(log ?in|sign ?in|accedi|entra|anmelden)\b|btnlogin/.test(label) ? [i] : []);
  return login.length === 1 ? { mode: 'ajax', button: login[0]! } : null;
}

/** When the login is done: the URL left the login page (Air: `/Account/Login`), or a signed-in element appeared. */
export type LoginSuccessRule = { urlNotContaining: string } | { selector: string };
export const AIR_LOGIN_SUCCESS: LoginSuccessRule = { urlNotContaining: '/Account/Login' };

export function loginSucceeded(page: { url: string; selectorFound?: boolean }, rule: LoginSuccessRule, origin: string): boolean {
  let url: URL;
  try { url = new URL(page.url); } catch { return false; }
  if (url.origin !== origin) return false; // an SSO or error redirect elsewhere is not a finished login
  if ('selector' in rule) return page.selectorFound === true;
  return !`${url.pathname}${url.search}`.toLowerCase().includes(rule.urlNotContaining.toLowerCase());
}

/** The few page operations a login needs; a Playwright Page or the Electron tab implement it. */
export interface LoginPageDriver {
  url(): Promise<string>;
  /** Loads a URL in the page and waits for it (the stored login page, query included). */
  navigate(url: string): Promise<void>;
  /** inspectLoginForm's facts for the current document, or null when the page has no readable form. */
  facts(): Promise<LoginFormFacts | null>;
  fill(field: 'user' | 'password', value: string): Promise<void>;
  /** Presses the form's single submit control (post) or the chosen login button (ajax). */
  press(plan: LoginPlan): Promise<void>;
  has(selector: string): Promise<boolean>;
  wait(ms: number): Promise<void>;
}

/** Why a login failed. Codes and details are fixed texts or counts and origins: never a filled value. */
export type LoginFailReason = 'no-form' | 'unrecognised-form' | 'form-changed' | 'still-on-login' | 'left-origin' | 'driver-error';
export type LoginResult = { ok: true } | { ok: false; reason: LoginFailReason; detail?: string };
export const LOGIN_FAIL_REASONS: Record<LoginFailReason, string> = {
  'no-form': 'the page shows no login form',
  'unrecognised-form': 'the login form is not one the runtime may fill',
  'form-changed': 'the form changed while it was being filled, so the password was not entered',
  'still-on-login': 'the page stayed on the login page after the login (wrong or expired credential, MFA or CAPTCHA)',
  'left-origin': 'the login went to another site (SSO or an error redirect)',
  'driver-error': 'the browser failed while filling the form',
};

/** Why classifyLoginForm refuses these facts (null = it accepts them); mirrors its rules, in fixed words. */
export function loginFormProblem(f: LoginFormFacts, origin: string): string | null {
  if (classifyLoginForm(f, origin)) return null;
  const sameTab = (t: string): boolean => t === '' || t === '_self';
  if (f.pageOrigin !== origin) return `the page is on ${f.pageOrigin}, not ${origin}`;
  if (f.passwords !== 1) return `${f.passwords} visible password fields, not 1`;
  if (!f.inForm) return 'the password field is not inside a form';
  if (f.users !== 1) return `${f.users} visible user fields in the form, not 1`;
  if (!sameTab(f.target)) return 'the form targets another window';
  if (f.method === 'post') {
    if (f.actionOrigin !== origin) return `the form posts to ${f.actionOrigin}`;
    if (f.submits.length !== 1) return `a POST form with ${f.submits.length} submit controls, not 1`;
    return 'the submit control posts elsewhere, by GET or to another window';
  }
  if (!f.bare) return `a ${f.method.toUpperCase()} form with a method or action attribute`;
  if (f.submits.length !== 0) return `a script form with ${f.submits.length} submit controls`;
  if (f.buttons.length === 0) return 'no visible login button in the form';
  return `${f.buttons.length} buttons in the form, none named like a login button`;
}

/** Fills and submits; ok or the failure's reason: the password never reaches the result, an error text or a log. */
export async function driveLoginResult(d: LoginPageDriver, origin: string, credential: { user: string; password: string }, rule: LoginSuccessRule, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<LoginResult> {
  const same = (a: LoginPlan | null, b: LoginPlan): boolean => !!a && JSON.stringify(a) === JSON.stringify(b);
  const recheck = async (plan: LoginPlan): Promise<boolean> => { const f = await d.facts(); return !!f && same(classifyLoginForm(f, origin), plan); };
  const fail = (reason: LoginFailReason, detail?: string): LoginResult => ({ ok: false, reason, ...(detail ? { detail } : {}) });
  try {
    const first = await d.facts();
    if (!first || first.passwords === 0) return fail('no-form');
    const plan = classifyLoginForm(first, origin);
    if (!plan) return fail('unrecognised-form', loginFormProblem(first, origin) ?? undefined);
    await d.fill('user', credential.user);
    if (!await recheck(plan)) return fail('form-changed', 'after the user field'); // never fill the password into a changed form
    await d.fill('password', credential.password);
    if (!await recheck(plan)) { await d.fill('password', '').catch(() => undefined); return fail('form-changed', 'after the password field'); }
    await d.press(plan);
    const poll = opts.pollMs ?? 250;
    let url = '';
    for (let waited = 0; waited <= (opts.timeoutMs ?? 15_000); waited += poll) {
      url = await d.url();
      if (loginSucceeded({ url, selectorFound: 'selector' in rule ? await d.has(rule.selector) : undefined }, rule, origin)) return { ok: true };
      await d.wait(poll);
    }
    let landed = '';
    try { landed = new URL(url).origin; } catch { /* not a URL: treated as the same page */ }
    return landed && landed !== origin ? fail('left-origin', `it ended on ${landed}`)
      : fail('still-on-login', 'selector' in rule ? `the signed-in element ${rule.selector} did not appear` : undefined);
  } catch { return fail('driver-error'); } // a driver error may quote the filled value: never its text
}

/** driveLoginResult as ok/fail only (the app's Electron login and the runtime's resume login). */
export async function driveLogin(d: LoginPageDriver, origin: string, credential: { user: string; password: string }, rule: LoginSuccessRule, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<boolean> {
  return (await driveLoginResult(d, origin, credential, rule, opts)).ok;
}
