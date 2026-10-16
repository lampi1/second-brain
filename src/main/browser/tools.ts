// MCP tools of the internal browser (24, under Cursor's 40-tool budget). Names and arguments follow the Claude desktop
// browser pane where it has an equivalent (tabs_*, navigate, read_page, find, get_page_text, console/network,
// javascript), Playwright MCP elsewhere (fill_form, select_option, wait_for, handle_dialog), so agents and skills
// (QA skills) transfer. Every call is scoped: an app chat sees only its own tab group, an external client only the group of
// its MCP session (scopeOf). Write actions of one group run one at a time. Used by browser/service.ts (mounts).
import type { CallCtx, McpTool, ToolOutput } from '../mcp/server';
import { log, redact } from '../log';
import type { BrowserTabs, Tab } from './tabs';
import { normalizeUrl, type BrowserActions, type Shot } from './actions';
import { envForUrl, envSlug } from './envs';
import { envRefusal, loginRefusal } from './rules';
import { fmtFactor } from './preview';

export interface Scope { group: string; owner: string | null; chatId: string | null }

/** How often handoff_to_user tells the client it is still waiting (well under Claude Code's 300 s idle timeout). */
export const PROGRESS_MS = 25_000;
/** Key combos that paste from the clipboard (Ctrl+V, Ctrl+Shift+V, Shift+Insert, Cmd+V). */
export const PASTE_KEYS = /(?:^|\s)(?:(?:ctrl|control|meta|cmd|command)\+(?:shift\+|alt\+)*v|shift\+insert|insert\+shift)(?=\s|$)/i;

