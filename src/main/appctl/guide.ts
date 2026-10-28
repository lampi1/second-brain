// app_guide and the live screen outline: how the Orchestrator knows the app it runs in (ADR 0149; the owner,
// 2026-10-24: "deve essere il massimo esperto di ogni cosa anche UI e posizione degli elementi"). Nothing here is a
// hand-kept description: the map is read when asked, from the code that draws the app. The renderer gives what the UI
// holds (window.__sbAppMap, renderer/lib/app-map.ts: the rail as drawn, pages, Memoria tabs, Settings sections,
// palette actions with their keys, the "?" help texts, the view); main adds the settings schema with the current values,
// the active routines (flows/service.ts, read only: starting one stays app_flow_start's),
// the concepts of the Guida page (shared/concept-guide.ts) and the caller's own tools. Called on demand only, so it
// costs no tokens in the Orchestrator's other turns (the token plan, ADR 0089). Without a topic: a short index; with
// one: the matching entries in full. The outline (window.__sbScreen) is what is on screen now, private content left out
// (lib/app-map.ts). Used by appctl/tools.ts (app_guide, app_ui "outline").
import type { BrowserWindow } from 'electron';
import type { SettingDef, Settings } from '../../shared/contract';
import { CONCEPTS, textOf, type GuideLang } from '../../shared/concept-guide';
import type { FlowSnapshot } from '../../shared/flows';
import { getAt } from '../brain/settings-schema';
import type { ToolDef } from './tools';
import { ROUTINE_AUTHORING_SUMMARY } from '../flows/capabilities';

/** What the renderer's appMap() returns (renderer/lib/app-map.ts AppMapUi). */
interface UiMap {
  lang: string;
  nav: { group: string; items: { page: string; label: string; key?: string }[] }[];
  pages: { id: string; label: string; key: string; aliases?: string[]; about?: string }[];
  memoria: { tab: string; label: string }[];
  settings: { id: string; title: string; description: string; keywords: string }[];
  actions: { group: string; title: string; sub?: string; shortcut?: string }[];
  help: { id: string; title: string; text: string }[];
  view: Record<string, unknown>;
}
export interface GuideDeps {
  window: () => BrowserWindow | null;
  settings: { schema(): SettingDef[]; get(): Settings };
  /** the caller's own tools (name + description) */
  tools: () => { name: string; description: string }[];
  /** the user's personal browser is on screen (ADR 0133): the outline says only that */
  personalShown?: () => boolean;
  /** false on the open /mcp/app mount: settings are listed without their current values (local paths, budgets) */
  showValues?: () => boolean;
  /** the routines (flows/service.ts snapshot): the guide names the active ones and their last run, read only */
  flows?: () => FlowSnapshot | null;
}

/** The active routines in one line each: what the user calls them, version, steps, last run (start: app_flow_start). */
export function routineLines(snap: FlowSnapshot | null | undefined): Entry[] {
  if (!snap) return [];
  return Object.entries(snap.active).flatMap(([id, version]) => {
    const v = snap.versions.find(x => x.definition.id === id && x.version === version);
    if (!v) return [];
    const runs = snap.runs.filter(r => r.flowId === id).sort((a, b) => b.updatedAt - a.updatedAt);
    const last = runs[0], open = runs.filter(r => r.status === 'active' || r.status === 'approval' || r.status === 'blocked').length;
    const def = v.definition;
    return [{ kind: 'routine', title: `${def.title} (flowId "${id}", v${version})`, text: [def.description, def.aliases.length ? `also called: ${def.aliases.join(', ')}` : '', `${def.steps.length} steps`,
      last ? `last run ${new Date(last.updatedAt).toISOString()} ${last.status}` : 'never run', open ? `${open} open run(s): app_flow_overview` : '',
      triggerText(snap, id), 'start for the user: app_flow_match then app_flow_start'].filter(Boolean).join(' · ') }];
  });
}
/** How the Agenti page measures the roles (agents/judge-sample.ts, standing.ts), so the Orchestrator explains the counters and the
 *  review switch from the code's rules. */
const AGENT_REVIEWS = 'Automatic reviews («Revisione · …» chats, a Sentinel in a fresh session): setting judging (Agenti page switch «Abilita controllo livello e performance»; change: app_config area setting judging). On = every finished root work chat gets one review, no daily limit (the old delegation.judgeDaily count is gone), at most two running at once; off = none. Never reviewed: a review chat itself (also a later task or a continuation of it), a delegated child (its parent judged it), a run its receipts (the repo checks after its last change) already decide. One review in ten gets a second one that grades the first.';
const AGENT_LEVELS = 'Agent cards: «Lavori conclusi» counts the ended runs; the Orchestrator\'s are the root jobs it opened, Flash\'s its answers, Pulse\'s (Battito) its card runs. Level = XP from verified successes only (user verdict, verified review, receipts, verified parent), by job size; Flash and Pulse also earn a small low-trust XP from observed outcomes (Flash: the user did not correct or re-ask; Pulse: a card run that answered; a saved/acted/dismissed card is the user\'s verdict). Why a level is stuck: npm run levels.';
/** How the app runs routines (ADR 0175, 0176), so the Orchestrator answers from the code's rules, not a guess. One
 *  entry each: app_guide cuts an entry's text at 700 characters. */
