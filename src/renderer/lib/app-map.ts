// The app as the Orchestrator learns it (app_guide and app_ui "outline", main/appctl/guide.ts): what the UI holds, read
// at the moment it is asked from the same sources the user's screen is drawn from, never a hand-kept list: the left
// rail as it is rendered now (groups, pages, shortcuts), every page with its shortcut and subtitle, Memoria's tabs, the
// Settings sections (lib/settings-sections.ts), the palette's actions with their keys, the "?" help texts (explain.*),
// and the view preferences (theme, density, work profile). screenOutline() is the live screen: headings, tabs and
// controls with their state and where they sit, never what a chat, a question or the personal browser says (ADR 0083,
// 0133: the Orchestrator sees a chat's state, not its content; the user's own browsing never reaches an agent). Main
// calls them with executeJavaScript on window.__sbAppMap / __sbScreen / __sbView (installAppMap, from main.tsx); the
// view change goes through ui:command 'prefs' (lib/view-prefs.ts). Pure DOM reads: no state is changed here.
import { BRAIN_PAGES, PAGE_ALIAS } from '../brain';
import { HUB_TABS } from './memory-hub';
import { settingsSections } from './settings-sections';
import { paletteActions } from '../components/CommandPalette';
import { lang, t, textsWhere, type Key } from '../i18n';
import { app } from '../store/store';
import { pageLabel, ui } from '../store/ui';
import { setViewPrefs, viewPrefs, type ViewPrefs } from './view-prefs';

export interface AppMapNav { group: string; items: { page: string; label: string; key?: string }[] }
export interface AppMapUi {
  lang: string;
  nav: AppMapNav[];
  pages: { id: string; label: string; key: string; aliases?: string[]; about?: string }[];
  memoria: { tab: string; label: string }[];
  settings: { id: string; title: string; description: string; keywords: string }[];
  actions: { group: string; title: string; sub?: string; shortcut?: string }[];
  help: { id: string; title: string; text: string }[];
  view: ViewPrefs;
}

const clean = (s: string | null | undefined, n = 70): string => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

/** The left rail as drawn now: its group titles and page entries in order (a page the work profile hides is absent). */
function navNow(): AppMapNav[] {
  const rail = document.querySelector('[data-testid="sidebar"]');
  if (!rail) return [];
  const out: AppMapNav[] = [{ group: '', items: [] }];
  for (const el of Array.from(rail.querySelectorAll<HTMLElement>('.nav-title, .nav-item'))) {
    if (el.classList.contains('nav-title')) { out.push({ group: clean(el.textContent), items: [] }); continue; }
    const page = (el.dataset.testid ?? '').replace(/^nav-/, '');
    if (!BRAIN_PAGES.some(p => p.id === page)) continue; // the agents' tree under the Grindhouse is not a place
    const [label, key] = (el.dataset.tip ?? '').split('|');
    out[out.length - 1]!.items.push({ page, label: clean(label || el.getAttribute('aria-label')), ...(key ? { key } : {}) });
  }
  return out.filter(g => g.items.length);
}

/** A page's subtitle or lead, when the dictionary has one for it. */
function aboutOf(id: string, texts: Record<string, string>): string | undefined {
  for (const k of [`brainPages.${id}.subtitle`, `brainPages.${id}.lead`, `brainPages.${id}.intro`, `${id}.subtitle`, `${id}.lead`]) if (texts[k]) return texts[k];
  return undefined;
}

