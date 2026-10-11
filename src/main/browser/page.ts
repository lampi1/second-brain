// Page-side functions: they run INSIDE browser tabs, in every frame (top page, same-origin and cross-origin iframes),
// in the page's main world, through WebFrameMain.executeJavaScript (Electron runs them in the frame's own renderer
// process, so cross-origin frames work too). Each function is self-contained (no imports, no closures over module
// scope): pageCall() serializes it with Function.prototype.toString and calls it with JSON arguments.
// The walker gives agents an accessibility-style tree (role "name" state [ref]); refs live in a per-frame WeakRef map
// (window.__sbAgent, non-enumerable) so the same element keeps its ref across reads. Frames are walked one by one and
// spliced by browser/actions.ts at the iframe markers.
// Password fields (the HARD LIMIT of guard.ts): pwKit runs before every call and keeps window.__sbPw, the set of
// elements EVER seen as a password field in this document (a "show password" toggle that turns it into type=text
// does not make it typeable), with a test that also uses autocomplete and id/name/label hints, and a scan that pierces
// open shadow roots and counts hidden fields. Residual risk: this runs in the page's main world, so a page written to
// defeat it could; the target sites are the user's own environments. Used by browser/actions.ts and browser/tabs.ts.

/** What pwKit installs on window.__sbPw (frozen, non-configurable). */
interface PwKit { is(el: Element | null | undefined): boolean; scan(root: Document | ShadowRoot): Element[] }

