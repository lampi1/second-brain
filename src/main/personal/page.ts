// Page scripts of the personal browser (Browser page, ADR 0133): find a sign-in form, fill it with a saved login, read
// what the user typed into it for «Salva password». They run in an isolated world (never the page's own JavaScript,
// which cannot see or replace them) of the top frame only. Values go in as JSON literals (never spliced as code) and
// the native value setter plus input/change events make frameworks (React, Angular) see a fill. Pure strings, unit
// tested (test/unit/personal-page.test.ts: they parse, a value never escapes its literal); used by personal/browser.ts.

/** The isolated world the scripts run in (any id but 0, the page's; the agent tabs use the main world through CDP). */
export const PERSONAL_WORLD = 1013;

const HELPERS = `
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled; };
  const all = sel => Array.from(document.querySelectorAll(sel)).filter(visible);
  const passwords = () => all('input[type="password"]');
  const userFields = () => all('input[autocomplete~="username"], input[type="email"], input[type="text"], input[type="tel"], input:not([type])');
  const userBefore = pw => {
    const users = userFields();
    if (!pw) return users.find(u => /user|mail|login|account|identifier/i.test((u.name || '') + ' ' + (u.id || '') + ' ' + (u.autocomplete || ''))) || users[0] || null;
    const scope = pw.form ? users.filter(u => u.form === pw.form) : users;
    const before = scope.filter(u => u.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before[before.length - 1] || null;
  };
  const set = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    el.focus();
    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
`;

/** true when the page shows a password field (or a lone user-name field of a two-step sign-in). */
export const detectScript = (): string => `(() => { ${HELPERS}
  return passwords().length > 0 || all('input[autocomplete~="username"]').length > 0;
})()`;

/** Fills the form: user name and password; a two-step sign-in (Google: e-mail first) gets the user name alone.
 *  → 'both' | 'user' | 'password' | 'none'. */
export const fillScript = (user: string, password: string): string => `(() => { ${HELPERS}
  const user = ${JSON.stringify(user)}, password = ${JSON.stringify(password)};
  const pw = passwords()[0] || null;
  const u = userBefore(pw);
  if (pw) set(pw, password);
  if (u && user && (!pw || !u.value || u.value === user)) set(u, user);
  if (pw) (u && !pw.value ? u : pw).focus();
  return pw && u && user ? 'both' : pw ? 'password' : u && user ? 'user' : 'none';
})()`;

/** What the user typed in the form: the focused password field first, else the first one with a value. */
export const readScript = (): string => `(() => { ${HELPERS}
  const filled = passwords().filter(p => p.value);
  const pw = filled.find(p => p === document.activeElement) || filled[0];
  if (!pw) return null;
  const u = userBefore(pw);
  return { user: u && u.value ? String(u.value) : '', password: String(pw.value) };
})()`;
