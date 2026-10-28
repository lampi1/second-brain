// The routine runtime's browser as a stdio MCP server, `routine-browser` (ADR 0175, owner decision 2026-10-27): a step
// that declares `browser: true` drives one Chromium page through these tools, in the app and in a terminal alike. The
// runtime, not the agent, logs in, always from the stored loginUrl (Air: /Account/Login?mode=local; without the query
// the node sends the browser to the portal, another origin, which can hand it to another node): before the first
// visit to a credential's site in a step the server opens that loginUrl and fills the credential itself with
// driveLogin; a navigate to the credential's bare origin with no session yet becomes that login; whenever a page lands
// on a login page (the stored path on its origin, or the same path on another origin: the portal redirect) it logs in
// again from the stored loginUrl and goes back where the agent wanted to go. A second user: `login` {credential, user?}
// clears the session and signs in as a named credential (user override allowed, password always the stored one;
// the profile remembers that user so the next step's default login signs it out first); `fill_secret` puts a named
// credential's password into a password field (an admin page setting that user's password), the value never in a
// reply. Every top-level navigation (a new tab's included) stays inside `routine.browser.origins`; the selectors of
// `routine.browser.hide` (an overlay like Air's Maia chat) are hidden on every page; `type` refuses password fields; credential
// values are masked in every reply; screenshots go to the step's evidence folder and to events.jsonl. The browser
// profile (cookies) is one folder per run, so a login survives the steps of a run. Config: the 0600 temp file named by
// SB_ROUTINE_BROWSER_CONFIG (it holds the credentials, so it never lives in the run folder). A failed login names its
// reason code (driveLoginResult) and saves one screenshot of the page, password fields emptied first, to evidence/. A
// launch that fails on a profile held by a leftover browser of the run (or a stale lock file) cleans it and retries once.
// Every widget of a real app is reachable (owner, 2026-10-28): the snapshot names pointer-cursor divs, toggles, datepicker
// days and SVG groups too, `type` presses real keys, `press`/`hover`/`click_at`/`scroll`/`wait` cover the rest and `eval`
// runs JavaScript on the declared origins only, refused while a password field holds a value; errors carry Playwright's
// call log, masked like every reply.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createMasker } from './mask';
import { readConfigOnce } from './fs-util';
import { driveLoginResult, LOGIN_FAIL_REASONS, type LoginResult, type LoginSuccessRule } from './login-form';
import { evalScript, PASSWORD_HELD_SCRIPT, playwrightLoginDriver, SNAPSHOT_SCRIPT, type BrowserPage } from './browser-page';

export const BROWSER_SERVER_NAME = 'routine-browser';
export const BROWSER_TOOLS = ['navigate', 'snapshot', 'click', 'type', 'select_option', 'press', 'hover', 'click_at', 'scroll', 'wait', 'eval', 'screenshot', 'login', 'fill_secret'] as const;
/** `id`: a named credential (a second user of the same login page); the first login of a page is its default. */
export interface BrowserLogin { id?: string; loginUrl: string; user: string; password: string; success?: LoginSuccessRule }
export interface BrowserServerConfig {
  origins: string[];
  /** the run's Chromium profile folder (cookies kept across the steps of the run) */
  profileDir: string;
  /** the step's evidence folder (screenshots) */
  evidence: string;
  /** the run's events.jsonl and the step number, for the live 'screenshot' event */
  events?: { file: string; n: number };
  headless: boolean;
  /** a Playwright channel ('msedge', 'chrome'); none = Playwright's Chromium, else Edge on Windows */
  channel?: string;
  logins: BrowserLogin[];
  /** CSS selectors hidden on every page (`routine.browser.hide`: an overlay such as Air's Maia chat) */
  hide?: string[];
}