const ROUTINE_RULES: [title: string, text: string][] = [
  ['Routine: pacchetti e chi decide (how routines run)', ['A routine is a package (routine.json) run by the shared routine runtime: each step is a plain Claude Code session, never an app role or chat. The app and the `routine` command in a terminal on this PC write the same run folders (events, report.md); the Routine page lists the packages and both runs, a run opens on its live view (a step waiting for a person in red, with the DevOps comment link).',
    'A package\'s trigger, filters, credentials and a prod «Esegui» are the user\'s clicks on the Routine page. Old role-based routines sit under «Routine da convertire» («Converti in pacchetto»; an enabled old trigger moves to the package); app_config area routine switches and pauses only the old routines\' triggers and runs.'].join(' ')],
  ['Routine: trigger, filtri, avvio (package trigger)', 'On the open package: «Trigger DevOps» on/off and its filters (states, tags all of, excluded tags, work item ids, max per hour; «Salva filtri»): an active trigger checks DevOps and starts a run for each new work item it finds; «Avvia» starts one work item by hand. A package with a missing secret asks for it under «Credenziali» first.'],
  ['Routine: credenziali, export, terminale (secrets)', 'On every save, import and migration the app fills each <set-by-user> secret it holds (DevOps token of the Azure DevOps connector, routine site passwords, the app\'s test-only SQL login for a test DB, never a production one): never ask the user for one the app holds. «Esporta per il terminale» or app_routine_export writes the filled zip only under %LOCALAPPDATA%/routine-runtime/packages/<id>/ and answers its path and the filled and missing secret names, never a value. «Da terminale» gives the run / resume / watch commands; «Importa zip» takes a package zip.'],
];
/** A routine's trigger as the Routine page shows it: state, what it watches, its filters, the queue (ADR 0155). */
function triggerText(snap: FlowSnapshot, flowId: string): string {
  const auto = snap.automation, r = auto?.rules.find(x => x.config.flowId === flowId && x.status !== 'rejected');
  if (!r) return 'no trigger (starts only by hand)';
  const t = r.config.trigger, queue = auto!.events.filter(e => e.ruleId === r.id && ['pending', 'notified', 'blocked'].includes(e.status) && !e.sourceKey.startsWith('restart:')).length;
  const state = auto!.paused ? 'all routines paused' : r.status === 'enabled' ? 'on' : r.status === 'paused' ? 'paused' : 'waiting for the user\'s approval';
  const watch = t.kind === 'manual' ? 'on demand only (grants remain independent of scheduling)' : t.kind === 'devops' ? `DevOps ${t.workItemType} in ${t.areaPath} (${t.states.join('/')}) every ${t.everyMinutes} min` : `every ${t.everyMinutes} min`;
  const filters = t.kind === 'devops' ? [t.includeTags?.length ? `tags ${t.includeTags.join('+')}` : '', t.excludeTags?.length ? `not tags ${t.excludeTags.join(', ')}` : '',
    t.workItemIds?.length ? `only ids ${t.workItemIds.join(', ')}` : '', t.iterationPath ? `iteration ${t.iterationPath}` : '', t.maxPerHour ? `max ${t.maxPerHour}/h` : ''].filter(Boolean).join(', ') : '';
  return `trigger ${state}: ${watch}${filters ? `, filters ${filters}` : t.kind === 'devops' ? ', no filters (tags, ids, iteration, max per hour can be set)' : ''}, queue ${queue}; change trigger, filters, queue, a run's pause: app_config area routine`;
}