/** Installs window.__sbPw once per document (see the header). Prepended to every pageCall. */
export function pwKit(): void {
  if ((window as unknown as { __sbPw?: unknown }).__sbPw) return;
  const seen = new WeakSet<Element>();
  const HINT = /(^|[^a-z])(pass(word|wd|code)?|pwd|kennwort|parola ?chiave)([^a-z]|$)/i;
  const now = (el: Element): boolean => {
    if (el.tagName.toUpperCase() !== 'INPUT') return false;
    const i = el as HTMLInputElement;
    const ac = (i.getAttribute('autocomplete') ?? '').toLowerCase();
    if (i.type === 'password' || /\b(?:current|new)-password\b/.test(ac)) return true;
    if (!['text', 'search', 'tel', ''].includes(i.type)) return false;
    const labels = i.labels ? Array.from(i.labels).map(l => l.textContent ?? '') : [];
    return HINT.test([i.id, i.name, i.getAttribute('aria-label') ?? '', i.placeholder, ...labels].join(' '));
  };
  const is = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    if (seen.has(el)) return true;
    if (now(el)) { seen.add(el); return true; }
    return false;
  };
  const scan = (root: Document | ShadowRoot): Element[] => {
    const out: Element[] = [];
    const walk = (r: Document | ShadowRoot) => {
      for (const el of Array.from(r.querySelectorAll('*'))) {
        if (is(el)) out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  };
  Object.defineProperty(window, '__sbPw', { value: Object.freeze({ is, scan }), enumerable: false, configurable: false, writable: false });
}

export type WalkMode = 'all' | 'interactive' | 'find';
export interface WalkOptions { mode: WalkMode; query: string; maxChars: number; prefix: string; start: number; maxMatches: number }
export interface FrameMarker { index: number; at: number; depth: number }
export interface WalkResult {
  title: string; url: string; lines: string[]; frames: FrameMarker[]; n: number; truncated: boolean; matches: number;
  indexInParent: number; focused: string | null;
}
export interface PointResult { x: number; y: number; w: number; h: number; covered: string | null; desc: string }
export interface InputInfo {
  kind: 'text' | 'select' | 'checkbox' | 'radio' | 'editable' | 'file' | 'other';
  password: boolean;          // type=password or autocomplete current-password / new-password (guard.ts)
  tag: string; type: string; checked: boolean; disabled: boolean; readonly: boolean; multiple: boolean; value: string; desc: string;
}

/** `(pwKit)(); (fn)(args...)` as a script string for executeJavaScript (the result is fn's). */
export function pageCall(fn: (...a: never[]) => unknown, ...args: unknown[]): string {
  return `(${pwKit.toString()})();\n(${fn.toString()})(${args.map(a => (a === undefined ? 'undefined' : JSON.stringify(a))).join(', ')})`;
}

export function walkPage(o: WalkOptions): WalkResult {
  interface State { n: number; prefix: string; refs: Map<string, WeakRef<Element>>; ids: WeakMap<Element, string> }
  const KEY = '__sbAgent';
  const host = window as unknown as Record<string, State | undefined>;
  let S = host[KEY];
  if (!S || S.prefix !== o.prefix) {
    S = { n: o.start, prefix: o.prefix, refs: new Map(), ids: new WeakMap() };
    Object.defineProperty(window, KEY, { value: S, configurable: true, enumerable: false, writable: true });
  }
  const st: State = S;
  // prune refs of nodes no longer in the page; drop the reverse entry too, so a node re-attached later (virtual scroll
  // recycling) gets a fresh, resolvable ref instead of its pruned one
  if (st.refs.size > 5000) for (const [k, w] of st.refs) { const el = w.deref(); if (!el?.isConnected) { st.refs.delete(k); if (el) st.ids.delete(el); } }
  const refOf = (el: Element): string => {
    let r = st.ids.get(el);
    if (!r) { r = st.prefix + (++st.n); st.ids.set(el, r); st.refs.set(r, new WeakRef(el)); }
    return r;
  };

  const INTER = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],' +
    '[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=option],[role=switch],' +
    '[role=combobox],[role=textbox],[role=searchbox],[role=slider],[role=spinbutton],[role=treeitem],[contenteditable=""],' +
    '[contenteditable=true],[tabindex]:not([tabindex="-1"]),[onclick]';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE']);
  const STRUCT = new Set(['heading', 'dialog', 'alertdialog', 'alert', 'status', 'navigation', 'main', 'form', 'table', 'row', 'cell',
    'columnheader', 'rowheader', 'img', 'region', 'tabpanel', 'menu', 'menubar', 'listbox', 'tree', 'grid', 'list', 'listitem', 'tablist', 'toolbar']);
  const FROM_CONTENT = new Set(['button', 'link', 'heading', 'cell', 'columnheader', 'rowheader', 'option', 'tab', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'treeitem', 'checkbox', 'radio', 'switch', 'gridcell']);
  const TAG_ROLE: Record<string, string> = {
    BUTTON: 'button', SUMMARY: 'button', TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading',
    H5: 'heading', H6: 'heading', TABLE: 'table', TR: 'row', TD: 'cell', TH: 'columnheader', UL: 'list', OL: 'list', LI: 'listitem',
    DIALOG: 'dialog', NAV: 'navigation', MAIN: 'main', FORM: 'form', IFRAME: 'iframe', FRAME: 'iframe', OPTION: 'option',
  };
  const INPUT_ROLE: Record<string, string> = {
    checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider',
    number: 'spinbutton', search: 'searchbox', file: 'button',
  };
  const clean = (s: string | null | undefined, max = 120): string => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return (t.length > max ? t.slice(0, max - 1) + '…' : t).replace(/"/g, "'");
  };
  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0]!;
    const tag = el.tagName.toUpperCase();
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'INPUT') return INPUT_ROLE[(el as HTMLInputElement).type] ?? 'textbox';
    if (tag === 'SELECT') return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
    if (tag === 'IMG') return (el as HTMLImageElement).alt ? 'img' : 'generic';
    if (tag === 'SECTION' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) return 'region';
    if (tag === 'SVG' || tag === 'svg') return el.getAttribute('aria-label') ? 'img' : 'generic';
    return TAG_ROLE[tag] ?? 'generic';
  };
  const textOf = (el: Element): string => (el as HTMLElement).innerText ?? el.textContent ?? '';
  const nameOf = (el: Element, role: string): string => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const doc = el.ownerDocument;
      const t = lb.split(/\s+/).map(id => { const n = doc.getElementById(id); return n ? textOf(n) : ''; }).join(' ');
      if (clean(t)) return clean(t);
    }
    const al = el.getAttribute('aria-label');
    if (al && clean(al)) return clean(al);
    const tag = el.tagName.toUpperCase();
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) { const t = clean(Array.from(labels).map(textOf).join(' ')); if (t) return t; }
    if (tag === 'IMG') return clean((el as HTMLImageElement).alt);
    if (tag === 'INPUT' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type)) return clean((el as HTMLInputElement).value || (el as HTMLInputElement).type);
    if (tag === 'INPUT' || tag === 'TEXTAREA') return clean((el as HTMLInputElement).placeholder || el.getAttribute('title') || (el as HTMLInputElement).name);
    if (tag === 'IFRAME' || tag === 'FRAME') return clean(el.getAttribute('title') || el.getAttribute('name') || el.getAttribute('src'), 80);
    if (FROM_CONTENT.has(role) || el.matches(INTER)) return clean(textOf(el) || el.getAttribute('title') || '');
    return clean(el.getAttribute('title') || '');
  };
  const extra = (el: Element, role: string): string => {
    const out: string[] = [];
    const tag = el.tagName.toUpperCase();
    const input = el as HTMLInputElement;
    const pw = tag === 'INPUT' && (window as unknown as { __sbPw: PwKit }).__sbPw.is(el);   // marks it for good
    if (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'text'].includes(input.type)) out.push(`type=${input.type}`);
    if (pw && input.type !== 'password') out.push('password');
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file'].includes(input.type) && input.value) {
      out.push(`value="${pw ? '•••' : clean(input.value, 80)}"`);
    }
    if (tag === 'SELECT') {
      const s = el as HTMLSelectElement;
      const sel = Array.from(s.selectedOptions).map(x => clean(x.text, 40)).join(', ');
      if (sel) out.push(`value="${sel}"`);
      const opts = Array.from(s.options).slice(0, 12).map(x => clean(x.text, 30));
      if (opts.length) out.push(`options=${opts.join('|')}${s.options.length > 12 ? `|…(${s.options.length})` : ''}`);
    }
    if (el.getAttribute('contenteditable') !== null && el.getAttribute('contenteditable') !== 'false') out.push(`value="${clean(textOf(el), 80)}"`);
    if (input.checked || el.getAttribute('aria-checked') === 'true') out.push('checked');
    if (el.getAttribute('aria-checked') === 'mixed' || input.indeterminate) out.push('mixed');
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') out.push('disabled');
    if (input.required || el.getAttribute('aria-required') === 'true') out.push('required');
    if (input.readOnly || el.getAttribute('aria-readonly') === 'true') out.push('readonly');
    const exp = el.getAttribute('aria-expanded');
    if (exp) out.push(exp === 'true' ? 'expanded' : 'collapsed');
    if (el.getAttribute('aria-selected') === 'true' || (tag === 'OPTION' && (el as HTMLOptionElement).selected)) out.push('selected');
    if (el.getAttribute('aria-invalid') === 'true') out.push('invalid');
    if (tag === 'A' && el.getAttribute('href')) out.push(`href="${clean(el.getAttribute('href'), 80)}"`);
    if (role === 'heading') { const lv = el.getAttribute('aria-level') || (/^H([1-6])$/.exec(tag)?.[1] ?? ''); if (lv) out.push(`level=${lv}`); }
    return out.length ? ' ' + out.join(' ') : '';
  };

  let active: Element | null = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;

  const lines: string[] = [];
  const frames: FrameMarker[] = [];
  const q = o.query.toLowerCase();
  const seen = new Set<Element>();
  let size = 0, matches = 0, stop = false, truncated = false;
  const push = (l: string) => {
    if (size + l.length + 1 > o.maxChars) { stop = true; truncated = true; return; }
    lines.push(l); size += l.length + 1;
  };
  const indent = (d: number) => '  '.repeat(d);
  const lineOf = (el: Element, role: string) => {
    const name = nameOf(el, role);
    return `${role}${name ? ` "${name}"` : ''}${extra(el, role)}${el === active ? ' focused' : ''} [${refOf(el)}]`;
  };
  const pushMatch = (el: Element | null, text?: string) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    if (matches >= o.maxMatches) { stop = true; truncated = true; return; }
    matches++;
    const role = roleOf(el);
    if (text !== undefined && !el.matches(INTER) && !STRUCT.has(role)) push(`text "${text}" [${refOf(el)}]`);
    else push(lineOf(el, role));
  };

  const visitNodes = (parent: Node, depth: number, textOk: boolean): void => {
    for (const node of Array.from(parent.childNodes)) {
      if (stop) return;
      if (node.nodeType === 3) {
        if (!textOk || o.mode === 'interactive') continue;
        const t = clean(node.textContent, 200);
        if (!t) continue;
        if (o.mode === 'all') push(`${indent(depth)}text "${t}"`);
        else if (t.toLowerCase().includes(q)) pushMatch(node.parentElement, t);
        continue;
      }
      if (node.nodeType === 1) visitElement(node as Element, depth, textOk);
    }
  };

  const visitElement = (el: Element, depth: number, parentTextOk: boolean): void => {
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    if (cs.display === 'contents') { if (el.shadowRoot) visitNodes(el.shadowRoot, depth, parentTextOk); visitNodes(el, depth, parentTextOk); return; }
    const rect = el.getBoundingClientRect();
    const vis = cs.visibility !== 'hidden' && cs.visibility !== 'collapse' && (rect.width > 0 || rect.height > 0);
    const role = roleOf(el);
    let d = depth;
    let textOk = vis && parentTextOk;
    if (vis && (tag === 'IFRAME' || tag === 'FRAME')) {
      if (o.mode === 'find') return;
      push(`${indent(depth)}${lineOf(el, 'iframe')}`);
      const cw = (el as HTMLIFrameElement).contentWindow;
      let index = -1;
      for (let i = 0; i < window.frames.length; i++) if (window.frames[i] === cw) { index = i; break; }
      if (index >= 0 && !stop) frames.push({ index, at: lines.length - 1, depth: depth + 1 });
      return;
    }
    if (tag === 'SVG' || tag === 'svg') {
      if (vis && role === 'img' && o.mode !== 'interactive') { if (o.mode === 'find') { if (lineOf(el, role).toLowerCase().includes(q)) pushMatch(el); } else push(`${indent(depth)}${lineOf(el, role)}`); }
      return;
    }
    if (vis) {
      const inter = el.matches(INTER);
      const labeledRegion = role !== 'region' || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
      const struct = STRUCT.has(role) && labeledRegion;
      if (o.mode === 'find') {
        if (inter || struct) {
          const name = nameOf(el, role);
          const hay = `${role} ${name} ${el.id} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('name') ?? ''} ${el.getAttribute('data-testid') ?? ''}`.toLowerCase();
          if (hay.includes(q)) pushMatch(el);
        }
      } else if (inter || (o.mode === 'all' && struct)) {
        push(`${indent(depth)}${lineOf(el, role)}`);
        d = depth + 1;
        if (FROM_CONTENT.has(role) || inter) textOk = false;
      }
    }
    if (el.shadowRoot) visitNodes(el.shadowRoot, d, textOk);
    visitNodes(el, d, textOk);
  };

  if (document.body) visitNodes(document.body, 0, true);
  else if (document.documentElement) visitNodes(document.documentElement, 0, true);

  let indexInParent = -1;
  try {
    if (window.parent !== window) for (let i = 0; i < window.parent.frames.length; i++) if (window.parent.frames[i] === window) { indexInParent = i; break; }
  } catch { /* detached */ }
  const focused = active && active !== document.body ? (st.ids.get(active) ?? null) : null;
  return { title: document.title, url: location.href, lines, frames, n: st.n, truncated, matches, indexInParent, focused };
}