type Json = Record<string, unknown>;
const REF = { type: 'string', description: 'an element ref from the last snapshot, e.g. e12 (f1e3: inside frame f1)' };
const PX = { type: 'number', minimum: 0, description: 'page pixels, as in the full-page screenshot and the snapshot\'s @x,y' };
const KEY = { type: 'string', description: 'a key or chord: Enter, Tab, Escape, ArrowDown, PageDown, Control+a…' };
const TOOLS = [
  { name: 'navigate', description: 'Open a URL (only the routine\'s declared origins). Logins are done for you.', inputSchema: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string' } } } },
  { name: 'snapshot', description: 'The current page as text plus its interactive elements with refs (e1, e2…; f1e1… inside an iframe) and their centre @x,y, for click/type/select_option/hover. Take a new one after the page changes.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'click', description: 'Click an element by ref. force: skip the checks when another element covers it (the error says "intercepts pointer events").', inputSchema: { type: 'object', additionalProperties: false, required: ['ref'], properties: { ref: REF, force: { type: 'boolean' } } } },
  { name: 'type', description: 'Replace the text of an input, textarea or editable element by ref with real key presses (a datepicker sees them; never a password field). then: a key pressed after it (Tab or Escape closes a picker, Enter submits).', inputSchema: { type: 'object', additionalProperties: false, required: ['ref', 'text'], properties: { ref: REF, text: { type: 'string' }, then: { type: 'string', enum: ['Tab', 'Enter', 'Escape'] } } } },
  { name: 'select_option', description: 'Choose an option of a select by ref, by its value or label.', inputSchema: { type: 'object', additionalProperties: false, required: ['ref', 'value'], properties: { ref: REF, value: { type: 'string' } } } },
  { name: 'press', description: 'Press a key, on an element by ref or on whatever has the focus.', inputSchema: { type: 'object', additionalProperties: false, required: ['key'], properties: { key: KEY, ref: REF } } },
  { name: 'hover', description: 'Move the mouse over an element by ref (menus and tooltips that open on hover).', inputSchema: { type: 'object', additionalProperties: false, required: ['ref'], properties: { ref: REF } } },
  { name: 'click_at', description: 'Click a point of the page, for what has no ref (a canvas, a cross-origin frame): x,y in the full-page screenshot\'s pixels. Returns what was there.', inputSchema: { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: PX, y: PX, button: { type: 'string', enum: ['left', 'right', 'middle'] }, double: { type: 'boolean' } } } },
  { name: 'scroll', description: 'Scroll an element by ref into view, or scroll the wheel by dx,dy pixels (default 600 down) over the point x,y (a scrolling panel) or the page.', inputSchema: { type: 'object', additionalProperties: false, properties: { ref: REF, dx: { type: 'number' }, dy: { type: 'number' }, x: PX, y: PX } } },
  { name: 'wait', description: 'Wait ms milliseconds, or until a text shows on the page or a CSS selector is visible (gone: true = until it disappears, a spinner), at most timeout ms (default 10000, max 30000).', inputSchema: { type: 'object', additionalProperties: false, properties: { ms: { type: 'number', minimum: 0, maximum: 30000 }, text: { type: 'string' }, selector: { type: 'string' }, gone: { type: 'boolean' }, timeout: { type: 'number', minimum: 0, maximum: 30000 } } } },
  { name: 'eval', description: 'Run a JavaScript expression in the page (only on the routine\'s origins) and return its value as JSON (a promise is awaited; statements: wrap them in (() => { …; return x; })()). Powerful: use it when no other tool can, e.g. to read a widget\'s state or call the page\'s own functions. Refused while a password field holds a value.', inputSchema: { type: 'object', additionalProperties: false, required: ['expression'], properties: { expression: { type: 'string' } } } },
  { name: 'screenshot', description: 'Save a PNG of the page into this step\'s evidence folder; returns its path. highlight: refs of the proving elements, drawn with a red box in this PNG.', inputSchema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', description: 'file name without extension' }, highlight: { type: 'array', maxItems: 5, items: REF, description: 'element refs from snapshot to mark with a red box' } } } },
  { name: 'login', description: 'Sign out and in again as a named credential of the routine (the runtime fills the password). user: another login name for that credential\'s stored password. No credential: back to the default login.', inputSchema: { type: 'object', additionalProperties: false, properties: { credential: { type: 'string', description: 'a credential id' }, user: { type: 'string', description: 'the login name to use instead of the stored one' } } } },
  { name: 'fill_secret', description: 'Fill a password field by ref with the password of a named credential (e.g. to set a user\'s password in an admin page). The value is never shown.', inputSchema: { type: 'object', additionalProperties: false, required: ['ref', 'credential'], properties: { ref: REF, credential: { type: 'string', description: 'a credential id' } } } },
];
/** The profile file naming the non-default user whose session the profile's cookies hold, per origin (no values). */
const ACTIVE_LOGIN_FILE = 'routine-active-login.json';

/** The init script that hides `routine.browser.hide` on every page: one style element, added as soon as the document
 *  exists; the selectors carry no braces (format.ts), so each one is a rule of its own. */
export const HIDE_SCRIPT = (selectors: string[]): string => `(() => {
  const css = ${JSON.stringify(selectors.map(s => `${s} { display: none !important; }`).join('\n'))};
  const add = () => { if (document.getElementById('routine-hide') || !document.documentElement) return;
    const s = document.createElement('style'); s.id = 'routine-hide'; s.textContent = css; (document.head || document.documentElement).appendChild(s); };
  add(); document.addEventListener('DOMContentLoaded', add);
})()`;
const ACTION_TIMEOUT = 15_000;

export interface BrowserServerIo {
  page(): Promise<BrowserPage>;
  now?(): number;
}

const originOf = (u: string): string => { try { return new URL(u).origin; } catch { return ''; } };
const loginPath = (u: string): string => { try { return new URL(u).pathname.replace(/\/+$/, '').toLowerCase(); } catch { return ''; } };

export function allowedOrigin(config: Pick<BrowserServerConfig, 'origins'>, url: string): boolean {
  const origin = originOf(url);
  return !!origin && config.origins.includes(origin);
}

/** The package login for the page's URL when the page is that login page (same origin, same path), else null. */
export function loginFor(config: Pick<BrowserServerConfig, 'logins'>, url: string): BrowserLogin | null {
  const origin = originOf(url), p = loginPath(url);
  return config.logins.find(l => originOf(l.loginUrl) === origin && loginPath(l.loginUrl) === p) ?? null;
}

/** The package login of the URL's origin (the credential that signs that site in), else null. */
export function credentialFor(config: Pick<BrowserServerConfig, 'logins'>, url: string): BrowserLogin | null {
  const origin = originOf(url);
  return (origin && config.logins.find(l => originOf(l.loginUrl) === origin)) || null;
}

/** The package login to use when the page at `url` is a login page, else null: the stored login page itself, or the
 *  same login path on another origin (a node redirecting to its portal: Air's test.air…/Account/Login), signed in with
 *  the credential of the site the agent wanted (`wanted`), else the only login with that path. */
export function loginPageFor(config: Pick<BrowserServerConfig, 'logins'>, url: string, wanted?: BrowserLogin | null): BrowserLogin | null {
  const own = loginFor(config, url);
  if (own) return own;
  const p = loginPath(url);
  const same = p ? config.logins.filter(l => loginPath(l.loginUrl) === p) : [];
  if (wanted && same.includes(wanted)) return wanted;
  return same.length && same.every(l => originOf(l.loginUrl) === originOf(same[0]!.loginUrl)) ? same[0]! : null; // one site (its users)
}

/** The bare root of a site (`https://node/`): on Air it redirects to the portal, so it is never opened without a session. */
export function bareOrigin(url: string): boolean {
  try { const u = new URL(url); return (u.pathname === '/' || u.pathname === '') && !u.search; } catch { return false; }
}

/** The login error the agent reads: the reason code and its fixed description, never the user or the password. */
export function loginFailedText(result: Exclude<LoginResult, { ok: true }>, screenshot?: string | null): string {
  const detail = result.detail ? ` (${result.detail})` : '';
  return `The site login failed [${result.reason}]: ${LOGIN_FAIL_REASONS[result.reason]}${detail}.${screenshot ? ` Screenshot of the page: ${screenshot}.` : ''} Report it as needs-human.`;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
/** A failed call's error for the agent: Playwright's whole message, its call log included ("… intercepts pointer
 *  events", "element is not visible"), without colours, at most 20 lines and 2000 characters (masked by the caller). */
export function errorText(e: unknown): string {
  const lines = (e instanceof Error ? e.message : String(e)).replace(ANSI, '').split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  const text = lines.slice(0, 20).join('\n') + (lines.length > 20 ? `\n… (${lines.length - 20} more lines)` : '');
  return text.length > 2000 ? `${text.slice(0, 1999)}…` : text;
}

/** Empties every password field of the page (native setter + input event); true when they are all empty now. */
export const CLEAR_PASSWORDS_SCRIPT = `(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const all = [...document.querySelectorAll('input[type="password"]')];
  for (const el of all) { set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); }
  return all.every(el => el.value === ''); })()`;

/** One server's session: the page, its login state, the JSON-RPC handler. */
export function createBrowserSession(config: BrowserServerConfig, io: BrowserServerIo) {
  const masker = createMasker(config.logins.map(l => l.password));
  /** the logins in lookup order: the one switched to with `login` comes first, so every lookup picks it */
  const state = { logins: [...config.logins] };
  let shots = 0;
  /** logins done (or found still valid) by this server; one server per step, so each step starts from its loginUrl */
  const signedIn = new Set<BrowserLogin>();
  let lastLogin: BrowserLogin | null = null;

  const activeFile = path.join(config.profileDir, ACTIVE_LOGIN_FILE);
  const whoKey = (l: BrowserLogin) => `${l.id ?? ''}|${l.user}`;
  const readActive = (): Record<string, string> => { try { return JSON.parse(fs.readFileSync(activeFile, 'utf8')) as Record<string, string>; } catch { return {}; } };
  /** Remembers in the run's profile which non-default user the cookies of an origin belong to: a later step's server
   *  signs that user out before its default login (the site would otherwise keep it in as that user). */
  function recordActive(login: BrowserLogin): void {
    const origin = originOf(login.loginUrl), all = readActive();
    if (config.logins.find(l => originOf(l.loginUrl) === origin) === login) delete all[origin]; else all[origin] = whoKey(login);
    try { fs.mkdirSync(config.profileDir, { recursive: true }); fs.writeFileSync(activeFile, JSON.stringify(all)); } catch { /* best effort */ }
  }
  /** Ends every session of the run's browser (its cookies: the browser opens only the declared origins). */
  async function signOut(page: BrowserPage): Promise<void> {
    await page.context().clearCookies();
    signedIn.clear();
  }

  /** Opens the stored loginUrl (query included: Air's ?mode=local) and signs in; a page that leaves by itself = already in. */
  async function logIn(page: BrowserPage, login: BrowserLogin): Promise<string | null> {
    const held = readActive()[originOf(login.loginUrl)];
    if (held !== undefined && held !== whoKey(login)) await signOut(page); // the cookies hold another user's session
    lastLogin = login;
    await page.goto(login.loginUrl, { waitUntil: 'load', timeout: 30_000 });
    if (loginPageFor(state, page.url(), login)) {
      const result = await driveLoginResult(playwrightLoginDriver(page), originOf(login.loginUrl), login, login.success ?? { urlNotContaining: new URL(login.loginUrl).pathname }, { timeoutMs: 20_000 })
        .catch((): LoginResult => ({ ok: false, reason: 'driver-error' }));
      if (!result.ok) { signedIn.delete(login); return loginFailedText(result, await failureShot(page)); }
    }
    signedIn.add(login);
    recordActive(login);
    return null;
  }

  /** One PNG of the failed login page, taken only once every password field is empty; null when that is not sure. */
  async function failureShot(page: BrowserPage): Promise<string | null> {
    try {
      if (!await page.evaluate<boolean>(CLEAR_PASSWORDS_SCRIPT)) return null;
      return await saveShot(page, 'login-failed', true);
    } catch { return null; }
  }

  /** Saves a full-page PNG to the step's evidence folder and announces it in events.jsonl; `fresh` never overwrites. */
  async function saveShot(page: BrowserPage, name: string, fresh = false): Promise<string> {
    shots += 1;
    const base = name.replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(0, 60) || `browser-${shots}`;
    fs.mkdirSync(config.evidence, { recursive: true });
    let file = path.join(config.evidence, `${base}.png`);
    for (let i = 2; fresh && fs.existsSync(file); i++) file = path.join(config.evidence, `${base}-${i}.png`);
    await page.screenshot({ path: file, fullPage: true });
    if (config.events) fs.appendFileSync(config.events.file, `${JSON.stringify({ type: 'screenshot', at: io.now?.() ?? Date.now(), n: config.events.n, path: file })}\n`);
    return file;
  }

  /** When the page sits on a login page (the portal's included): log in from the stored loginUrl, then return to
   *  `target` once; back on a login page after that = an error, never a loop. */
  async function ensureLoggedIn(page: BrowserPage, target?: string): Promise<string | null> {
    const login = loginPageFor(state, page.url(), (target ? credentialFor(state, target) : null) ?? lastLogin);
    if (!login) return null;
    const failed = await logIn(page, login);
    if (failed) return failed;
    if (!target || loginPageFor(state, target, login) || page.url() === target) return null;
    if (bareOrigin(target) && credentialFor(state, target) === login) return null; // the bare root redirects: stay on the signed-in home
    await page.goto(target, { waitUntil: 'load', timeout: 30_000 });
    if (loginPageFor(state, page.url(), login)) return `Signed in from ${login.loginUrl}, but ${target} went back to a login page (${page.url()}). Report it as needs-human.`;
    return null;
  }

  /** Opens a URL: the step's first visit to a credential's site signs in from its loginUrl first; its bare origin with
   *  no session is that login; a landing on any login page signs in again and returns to the URL. */
  async function goto(page: BrowserPage, url: string): Promise<string | null> {
    const own = loginFor(state, url);
    if (own) return logIn(page, own); // the agent asked for the login page itself: the runtime does it
    const cred = credentialFor(state, url);
    if (cred && !signedIn.has(cred)) {
      const failed = await logIn(page, cred);
      if (failed) return failed;
      if (bareOrigin(url)) return null; // rewritten to the loginUrl: the signed-in home is where it leads
    }
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    return ensureLoggedIn(page, url);
  }
  async function where(page: BrowserPage): Promise<string> { return `Now at ${page.url()} (${await page.title().catch(() => '')}).`; }
  const locate = (page: BrowserPage, ref: unknown) => {
    const m = typeof ref === 'string' ? /^(?:(f\d{1,2}))?e\d{1,4}$/.exec(ref) : null;
    if (!m) throw new Error('ref: an element ref from snapshot, e.g. e12 or f1e3');
    const el = `[data-routine-ref="${String(ref)}"]`;
    return m[1] ? page.frameLocator(`[data-routine-frame="${m[1]}"]`).locator(el) : page.locator(el);
  };
  const num = (v: unknown, name: string, min: number, max: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name}: a number from ${min} to ${max}`);
    return n;
  };
  /** Page pixels (the full-page screenshot's) → viewport pixels, scrolling the window first when the point is outside. */
  async function toViewport(page: BrowserPage, x: number, y: number): Promise<{ x: number; y: number }> {
    const view = () => page.evaluate<{ sx: number; sy: number; w: number; h: number }>('({ sx: scrollX, sy: scrollY, w: innerWidth, h: innerHeight })');
    let v = await view();
    if (x < v.sx || x >= v.sx + v.w || y < v.sy || y >= v.sy + v.h) {
      await page.evaluate(`scrollTo(${Math.max(0, Math.round(x - v.w / 2))}, ${Math.max(0, Math.round(y - v.h / 2))})`);
      v = await view();
    }
    const vx = x - v.sx, vy = y - v.sy;
    if (vx < 0 || vx >= v.w || vy < 0 || vy >= v.h) throw new Error(`x,y ${x},${y}: outside the page (it scrolls only to ${v.sx},${v.sy} with a ${v.w}x${v.h} viewport)`);
    return { x: vx, y: vy };
  }
  /** The element at a viewport point, named like a snapshot line (tag.class "text"). */
  const elementAt = (page: BrowserPage, x: number, y: number) => page.evaluate<string>(`(() => { const e = document.elementFromPoint(${x}, ${y}); if (!e) return 'nothing';
    const c = (e.getAttribute('class') || '').trim().split(/\\s+/)[0]; const t = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    return e.tagName.toLowerCase() + (c ? '.' + c : '') + (e.tagName === 'IFRAME' ? ' (a frame: the click went inside it)' : '') + (t ? ' "' + t + '"' : ''); })()`);
  async function settle(page: BrowserPage): Promise<string | null> {
    await page.waitForLoadState('load', { timeout: ACTION_TIMEOUT }).catch(() => undefined);
    return ensureLoggedIn(page);
  }

  /** The named credential with its stored values, or the error text. */
  function namedLogin(id: unknown): BrowserLogin | string {
    const found = typeof id === 'string' ? config.logins.find(l => l.id === id) : undefined;
    return found ?? `credential: one of ${config.logins.filter(l => l.id).map(l => `"${l.id}"`).join(', ') || '(none: this routine names no credential)'}.`;
  }

  async function call(name: string, args: Json): Promise<{ text: string; isError?: boolean }> {
    const page = await io.page();
    switch (name) {
      case 'navigate': {
        const url = String(args.url ?? '');
        if (!allowedOrigin(config, url)) return { text: `Not allowed: the routine's browser opens only ${config.origins.join(', ')}.`, isError: true };
        const failed = await goto(page, url);
        return failed ? { text: failed, isError: true } : { text: await where(page) };
      }
      case 'snapshot': {
        await page.waitForLoadState('load', { timeout: ACTION_TIMEOUT }).catch(() => undefined);
        let s = await page.evaluate<{ url: string; title: string; text: string; elements: string[] }>(SNAPSHOT_SCRIPT);
        // a SPA (Air's agenda) paints after 'load': wait a little for something to read
        for (let i = 0; i < 10 && !s.text.trim() && !s.elements.length; i++) { await page.waitForTimeout(500); s = await page.evaluate(SNAPSHOT_SCRIPT); }
        return { text: `URL: ${s.url}\nTitle: ${s.title}\n\nElements:\n${s.elements.join('\n') || '(none)'}\n\nText:\n${s.text}` };
      }
      case 'click': {
        await locate(page, args.ref).click({ timeout: ACTION_TIMEOUT, ...(args.force === true ? { force: true } : {}) });
        const failed = await settle(page);
        return failed ? { text: failed, isError: true } : { text: `Clicked ${String(args.ref)}. ${await where(page)}` };
      }
      case 'type': {
        const el = locate(page, args.ref);
        const then = args.then === undefined ? undefined : String(args.then);
        if (then !== undefined && !['Tab', 'Enter', 'Escape'].includes(then)) return { text: 'then: Tab, Enter or Escape.', isError: true };
        const kind = await el.evaluate(e => `${e.tagName.toLowerCase()}:${(e.getAttribute('type') ?? '').toLowerCase()}`);
        if (kind.endsWith(':password')) return { text: 'Refused: password fields are filled only by the runtime\'s own login.', isError: true };
        const text = String(args.text ?? '');
        // real keys (keydown/keypress/input/keyup per character): bootstrap-datepicker reads the date only on keyup, and
        // its forceParse would put the old date back on blur after a bare fill; a long text is filled, then one End key
        if (text.length <= 300) {
          await el.fill('', { timeout: ACTION_TIMEOUT });
          await el.pressSequentially(text, { timeout: ACTION_TIMEOUT });
        } else {
          await el.fill(text, { timeout: ACTION_TIMEOUT });
          await el.press('End', { timeout: ACTION_TIMEOUT });
        }
        if (!then) return { text: `Typed into ${String(args.ref)}.` };
        await el.press(then, { timeout: ACTION_TIMEOUT });
        const failed = await settle(page);
        return failed ? { text: failed, isError: true } : { text: `Typed into ${String(args.ref)}, then ${then}. ${await where(page)}` };
      }
      case 'press': {
        const key = String(args.key ?? '');
        if (!/^[^\s]{1,40}$/.test(key)) return { text: 'key: a key name such as Enter, Tab, Escape, ArrowDown or Control+a.', isError: true };
        if (args.ref === undefined) await page.keyboard.press(key);
        else await locate(page, args.ref).press(key, { timeout: ACTION_TIMEOUT });
        const failed = await settle(page);
        return failed ? { text: failed, isError: true } : { text: `Pressed ${key}${args.ref === undefined ? '' : ` on ${String(args.ref)}`}. ${await where(page)}` };
      }
      case 'hover': {
        await locate(page, args.ref).hover({ timeout: ACTION_TIMEOUT });
        return { text: `The mouse is over ${String(args.ref)}.` };
      }
      case 'click_at': {
        const button = args.button === undefined ? 'left' : String(args.button);
        if (button !== 'left' && button !== 'right' && button !== 'middle') return { text: 'button: left, right or middle.', isError: true };
        const at = await toViewport(page, num(args.x, 'x', 0, 100_000), num(args.y, 'y', 0, 100_000));
        const what = await elementAt(page, at.x, at.y);
        await page.mouse.click(at.x, at.y, { button, clickCount: args.double === true ? 2 : 1 });
        const failed = await settle(page);
        return failed ? { text: failed, isError: true } : { text: `Clicked ${String(args.x)},${String(args.y)} on ${what}. ${await where(page)}` };
      }
      case 'scroll': {
        if (args.ref !== undefined) {
          await locate(page, args.ref).scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT });
          return { text: `${String(args.ref)} is in view.` };
        }
        const dx = args.dx === undefined ? 0 : num(args.dx, 'dx', -100_000, 100_000);
        const dy = args.dy === undefined ? (args.dx === undefined ? 600 : 0) : num(args.dy, 'dy', -100_000, 100_000);
        if (args.x !== undefined || args.y !== undefined) {
          const at = await toViewport(page, num(args.x, 'x', 0, 100_000), num(args.y, 'y', 0, 100_000));
          await page.mouse.move(at.x, at.y);
        }
        await page.mouse.wheel(dx, dy);
        await page.waitForTimeout(250);
        const pos = await page.evaluate<{ x: number; y: number }>('({ x: Math.round(scrollX), y: Math.round(scrollY) })');
        return { text: `Scrolled by ${dx},${dy}; the window is at ${pos.x},${pos.y} (a panel that scrolled by itself does not move it). Take a new snapshot.` };
      }
      case 'wait': {
        if (args.ms !== undefined) {
          const ms = num(args.ms, 'ms', 0, 30_000);
          await page.waitForTimeout(ms);
          return { text: `Waited ${ms} ms. ${await where(page)}` };
        }
        const text = args.text === undefined ? undefined : String(args.text);
        const selector = args.selector === undefined ? undefined : String(args.selector);
        if (!text === !selector) return { text: 'wait: ms, or one of text and selector.', isError: true };
        const timeout = args.timeout === undefined ? 10_000 : num(args.timeout, 'timeout', 0, 30_000);
        const gone = args.gone === true;
        const probe = text !== undefined
          ? `(document.body ? document.body.innerText : '').includes(${JSON.stringify(text)})`
          : `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })()`;
        const what = text !== undefined ? `the text "${text}"` : `the selector ${selector!}`;
        const start = Date.now();
        for (;;) {
          if ((await page.evaluate<boolean>(probe)) !== gone) return { text: `${gone ? 'Gone' : 'Found'}: ${what} after ${Date.now() - start} ms. ${await where(page)}` };
          if (Date.now() - start >= timeout) return { text: `${what} ${gone ? 'is still on the page' : 'did not show'} after ${timeout} ms. ${await where(page)}`, isError: true };
          await page.waitForTimeout(250);
        }
      }
      case 'eval': {
        const expression = String(args.expression ?? '');
        if (!expression.trim() || expression.length > 20_000) return { text: 'expression: some JavaScript, up to 20000 characters.', isError: true };
        // the page must be one of the routine's sites (the test hosts navigate allows), never a login page
        if (!allowedOrigin(config, page.url())) return { text: `Refused: eval runs only on ${config.origins.join(', ')}; this page is ${originOf(page.url()) || page.url()}.`, isError: true };
        if (loginPageFor(state, page.url())) return { text: 'Refused: eval never runs on a login page.', isError: true };
        if (await page.evaluate<boolean>(PASSWORD_HELD_SCRIPT)) return { text: 'Refused: a password field of this page holds a value (eval could read it). Run it before fill_secret or after the form is saved.', isError: true };
        const value = await page.evaluate<string>(evalScript(expression));
        const failed = await settle(page);
        return failed ? { text: failed, isError: true } : { text: `Result: ${value}` };
      }
      case 'select_option': {
        await locate(page, args.ref).selectOption(String(args.value ?? ''), { timeout: ACTION_TIMEOUT });
        const failed = await settle(page);
        return failed ? { text: failed, isError: true } : { text: `Selected "${String(args.value)}" in ${String(args.ref)}.` };
      }
      case 'screenshot': {
        // highlight: the proving elements get a red box in this PNG only (their inline style is put back after it)
        const refs = [...new Set(args.highlight === undefined ? [] : Array.isArray(args.highlight) ? args.highlight : [args.highlight])];
        if (refs.length > 5) return { text: 'highlight: at most 5 element refs.', isError: true };
        for (const ref of refs) locate(page, ref); // validates each ref before the page is touched
        // the originals live here, not on the page: only the elements really marked get their own style back
        let marked: Array<[ref: string, style: string]> = [];
        try {
          const found = await page.evaluate<{ marked: Array<[string, string]>; missing?: string }>(`((refs) => { const marked = [];
            for (const ref of refs) { const e = document.querySelector('[data-routine-ref="' + ref + '"]'); if (!e) return { marked, missing: ref };
              marked.push([ref, e.style.cssText]); e.style.setProperty('outline', '3px solid red', 'important'); e.style.setProperty('outline-offset', '2px', 'important'); }
            return { marked }; })(${JSON.stringify(refs)})`);
          marked = found.marked;
          if (found.missing) return { text: `highlight: ${found.missing} is not on the page; take a new snapshot.`, isError: true };
          const file = await saveShot(page, String(args.name ?? ''));
          return { text: `Saved ${file}${refs.length ? ` with a red box on ${refs.join(', ')}` : ''}. ${await where(page)}` };
        } finally {
          if (marked.length) await page.evaluate(`((marked) => { for (const [ref, style] of marked) { const e = document.querySelector('[data-routine-ref="' + ref + '"]'); if (e) e.style.cssText = style; } })(${JSON.stringify(marked)})`).catch(() => undefined);
        }
      }
      case 'login': {
        const named = args.credential === undefined ? null : namedLogin(args.credential);
        if (typeof named === 'string') return { text: named, isError: true };
        const site = lastLogin ? originOf(lastLogin.loginUrl) : '';
        const base = named ?? config.logins.find(l => originOf(l.loginUrl) === site) ?? config.logins[0];
        if (!base) return { text: 'This routine has no site login.', isError: true };
        const user = args.user === undefined ? base.user : String(args.user).trim();
        if (!user || user.length > 256) return { text: 'user: a login name up to 256 characters.', isError: true };
        const login: BrowserLogin = user === base.user ? base : { ...base, user };
        state.logins = [login, ...config.logins.filter(l => l !== base)];
        await signOut(page);
        const failed = await logIn(page, login);
        return failed ? { text: failed, isError: true } : { text: `Signed in as ${login.user}${login.id ? ` (credential ${login.id})` : ''}. ${await where(page)}` };
      }
      case 'fill_secret': {
        const named = namedLogin(args.credential);
        if (typeof named === 'string') return { text: named, isError: true };
        const el = locate(page, args.ref);
        const kind = await el.evaluate(e => `${e.tagName.toLowerCase()}:${(e.getAttribute('type') ?? '').toLowerCase()}`);
        if (kind !== 'input:password') return { text: 'Refused: fill_secret fills only password fields (a text field would show the value).', isError: true };
        await el.fill(named.password, { timeout: ACTION_TIMEOUT });
        return { text: `Filled ${String(args.ref)} with the password of credential ${named.id}.` };
      }
      default: throw new Error('Unknown tool');
    }
  }

  /** Handles one JSON-RPC message; null = a notification. */
  async function handle(message: Json): Promise<Json | null> {
    const id = message.id;
    if (id === undefined || id === null) return null;
    const reply = (result: unknown): Json => ({ jsonrpc: '2.0', id, result });
    switch (message.method) {
      case 'initialize': {
        const asked = (message.params as Json | undefined)?.protocolVersion;
        return reply({ protocolVersion: typeof asked === 'string' ? asked : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: BROWSER_SERVER_NAME, version: '1' } });
      }
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const params = (message.params ?? {}) as Json;
        const name = String(params.name ?? '');
        if (!(BROWSER_TOOLS as readonly string[]).includes(name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
        try {
          const r = await call(name, (params.arguments ?? {}) as Json);
          return reply({ content: [{ type: 'text', text: masker.mask(r.text) }], ...(r.isError ? { isError: true } : {}) });
        } catch (e) {
          return reply({ content: [{ type: 'text', text: masker.mask(`Browser ${name} failed: ${errorText(e)}`) }], isError: true });
        }
      }
      default: return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    }
  }
  return { handle, ensureLoggedIn };
}