/** Runs one of the renderer's fixed readers (never code an agent wrote) with a time limit. */
export async function readUi<T>(win: BrowserWindow | null, expr: string, ms = 3000): Promise<T | null> {
  if (!win || win.isDestroyed()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([win.webContents.executeJavaScript(expr, false) as Promise<T>, new Promise<null>(r => { timer = setTimeout(() => r(null), ms); })]);
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}

export async function screenOutline(d: GuideDeps, filter = ''): Promise<string> {
  // the filter travels as a JSON string literal: data, never code
  const text = await readUi<string>(d.window(), `typeof window.__sbScreen === "function" ? window.__sbScreen(${JSON.stringify(String(filter).slice(0, 200))}) : null`);
  if (!text) return 'The window did not answer (closed or still loading): try again in a moment, or app_screenshot.';
  return d.personalShown?.() ? `${text}\n(the user's personal Browser page is on screen: its content is private)` : text;
}

interface Entry { kind: string; title: string; text: string }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const firstSentence = (s: string) => (/^(.{20,240}?[.:])(\s|$)/.exec(s)?.[1] ?? s.slice(0, 240));
const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** Every entry the guide can answer from, in one list (the topic search runs over it). */
export function entries(ui: UiMap | null, d: GuideDeps, lang: GuideLang): Entry[] {
  const out: Entry[] = [];
  if (ui) {
    const where = new Map<string, string>();
    for (const g of ui.nav) for (const it of g.items) where.set(it.page, g.group ? `left rail › ${g.group}` : 'left rail, top');
    for (const p of ui.pages) out.push({ kind: 'page', title: `${p.label} (page "${p.id}")`,
      text: [`open: app_ui page ${p.id}, or the user presses ${p.key}`, where.get(p.id) ?? (ui.memoria.some(m => m.tab === p.id) ? 'a tab of Memoria' : 'not in the rail now (palette Ctrl+K)'), p.about, p.aliases ? `also called: ${p.aliases.join(', ')}` : ''].filter(Boolean).join(' · ') });
    out.push({ kind: 'page', title: 'Memoria tabs', text: ui.memoria.map(m => `${m.label} (app_ui page memoria/${m.tab})`).join(' · ') });
    for (const s of ui.settings) out.push({ kind: 'settings section', title: `Impostazioni › ${s.title}`, text: `${s.description} · open: app_ui page impostazioni/${s.id} · about: ${s.keywords}` });
    for (const a of ui.actions) out.push({ kind: a.group === 'Vai a' ? 'go to' : 'action', title: a.title, text: [a.sub, a.shortcut ? `keys ${a.shortcut}` : 'from the palette (Ctrl+K)'].filter(Boolean).join(' · ') });
    for (const h of ui.help) out.push({ kind: 'help', title: h.title, text: h.text });
    out.push({ kind: 'view', title: 'Vista (tema, densità, profilo di lavoro)', text: `${d.showValues?.() === false ? '' : `now: ${show(ui.view)} · `}change: app_config area view` });
  }
  const s = d.settings.get(), values = d.showValues?.() ?? true;
  for (const x of d.settings.schema()) out.push({ kind: 'setting', title: `${x.label} (${x.key})`,
    text: `${x.description} · type ${x.type}${x.values ? ` ${x.values.join('|')}` : ''}${x.key.includes('*') || !values ? '' : ` · now ${show(getAt(s, x.key))}`} · change: app_config area setting` });
  out.push({ kind: 'agents', title: 'Agenti: revisioni automatiche on/off (reviews, judging)', text: AGENT_REVIEWS });
  out.push({ kind: 'agents', title: 'Agenti: lavori conclusi e livelli (completed counter, levels, XP)', text: AGENT_LEVELS });
  out.push({ kind: 'concept', title: 'Connettori: moduli MCP elicitation nelle domande', text: 'Claude MCP forms appear in Da rispondere: up to eight flat text, enum, boolean or numeric fields; Altro accepts typed input. The user fills or refuses the form; defaults never approve it and there is no always-allow. Empty forms ask for confirmation. Nested schemas, unsupported constraints, URL requests and credential fields are cancelled with an explanation; use the connector login route for credentials. app_pending lists requests read-only; the user answers in the question panel.' });
  out.push(...routineLines(d.flows?.()));
  if (d.flows) for (const [title, text] of ROUTINE_RULES) out.push({ kind: 'routine', title, text });
  out.push({ kind: 'routine', title: 'Routine: creare un pacchetto (author a routine package from the user need)', text: ROUTINE_AUTHORING_SUMMARY });
  for (const c of CONCEPTS) out.push({ kind: 'concept', title: textOf(c.title, lang), text: `${textOf(c.summary, lang)} ${c.points.slice(0, 3).map(p => textOf(p, lang)).join(' ')} (more: the Guida page)` });
  for (const t of d.tools()) out.push({ kind: 'tool', title: t.name, text: t.description });
  return out;
}

/** A query word matches a word of the text that starts like it: the first 4 letters of a longer word, so Italian
 *  forms meet («chiusura» finds «Chiudi», «notifica» finds «notifiche»). */
const stem = (w: string) => (w.length > 4 ? w.slice(0, 4) : w);
/** Words that say how a question is asked, not what it is about (it, en, de): never matched. */
const STOP = new Set(('dove come cosa quale quali quando perche posso puoi voglio vorrei fare cambio cambia cambiare modifica modificare '
  + 'imposta impostare trovo trova trovare metti mettere sono della delle degli dello nella nelle negli con per che una uno gli le '
  + 'where what which when how can could want change set find put the and for with this that does show '
  + 'wie was wo wann kann ich mochte andern finde der die das und mit').split(' '));
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
export function search(list: Entry[], topic: string, max = 15): Entry[] {
  const words = [...new Set(tokens(topic).filter(w => w.length > 2 && !STOP.has(w)).map(stem))];
  if (!words.length) return [];
  const has = (toks: string[], w: string) => toks.some(t => t.startsWith(w));
  const scored = list.map(e => {
    const title = tokens(e.title), body = tokens(e.text);
    const inTitle = words.filter(w => has(title, w)).length, inBody = words.filter(w => !has(title, w) && has(body, w)).length;
    return { e, score: inTitle * 3 + inBody, hits: inTitle + inBody };
  }).filter(x => x.hits >= Math.max(1, Math.ceil(words.length / 2)));
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(x => x.e);
}

/** The index without a topic: the layout, the pages and where to look next; a few hundred tokens. */
function index(ui: UiMap | null, d: GuideDeps, lang: GuideLang): string {
  const lines = ['second-brain: an Electron desktop app. Layout: left rail (pages, and under Grindhouse the open agents as a tree), the page in the middle, the Orchestrator column on the right (collapsible, Ctrl+R), Ctrl+K palette = go anywhere and every action, Ctrl+/ = shortcuts, Ctrl+J = next thing waiting for the user.'];
  if (ui) {
    lines.push('Left rail now: ' + ui.nav.map(g => `${g.group || 'top'}: ${g.items.map(i => `${i.label} [${i.page}${i.key ? `, ${i.key}` : ''}]`).join(', ')}`).join(' | '));
    lines.push('Memoria tabs: ' + ui.memoria.map(m => m.label).join(', '));
    lines.push('Impostazioni sections: ' + ui.settings.map(s => `${s.title} [${s.id}]`).join(', '));
    lines.push('Palette actions: ' + ui.actions.filter(a => a.group !== 'Vai a').map(a => `${a.title}${a.shortcut ? ` (${a.shortcut})` : ''}`).join(', '));
    lines.push('Help topics: ' + ui.help.map(h => h.title).join(', '));
  } else lines.push('(the window did not answer: pages and sections missing; try again)');
  const routines = routineLines(d.flows?.());
  lines.push(routines.length ? `Routines (page Routine, active): ${routines.map(r => r.title).join(', ')}; triggers, filters, queue, pause: app_config area routine; how they run: app_guide topic "routine"` : 'Routines: none active yet (page Routine).');
  lines.push('Concepts (Guida page): ' + CONCEPTS.map(c => textOf(c.title, lang)).join(', '));
  lines.push(`Settings: ${d.settings.schema().length} keys, read and change them with app_config (area setting).`);
  lines.push('Ask app_guide with a topic for details ("tema", "notifiche", "Memoria", "chiusura automatica", "permessi Scout"…); app_ui action "outline" = what is on screen now with positions; app_config = change any configuration.');
  return lines.join('\n');
}

export function guideTool(d: GuideDeps): ToolDef {
  return {
    name: 'app_guide',
    description: 'How this app works and where everything is, read live from the app\'s own code: pages and the left rail with shortcuts, Memoria tabs, Impostazioni sections, every setting with its current value, palette actions and keys, the "?" help texts, the Guida concepts and your tools. No topic: a short index. An exact tool name returns its complete live description (bounded), including approval rules. topic: words in the user\'s language ("dove cambio il tema", "chiusura automatica") → the matching entries. Use it before answering a question about the app or telling the user where to click; for what is on screen now use app_ui action "outline"; to change a configuration use app_config.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, properties: { topic: { type: 'string', description: 'optional: what to look up' } } },
    run: async a => {
      const ui = await readUi<UiMap>(d.window(), 'typeof window.__sbAppMap === "function" ? window.__sbAppMap() : null');
      const topic = typeof a.topic === 'string' ? a.topic.trim() : '';
      const lang: GuideLang = ui?.lang === 'en' || ui?.lang === 'de' ? ui.lang : 'it';
      if (!topic) return index(ui, d, lang);
      const exact = d.tools().find(tool => tool.name === topic);
      if (exact) return `[tool] ${exact.name}: ${exact.description.length <= 16000 ? exact.description : `${exact.description.slice(0, 15800)}… [truncated; read the mounted tool schema for the complete contract]`}`;
      const found = search(entries(ui, d, lang), topic);
      if (!found.length) return `Nothing on "${topic}". ${index(ui, d, lang)}`;
      return found.map(e => `[${e.kind}] ${e.title}: ${e.kind === 'tool' ? firstSentence(e.text) : e.text.length > 700 ? `${e.text.slice(0, 699)}…` : e.text}`).join('\n');
    },
  };
}