/** This frame's index in its parent's window.frames (cross-origin safe), -1 for the top frame. */
export function indexInParent(): number {
  try {
    if (window.parent === window) return -1;
    for (let i = 0; i < window.parent.frames.length; i++) if (window.parent.frames[i] === window) return i;
  } catch { /* detached */ }
  return -2;
}

/** Scrolls a ref into view when needed and returns the center of its visible part in this frame's viewport. */
export function locateRef(ref: string, scroll: boolean): PointResult | { error: string } {
  const S = (window as unknown as Record<string, { refs: Map<string, WeakRef<Element>> } | undefined>).__sbAgent;
  const el = S?.refs.get(ref)?.deref();
  if (!el || !el.isConnected) return { error: 'stale' };
  const describe = (e: Element): string => {
    const id = e.id ? `#${e.id}` : '';
    const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const txt = ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${e.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  const contains = (a: Node, b: Node | null): boolean => {
    for (let n: Node | null = b; n; n = n.parentNode ?? (n as ShadowRoot).host ?? null) if (n === a) return true;
    return false;
  };
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  let r = el.getBoundingClientRect();
  if (!r.width && !r.height) return { error: `zero-size: ${describe(el)} has no box (hidden). Click its visible label or container instead.` };
  const inView = r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw;
  if (scroll && !inView) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); r = el.getBoundingClientRect(); }
  const left = Math.max(r.left, 0), top = Math.max(r.top, 0), right = Math.min(r.right, vw), bottom = Math.min(r.bottom, vh);
  if (right <= left || bottom <= top) return { error: `offscreen: ${describe(el)} is outside the viewport and could not be scrolled into view.` };
  const x = (left + right) / 2, y = (top + bottom) / 2;
  const root = el.getRootNode() as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
  const hit = typeof root.elementFromPoint === 'function' ? root.elementFromPoint.call(root, x, y) : document.elementFromPoint(x, y);
  let covered: string | null = null;
  if (hit && !(hit === el || contains(el, hit) || contains(hit, el))) {
    const lbl = hit.closest('label') as HTMLLabelElement | null;
    const labels = (el as HTMLInputElement).labels;
    const isLabel = !!lbl && (lbl.control === el || (!!labels && Array.from(labels).includes(lbl)));
    if (!isLabel) covered = describe(hit);
  }
  return { x, y, w: r.width, h: r.height, covered, desc: describe(el) };
}