export function appMap(): AppMapUi {
  const texts = textsWhere(k => k.startsWith('brainPages.') || k.startsWith('explain.') || /\.(subtitle|lead)$/.test(k));
  const aliases: Record<string, string[]> = {};
  for (const [a, to] of Object.entries(PAGE_ALIAS)) (aliases[to] ??= []).push(a);
  const help: AppMapUi['help'] = [];
  for (const [k, title] of Object.entries(texts)) {
    const m = /^explain\.([^.]+)\.title$/.exec(k);
    if (!m) continue;
    const body = Object.keys(texts).filter(x => x.startsWith(`explain.${m[1]}.`) && x !== k).sort().map(x => texts[x]).join(' ');
    help.push({ id: m[1]!, title, text: clean(body, 600) });
  }
  let actions: AppMapUi['actions'] = [];
  try { actions = paletteActions(); } catch { actions = []; }
  return {
    lang: lang(),
    nav: navNow(),
    pages: BRAIN_PAGES.map(p => ({ id: p.id, label: p.label, key: p.key, ...(aliases[p.id] ? { aliases: aliases[p.id] } : {}), ...(aboutOf(p.id, texts) ? { about: aboutOf(p.id, texts) } : {}) })),
    memoria: HUB_TABS.map(tab => ({ tab, label: t(`mh.tab.${tab}` as Key) })),
    settings: Object.values(settingsSections([])).map(s => ({ id: s.id, title: s.title, description: s.description, keywords: s.search })),
    actions, help, view: viewPrefs(),
  };
}

// ── the live screen ─────────────────────────────────────────────────────────────────────────────────────────────
/** Containers whose content is private to the agent (a chat's messages, activity and questions, the questions window
 *  and the lane of waiting requests, the notifications and toasts that may quote a chat) or to the user (the personal
 *  browser): never read. A chat strip is one line with its title and state; the
 *  Orchestrator column shows only its bar's controls. */
const PRIVATE = '.chat-tile, [data-testid="orchestrator-overlay"], [data-testid="qwin"], [data-testid="needs-lane"], [data-testid="nc-list"], [data-testid="toasts"], [data-testid="personal-browser"], [data-testid="rec-lines"]';
const HEADER = '.orchestrator-bar';
const CONTROLS = 'h1, h2, h3, [role="tab"], button, a[href], input, select, textarea, [role="switch"], [role="checkbox"], [role="menuitem"], [role="dialog"]';
const MAX_LINES = 220;