/** How a launch finds and ends a leftover browser of the run's profile (a server of an earlier step or resume that
 *  died without closing it: Chromium then hands the new launch to it and exits, "Target … has been closed"). */
export interface ProfileRecovery {
  /** pids of browser processes started with --user-data-dir = this profile folder */
  holders(profileDir: string): Promise<number[]>;
  kill(pid: number): void;
  wait(ms: number): Promise<void>;
}

const LOCK_FILES = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];
/** Chromium's profile lock files present in the folder (lstat: SingletonLock is a symlink that may point nowhere). */
export function profileLockFiles(profileDir: string): string[] {
  return LOCK_FILES.filter(f => { try { fs.lstatSync(path.join(profileDir, f)); return true; } catch { return false; } });
}

/** The processes whose command line opens exactly this profile folder (`--user-data-dir=<dir>`, quoted or not). */
export function profileHolders(processes: { pid: number; cmd: string }[], profileDir: string): number[] {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const dir = norm(path.resolve(profileDir));
  return processes.filter(p => {
    const cmd = norm(p.cmd);
    for (const flag of ['--user-data-dir=', '--user-data-dir="']) {
      for (let at = cmd.indexOf(flag + dir); at >= 0; at = cmd.indexOf(flag + dir, at + 1)) {
        const next = cmd.charAt(at + flag.length + dir.length);
        if (next === '' || next === ' ' || next === '"' || next === '/') return true;
      }
    }
    return false;
  }).map(p => p.pid);
}

