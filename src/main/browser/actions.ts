// What an agent can do in a tab: read it (frame-aware tree with refs, text, find), act on it with trusted CDP input
// (click, type, key, scroll, drag, fill_form, select_option), wait, see it (screenshots), answer dialogs, inspect
// network and console, evaluate JavaScript. Frames: every iframe (same- or cross-origin) is walked in its own renderer
// through WebFrameMain.executeJavaScript and spliced under its iframe line; a ref inside frame N is located in that
// frame and its point is translated up through each parent iframe to top-level viewport CSS pixels. Every write action
// returns a short result (what changed: URL, dialog, console errors, failed requests, new tabs, downloads) so the agent
// rarely needs an extra read. Nothing here waits forever: page scripts and input race a timeout and dialog opening.
// HARD LIMIT (guard.ts): never type a password on a remote host; agents get an error pointing to handoff_to_user.
// Used by browser/tools.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { WebFrameMain } from 'electron';
import { errText, redact } from '../log';
import type { BrowserTabs, Tab } from './tabs';
import { pageCall, walkPage, locateRef, frameBox, inputInfo, focusSelect, selectOptions, pageText, probe, angularStable, fieldFacts, hasPasswordField,
  type WalkMode, type WalkResult, type PointResult, type InputInfo, type FrameMarker } from './page';
import { parseRef, parseFrame, refPrefix } from './refs';
import { charKey, parseKeys, parseModifiers, strokeEvents, MOD } from './keys';
import { evidencePath, stampName } from './evidence';
import { formatDetail, formatEntry, redactBody } from './netlog';
import { globMatch } from './glob';
import { changesInputType, hostOf, isLocalHost, passwordRefusal, urlCredentials } from './guard';
import { isLoginUrl } from './envs';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
type Step = [string, Record<string, unknown>];

export interface Before { url: string; console: number; t0: number; tabs: Set<string>; downloads: number; dialogs: number }
export interface Shot { png: Buffer; width: number; height: number; note: string }

export function normalizeUrl(input: string): string {
  const s = String(input ?? '').trim();
  if (!s) throw new Error('url is empty');
  if (/^about:blank$/i.test(s)) return 'about:blank';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(?:localhost|127\.0\.0\.1|\[::1\]):\d/i.test(s)) throw new Error(`Only http(s) URLs can be opened (got "${s.split(':')[0]}:").`);
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(s)) return `http://${s}`;
  return `https://${s}`;
}

export function dialogText(tab: Tab): string {
  const d = tab.dialog;
  return d ? `A JavaScript ${d.type} dialog is open: "${d.message}".` : '';
}

export class BrowserActions {
  constructor(private readonly tabs: BrowserTabs) {}

  // ---------- plumbing ----------

  /** Throws an actionable error when the tab cannot take actions now. */
  guard(tab: Tab, { allowDialog = false }: { allowDialog?: boolean } = {}): void {
    if (tab.wc.isDestroyed()) throw new Error('The tab was closed: call tabs_list.');
    if (tab.dialog && !allowDialog) throw new Error(`${dialogText(tab)} The page is blocked until you call handle_dialog (accept: true = OK, false = Cancel).`);
  }

  private cdp(tab: Tab) {
    if (!tab.cdp) throw new Error('This tab is not under agent automation.');
    return tab.cdp;
  }