function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return clean(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by) { const txt = by.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' '); if (clean(txt)) return clean(txt); }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const l = el.labels?.[0]?.textContent;
    if (clean(l)) return clean(l);
    if ('placeholder' in el && el.placeholder) return clean(el.placeholder);
    return clean(el.getAttribute('title')) || clean(el.dataset.testid); // never its text: a textarea's text is its value
  }
  return clean(el.textContent) || clean(el.getAttribute('title')) || clean(el.dataset.testid);
}
function kindOf(el: HTMLElement): string {
  const role = el.getAttribute('role');
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') return (el as HTMLInputElement).type === 'checkbox' ? 'checkbox' : 'field';
  if (tag === 'textarea') return 'field';
  if (tag === 'a') return 'link';
  return tag;
}
/** The control's state in words; a text field's value is never read (it may be anything the user typed). */
function stateOf(el: HTMLElement): string {
  const out: string[] = [];
  const checked = el.getAttribute('aria-checked') ?? (el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : null);
  if (checked !== null) out.push(checked === 'true' ? 'on' : 'off');
  if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current')) out.push('selected');
  if (el.getAttribute('aria-expanded') !== null) out.push(el.getAttribute('aria-expanded') === 'true' ? 'open' : 'closed');
  if (el.getAttribute('aria-pressed') === 'true') out.push('pressed');
  if (el instanceof HTMLSelectElement) out.push(`= ${clean(el.selectedOptions[0]?.textContent, 40)}`);
  if ((el as HTMLButtonElement).disabled) out.push('disabled');
  return out.join(', ');
}
/** The section a control belongs to: the nearest labelled landmark, section or dialog. */
function regionOf(el: HTMLElement): string {
  const names: string[] = [];
  let n: HTMLElement | null = el.parentElement;
  while (n && names.length < 2) {
    if (n.matches('nav, aside, header, section, [role="dialog"], [role="region"], [role="tabpanel"], [role="search"]')) {
      const name = n.getAttribute('aria-label') || (n.getAttribute('aria-labelledby') ? document.getElementById(n.getAttribute('aria-labelledby')!)?.textContent : '') || '';
      if (clean(name, 40) && !names.includes(clean(name, 40))) names.unshift(clean(name, 40));
    }
    n = n.parentElement;
  }
  return names.join(' › ');
}
function zoneOf(r: DOMRect, w: number, h: number): string {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  if (cy > h) return 'below (scroll)';
  if (cy < 0) return 'above (scroll)';
  const v = cy < h / 3 ? 'top' : cy < (2 * h) / 3 ? 'middle' : 'bottom';
  const o = cx < w / 3 ? 'left' : cx < (2 * w) / 3 ? 'center' : 'right';
  return v === 'middle' && o === 'center' ? 'center' : `${v} ${o}`;
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** What is on screen now, one line per heading or control, private content left out; the ones in view first.
 *  `filter`: words (first four letters of each) a line's label or section must hold, for a long page. */
export function screenOutline(filter = ''): string {
  const want = fold(filter).split(/[^a-z0-9]+/).filter(x => x.length > 2).map(x => x.slice(0, 4));
  const keep = (text: string) => !want.length || want.some(x => fold(text).split(/[^a-z0-9]+/).some(t => t.startsWith(x)));
  const u = ui.get(), w = window.innerWidth, h = window.innerHeight;
  const head = [`page: ${u.page} (${pageLabel(u.page)})${u.pageArg ? ` · ${u.pageArg}` : ''}`, `window ${w}×${h}`,
    `modal: ${u.modal ?? 'none'}`, `orchestrator: ${u.prefs.orchestratorOpen ? 'open' : 'collapsed'}`, ...(u.map ? ['3D map open'] : []),
    ...(u.maximized ? [`maximized: ${u.maximized.replace(/:.*/, '')}`] : []), ...(u.focusMode ? ['focus mode'] : []), ...(u.qwin.shown ? ['questions window open (its content is private)'] : [])];
  const lines: string[] = [head.join(' · ')];
  const seen = new Set<string>(), inView: string[] = [], away: string[] = [];
  // a chat strip is named by its title only (what app_chats shows), never by what is inside it
  for (const tile of Array.from(document.querySelectorAll<HTMLElement>('.chat-tile'))) {
    const r = tile.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const c = tile.dataset.chatId ? app.get().chats[tile.dataset.chatId] : undefined;
    if (!c || !keep(c.title)) continue;
    lines.push(`chat strip «${clean(c.title, 50)}» [${c.state}] · ${zoneOf(r, w, h)} (${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)})`);
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(CONTROLS))) {
    const box = el.closest(PRIVATE);
    if (box && !(box.matches('[data-testid="orchestrator-overlay"]') && el.closest(HEADER))) continue;
    if (el.closest('[hidden], [aria-hidden="true"], .sr-only')) continue;
    if (el instanceof HTMLInputElement && el.type === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const label = labelOf(el);
    if (!label) continue;
    const kind = kindOf(el), region = regionOf(el), state = stateOf(el);
    if (!keep(`${label} ${region}`)) continue;
    const key = `${kind}|${label}|${region}|${Math.round(r.y / 8)}`; // the same button in another row is another line
    if (seen.has(key)) continue;
    seen.add(key);
    const shortcut = /^(Ctrl|Alt|Shift|F\d|[A-Z] [A-Z]$)/.test(el.dataset.tip?.split('|')[1] ?? '') ? el.dataset.tip!.split('|')[1] : undefined;
    const zone = zoneOf(r, w, h);
    (zone.includes('scroll') ? away : inView).push(`${kind} «${label}»${state ? ` [${state}]` : ''}${shortcut ? ` (${shortcut})` : ''}${region ? ` · ${region}` : ''} · ${zone} (${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)})`);
  }
  const rest = [...inView, ...away], room = Math.max(0, MAX_LINES - lines.length);
  lines.push(...rest.slice(0, room));
  if (rest.length > room) lines.push(`… ${rest.length - room} more off screen: outline with a filter (a section's name) to see them`);
  return lines.join('\n');
}

/** Puts the readers and the view setter on window for main's executeJavaScript (main/appctl/guide.ts). */
export function installAppMap(): void {
  Object.assign(window as unknown as Record<string, unknown>, { __sbAppMap: appMap, __sbScreen: screenOutline, __sbView: viewPrefs, __sbSetView: setViewPrefs });
}