const run = (file: string, args: string[]) => new Promise<string>((resolve, reject) =>
  execFile(file, args, { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(String(out)))));

/** The machine's processes (Windows: CIM over the browser images; elsewhere: ps). */
async function browserProcesses(): Promise<{ pid: number; cmd: string }[]> {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe' OR Name='chrome-headless-shell.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"]);
    if (!out.trim()) return [];
    const rows = JSON.parse(out) as { ProcessId: number; CommandLine: string | null } | { ProcessId: number; CommandLine: string | null }[];
    return (Array.isArray(rows) ? rows : [rows]).map(r => ({ pid: r.ProcessId, cmd: r.CommandLine ?? '' }));
  }
  const out = await run('ps', ['-axo', 'pid=,args=']);
  return out.split('\n').map(l => /^\s*(\d+)\s+(.*)$/.exec(l)).flatMap(m => (m ? [{ pid: Number(m[1]), cmd: m[2]! }] : []));
}

export const systemProfileRecovery: ProfileRecovery = {
  holders: async dir => profileHolders(await browserProcesses(), dir),
  kill: pid => { process.kill(pid); },
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

/** Launches; when that fails and the profile is held (a leftover browser of the run, or a stale lock file), ends those
 *  processes, removes the stale locks and retries once. Still failing, or nothing to clean: a clear error. Only browsers
 *  started on this run's own profile folder are ended. */
export async function launchOnProfile<T>(profileDir: string, launch: () => Promise<T>, recovery: ProfileRecovery): Promise<T> {
  const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];
  try {
    return await launch();
  } catch (first) {
    const pids = await recovery.holders(profileDir).catch(() => [] as number[]);
    const locks = profileLockFiles(profileDir);
    if (!pids.length && !locks.length) throw new Error(`The browser did not start on the run's profile ${profileDir} (no leftover browser or lock file found there): ${firstLine(first)}`);
    for (const pid of pids) { try { recovery.kill(pid); } catch { /* already gone */ } }
    for (let i = 0; pids.length && i < 20 && (await recovery.holders(profileDir).catch(() => [] as number[])).length; i++) await recovery.wait(250);
    for (const f of profileLockFiles(profileDir)) { try { fs.rmSync(path.join(profileDir, f), { force: true }); } catch { /* still held: the retry says so */ } }
    const found = [pids.length ? `a leftover browser on it (pid ${pids.join(', ')}), ended` : '', locks.length ? `a stale lock (${locks.join(', ')}), removed` : ''].filter(Boolean).join(' and ');
    try {
      return await launch();
    } catch (second) {
      throw new Error(`The browser did not start on the run's profile ${profileDir}: found ${found}, retried once, still failing: ${firstLine(second)}. Close any browser using that folder, then resume.`);
    }
  }
}