/** In a parent frame: the point (x, y) of child frame #index in this frame's viewport, scrolling the iframe into view. */
export function frameBox(index: number, x: number, y: number): { x: number; y: number; covered: string | null } | { error: string } {
  const target = window.frames[index];
  if (!target) return { error: `frame #${index} is gone` };
  const find = (root: Document | ShadowRoot): HTMLIFrameElement | null => {
    for (const f of Array.from(root.querySelectorAll('iframe,frame'))) if ((f as HTMLIFrameElement).contentWindow === target) return f as HTMLIFrameElement;
    for (const h of Array.from(root.querySelectorAll('*'))) if (h.shadowRoot) { const r = find(h.shadowRoot); if (r) return r; }
    return null;
  };
  const el = find(document);
  if (!el) return { error: 'iframe element not found' };
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const at = () => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { px: r.left + el.clientLeft + parseFloat(cs.paddingLeft || '0') + x, py: r.top + el.clientTop + parseFloat(cs.paddingTop || '0') + y };
  };
  let p = at();
  const out = () => p.px < 0 || p.py < 0 || p.px >= vw || p.py >= vh;
  if (out()) { el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); p = at(); }
  if (out()) { window.scrollBy({ left: p.px < 0 || p.px >= vw ? p.px - vw / 2 : 0, top: p.py < 0 || p.py >= vh ? p.py - vh / 2 : 0, behavior: 'instant' }); p = at(); }
  if (out()) return { error: 'the iframe point is outside the viewport' };
  const root = el.getRootNode() as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
  const hit = typeof root.elementFromPoint === 'function' ? root.elementFromPoint.call(root, p.px, p.py) : document.elementFromPoint(p.px, p.py);
  const covered = hit && hit !== el ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}` : null;
  return { x: p.px, y: p.py, covered };
}

/** What kind of control a ref is (for fill_form / type), with its current value (passwords masked). */
export function inputInfo(ref: string): InputInfo | { error: string } {
  const S = (window as unknown as Record<string, { refs: Map<string, WeakRef<Element>> } | undefined>).__sbAgent;
  const el = S?.refs.get(ref)?.deref();
  if (!el || !el.isConnected) return { error: 'stale' };
  const tag = el.tagName.toUpperCase();
  const i = el as HTMLInputElement;
  const type = tag === 'INPUT' ? i.type : tag.toLowerCase();
  const editable = (el as HTMLElement).isContentEditable;
  const role = el.getAttribute('role');
  const kind: InputInfo['kind'] =
    tag === 'SELECT' ? 'select'
      : tag === 'INPUT' && type === 'checkbox' || role === 'checkbox' || role === 'switch' ? 'checkbox'
        : tag === 'INPUT' && type === 'radio' || role === 'radio' ? 'radio'
          : tag === 'INPUT' && type === 'file' ? 'file'
            : tag === 'TEXTAREA' || (tag === 'INPUT' && !['button', 'submit', 'reset', 'image', 'range', 'color'].includes(type)) ? 'text'
              : editable ? 'editable' : 'other';
  const checked = tag === 'INPUT' ? i.checked : el.getAttribute('aria-checked') === 'true';
  const raw = tag === 'SELECT' ? Array.from((el as HTMLSelectElement).selectedOptions).map(o => o.text.trim()).join(', ')
    : tag === 'INPUT' || tag === 'TEXTAREA' ? i.value : editable ? ((el as HTMLElement).innerText ?? '') : '';
  const pw = (window as unknown as { __sbPw: PwKit }).__sbPw.is(el);   // ever seen as a password field
  const value = pw && raw ? '•••' : raw.slice(0, 200);
  const name = (el.getAttribute('aria-label') || (i.labels && i.labels[0] ? i.labels[0].innerText : '') || i.placeholder || i.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return {
    kind, password: pw, tag: tag.toLowerCase(), type, checked, disabled: !!i.disabled || el.getAttribute('aria-disabled') === 'true',
    readonly: !!i.readOnly, multiple: tag === 'SELECT' && (el as HTMLSelectElement).multiple, value, desc: `${tag.toLowerCase()}${name ? ` "${name}"` : ''}`,
  };
}

/** The guard's view of a field: the ref's element, or the focused element of this frame (deep, through shadow roots).
 *  password: true when ever seen as a password field in this document (pwKit). Scans the frame first so that every password
 *  field present now is remembered even if a "show password" toggle changes its type later. */
export function fieldFacts(ref: string | null): { password: boolean; focused: boolean; desc: string; hasFocus: boolean } {
  const kit = (window as unknown as { __sbPw: PwKit }).__sbPw;
  kit.scan(document);
  let el: Element | null | undefined = null;
  if (ref) el = (window as unknown as Record<string, { refs: Map<string, WeakRef<Element>> } | undefined>).__sbAgent?.refs.get(ref)?.deref();
  else { el = document.activeElement; while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement; }
  if (!el) return { password: false, focused: false, desc: '', hasFocus: document.hasFocus() };
  const i = el as HTMLInputElement;
  const name = (el.getAttribute('aria-label') || (i.labels && i.labels[0] ? i.labels[0].innerText : '') || i.placeholder || i.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { password: kit.is(el), focused: el !== document.body, desc: `${el.tagName.toLowerCase()}${name ? ` "${name}"` : ''}`, hasFocus: document.hasFocus() };
}

/** Does this frame hold a password field? Pierces open shadow roots; hidden fields count unless visibleOnly (the
 *  sign-in page detection of the session status wants only what the user sees). */
export function hasPasswordField(visibleOnly: boolean): boolean {
  const found = (window as unknown as { __sbPw: PwKit }).__sbPw.scan(document);
  if (!visibleOnly) return found.length > 0;
  return found.some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
}

/** Focuses a text control and selects its content (so typed text replaces it). True when it holds the focus. */
export function focusSelect(ref: string, selectAll: boolean): boolean {
  const S = (window as unknown as Record<string, { refs: Map<string, WeakRef<Element>> } | undefined>).__sbAgent;
  const el = S?.refs.get(ref)?.deref() as HTMLElement | undefined;
  if (!el || !el.isConnected) return false;
  el.focus();
  if (selectAll) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { try { el.select(); } catch { /* type without selection */ } }
    else if (el.isContentEditable) { const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(el); sel?.removeAllRanges(); sel?.addRange(range); }
  }
  let a: Element | null = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a === el && document.hasFocus();
}

/** Selects options of a <select> by value or visible text (case-insensitive) and fires input + change. */
export function selectOptions(ref: string, values: string[]): { selected: string[] } | { error: string } {
  const S = (window as unknown as Record<string, { refs: Map<string, WeakRef<Element>> } | undefined>).__sbAgent;
  const el = S?.refs.get(ref)?.deref();
  if (!el || !el.isConnected) return { error: 'stale' };
  if (el.tagName.toUpperCase() !== 'SELECT') return { error: `not a <select> (${el.tagName.toLowerCase()}): for custom dropdowns click the field, then click the option` };
  const sel = el as HTMLSelectElement;
  const want = values.map(v => String(v).trim().toLowerCase());
  const hits: HTMLOptionElement[] = [];
  for (const opt of Array.from(sel.options)) {
    if (want.includes(opt.value.toLowerCase()) || want.includes(opt.text.trim().toLowerCase()) || want.includes(opt.label.trim().toLowerCase())) hits.push(opt);
  }
  if (!hits.length) return { error: `no option matches ${JSON.stringify(values)}; options: ${Array.from(sel.options).slice(0, 30).map(o => o.text.trim()).join(' | ')}` };
  if (sel.multiple) for (const opt of Array.from(sel.options)) opt.selected = hits.includes(opt);
  else sel.value = hits[0]!.value;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { selected: Array.from(sel.selectedOptions).map(o => o.text.trim()) };
}

/** Visible text: the main/article region when it has content (unless full), else the whole body. */
export function pageText(full: boolean, maxChars: number): { title: string; url: string; text: string; scope: string; truncated: boolean } {
  const main = full ? null : document.querySelector('main,[role=main],article') as HTMLElement | null;
  const mainText = main ? main.innerText.trim() : '';
  const useMain = mainText.length >= 50;
  const text = useMain ? mainText : (document.body?.innerText ?? '').trim();
  return { title: document.title, url: location.href, text: text.slice(0, maxChars), scope: useMain ? 'main' : 'body', truncated: text.length > maxChars };
}

/** For wait_for: is the text present / a visible element matching the selector there, in this frame? */
export function probe(o: { text?: string; selector?: string }): { text: boolean | null; selector: boolean | null; error?: string } {
  let text: boolean | null = null, selector: boolean | null = null;
  if (o.text) text = (document.body?.innerText ?? '').includes(o.text);
  if (o.selector) {
    try {
      const el = document.querySelector(o.selector);
      if (!el) selector = false;
      else { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); selector = (r.width > 0 || r.height > 0) && cs.visibility !== 'hidden'; }
    } catch (e) { return { text, selector: null, error: `invalid selector: ${(e as Error).message}` }; }
  }
  return { text, selector };
}

/** Angular apps: true when every testability is stable, false while busy, null when not an Angular page. */
export function angularStable(): boolean | null {
  const f = (window as unknown as { getAllAngularTestabilities?: () => Array<{ isStable(): boolean }> }).getAllAngularTestabilities;
  if (typeof f !== 'function') return null;
  try { return f().every(t => t.isStable()); } catch { return null; }
}
