// The routine browser's page side (ADR 0175): the LoginPageDriver over a Playwright page (so `driveLogin` fills the
// package's site logins host-side, never through the agent) and the snapshot script that names a page's interactive
// elements with refs (`data-routine-ref`) for the `routine-browser` MCP tools, plus the wrapper of its `eval` tool and
// the password check that guards it. Used by browser-mcp.ts; Playwright itself
// is loaded there, this file only needs the few Page methods below (tests pass a real page).
import { inspectLoginForm, type LoginFormFacts, type LoginPageDriver, type LoginPlan } from './login-form';

/** The Playwright Page methods the routine browser uses. */
export interface BrowserPage {
  url(): string;
  title(): Promise<string>;
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }): Promise<void>;
  screenshot(options: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  context(): { clearCookies(): Promise<void>; pages(): BrowserPage[]; on(event: 'page', handler: (page: BrowserPage) => void): unknown };
  on(event: string, handler: (arg: never) => void): unknown;
  goBack(options?: { timeout?: number }): Promise<unknown>;
  goForward(options?: { timeout?: number }): Promise<unknown>;
  reload(options?: { timeout?: number }): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  viewportSize(): { width: number; height: number } | null;
  ariaSnapshot(options?: { timeout?: number }): Promise<string>;
  bringToFront(): Promise<void>;
  close(): Promise<void>;
  isClosed(): boolean;
  locator(selector: string): BrowserLocator;
  /** a same-origin iframe's elements (refs f1e3…) */
  frameLocator(selector: string): { locator(selector: string): BrowserLocator };
  mouse: {
    click(x: number, y: number, options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void>;
    move(x: number, y: number): Promise<void>;
    wheel(deltaX: number, deltaY: number): Promise<void>;
  };
  keyboard: { press(key: string): Promise<void> };
}

/** The Playwright Locator methods the routine browser uses. */
export interface BrowserLocator {
  count(): Promise<number>;
  click(options?: { timeout?: number; force?: boolean; button?: 'left' | 'right' | 'middle' }): Promise<void>;
  dblclick(options?: { timeout?: number; force?: boolean }): Promise<void>;
  setChecked(checked: boolean, options?: { timeout?: number; force?: boolean }): Promise<void>;
  dragTo(target: BrowserLocator, options?: { timeout?: number }): Promise<void>;
  setInputFiles(files: string[], options?: { timeout?: number }): Promise<void>;
  screenshot(options?: { timeout?: number }): Promise<Buffer>;
  ariaSnapshot(options?: { timeout?: number }): Promise<string>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  pressSequentially(text: string, options?: { timeout?: number }): Promise<void>;
  press(key: string, options?: { timeout?: number }): Promise<void>;
  hover(options?: { timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded(options?: { timeout?: number }): Promise<void>;
  selectOption(value: string, options?: { timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (el: Element) => T): Promise<T>;
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

/** The selectors of what a user can act on, like the app's own browser (src/main/browser/page.ts) plus Air's widgets:
 *  Bootstrap toggles (`data-toggle`: collapse «Inserimento prestazione»), `.btn` divs (the toolbar), datepicker days. */
const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,label[for],[role=button],[role=link],[role=tab],' +
  '[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=option],[role=switch],' +
  '[role=combobox],[role=textbox],[role=searchbox],[role=slider],[role=spinbutton],[role=treeitem],[role=gridcell],[onclick],' +
  '[contenteditable=""],[contenteditable="true"],[tabindex]:not([tabindex="-1"]),[data-toggle],[data-bs-toggle],.btn,td.day:not(.disabled)';
/** At most this many refs per snapshot (the ones in the viewport first), and this many elements scanned for a pointer. */
export const SNAPSHOT_CAP = 600;
const POINTER_SCAN = 8000;

/** Names the interactive elements `e1..eN` (attribute data-routine-ref; inside the same-origin iframe fK: `fKe1..`) and
 *  returns the page as text. Beyond the selectors above, an element counts when it shows a pointer cursor its parent
 *  does not (jQuery-bound divs, datepicker days) and an SVG group drawing shapes (Air's odontogram `g.body`). Each line
 *  ends with `@x,y`: the element's centre in page pixels, the coordinates of the full-page screenshot and of click_at.
 *  Password inputs never show their value. */
export const SNAPSHOT_SCRIPT = `(() => {
  const clip = (s, n) => { s = (s || '').replace(/\\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const styleOf = e => e.ownerDocument.defaultView.getComputedStyle(e);
  const visible = e => { const r = e.getBoundingClientRect(); const s = styleOf(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // a styled toggle (Air's checkbox-slider) hides its checkbox and paints a label/span: the ref goes on that visible part
  const proxyOf = e => { if (visible(e)) return e; if (e.tagName !== 'INPUT' || !/^(checkbox|radio)$/i.test(e.type)) return null;
    return [...(e.labels || []), e.nextElementSibling, e.parentElement].find(x => x && visible(x)) || null; };
  const cls = e => clip(e.getAttribute('class') || '', 60);
  const data = e => [...e.attributes].filter(a => a.name.startsWith('data-') && a.name !== 'data-routine-ref' && a.value && a.value.length <= 40)
    .slice(0, 3).map(a => a.name.slice(5) + '=' + a.value).join(' ');
  const svgTitle = e => { const t = e.querySelector(':scope > title'); return t ? t.textContent : ''; };
  // an icon-only control (<a><i class="fa fa-print"></i></a>) is named by its own or its icon's class
  const iconOf = e => { const i = e.querySelector('[class]'); return i ? cls(i) : ''; };
  const where = e => { if (!(e instanceof e.ownerDocument.defaultView.SVGElement)) return '';
    for (let p = e.parentElement; p && p.tagName.toLowerCase() !== 'svg'; p = p.parentElement) { const d = p.id ? '#' + p.id : data(p); if (d) return ' in ' + clip(d, 40); }
    return ''; };
  const nameOf = e => clip(e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.getAttribute('placeholder')
    || e.getAttribute('title') || svgTitle(e) || e.textContent || e.getAttribute('alt') || e.getAttribute('name') || e.id || data(e)
    || (iconOf(e) ? 'icon ' + iconOf(e) : '') || (cls(e) ? 'class ' + cls(e) : ''), 80);
  const collect = (doc, prefix, ox, oy) => {
    doc.querySelectorAll('[data-routine-ref]').forEach(e => e.removeAttribute('data-routine-ref'));
    const picked = new Map();
    // a field wins over its label[for] when the label is also its visible proxy (a hidden checkbox): the line shows its state
    const add = e => { const t = proxyOf(e); if (t && (!picked.has(t) || /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName))) picked.set(t, e); };
    doc.querySelectorAll(${JSON.stringify(INTERACTIVE)}).forEach(add);
    const all = doc.body ? doc.body.getElementsByTagName('*') : [];
    for (let i = 0; i < all.length && i < ${POINTER_SCAN}; i++) {
      const e = all[i]; if (picked.has(e) || styleOf(e).cursor !== 'pointer') continue;
      const p = e.parentElement; if (p && styleOf(p).cursor === 'pointer') continue;
      if (visible(e)) add(e);
    }
    doc.querySelectorAll('svg g[class], svg g[id]').forEach(g => {
      if (picked.has(g) || !g.querySelector(':scope > path, :scope > polygon, :scope > rect, :scope > circle, :scope > ellipse')) return;
      const r = g.getBoundingClientRect(); if (r.width >= 6 && r.height >= 6 && visible(g)) add(g);
    });
    const win = doc.defaultView, inView = t => { const r = t.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth; };
    let list = [...picked.entries()];
    const total = list.length;
    if (total > ${SNAPSHOT_CAP}) list = [...list.filter(([t]) => inView(t)), ...list.filter(([t]) => !inView(t))].slice(0, ${SNAPSHOT_CAP});
    list.sort(([a], [b]) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
    const lines = list.map(([target, e], i) => {
      const ref = prefix + (i + 1); target.setAttribute('data-routine-ref', ref);
      const tag = e.tagName.toLowerCase(), type = (e.getAttribute('type') || '').toLowerCase();
      const known = /^(a|button|input|select|textarea|summary|label)$/.test(tag);
      const first = (e.getAttribute('class') || '').trim().split(/\\s+/)[0];
      let value = '';
      if (tag === 'input' && (type === 'checkbox' || type === 'radio')) value = e.checked ? 'on' : 'off';
      else if (tag === 'input' || tag === 'textarea') value = type === 'password' ? (e.value ? '***' : '') : clip(e.value, 60);
      if (tag === 'select') value = clip(e.selectedOptions[0] ? e.selectedOptions[0].textContent : '', 60) + ' | options: ' + clip([...e.options].map(o => o.value + '=' + o.textContent).join('; '), 200);
      const r = target.getBoundingClientRect(), x = Math.round(ox + r.left + r.width / 2), y = Math.round(oy + r.top + r.height / 2);
      const label = nameOf(e);
      return '[' + ref + '] ' + tag + (!known && first ? '.' + first : '') + (type ? '[' + type + ']' : '') + (label ? ' "' + label + '"' : '') + where(e)
        + (value ? ' = ' + value : '') + (e.disabled ? ' (disabled)' : '') + ' @' + x + ',' + y;
    });
    if (total > list.length) lines.push('(' + (total - list.length) + ' more elements outside the viewport: scroll, then take a new snapshot)');
    return lines;
  };
  const sx = window.scrollX, sy = window.scrollY;
  const elements = collect(document, 'e', sx, sy);
  // Air-like pages may render inside iframes or keep the body hidden while loading: say so instead of an empty page
  document.querySelectorAll('[data-routine-frame]').forEach(f => f.removeAttribute('data-routine-frame'));
  let k = 0;
  const frames = [...document.querySelectorAll('iframe,frame')].filter(visible).slice(0, 10).map(f => {
    let doc = null; try { doc = f.contentDocument; } catch (e) { doc = null; }
    // no query: a widget frame's URL can carry its auth token (Air's Maia: ?auth=…)
    const src = clip((f.getAttribute('src') || '').split('?')[0].split('#')[0], 120);
    if (!doc || !doc.body) return '[cross-origin frame ' + src + ', not readable: click_at its screenshot coordinates]';
    const id = 'f' + (++k); f.setAttribute('data-routine-frame', id);
    const r = f.getBoundingClientRect();
    elements.push(...collect(doc, id + 'e', sx + r.left + f.clientLeft, sy + r.top + f.clientTop));
    return '[frame ' + id + ' ' + src + ', its elements are the refs ' + id + 'e…]\\n' + clip(doc.body.innerText || doc.body.textContent, 5000);
  });
  const body = document.body ? clip(document.body.innerText || document.body.textContent, 15000) : '';
  return { url: location.href, title: document.title, text: [body, ...frames].filter(Boolean).join('\\n\\n'), elements };
})()`;

/** True when a password field of the page (or of a same-origin frame) holds a value: eval is refused then, since a
 *  script could return the password reshaped past the masking. */
export const PASSWORD_HELD_SCRIPT = `(() => { const docs = [document];
  for (const f of document.querySelectorAll('iframe,frame')) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) { /* cross-origin */ } }
  return docs.some(d => [...d.querySelectorAll('input[type="password"]')].some(i => i.value !== '')); })()`;

/** Wraps an agent's expression: awaited, serialised to JSON (DOM nodes as a short tag + text, cycles and functions
 *  named), capped at `max` characters. */
export function evalScript(expression: string, max = 4000): string {
  return `(async () => { const v = await (${expression}
  );
  const seen = new WeakSet();
  const s = JSON.stringify(v, (k, x) => {
    if (typeof x === 'function') return '[function]';
    if (typeof x === 'bigint') return String(x);
    if (typeof Node !== 'undefined' && x instanceof Node) return x instanceof Element ? '<' + x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + '> ' + (x.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100) : String(x.textContent || '').slice(0, 100);
    if (x instanceof NodeList || x instanceof HTMLCollection) return [...x];
    if (x && typeof x === 'object') { if (seen.has(x)) return '[circular]'; seen.add(x); }
    return x; });
  return s === undefined ? 'undefined' : s.length > ${max} ? s.slice(0, ${max - 1}) + '…' : s; })()`;
}