  /** Runs a page script in a frame, racing a timeout and a dialog opening (a dialog blocks the page's JS). */
  async evalIn<T>(tab: Tab, frame: WebFrameMain, script: string, ms = 6000): Promise<T> {
    if (tab.dialog) throw new Error(`${dialogText(tab)} Call handle_dialog first.`);     // the page's JS is blocked
    const d = this.tabs.dialogOpened(tab);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        frame.executeJavaScript(script) as Promise<T>,
        d.promise.then(() => { throw new Error(tab.dialog ? `${dialogText(tab)} Call handle_dialog first.` : 'The tab was closed: call tabs_list.'); }),
        new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error(`the page did not answer within ${ms / 1000}s (a long-running script?)`)), ms); }),
      ]);
    } finally {
      d.cancel();
      if (timer) clearTimeout(timer);
    }
  }

  /** Sends CDP input events in order; stops early (without error) if a dialog opens, since the page then blocks. */
  private async input(tab: Tab, steps: Step[]): Promise<'ok' | 'dialog'> {
    if (tab.dialog) return 'dialog';
    const cdp = this.cdp(tab);
    const d = this.tabs.dialogOpened(tab);
    try {
      for (const [method, params] of steps) {
        let timer: NodeJS.Timeout | undefined;
        const r = await Promise.race([
          cdp.send(method, params).then(() => 'ok' as const),
          d.promise.then(() => 'dialog' as const),
          new Promise<'timeout'>(res => { timer = setTimeout(() => res('timeout'), 10_000); }),
        ]).catch(async (e: unknown) => {
          await sleep(100);
          if (tab.wc.isDestroyed()) return 'closed' as const;       // the input closed the page (window.close())
          throw e;
        }).finally(() => { if (timer) clearTimeout(timer); });
        if (r === 'closed') return 'ok';
        if (r === 'dialog') return 'dialog';
        if (r === 'timeout') throw new Error('the page did not take the input within 10s');
      }
      return 'ok';
    } finally {
      d.cancel();
    }
  }

  /** Waits until the page is quiet: not loading, no request in flight for 250ms, Angular stable (bounded). */
  async settle(tab: Tab, max = 4000): Promise<void> {
    await sleep(120);
    const end = Date.now() + max;
    let quiet = 0;
    while (Date.now() < end && !tab.wc.isDestroyed() && !tab.dialog) {
      const busy = tab.wc.isLoading() || tab.net.inflight() > 0;
      if (busy) quiet = 0;
      else if (!quiet) quiet = Date.now();
      else if (Date.now() - quiet >= 250) break;
      await sleep(50);
    }
    for (let i = 0; i < 10 && !tab.wc.isDestroyed() && !tab.dialog; i++) {
      const stable = await this.evalIn<boolean | null>(tab, tab.wc.mainFrame, pageCall(angularStable), 500).catch(() => null);
      if (stable !== false) break;
      await sleep(100);
    }
  }

  begin(tab: Tab, label: string): Before {
    this.tabs.setLastAction(tab, label);
    return {
      url: tab.wc.getURL(), console: tab.consoleSeq, t0: Date.now(), tabs: new Set(this.tabs.tabsOf(tab.group).map(t => t.id)),
      downloads: tab.downloads.length, dialogs: tab.dialogSeq,
    };
  }

  /** The short "what changed" block returned by every write action. */
  async summary(tab: Tab, b: Before, detail: string): Promise<string> {
    const lines = [detail];
    const fresh = this.tabs.tabsOf(tab.group).filter(t => !b.tabs.has(t.id));
    for (const t of fresh) {
      for (let i = 0; i < 40 && !t.wc.isDestroyed() && (t.wc.isLoading() || t.wc.getURL() === '' || t.wc.getURL() === 'about:blank'); i++) await sleep(75);
    }
    if (tab.wc.isDestroyed()) {
      lines.push(`Tab ${tab.id} closed itself.${this.tabs.activeOf(tab.group) ? ` Your active tab is now ${this.tabs.activeOf(tab.group)!.id}.` : ''}`);
      return lines.join('\n');
    }
    const url = tab.wc.getURL();
    if (url !== b.url) lines.push(`URL changed: ${redact(b.url)} → ${redact(url)}`);
    lines.push(`Tab ${tab.id}: "${tab.wc.getTitle()}" ${redact(url)}${tab.wc.isLoading() ? ' (still loading)' : ''} · env ${tab.env}`);
    if (tab.dialog) lines.push(`Dialog open: ${tab.dialog.type} "${tab.dialog.message}". The page waits: call handle_dialog (accept: true = OK, false = Cancel).`);
    else {
      if (tab.dialogSeq > b.dialogs && tab.lastDialog) lines.push(`A ${tab.lastDialog.type} dialog "${tab.lastDialog.message}" opened and was ${tab.lastDialog.result}.`);
      const notice = await this.loginNotice(tab);
      if (notice) lines.push(notice);
    }
    const errs = tab.console.filter(c => c.seq > b.console && c.level === 'error');
    if (errs.length) lines.push(`Console errors (${errs.length} new): ${errs.slice(0, 3).map(e => e.text.slice(0, 200)).join(' | ')}${errs.length > 3 ? ' …' : ''}`);
    const fails = tab.net.failuresSince(b.t0);
    if (fails.length) lines.push(`Failed requests (${fails.length}): ${fails.slice(0, 3).map(formatEntry).join(' | ')}${fails.length > 3 ? ' … (network_requests status "error")' : ''}`);
    for (const t of fresh) lines.push(`New tab ${t.id} opened${t.openedBy ? ` by ${t.openedBy}` : ''}: "${t.wc.isDestroyed() ? '' : t.wc.getTitle()}" ${t.wc.isDestroyed() ? '(closed)' : redact(t.wc.getURL())}${this.tabs.activeOf(tab.group)?.id === t.id ? ` (now your active tab; tabs_select ${tab.id} to go back)` : ''}`);
    for (const d of tab.downloads.slice(b.downloads)) lines.push(`Download ${d.state}: ${d.path}`);
    if (tab.unloadBlockedAt >= b.t0) lines.push('The page tried to block leaving it (beforeunload: unsaved changes?). Use navigate with force: true to leave anyway.');
    return lines.join('\n');
  }

  /** When the tab shows a sign-in page: what the agent may do (local stack: sign in itself; remote: hand off to the user). */
  async loginNotice(tab: Tab): Promise<string> {
    if (tab.wc.isDestroyed()) return '';
    const url = tab.wc.getURL();
    if (!/^https?:/i.test(url)) return '';
    const form = await this.evalIn<boolean>(tab, tab.wc.mainFrame, pageCall(hasPasswordField, true), 1500).catch(() => false);
    if (!form && !isLoginUrl(url)) return '';
    const host = hostOf(url);
    return isLocalHost(host)
      ? `Sign-in page on a local stack (${host}): you may sign in with the project's test accounts.`
      : `Sign-in page in environment ${tab.env} (${host}). You never type passwords on remote hosts: call handoff_to_user with kind "login"; the user signs in once and environment ${tab.env} keeps the session.`;
  }

  /** HARD LIMIT: refuses when the target (a ref, or the focused element of any frame) is a password field on a remote
   *  host. Checked before typing anything. */
  async guardPassword(tab: Tab, ref: unknown, what: string): Promise<void> {
    const check = async (frame: WebFrameMain, r: string | null) => {
      const host = frameHost(frame);
      if (isLocalHost(host)) return;
      const facts = await this.evalIn<{ password: boolean; focused: boolean; desc: string; hasFocus: boolean }>(tab, frame, pageCall(fieldFacts, r), 3000).catch(() => null);
      // fail closed: a remote frame we cannot read might hold a password field
      if (!facts) throw new Error(`Refused: could not verify that ${what} is not a password field on ${host || 'a remote page'} (the page did not answer). Try again, or use handoff_to_user.`);
      if (facts.password) throw passwordRefusal(`${what} (${facts.desc || 'password field'})`, host, tab.env);
    };
    if (ref !== undefined && ref !== null && ref !== '') {
      const { frame, ref: r } = parseRef(ref);
      await check(this.tabs.frameByNo(tab, frame), r);
      return;
    }
    for (const f of this.tabs.frames(tab)) await check(f, null);
  }

  /** Runs a write action with its before/after summary. */
  async act(tab: Tab, label: string, fn: () => Promise<string>, opts: { allowDialog?: boolean; settle?: number } = {}): Promise<string> {
    this.guard(tab, opts);
    const h = this.tabs.handoffs.openFor(tab.id);
    if (h) throw new Error(`The user is working in this tab (hand-off ${h.id}: ${h.reason}). Wait with handoff_to_user handoff_id "${h.id}".`);
    const b = this.begin(tab, label);
    const detail = await fn();
    if (!tab.wc.isDestroyed()) await this.settle(tab, opts.settle ?? 4000);
    return this.summary(tab, b, detail);
  }

  // ---------- reading ----------

  async snapshot(tab: Tab, mode: WalkMode, query = '', maxChars = 40000): Promise<string> {
    this.guard(tab);
    const max = Math.max(500, Math.min(200_000, Math.floor(maxChars)));
    const frames = this.tabs.frames(tab);
    const results = new Map<WebFrameMain, { no: number; res?: WalkResult; error?: string }>();
    await Promise.all(frames.map(async f => {
      const no = this.tabs.frameNo(tab, f);
      try {
        const res = await this.evalIn<WalkResult>(tab, f, pageCall(walkPage, { mode, query, maxChars: max, prefix: refPrefix(no), start: tab.refStart.get(no) ?? 0, maxMatches: 30 }), 8000);
        tab.refStart.set(no, Math.max(tab.refStart.get(no) ?? 0, res.n));
        results.set(f, { no, res });
      } catch (e) { results.set(f, { no, error: errText(e) }); }
    }));
    this.guard(tab);
    const top = tab.wc.mainFrame;
    const topRes = results.get(top)?.res;
    const head = [`Tab ${tab.id}: "${tab.wc.getTitle()}" ${redact(tab.wc.getURL())}`];
    if (topRes?.focused) head.push(`Focused: ${topRes.focused}`);
    const out: string[] = [];
    if (mode === 'find') {
      let total = 0;
      for (const f of frames) {
        const r = results.get(f);
        if (!r?.res?.lines.length) continue;
        if (f !== top) out.push(`(in iframe f${r.no} ${originOf(f)})`);
        out.push(...r.res.lines);
        total += r.res.matches;
      }
      head.push(total ? `${total} match${total > 1 ? 'es' : ''} for "${query}"${total >= 30 ? ' (first 30: refine the query)' : ''}:` : `Nothing matches "${query}". Try a shorter query, read_page, or get_page_text.`);
      return [...head, ...out].join('\n');
    }
    const kids = new Map<WebFrameMain, WebFrameMain[]>();
    for (const f of frames) if (f.parent) { const k = kids.get(f.parent) ?? []; k.push(f); kids.set(f.parent, k); }
    const ind = (d: number) => '  '.repeat(d);
    let truncated = false;
    const emit = (f: WebFrameMain, base: number) => {
      const r = results.get(f);
      if (!r) return;
      if (!r.res) { out.push(`${ind(base)}(frame f${r.no} not readable: ${r.error ?? 'unknown error'})`); return; }
      truncated ||= r.res.truncated;
      const markers = new Map<number, FrameMarker>(r.res.frames.map(m => [m.at, m]));
      const mine = kids.get(f) ?? [];
      r.res.lines.forEach((line, i) => {
        const m = markers.get(i);
        const child = m ? mine.find(k => this.tabs.childIndex(k) === m.index) : undefined;
        if (!m || !child) { out.push(ind(base) + line); return; }
        const cr = results.get(child)!;
        out.push(`${ind(base)}${line} → frame f${cr.no} ${originOf(child)}${child.origin !== f.origin ? ' (cross-origin)' : ''}`);
        emit(child, base + m.depth);
      });
      for (const k of mine) { const kr = results.get(k); if (kr && !kr.res) out.push(`${ind(base + 1)}(iframe f${kr.no} ${originOf(k)} not readable: ${kr.error ?? 'unknown error'})`); }
    };
    emit(top, 0);
    let text = out.join('\n');
    if (text.length > max) { text = text.slice(0, text.lastIndexOf('\n', max)); truncated = true; }
    if (!text.trim()) text = mode === 'interactive' ? '(no interactive elements: try filter "all" or get_page_text)' : '(empty page)';
    return [...head, text, ...(truncated ? [`…(truncated at ${max} chars: use filter "interactive", find, or a larger max_chars)`] : [])].join('\n');
  }

  async text(tab: Tab, maxChars = 30000, full = false): Promise<string> {
    this.guard(tab);
    const max = Math.max(200, Math.min(200_000, Math.floor(maxChars)));
    const parts: string[] = [];
    let left = max;
    for (const f of this.tabs.frames(tab)) {
      if (left <= 0) break;
      const no = this.tabs.frameNo(tab, f);
      try {
        const r = await this.evalIn<{ title: string; url: string; text: string; scope: string; truncated: boolean }>(tab, f, pageCall(pageText, full || no !== 0, left));
        if (!r.text && no !== 0) continue;
        parts.push(no === 0 ? `Tab ${tab.id}: "${r.title}" ${redact(r.url)}${r.scope === 'main' ? ' (main content; full: true for the whole page)' : ''}\n${r.text}` : `--- iframe f${no} ${originOf(f)} ---\n${r.text}`);
        left -= r.text.length;
      } catch (e) { parts.push(`--- iframe f${no}: not readable (${errText(e)}) ---`); }
    }
    return parts.join('\n') + (left <= 0 ? `\n…(truncated at ${max} chars)` : '');
  }

  // ---------- locating ----------

  /** Top-level viewport CSS pixels of a ref's center (scrolled into view, through every parent iframe). */
  async point(tab: Tab, refInput: unknown): Promise<{ x: number; y: number; desc: string }> {
    const { frame: no, ref } = parseRef(refInput);
    for (let attempt = 0; ; attempt++) {
      const frame = this.tabs.frameByNo(tab, no);
      const r = await this.evalIn<PointResult | { error: string }>(tab, frame, pageCall(locateRef, ref, true));
      if ('error' in r) {
        if (r.error === 'stale') throw new Error(`${ref} is no longer on the page (it changed or reloaded): call read_page or find for fresh refs.`);
        throw new Error(`${ref}: ${r.error}`);
      }
      let x = r.x, y = r.y;
      let covered = r.covered ? `${ref} (${r.desc}) is covered by ${r.covered}` : null;
      for (let f: WebFrameMain = frame; f.parent; f = f.parent) {
        const idx = this.tabs.childIndex(f);                // from the browser's frame tree, never from the frame itself
        if (idx < 0) throw new Error(`cannot place frame f${no} inside its parent page`);
        const p = await this.evalIn<{ x: number; y: number; covered: string | null } | { error: string }>(tab, f.parent, pageCall(frameBox, idx, x, y));
        if ('error' in p) throw new Error(`${ref}: ${p.error}`);
        x = p.x; y = p.y;
        if (!covered && p.covered) covered = `the iframe holding ${ref} is covered by ${p.covered}`;
      }
      if (!covered) return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, desc: `${ref} ${r.desc}` };
      if (attempt >= 3) throw new Error(`${covered}: close the overlay first (Escape, or click outside it), or click by coordinate to force.`);
      await sleep(250);
    }
  }

  private async target(tab: Tab, ref: unknown, coordinate: unknown): Promise<{ x: number; y: number; what: string }> {
    if (ref !== undefined && ref !== null && ref !== '') { const p = await this.point(tab, ref); return { x: p.x, y: p.y, what: p.desc }; }
    if (Array.isArray(coordinate) && coordinate.length === 2 && coordinate.every(n => typeof n === 'number' && Number.isFinite(n))) {
      const b = tab.view.getBounds();
      const [x, y] = coordinate as [number, number];
      if (x < 0 || y < 0 || x >= b.width || y >= b.height) throw new Error(`coordinate (${x}, ${y}) is outside the viewport (${b.width}x${b.height} CSS px).`);
      return { x, y, what: `(${x}, ${y})` };
    }
    throw new Error('Pass ref (from read_page/find) or coordinate [x, y] (CSS px of the last screenshot).');
  }

  // ---------- acting ----------

  async click(tab: Tab, a: { ref?: unknown; coordinate?: unknown; button?: unknown; clickCount?: unknown; modifiers?: unknown }): Promise<string> {
    const button = String(a.button ?? 'left');
    if (!['left', 'right', 'middle'].includes(button)) throw new Error('button must be left, right or middle');
    const count = Math.max(1, Math.min(3, Math.floor(Number(a.clickCount ?? 1)) || 1));
    const modifiers = parseModifiers(a.modifiers);
    const t = await this.target(tab, a.ref, a.coordinate);
    const bits = button === 'left' ? 1 : button === 'right' ? 2 : 4;
    const steps: Step[] = [['Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y, modifiers }]];
    for (let i = 1; i <= count; i++) {
      steps.push(['Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button, buttons: bits, clickCount: i, modifiers }]);
      steps.push(['Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x, y: t.y, button, buttons: 0, clickCount: i, modifiers }]);
    }
    const r = await this.input(tab, steps);
    return `${button === 'left' ? '' : `${button} `}${count === 2 ? 'Double-clicked' : count === 3 ? 'Triple-clicked' : 'Clicked'} ${t.what}${r === 'dialog' ? ' (a dialog opened)' : ''}`;
  }

  async hover(tab: Tab, a: { ref?: unknown; coordinate?: unknown }): Promise<string> {
    const t = await this.target(tab, a.ref, a.coordinate);
    await this.input(tab, [['Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y }]]);
    return `Mouse over ${t.what}`;
  }

  async drag(tab: Tab, a: { from_ref?: unknown; from?: unknown; to_ref?: unknown; to?: unknown }): Promise<string> {
    const s = await this.target(tab, a.from_ref, a.from);
    const e = await this.target(tab, a.to_ref, a.to);
    const steps: Step[] = [
      ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y }],
      ['Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', buttons: 1, clickCount: 1 }],
    ];
    for (let i = 1; i <= 8; i++) steps.push(['Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x + ((e.x - s.x) * i) / 8, y: s.y + ((e.y - s.y) * i) / 8, button: 'left', buttons: 1 }]);
    steps.push(['Input.dispatchMouseEvent', { type: 'mouseReleased', x: e.x, y: e.y, button: 'left', buttons: 0, clickCount: 1 }]);
    await this.input(tab, steps);
    return `Dragged ${s.what} to ${e.what}`;
  }

  /** Types text as key presses (insertText for long runs or characters without a key). Tab and Enter ("\t", "\n")
   *  move the focus, so the text is typed in segments and the password limit is checked again before each one. */
  async typeText(tab: Tab, text: string): Promise<'ok' | 'dialog'> {
    for (const part of text.replace(/\r\n?/g, '\n').split(/([\t\n])/)) {
      if (!part) continue;
      if (part === '\t' || part === '\n') {
        const steps = strokeEvents({ def: charKey(part)!, modifiers: 0, mods: [] }).map((ev): Step => ['Input.dispatchKeyEvent', ev as unknown as Record<string, unknown>]);
        if (await this.input(tab, steps) === 'dialog') return 'dialog';
        await sleep(30);                                   // let the focus move before the next check
        continue;
      }
      await this.guardPassword(tab, undefined, 'the focused field');
      if (part.length > 300) { if (await this.input(tab, [['Input.insertText', { text: part }]]) === 'dialog') return 'dialog'; continue; }
      const steps: Step[] = [];
      for (const ch of part) {
        const k = charKey(ch);
        if (!k) { steps.push(['Input.insertText', { text: ch }]); continue; }
        for (const ev of strokeEvents({ def: k, modifiers: 0, mods: [] })) steps.push(['Input.dispatchKeyEvent', ev as unknown as Record<string, unknown>]);
      }
      if (await this.input(tab, steps) === 'dialog') return 'dialog';
    }
    return 'ok';
  }

  async type(tab: Tab, text: string, ref?: unknown): Promise<string> {
    let where = 'into the focused element';
    if (ref !== undefined && ref !== null && ref !== '') {
      await this.guardPassword(tab, ref, String(ref));
      await this.click(tab, { ref });
      if (tab.dialog) return `Clicked ${String(ref)}, but a dialog opened: nothing typed`;
      where = `into ${String(ref)}`;
    }
    const r = await this.typeText(tab, text);                // checks the focused field before every segment
    return `Typed ${[...text].length} characters ${where}${r === 'dialog' ? ' (a dialog opened: typing stopped)' : ''}`;
  }

  async key(tab: Tab, keys: string, repeat = 1): Promise<string> {
    const strokes = parseKeys(keys);
    const n = Math.max(1, Math.min(100, Math.floor(repeat) || 1));
    // characters and paste (ctrl/meta+v, shift+Insert) put text into a field: the password limit applies, checked again
    // after every key that can move the focus
    const writes = (s: (typeof strokes)[number]) => (s.def.text !== undefined && s.def.key !== 'Enter' && (s.modifiers & ~MOD.shift) === 0)
      || (/^v$/i.test(s.def.key) && (s.modifiers & (MOD.ctrl | MOD.meta)) !== 0) || (s.def.key === 'Insert' && (s.modifiers & MOD.shift) !== 0);
    const MOVES = new Set(['Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'F6']);
    let checked = false;
    for (let i = 0; i < n; i++) {
      for (const s of strokes) {
        if (writes(s) && !checked) { await this.guardPassword(tab, undefined, 'the focused field'); checked = true; }
        const steps = strokeEvents(s).map((ev): Step => ['Input.dispatchKeyEvent', ev as unknown as Record<string, unknown>]);
        if (await this.input(tab, steps) === 'dialog') return `Pressed part of ${keys}: a dialog opened`;
        if (MOVES.has(s.def.key)) { checked = false; await sleep(30); }
      }
    }
    return `Pressed ${keys}${n > 1 ? ` x${n}` : ''}`;
  }

  async scroll(tab: Tab, a: { ref?: unknown; coordinate?: unknown; direction?: unknown; amount?: unknown }): Promise<string> {
    if (a.ref && !a.direction) { const p = await this.point(tab, a.ref); return `Scrolled ${p.desc} into view`; }
    const dir = String(a.direction ?? 'down');
    if (!['up', 'down', 'left', 'right'].includes(dir)) throw new Error('direction must be up, down, left or right');
    const b = tab.view.getBounds();
    const t = a.ref || a.coordinate ? await this.target(tab, a.ref, a.coordinate) : { x: b.width / 2, y: b.height / 2, what: 'the page' };
    const px = Math.max(1, Math.min(30, Number(a.amount ?? 3) || 3)) * 100;
    const delta = { up: [0, -px], down: [0, px], left: [-px, 0], right: [px, 0] }[dir as 'up']!;
    await this.input(tab, [['Input.dispatchMouseEvent', { type: 'mouseWheel', x: t.x, y: t.y, deltaX: delta[0], deltaY: delta[1] }]]);
    return `Scrolled ${dir} ${px}px at ${t.what}`;
  }

  async select(tab: Tab, ref: unknown, values: string[]): Promise<string> {
    const { frame, ref: r } = parseRef(ref);
    const res = await this.evalIn<{ selected: string[] } | { error: string }>(tab, this.tabs.frameByNo(tab, frame), pageCall(selectOptions, r, values));
    if ('error' in res) throw new Error(res.error === 'stale' ? `${r} is no longer on the page: call read_page again.` : `${r}: ${res.error}`);
    return `Selected ${res.selected.map(s => `"${s}"`).join(', ')} in ${r}`;
  }

  /** Fills several fields in one call: text-like fields are focused, selected and replaced; checkboxes/radios clicked
   *  only when their state differs; selects set by value or label. One result line per field. */
  async fill(tab: Tab, fields: Array<{ ref?: unknown; value?: unknown }>): Promise<string> {
    if (!Array.isArray(fields) || !fields.length) throw new Error('fields must be a non-empty array of { ref, value }');
    // HARD LIMIT first, for every field: nothing is filled when one of them is a password field on a remote host
    for (const f of fields.slice(0, 50)) {
      let parsed;
      try { parsed = parseRef(f?.ref); } catch { continue; }
      const frame = this.tabs.frameByNo(tab, parsed.frame);
      const host = frameHost(frame);
      if (isLocalHost(host)) continue;
      const info = await this.evalIn<InputInfo | { error: string }>(tab, frame, pageCall(inputInfo, parsed.ref)).catch(() => null);
      if (!info) throw new Error(`Refused: could not verify that ${parsed.ref} is not a password field on ${host || 'a remote page'}. Try again, or use handoff_to_user.`);
      if (!('error' in info) && info.password) throw passwordRefusal(`${parsed.ref} (${info.desc})`, host, tab.env);
    }
    const lines: string[] = [];
    for (const f of fields.slice(0, 50)) {
      let label = String(f?.ref ?? '?');
      try {
        const { frame: no, ref } = parseRef(f.ref);
        label = ref;
        const frame = this.tabs.frameByNo(tab, no);
        const info = await this.evalIn<InputInfo | { error: string }>(tab, frame, pageCall(inputInfo, ref));
        if ('error' in info) throw new Error(info.error === 'stale' ? 'no longer on the page: call read_page again' : info.error);
        if (info.disabled) throw new Error(`${info.desc} is disabled`);
        const v = f.value;
        if (info.kind === 'text' || info.kind === 'editable') {
          if (info.readonly) throw new Error(`${info.desc} is read-only`);
          let focused = await this.evalIn<boolean>(tab, frame, pageCall(focusSelect, ref, true));
          if (!focused) { await this.click(tab, { ref: f.ref }); focused = await this.evalIn<boolean>(tab, frame, pageCall(focusSelect, ref, true)); }
          if (!focused) throw new Error(`could not focus ${info.desc}`);
          // a field can turn into a password field on focus, or focus can land elsewhere: check again right before typing
          await this.guardPassword(tab, f.ref, ref);
          await this.guardPassword(tab, undefined, 'the focused field');
          const text = String(v ?? '');
          if (text) { if (await this.input(tab, [['Input.insertText', { text }]]) === 'dialog') break; }
          else await this.key(tab, 'Delete');
        } else if (info.kind === 'checkbox' || info.kind === 'radio') {
          const want = v === true || /^(?:true|1|yes|on|checked|si|sì)$/i.test(String(v ?? ''));
          if (info.kind === 'radio' && !want) throw new Error('a radio button cannot be unchecked: check another option of the group');
          if (info.checked !== want) await this.click(tab, { ref: f.ref });
        } else if (info.kind === 'select') {
          const res = await this.evalIn<{ selected: string[] } | { error: string }>(tab, frame, pageCall(selectOptions, ref, Array.isArray(v) ? v.map(String) : [String(v ?? '')]));
          if ('error' in res) throw new Error(res.error);
        } else if (info.kind === 'file') {
          throw new Error('file inputs are not supported yet: ask the user with handoff_to_user');
        } else throw new Error(`${info.desc} is not a form field (click it instead)`);
        if (tab.dialog) { lines.push(`${ref}: a dialog opened`); break; }
        const after = await this.evalIn<InputInfo | { error: string }>(tab, frame, pageCall(inputInfo, ref));
        lines.push('error' in after ? `${ref}: done` : `${ref} ${after.desc} = ${after.kind === 'checkbox' || after.kind === 'radio' ? (after.checked ? 'checked' : 'unchecked') : `"${after.value}"`}`);
      } catch (e) {
        if (tab.dialog) { lines.push(`${label}: a dialog opened (the page waits: handle_dialog, then fill the rest)`); break; }
        if (/^Refused:/.test(errText(e))) throw e;            // the password limit fails the whole call, never one line
        lines.push(`${label}: FAILED (${errText(e)})`);
      }
    }
    return lines.join('\n');
  }

  async navigate(tab: Tab, url: string, force: boolean): Promise<string> {
    const wc = tab.wc;
    if (tab.dialog && force) await this.cdp(tab).send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
    tab.forceUnload = force;
    try {
      const where = String(url).trim().toLowerCase();
      if (where === 'back' || where === 'forward') {
        const h = wc.navigationHistory;
        if (where === 'back' ? !h.canGoBack() : !h.canGoForward()) throw new Error(`There is no page to go ${where} to.`);
        if (where === 'back') h.goBack(); else h.goForward();
        await this.waitLoad(tab, 15_000);
        return `Went ${where}`;
      }
      if (where === 'reload') { wc.reload(); await this.waitLoad(tab, 30_000); return 'Reloaded'; }
      const target = normalizeUrl(url);
      if (urlCredentials(target) && !isLocalHost(hostOf(target))) {
        throw new Error('Refused: the URL carries credentials (user:password@) for a remote host. Agents never send passwords to remote hosts: open the plain URL and call handoff_to_user with kind "login".');
      }
      const d = this.tabs.dialogOpened(tab);
      let timer: NodeJS.Timeout | undefined;
      try {
        const r = await Promise.race([
          wc.loadURL(target).then(() => 'ok', (e: unknown) => errText(e)),
          d.promise.then(() => 'dialog'),
          new Promise<string>(res => { timer = setTimeout(() => res('timeout'), 30_000); }),
        ]);
        if (r === 'timeout') return `Still loading ${redact(target)} after 30s (continuing in the background)`;
        if (r !== 'ok' && r !== 'dialog' && !/ERR_ABORTED/.test(r)) {
          const code = /ERR_[A-Z_]+/.exec(r)?.[0] ?? r;
          throw new Error(`Could not load ${redact(target)}: ${code}. Check the URL and that the server is up.`);
        }
        if (/ERR_ABORTED/.test(r)) {
          await this.waitLoad(tab, 10_000);
          if (tab.unloadBlockedAt === 0 && wc.getURL() === '') throw new Error(`Loading ${redact(target)} was interrupted (ERR_ABORTED): call navigate again.`);
          return `Navigation to ${redact(target)} was redirected or interrupted (ERR_ABORTED)`;
        }
      } finally { d.cancel(); if (timer) clearTimeout(timer); }
      return `Navigated to ${redact(target)}`;
    } finally {
      setTimeout(() => { tab.forceUnload = false; }, 1000);
    }
  }

  private async waitLoad(tab: Tab, ms: number): Promise<void> {
    await sleep(100);
    if (!tab.wc.isLoading()) return;
    const d = this.tabs.dialogOpened(tab);
    let timer: NodeJS.Timeout | undefined;
    let off = () => {};
    await Promise.race([
      new Promise<void>(r => { const h = () => r(); tab.wc.once('did-stop-loading', h); off = () => tab.wc.removeListener('did-stop-loading', h); }),
      d.promise,
      new Promise<void>(r => { timer = setTimeout(r, ms); }),
    ]);
    off(); d.cancel(); if (timer) clearTimeout(timer);
  }

  // ---------- seeing ----------

  async screenshot(tab: Tab, o: { region?: unknown; full_page?: unknown }): Promise<Shot> {
    if (tab.wc.isDestroyed()) throw new Error('The tab was closed: call tabs_list.');
    const b = tab.view.getBounds();
    if (o.full_page === true) {
      const cdp = this.cdp(tab);
      const m = await cdp.send<{ cssContentSize?: { width: number; height: number }; contentSize?: { width: number; height: number } }>('Page.getLayoutMetrics');
      const cs = m.cssContentSize ?? m.contentSize ?? { width: b.width, height: b.height };
      const width = Math.ceil(Math.min(Math.max(cs.width, 1), 4000)), height = Math.ceil(Math.min(Math.max(cs.height, 1), 16000));
      const r = await withTimeout(cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } }), 20_000, 'full-page screenshot');
      return { png: Buffer.from(r.data, 'base64'), width, height, note: `full page ${width}x${height} CSS px${cs.height > 16000 ? ' (cut at 16000 px)' : ''}` };
    }
    let rect: { x: number; y: number; width: number; height: number } | undefined;
    if (o.region !== undefined) {
      const r = o.region;
      if (!Array.isArray(r) || r.length !== 4 || !r.every(n => typeof n === 'number' && Number.isFinite(n))) throw new Error('region must be [x0, y0, x1, y1] in CSS px');
      const [x0, y0, x1, y1] = (r as number[]).map(Math.round) as [number, number, number, number];
      const x = Math.max(0, Math.min(x0, x1)), y = Math.max(0, Math.min(y0, y1));
      rect = { x, y, width: Math.min(b.width, Math.max(x0, x1)) - x, height: Math.min(b.height, Math.max(y0, y1)) - y };
      if (rect.width < 1 || rect.height < 1) throw new Error(`region is empty or outside the viewport (${b.width}x${b.height})`);
    }
    let img = await withTimeout(rect ? tab.wc.capturePage(rect) : tab.wc.capturePage(), 8000, 'screenshot').catch(() => null);
    if (!img || img.isEmpty()) {
      if (!tab.cdp) throw new Error('The tab could not be captured (not rendered).');
      const clip = rect ?? { x: 0, y: 0, width: b.width, height: b.height };
      const r = await withTimeout(tab.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } }), 8000, 'screenshot');
      return { png: Buffer.from(r.data, 'base64'), width: clip.width, height: clip.height, note: `${clip.width}x${clip.height} CSS px` };
    }
    if (rect) {
      const s = img.getSize();
      return { png: img.toPNG(), width: s.width, height: s.height, note: `region (${rect.x},${rect.y})-(${rect.x + rect.width},${rect.y + rect.height}) at ${(s.width / rect.width).toFixed(2)}x` };
    }
    if (img.getSize().width !== b.width) img = img.resize({ width: b.width, height: b.height });
    return { png: img.toPNG(), width: b.width, height: b.height, note: `${b.width}x${b.height} CSS px (image pixels = click coordinates)` };
  }

  saveShot(tab: Tab, shot: Shot, name: unknown): string {
    const dir = this.tabs.evidenceDir(tab.group);
    const file = evidencePath(dir, name ? String(name) : stampName(`shot-${tab.id}`, '.png'), '.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, shot.png);
    return file;
  }

  // ---------- waiting ----------

  async waitFor(tab: Tab, o: { text?: unknown; text_gone?: unknown; selector?: unknown; url?: unknown; network_idle?: unknown; timeout_ms?: unknown }): Promise<string> {
    const text = o.text ? String(o.text) : undefined, gone = o.text_gone ? String(o.text_gone) : undefined;
    const selector = o.selector ? String(o.selector) : undefined, url = o.url ? String(o.url) : undefined;
    const idle = o.network_idle === true;
    if (!text && !gone && !selector && !url && !idle) throw new Error('Pass at least one of text, text_gone, selector, url, network_idle.');
    const timeout = Math.max(100, Math.min(120_000, Number(o.timeout_ms ?? 10_000) || 10_000));
    const t0 = Date.now();
    let quietSince = 0;
    for (;;) {
      this.guard(tab);
      const conds: Array<[string, boolean]> = [];
      if (url) conds.push([`url contains "${url}"`, urlMatches(tab.wc.getURL(), url)]);
      if (idle) {
        const busy = tab.wc.isLoading() || tab.net.inflight() > 0;
        quietSince = busy ? 0 : quietSince || Date.now();
        conds.push(['network idle', !busy && Date.now() - quietSince >= 500]);
      }
      if (text || gone || selector) {
        let hasText = false, hasGone = false, hasSel = false;
        type Probe = { text: boolean | null; selector: boolean | null; error?: string };
        for (const f of this.tabs.frames(tab)) {
          if (text || selector) {
            const r = await this.evalIn<Probe>(tab, f, pageCall(probe, { text, selector }), 3000).catch(() => null);
            if (r?.error) throw new Error(r.error);
            if (r?.text) hasText = true;
            if (r?.selector) hasSel = true;
          }
          if (gone && (await this.evalIn<Probe>(tab, f, pageCall(probe, { text: gone }), 3000).catch(() => null))?.text) hasGone = true;
        }
        if (text) conds.push([`text "${text}" visible`, hasText]);
        if (gone) conds.push([`text "${gone}" gone`, !hasGone]);
        if (selector) conds.push([`selector ${selector} visible`, hasSel]);
      }
      if (conds.every(c => c[1])) return `Done after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${conds.map(c => c[0]).join(', ')}`;
      if (Date.now() - t0 >= timeout) {
        throw new Error(`Timed out after ${timeout / 1000}s waiting for ${conds.filter(c => !c[1]).map(c => c[0]).join(', ')}. Page: "${tab.wc.getTitle()}" ${redact(tab.wc.getURL())}`);
      }
      await sleep(200);
    }
  }

  // ---------- dialogs, network, console, js ----------

  async handleDialog(tab: Tab, accept: boolean, promptText?: string): Promise<string> {
    if (tab.wc.isDestroyed()) throw new Error('The tab was closed: call tabs_list.');
    const d = tab.dialog;
    if (!d) {
      const last = tab.lastDialog;
      return last ? `No dialog is open (the last one, ${last.type} "${last.message}", was ${last.result}).` : 'No dialog is open.';
    }
    const b = this.begin(tab, `dialog ${accept ? 'OK' : 'Cancel'}`);
    b.dialogs = tab.dialogSeq;
    await this.cdp(tab).send('Page.handleJavaScriptDialog', { accept, ...(promptText !== undefined ? { promptText } : {}) });
    for (let i = 0; i < 40 && tab.dialog === d; i++) await sleep(50);
    await this.settle(tab);
    const head = `${accept ? 'Accepted' : 'Dismissed'} the ${d.type} "${d.message}"${d.type === 'prompt' && promptText !== undefined ? ` with "${promptText}"` : ''}`;
    return this.summary(tab, b, head);
  }

  network(tab: Tab, o: { urlPattern?: unknown; method?: unknown; type?: unknown; status?: unknown; limit?: unknown; requestId?: unknown; clear?: unknown }): Promise<string> | string {
    if (o.requestId) return this.requestDetail(tab, String(o.requestId));
    const list = tab.net.list({ urlPattern: o.urlPattern ? String(o.urlPattern) : undefined, method: o.method ? String(o.method) : undefined, type: o.type ? String(o.type) : undefined, status: o.status as string | number | undefined, limit: Number(o.limit ?? 50) });
    if (o.clear === true) tab.net.clear();
    if (!list.length) return 'No matching requests (the log keeps the last 500 of this tab, across navigations).';
    return `${list.length} request${list.length > 1 ? 's' : ''} (oldest first; pass requestId for headers and the response body):\n${list.map(formatEntry).join('\n')}`;
  }

  private async requestDetail(tab: Tab, id: string): Promise<string> {
    const e = tab.net.get(id);
    if (!e) throw new Error(`No request ${id} in this tab's log: call network_requests to list them.`);
    const lines = [formatDetail(e)];
    if (e.endedAt !== undefined && !e.failed && tab.cdp) {
      try {
        const r = await withTimeout(tab.cdp.send<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', { requestId: e.requestId }, e.session || undefined), 5000, 'response body');
        const textual = !r.base64Encoded || /json|text|xml|javascript|html|x-www-form-urlencoded/.test(e.mimeType ?? '');
        let buf = Buffer.from(r.body, r.base64Encoded ? 'base64' : 'utf8');
        let masked = false;
        if (textual) {                                         // tokens and passwords never reach the agent or the disk
          const raw = buf.toString('utf8');
          const safe = redactBody(raw, e.mimeType);
          masked = safe !== raw;
          buf = Buffer.from(safe, 'utf8');
        }
        const ext = extFor(e.mimeType ?? '', e.url);
        const file = evidencePath(path.join(this.tabs.evidenceDir(tab.group), 'network'), `${e.id}-${tab.id}${ext}`, ext);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
        lines.push(`Response body: ${buf.length} bytes saved to ${file}${masked ? ' (secrets masked)' : ''}`);
        if (textual) lines.push(`Preview: ${buf.toString('utf8').slice(0, 1500)}${buf.length > 1500 ? '…' : ''}`);
      } catch (err) {
        lines.push(`Response body: not available (${errText(err)}; bodies are kept only while the page that loaded them is open)`);
      }
    }
    return lines.join('\n');
  }

  console(tab: Tab, o: { onlyErrors?: unknown; pattern?: unknown; limit?: unknown; clear?: unknown }): string {
    let c = tab.console;
    if (o.onlyErrors === true) c = c.filter(m => m.level === 'error');
    if (o.pattern) { const p = String(o.pattern).toLowerCase(); c = c.filter(m => m.text.toLowerCase().includes(p)); }
    const limit = Math.max(1, Math.min(500, Number(o.limit ?? 50) || 50));
    const out = c.slice(-limit);
    if (o.clear === true) tab.console.length = 0;
    if (!out.length) return 'No matching console messages.';
    return out.map(m => `[${m.level}] ${m.text}${m.source && m.source !== ':' ? ` (${m.source.slice(0, 160)})` : ''}${m.frame ? ` [iframe ${m.frame}]` : ''}`).join('\n');
  }

  async evaluate(tab: Tab, code: string, frameArg?: unknown): Promise<string> {
    this.guard(tab);
    const no = parseFrame(frameArg);
    // the password limit covers reading too: while the user signs in (hand-off) nothing runs in the tab, and no script at
    // all runs in a tab where a remote frame holds a password field (hidden or in a shadow root included)
    const h = this.tabs.handoffs.openFor(tab.id);
    if (h) throw new Error(`Refused: the user is working in this tab (hand-off ${h.id}: ${h.reason}) and a script could read what they type. Wait with handoff_to_user handoff_id "${h.id}".`);
    for (const f of this.tabs.frames(tab)) {
      const host = frameHost(f);
      if (isLocalHost(host)) continue;
      if (changesInputType(code)) throw new Error(`Refused: on remote hosts (${host || 'this page'}) a script may not change an input's type (it could turn a password field into a plain one). Use read_page / get_page_text / screenshot.`);
      const form = await this.evalIn<boolean>(tab, f, pageCall(hasPasswordField, false), 3000).catch(() => true);   // fail closed
      if (form) {
        throw new Error(`Refused: ${host || 'a remote frame'} holds a password field, so javascript is not allowed in this tab (it could read or change what is typed). ` +
          `Use read_page / get_page_text / screenshot; to sign in call handoff_to_user with kind "login" (environment ${tab.env} keeps the session).`);
      }
    }
    let value: unknown;
    if (no === 0 && tab.cdp) {
      const d = this.tabs.dialogOpened(tab);
      try {
        const r = await Promise.race([
          tab.cdp.send<{ result?: { type?: string; value?: unknown; description?: string; unserializableValue?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
            'Runtime.evaluate', { expression: code, replMode: true, awaitPromise: true, returnByValue: true, userGesture: false, timeout: 10_000 }),
          d.promise.then(() => { throw new Error(`${dialogText(tab)} (opened by your script). Call handle_dialog.`); }),
          sleep(15_000).then(() => { throw new Error('the script did not finish within 15s'); }),
        ]);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'script error');
        value = r.result?.value !== undefined ? r.result.value : r.result?.unserializableValue ?? r.result?.description ?? (r.result?.type === 'undefined' ? undefined : r.result?.type);
      } finally { d.cancel(); }
    } else {
      value = await this.evalIn<unknown>(tab, this.tabs.frameByNo(tab, no), code, 15_000);
    }
    if (value === undefined) return 'undefined';
    const s = typeof value === 'string' ? value : JSON.stringify(value, null, 1) ?? String(value);
    return redact(s.length > 20000 ? `${s.slice(0, 20000)}…(truncated)` : s);
  }
}

function originOf(f: WebFrameMain): string {
  try { return f.origin && f.origin !== 'null' ? f.origin : redact(f.url).slice(0, 80); } catch { return ''; }
}

/** wait_for url: a substring, or a glob ("*" = anything) matched against the whole URL, without regex (no ReDoS). */
function urlMatches(url: string, want: string): boolean {
  return want.includes('*') ? globMatch(url.slice(0, 8192), want, true) : url.includes(want);
}

/** The host a frame's content belongs to: about:blank / srcdoc / data frames take their parent's. */
function frameHost(f: WebFrameMain): string {
  for (let cur: WebFrameMain | null = f; cur; cur = cur.parent) {
    const h = hostOf(cur.url);
    if (h) return h;
    try { if (cur.origin && cur.origin !== 'null') { const o = hostOf(cur.origin); if (o) return o; } } catch { /* detached */ }
  }
  return '';
}

function extFor(mime: string, url: string): string {
  if (/json/.test(mime)) return '.json';
  if (/html/.test(mime)) return '.html';
  if (/xml/.test(mime)) return '.xml';
  if (/javascript/.test(mime)) return '.js';
  if (/css/.test(mime)) return '.css';
  if (/png/.test(mime)) return '.png';
  if (/jpe?g/.test(mime)) return '.jpg';
  if (/pdf/.test(mime)) return '.pdf';
  if (/text/.test(mime)) return '.txt';
  const m = /\.([a-z0-9]{1,5})(?:[?#]|$)/i.exec(url);
  return m ? `.${m[1]!.toLowerCase()}` : '.bin';
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms); })]).finally(() => { if (timer) clearTimeout(timer); });
}