type Args = Record<string, unknown>;
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required (a non-empty string)`);
  return v;
};
const bool = (v: unknown): boolean => v === true || v === 'true';

const tabId = { tabId: { type: 'string', description: 'Tab id from tabs_list; omit for your active tab.' } };
const target = {
  ref: { type: 'string', description: 'Element ref from read_page/find: e12 in the page, f1e7 inside iframe f1.' },
  coordinate: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] in CSS pixels of the viewport (= pixels of the last screenshot).' },
};
const schema = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: { ...props, ...tabId }, required });
const RO = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

/** How the agent's image maps back to CSS px: k = CSS px per image px (the capture's zoom and the preview's factor). */
export function shotMapping(shot: Pick<Shot, 'scale' | 'origin' | 'page'>, img: { width: number; height: number; factor: number; mimeType: string }): string {
  const k = fmtFactor(img.factor / shot.scale);
  const head = `Image ${img.width}x${img.height} ${img.mimeType === 'image/jpeg' ? 'JPEG' : 'PNG'}`;
  if (shot.page) return `${head}: page point = image px × ${k} (page coordinates: scroll it into view before clicking)`;
  if (shot.origin.x || shot.origin.y) return `${head}: click coordinate = (${shot.origin.x} + image x × ${k}, ${shot.origin.y} + image y × ${k})`;
  return `${head}: click coordinate = image px × ${k}`;
}

export function browserTools(tabs: BrowserTabs, actions: BrowserActions, scopeOf: (ctx: CallCtx) => Scope): McpTool[] {
  const queues = new Map<string, Promise<unknown>>();
  const handoffGroup = new Map<string, string>();       // hand-off id → the group that opened it (outlives the tab)
  /** Write actions of one group run in order (an agent sending parallel clicks must not interleave them). */
  const serial = <T>(group: string, fn: () => Promise<T>): Promise<T> => {
    const prev = queues.get(group) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    queues.set(group, run.catch(() => {}));
    return run;
  };
  const tabOf = (ctx: CallCtx, a: Args): Tab => tabs.tabFor(scopeOf(ctx).group, a.tabId);
  const write = (label: (a: Args) => string, fn: (tab: Tab, a: Args) => Promise<string>, opts: { allowDialog?: boolean } = {}) =>
    (a: Args, ctx: CallCtx) => serial(scopeOf(ctx).group, async () => { const tab = tabOf(ctx, a); return actions.act(tab, label(a), () => fn(tab, a), opts); });
  const line = (t: Tab) => {
    const b = tabs.toBrowserTab(t);
    const shared = [...tabs.tabs.values()].filter(o => o.env === t.env && o.id !== t.id).length;
    return `${t.id}${b.active ? ' (active)' : ''} "${b.title}" ${redact(b.url)} env=${t.env} (session ${b.session ?? 'unknown'}${shared ? `, shared with ${shared} other tab${shared > 1 ? 's' : ''}` : ''})` +
      `${b.loading ? ' [loading]' : ''}${b.dialog ? ` [dialog ${b.dialog}]` : ''}${b.handoffId ? ' [the user is working here]' : ''}${tabs.isShown(t) ? ' [on screen]' : ''}`;
  };
  const listTabs = (scope: Scope) => {
    const mine = tabs.tabsOf(scope.group);
    return mine.length ? mine.map(line).join('\n') : 'No tabs yet: navigate opens one.';
  };
  const ensureTab = (scope: Scope, a: Args): Tab => {
    if (a.tabId) return tabs.tabFor(scope.group, a.tabId);
    const closed = tabs.activeOf(scope.group) ? null : tabs.closedError(scope.group, null);
    if (closed) throw new Error(closed);              // the user closed its active tab: never reopen a page silently
    return tabs.activeOf(scope.group) ?? tabs.create(scope.group, scope.owner, undefined, a.env ? { env: String(a.env) } : {});
  };
  const envProp = { env: { type: 'string', description: 'Environment = its own session (cookies, storage). Default from the host (test-3.example.com → example-test-3, localhost → local); name one to share a session on purpose or to keep two users apart. Local stacks (localhost, 127.0.0.1, *.localhost) load only in "local", and "local" holds only them (refused otherwise).' } };

  const tools: McpTool[] = [
    {
      name: 'tabs_list', annotations: RO,
      description: 'List your tabs (id, title, url, environment and its session status, the active one, open dialogs). You only see tabs you opened or that your pages opened.',
      inputSchema: schema({}),
      run: (_a, ctx) => listTabs(scopeOf(ctx)),
    },
    {
      name: 'tabs_create', annotations: WRITE,
      description: 'Open a new tab (optionally loading a url, waits for load) and make it your active tab. env picks its environment (own cookies and storage); default from the url host.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' }, ...envProp } },
      run: (a, ctx) => serial(scopeOf(ctx).group, async () => {
        const s = scopeOf(ctx);
        const url = a.url ? normalizeUrl(String(a.url)) : undefined;
        if (url && a.env) { const no = envRefusal(url, envSlug(a.env)); if (no) throw new Error(no); }
        const tab = tabs.create(s.group, s.owner, url ? undefined : 'about:blank', a.env ? { env: String(a.env) } : url ? { env: envForUrl(url) } : {});
        tab.envExplicit = !!a.env;                       // a derived env can still follow the host on first navigate
        if (!url) return `Opened ${tab.id} (empty) in environment ${tab.env}\n${listTabs(s)}`;
        return actions.act(tab, `open ${url}`, () => actions.navigate(tab, url, false));
      }),
    },
    {
      name: 'environments', annotations: RO,
      description: 'Known browser environments (each its own session): sign-in status (valid, expiring within 24 h, expired, unknown), last sign-in time, hosts and your tabs in it. No cookies or secrets.',
      inputSchema: { type: 'object', properties: {} },
      run: async (_a, ctx) => {
        const list = await tabs.envList();
        if (!list.length) return 'No environments yet.';
        const mine = new Set(tabs.tabsOf(scopeOf(ctx).group).map(t => t.id));
        const when = (t: number | null) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : 'never');
        // only your own tab ids; hosts only of environments agents have used (the user's own browsing stays private)
        return list.map(e => {
          const hosts = tabs.envStore.get(e.id)?.agents ? e.hosts.join(', ') || '-' : '(hidden: used only by the user)';
          return `${e.id}: session ${e.session} (${e.sessionDetail}) · last sign-in ${when(e.lastLoginAt)} · hosts ${hosts} · your tabs ${e.tabIds.filter(id => mine.has(id)).join(', ') || '-'}`;
        }).join('\n') + (list[0]!.encryptedAtRest === false ? '\n(cookies are not encrypted at rest on this build: ADR 0003)' : '');
      },
    },
    {
      name: 'tabs_select', annotations: WRITE,
      description: 'Make one of your tabs the active one (the default target of every other tool).',
      inputSchema: schema({}, ['tabId']),
      run: (a, ctx) => { const s = scopeOf(ctx); tabs.select(s.group, str(a.tabId, 'tabId')); return listTabs(s); },
    },
    {
      name: 'tabs_close', annotations: { ...WRITE, destructiveHint: true },
      description: 'Close one of your tabs.',
      inputSchema: schema({}, ['tabId']),
      run: (a, ctx) => { const s = scopeOf(ctx); tabs.close(tabs.tabFor(s.group, str(a.tabId, 'tabId')).id); return `Closed ${String(a.tabId)}\n${listTabs(s)}`; },
    },
    {
      name: 'navigate', annotations: WRITE,
      description: 'Load a url in your active tab (opens a tab if you have none), or "back", "forward", "reload". Waits for the page to load and settle. env: the environment (session) to load it in; a different env than the tab\'s opens a new tab there. force: true leaves a page that blocks unloading (unsaved changes) and dismisses an open dialog.',
      inputSchema: schema({ url: { type: 'string', description: 'http(s) URL (scheme optional), or back | forward | reload' }, force: { type: 'boolean' }, ...envProp }, ['url']),
      run: (a, ctx) => serial(scopeOf(ctx).group, async () => {
        const url = str(a.url, 'url');
        const history = /^(?:back|forward|reload)$/i.test(url.trim());
        if (!history && a.env) { const no = envRefusal(normalizeUrl(url), envSlug(a.env)); if (no) throw new Error(no); }
        let tab = ensureTab(scopeOf(ctx), a);
        let note = '';
        if (!history) {
          // without env the url loads in the tab's environment (a fresh tab with a derived one follows the host)
          if (!a.env && !(tab.fresh && !tab.envExplicit)) { const no = envRefusal(normalizeUrl(url), tab.env); if (no) throw new Error(no); }
          ({ tab, note } = tabs.prepareFor(tab, normalizeUrl(url), a.env));
        }
        const t = tab;
        const out = await actions.act(t, `navigate ${url.slice(0, 80)}`, () => actions.navigate(t, url, bool(a.force)), { allowDialog: bool(a.force), settle: 6000 });
        return note ? `${note}\n${out}` : out;
      }),
    },
    {
      name: 'screenshot', annotations: RO,
      description: 'See the tab when text is not enough (try read_page, find or get_page_text first: far fewer tokens). The image is scaled to a long side of ~1000 px; its text gives the factor (click coordinate = image px × factor). region [x0,y0,x1,y1] zooms on an area (sharper), full_page captures the whole scrollable page. save_to "name.png" stores the full-size PNG as QA evidence and returns only its path and size, no image; add view: true to see it too.',
      inputSchema: schema({
        region: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, full_page: { type: 'boolean' },
        save_to: { type: 'string', description: 'File name inside the evidence folder of your chat, e.g. "TC-12/step-3.png"' },
        view: { type: 'boolean', description: 'with save_to: return the image too (default false)' },
      }),
      run: async (a, ctx): Promise<ToolOutput> => {
        const tab = tabOf(ctx, a);
        const shot = await actions.screenshot(tab, { region: a.region, full_page: a.full_page });
        const saved = a.save_to !== undefined && a.save_to !== '' ? actions.saveShot(tab, shot, a.save_to) : null;
        const dialog = tab.dialog ? `