/** Launches the run's Chromium on its profile folder: Playwright's Chromium, or Edge on Windows when it is missing.
 *  Main-frame navigations outside the declared origins are aborted. */
export async function launchBrowser(config: BrowserServerConfig, recovery: ProfileRecovery = systemProfileRecovery): Promise<{ page: BrowserPage; close(): Promise<void> }> {
  const { chromium } = await import('playwright-core');
  const options = { headless: config.headless, viewport: { width: 1366, height: 900 } };
  const context = await launchOnProfile(config.profileDir, async () => {
    try {
      return await chromium.launchPersistentContext(config.profileDir, { ...options, ...(config.channel ? { channel: config.channel } : {}) });
    } catch (e) {
      if (config.channel || process.platform !== 'win32') throw e;
      return chromium.launchPersistentContext(config.profileDir, { ...options, channel: 'msedge' });
    }
  }, recovery);
  await context.route('**/*', async route => {
    const request = route.request();
    // a new tab's first navigation (target=_blank, window.open) has no frame yet: request.frame() throws, and a throw
    // here is an unhandled rejection that ends the whole server ("Connection closed" mid-step); it is a top-level one
    let topLevel = false;
    if (request.isNavigationRequest()) { try { topLevel = request.frame().parentFrame() === null; } catch { topLevel = true; } }
    try {
      if (topLevel && !allowedOrigin(config, request.url())) await route.abort('blockedbyclient');
      else await route.continue();
    } catch { /* the page or the request is gone: nothing to route */ }
  });
  // overlays the package names (Air's Maia chat) never cover what a step clicks: hidden by a style on every page
  if (config.hide?.length) await context.addInitScript(HIDE_SCRIPT(config.hide));
  const page = context.pages()[0] ?? await context.newPage();
  return { page: page as unknown as BrowserPage, close: () => context.close() };
}

export async function serveBrowser(config: BrowserServerConfig, io: BrowserServerIo, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const session = createBrowserSession(config, io);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: Json;
    try { message = JSON.parse(line) as Json; } catch { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`); continue; }
    const reply = await session.handle(message);
    if (reply) output.write(`${JSON.stringify(reply)}\n`);
  }
}

export async function browserMain(): Promise<void> {
  const file = process.env.SB_ROUTINE_BROWSER_CONFIG;
  if (!file) { process.stderr.write('SB_ROUTINE_BROWSER_CONFIG is not set\n'); process.exit(2); }
  // read once and deleted: the login passwords it holds never stay where the session could read them
  const config = readConfigOnce<BrowserServerConfig>(file);
  // a stray Playwright rejection must not end the server: it cannot be restarted (its config file is gone), so the
  // step would lose its browser for good; the failing call already answers with its own error
  process.on('unhandledRejection', e => { process.stderr.write(`routine-browser: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}\n`); });
  let launched: Promise<{ page: BrowserPage; close(): Promise<void> }> | undefined;
  const browser = () => (launched ??= launchBrowser(config));
  try {
    await serveBrowser(config, { page: async () => (await browser()).page });
  } finally {
    if (launched) await (await launched).close().catch(() => undefined);
  }
}