Dialog open: ${tab.dialog.type} "${tab.dialog.message}" (handle_dialog)` : '';
        if (saved && a.view !== true) return `Tab ${tab.id}: ${shot.note}
Saved: ${saved}
PNG ${shot.width}x${shot.height}, not shown (view: true to see it)${dialog}`;
        const img = actions.preview(shot);
        return { text: `Tab ${tab.id}: ${shot.note}
${shotMapping(shot, img)}${saved ? `
Saved: ${saved}
PNG ${shot.width}x${shot.height}` : ''}${dialog}`, images: [{ data: img.data, mimeType: img.mimeType }] };
      },
    },
    {
      name: 'read_page', annotations: RO,
      description: 'The page as an indented tree: role "name" state [ref], text lines, and every iframe (same- or cross-origin) nested under its iframe line with refs like f1e7. filter "interactive" lists only controls (smaller). Refs stay valid while the element exists; after big changes call it again.',
      inputSchema: schema({ filter: { type: 'string', enum: ['all', 'interactive'] }, max_chars: { type: 'number' } }),
      run: (a, ctx) => actions.snapshot(tabOf(ctx, a), a.filter === 'interactive' ? 'interactive' : 'all', '', Number(a.max_chars ?? 40000)),
    },
    {
      name: 'find', annotations: RO,
      description: 'Elements (in the page and all iframes) whose role, name, text, id, placeholder or data-testid contains query (case-insensitive), with refs. Cheaper than read_page on big pages.',
      inputSchema: schema({ query: { type: 'string' } }, ['query']),
      run: (a, ctx) => actions.snapshot(tabOf(ctx, a), 'find', str(a.query, 'query').toLowerCase(), 20000),
    },
    {
      name: 'get_page_text', annotations: RO,
      description: 'Visible text of the page (main/article content first; full: true for everything), then the text of each iframe.',
      inputSchema: schema({ max_chars: { type: 'number' }, full: { type: 'boolean' } }),
      run: (a, ctx) => actions.text(tabOf(ctx, a), Number(a.max_chars ?? 30000), bool(a.full)),
    },
    {
      name: 'click', annotations: WRITE,
      description: 'Trusted mouse click on a ref (scrolled into view, also inside iframes) or a coordinate. button left|right|middle, clickCount 2 = double click, modifiers e.g. "ctrl+shift". Refuses when an overlay covers the element. Returns what changed.',
      inputSchema: schema({ ...target, button: { type: 'string', enum: ['left', 'right', 'middle'] }, clickCount: { type: 'number' }, modifiers: { type: 'string' } }),
      run: write(a => `click ${String(a.ref ?? a.coordinate ?? '')}`, (tab, a) => actions.click(tab, a)),
    },
    {
      name: 'hover', annotations: WRITE,
      description: 'Move the mouse over a ref or coordinate (menus, tooltips).',
      inputSchema: schema(target),
      run: write(a => `hover ${String(a.ref ?? a.coordinate ?? '')}`, (tab, a) => actions.hover(tab, a)),
    },
    {
      name: 'drag', annotations: WRITE,
      description: 'Drag with the mouse from a ref/coordinate to a ref/coordinate (sliders, drag and drop lists).',
      inputSchema: schema({ from_ref: { type: 'string' }, from: target.coordinate, to_ref: { type: 'string' }, to: target.coordinate }),
      run: write(a => `drag ${String(a.from_ref ?? a.from ?? '')} → ${String(a.to_ref ?? a.to ?? '')}`, (tab, a) => actions.drag(tab, a)),
    },
    {
      name: 'type', annotations: WRITE,
      description: 'Type text as real key presses into the focused element, or click ref first. "\\n" presses Enter. For several fields at once use fill_form. Never type passwords: use handoff_to_user.',
      inputSchema: schema({ text: { type: 'string' }, ref: target.ref }, ['text']),
      run: write(a => `type ${[...String(a.text ?? '')].length} chars${a.ref ? ` in ${String(a.ref)}` : ''}`, (tab, a) => actions.type(tab, typeof a.text === 'string' ? a.text : str(a.text, 'text'), a.ref)),
    },
    {
      name: 'key', annotations: WRITE,
      description: 'Press keys, space-separated, combos with "+": "Enter", "Escape", "Tab", "ctrl+a Backspace", "shift+Tab", "ArrowDown". repeat presses the sequence N times.',
      inputSchema: schema({ keys: { type: 'string' }, repeat: { type: 'number' } }, ['keys']),
      run: write(a => `key ${String(a.keys ?? '')}`, (tab, a) => {
        const keys = str(a.keys, 'keys');
        // a password the user just copied for a login hand-off sits on the clipboard: pasting it into any field would
        // let the agent read it back (read_page shows field values)
        if (PASTE_KEYS.test(keys) && tabs.credentials.pasteBlocked()) throw new Error('Refused: pasting is blocked for 30 s while the user\'s password is on the clipboard (login hand-off). Type the text instead.');
        return actions.key(tab, keys, Number(a.repeat ?? 1));
      }),
    },
    {
      name: 'scroll', annotations: WRITE,
      description: 'Mouse-wheel scroll (direction up|down|left|right, amount in steps of 100px, default 3) at a ref, coordinate or the page center. A ref without direction scrolls that element into view.',
      inputSchema: schema({ ...target, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number' } }),
      run: write(a => `scroll ${String(a.direction ?? (a.ref ? 'to ' + String(a.ref) : 'down'))}`, (tab, a) => actions.scroll(tab, a)),
    },
    {
      name: 'select_option', annotations: WRITE,
      description: 'Choose option(s) of a native <select> by value or visible text. For custom dropdowns (Angular Material, PrimeNG) click the field, then click the option.',
      inputSchema: schema({ ref: target.ref, values: { type: 'array', items: { type: 'string' } }, value: { type: 'string' } }, ['ref']),
      run: write(a => `select ${String(a.ref ?? '')}`, (tab, a) => actions.select(tab, a.ref, Array.isArray(a.values) ? a.values.map(String) : [str(a.value, 'value (or values)')])),
    },
    {
      name: 'fill_form', annotations: WRITE,
      description: 'Fill several fields in one call: [{ref, value}]. Text fields and textareas are replaced, checkboxes/radios set to value true/false (clicked only if needed), selects chosen by value or label. Returns each field\'s resulting value.',
      inputSchema: schema({
        fields: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string' }, value: { type: 'string', description: 'Text for fields; "true" or "false" for checkboxes and radios (booleans accepted); option value or label for selects' } }, required: ['ref', 'value'] } },
      }, ['fields']),
      run: write(a => `fill_form ${Array.isArray(a.fields) ? a.fields.length : 0} fields`, (tab, a) => actions.fill(tab, a.fields as Array<{ ref?: unknown; value?: unknown }>)),
    },
    {
      name: 'wait_for', annotations: RO,
      description: 'Wait until all given conditions hold (default timeout 10 s, max 120 s): text visible, text_gone, a CSS selector visible, url contains (or * glob), network_idle (no request for 500 ms). Searches iframes too.',
      inputSchema: schema({ text: { type: 'string' }, text_gone: { type: 'string' }, selector: { type: 'string' }, url: { type: 'string' }, network_idle: { type: 'boolean' }, timeout_ms: { type: 'number' } }),
      run: (a, ctx) => actions.waitFor(tabOf(ctx, a), a),
    },
    {
      name: 'handle_dialog', annotations: WRITE,
      description: 'Answer the open JavaScript dialog (alert/confirm/beforeunload) that blocks the page: accept true = OK, false = Cancel. Tool results tell you when one is open. (window.prompt() is not supported by Electron: it throws in the page.)',
      inputSchema: schema({ accept: { type: 'boolean' }, promptText: { type: 'string' } }, ['accept']),
      run: (a, ctx) => serial(scopeOf(ctx).group, () => actions.handleDialog(tabOf(ctx, a), a.accept !== false && a.accept !== 'false', typeof a.promptText === 'string' ? a.promptText : undefined)),
    },
    {
      name: 'network_requests', annotations: RO,
      description: 'Requests of the tab and its iframes (last 500, kept across navigations), oldest first. Filters: urlPattern (substring or * glob), method, type (xhr, fetch, document, script...), status (404, 5xx, "error" = >= 400 or failed, "failed", "pending"), limit (default 50). requestId gives headers (secrets redacted), the request body and saves the response body to a file. clear empties the log.',
      inputSchema: schema({ urlPattern: { type: 'string' }, method: { type: 'string' }, type: { type: 'string' }, status: { type: 'string', description: '404, 5xx, error, failed or pending' }, limit: { type: 'number' }, requestId: { type: 'string' }, clear: { type: 'boolean' } }),
      run: (a, ctx) => actions.network(tabOf(ctx, a), a),
    },
    {
      name: 'console_messages', annotations: RO,
      description: 'Console messages of the tab and its iframes (last 500), with uncaught errors. onlyErrors, pattern (substring), limit (default 50), clear.',
      inputSchema: schema({ onlyErrors: { type: 'boolean' }, pattern: { type: 'string' }, limit: { type: 'number' }, clear: { type: 'boolean' } }),
      run: (a, ctx) => actions.console(tabOf(ctx, a), a),
    },
    {
      name: 'javascript', annotations: { readOnlyHint: false, openWorldHint: true },
      description: 'Evaluate JavaScript for INSPECTION only (reading state the tree does not show); act with click/type/fill_form instead. Top page: REPL semantics (last expression returned, top-level await). frame "f1" runs it inside that iframe (script semantics). Result as JSON, max 20000 chars.',
      inputSchema: schema({ code: { type: 'string' }, frame: { type: 'string' } }, ['code']),
      run: (a, ctx) => { const tab = tabOf(ctx, a); tabs.setLastAction(tab, 'javascript'); return actions.evaluate(tab, str(a.code, 'code'), a.frame); },
    },
    {
      name: 'handoff_to_user', annotations: WRITE,
      description: 'Ask the user to act in your tab themselves (login, MFA, CAPTCHA, a choice only they can make): the app shows them a banner on your tab with your reason and instructions until they click Fatto (done) or Non riesco (failed). kind "login" = sign in to this environment (also announced in their feed as "Rifai l\'accesso a <env>"); the environment keeps the session for later runs. Open the sign-in page in your tab first. On a local stack whose test accounts are in the user\'s credentials file a login hand-off is refused: sign in yourself. For a login pass account = the user name or e-mail of the entry in the user\'s credentials file (required, refused otherwise, when the file has entries for the page\'s host): the banner shows that account and its sign-in URL with Copia buttons, and the app copies the password from the file only when the user clicks (never put a password in any argument, never read it out, never write it in chat). The call keeps waiting (progress notifications; default 600 s, max 1800) and returns as soon as they answer; if it returns "still waiting", call it again with the same handoff_id. If you end your turn instead, the app messages you when they answer.',
      inputSchema: schema({
        reason: { type: 'string', description: 'One short line, e.g. "Login richiesto su example-test-3"' }, instructions: { type: 'string' },
        kind: { type: 'string', enum: ['login', 'other'] },
        account: { type: 'string', description: 'kind login: user name or e-mail of the credentials-file entry to show (never a password)' },
        handoff_id: { type: 'string', description: 'Keep waiting on an open hand-off' }, wait_seconds: { type: 'number' },
      }),
      run: async (a, ctx) => {
        const s = scopeOf(ctx);
        let h;
        let opened = '';
        if (a.handoff_id) {
          h = tabs.handoffs.get(String(a.handoff_id));
          if (!h || handoffGroup.get(h.id) !== s.group) throw new Error(`No hand-off "${String(a.handoff_id)}" for you: call handoff_to_user with a reason to open one.`);
        } else {
          const tab = tabOf(ctx, a);
          const kind = a.kind === 'login' ? 'login' as const : 'other' as const;
          const reason = String(a.reason ?? (kind === 'login' ? `Rifai l'accesso a ${tab.env}` : 'Serve il tuo intervento')).slice(0, 200);
          const url = tab.wc.getURL();
          if (kind === 'login') {
            const no = loginRefusal({ url, account: typeof a.account === 'string' ? a.account : '', accounts: tabs.credentials.accountsFor(url), file: tabs.credentials.describe() });
            if (no) { log.info('browser', 'login hand-off refused', { chat: s.chatId ?? undefined, data: { tab: tab.id, env: tab.env } }); throw new Error(no); }
          }
          const account = typeof a.account === 'string' && a.account.trim() ? tabs.credentials.lookup(a.account, url) : undefined;
          h = tabs.handoffs.open({ tabId: tab.id, chatId: s.chatId, reason, instructions: String(a.instructions ?? '').slice(0, 2000), url: redact(url), env: tab.env, kind, ...(account ? { account } : {}) });
          handoffGroup.set(h.id, s.group);
          tabs.setLastAction(tab, `waiting for the user: ${h.reason}`);
          log.info('browser', 'hand-off opened', { chat: s.chatId ?? undefined, data: { id: h.id, tab: tab.id, account: account ? (account.found ? 'found' : 'not found') : 'none' } });
          if (account) opened = account.found
            ? `The banner shows account ${account.user} with its sign-in URL and a Copia password button (the password stays in the user's file).\n`
            : `Account "${account.user}" is not in the user's credentials file (${tabs.credentials.describe()}): the banner shows the name only, without a password.\n`;
        }
        const t0 = Date.now();
        // a progress notification every 25 s keeps the call alive (Claude Code aborts a call silent for 300 s); a
        // client that cannot receive them gets an answer before 240 s and calls again
        const live = ctx.progress(`Waiting for the user: ${h.reason}`);
        const waitMs = Math.max(5, Math.min(live ? 1800 : 240, Number(a.wait_seconds ?? 600) || 600)) * 1000;
        let r = h;
        while (r.state === 'open' && !ctx.signal.aborted && Date.now() - t0 < waitMs) {
          r = await tabs.handoffs.wait(h.id, Math.min(PROGRESS_MS, waitMs - (Date.now() - t0)), ctx.signal);
          if (r.state === 'open' && live) ctx.progress(`Still waiting for the user (${Math.round((Date.now() - r.at) / 1000)}s): ${r.reason}`);
        }
        if (r.state === 'open' && !ctx.signal.aborted) tabs.handoffs.polled(r.id);   // a cancelled call will not come back
        if (r.state === 'open') return `${opened}Still waiting for the user (hand-off ${r.id}, open for ${Math.round((Date.now() - r.at) / 1000)}s). Call handoff_to_user with handoff_id "${r.id}" to keep waiting; if you end your turn instead, the app messages you when they answer.`;
        tabs.handoffs.delivered(r.id);
        const tab = tabs.tabs.get(r.tabId);
        const outcome = r.state === 'done' ? 'clicked Fatto (done)' : r.state === 'failed' ? 'answered Non riesco (failed)' : 'cancelled the hand-off (the tab was closed)';
        log.info('browser', 'hand-off resolved', { chat: s.chatId ?? undefined, data: { id: r.id, state: r.state, waitedMs: Date.now() - t0 } });
        return `${opened}The user ${outcome}${r.note ? `: "${r.note}"` : ''}.${tab && !tab.wc.isDestroyed() ? `\nTab ${tab.id}: "${tab.wc.getTitle()}" ${redact(tab.wc.getURL())}` : ''}`;
      },
    },
  ];
  return tools;
}
