// app_guide and the live screen outline: how the Orchestrator knows the app it runs in (ADR 0149; the owner,
// 2026-10-24: "deve essere il massimo esperto di ogni cosa anche UI e posizione degli elementi"). Nothing here is a
// hand-kept description: the map is read when asked, from the code that draws the app. The renderer gives what the UI
// holds (window.__sbAppMap, renderer/lib/app-map.ts: the rail as drawn, pages, Memoria tabs, Settings sections,
// palette actions with their keys, the "?" help texts, the view); main adds the settings schema with the current values,
// the static terminal-only routine guidance (never scans run data), the usage counter's summary (ADR 0202: which pages and
// actions the user used most in 14 days, local counts, on the authenticated Orchestrator's mount only),
// the concepts of the Guida page (shared/concept-guide.ts), the caller's own tools and, from appctl/tool-catalog.ts,
// every other tool of the app (the work chats', the browser's, the brain hooks'), so it knows the whole app (ADR 0208). Called on demand only, so it
// costs no tokens in the Orchestrator's other turns (the token plan, ADR 0089). Without a topic: a short index; with
// one: the matching entries in full. The outline (window.__sbScreen) is what is on screen now, private content left out
// (lib/app-map.ts). Used by appctl/tools.ts (app_guide, app_ui "outline").
import type { BrowserWindow } from 'electron';
import type { SettingDef, Settings } from '../../shared/contract';
import { CONCEPTS, textOf, type GuideLang } from '../../shared/concept-guide';
import { getAt } from '../brain/settings-schema';
import type { ToolDef } from './tools';
import { ROUTINE_AUTHORING_SUMMARY } from '../flows/capabilities';
import { MOUNT_LABEL, TOOL_CATALOG, type ToolMount } from './tool-catalog';
import { useCounts } from '../use-counter';

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
  /** the usage counter's summary (tests); absent = the app's own counter (use-counter.ts) */
  usage?: () => string;
}

/** How the Agenti page measures the roles (agents/judge-sample.ts, standing.ts), so the Orchestrator explains the counters and the
 *  review switch from the code's rules. */
const AGENT_REVIEWS = 'Automatic reviews («Revisione · …» chats, a Sentinel in a fresh session): setting judging (Agenti page switch «Abilita controllo livello e performance»; change: app_config area setting judging). On = every finished root work chat gets one review, no daily limit (the old delegation.judgeDaily count is gone), at most two running at once; off = none. Never reviewed: a review chat itself (also a later task or a continuation of it), a delegated child (its parent judged it), a run its receipts (the repo checks after its last change) already decide. One review in ten gets a second one that grades the first. Off: the Agenti page and npm run levels say «Controllo spento dal <giorno>: nessuna revisione indipendente, contano solo i tuoi voti»; nothing turns it on but the user.';
const AGENT_LEVELS = 'Agent cards: «Lavori conclusi» counts the ended runs; the Orchestrator\'s are the root jobs it opened, Flash\'s its answers. Level = XP from verified successes only (user verdict, verified review, receipts, verified parent, a Sentinel review graded later by the user, a second review, its parent\'s feedback or a rework of the reviewed run), by job size; Flash also earns a small low-trust XP from observed outcomes (the user did not correct or re-ask). Pulse (Battito) and the retired roles (Judge, Scribe, Router) have no level and no stats; their old runs stay readable. Receipts: a turn outside git knows its files from its edit tools when it ran no command that may write. Why a level is stuck: npm run levels.';
/** A page that crashed and where interface errors go (ADR 0192), so the Orchestrator tells the user what the card means. */
const PAGE_ERRORS = 'A page that fails to render shows «Questa pagina ha avuto un errore» in its place (each page, the focus view, the 3D map and this column\'s body have their own): «Ricarica la pagina» mounts it again; the rest of the app, the chats and the agents keep working. Every interface error (that card, an uncaught exception, an unhandled promise rejection) goes to the technical log, scope renderer, rate-limited: app_logs or npm run logs -- --scope renderer. A «Manutenzione» click sees them in its pack (ui-errors) and can propose an «Apri issue» card; the daily digest keeps the counts 90 days. Nothing to approve: reloading the page is the user\'s click.';
/** The measures added by ADR 0197, read only (no setting, no tool changes them): where they are and what they rest on. */
const MEASURES_0197: [title: string, text: string][] = [
  ['Qualità: correzioni tue ogni 100 turni (errors you had to catch)', 'Page qualita (app_ui page qualita), card «Errori che hai dovuto trovare tu». Main counts each message the user sends to an app chat when sent, never its text: «Correggi il pensiero» tag, a correction to a run whose agent had reported («riapertura dopo il report», also written on the run as corrections.afterReport), else the brain correction detector (local semantic model when warm, the hook regex otherwise; «non capisco» never counts). Per day in userData/user-corrections.json; ai-errors.md rows seen by him count only beyond those. «Come lo conto» on the card; no data = «nessun dato», never 0.'],
  ['Classificatori: tipo di lavoro per esempi (kind by examples)', 'Page classificatori, wide card «Tipo di lavoro per esempi» (on trial). Nearest centroid over the local e5 embeddings of the user\'s ended runs with a verified outcome, labelled by the word rule (taskOf); «altro» below a threshold calibrated on 20% of them; tested on another 20% (agreement with the word rule and confusion matrix: agreement, not truth). Zero tokens, computed only when the page asks. Routing still uses the word rule; switching is the user\'s decision, not a setting.'],
  ['Agenti: stima con tutti i giudizi e accordo Sentinel–te (PPI, kappa)', 'Role page (Agenti › a role): beside «Successi verificati», only when at least 5 runs are judged both by the user and by an automatic judge (newest Sentinel review, else the receipts), «Stima con tutti i giudizi» = mean of the automatic judgments + mean(user − automatic) on those runs, 90% range (prediction-powered inference). «Accordo Sentinel–te» = share of equal verdicts and Cohen\'s kappa with n. Kept runs only; read only.'],
];
/** Andamento's tabs (ADR 0202): the four statistics pages in one, and where their old ids land. */
const ANDAMENTO_TABS = 'One page, rail › Andamento (G C), five tabs: Costi (app_ui page andamento/costi, period andamento/costi/1|7|30|90), Qualità (andamento/qualita), Apprendimento (andamento/apprendimento, once a Memoria tab), Classificatori (andamento/classificatori, once a Brain page), Uso (andamento/uso, the local usage counter). The old ids costi, qualita, apprendimento, classificatori and memoria/apprendimento open their tab; keys G Q, G J, G K too. Read only, nothing to approve.';
/** The usage counter (ADR 0202): what it counts and where, before its numbers. */
const USAGE_ABOUT = 'Andamento → Uso (app_ui page andamento/uso): page and tab opens and main actions (new request, Orchestrator, Discuti, focus mode, stop all, dictation, file opens…) counted per day on this PC, kept 90 days, zero tokens, never sent anywhere; for deciding which features to keep. Read only: nothing to approve, no setting.';
/** How the app prepares and observes terminal routines (ADR 0179), so the Orchestrator answers from the code's rules. One
 *  entry each: app_guide cuts an entry's text at 700 characters. */
const ROUTINE_RULES: [title: string, text: string][] = [
  ['Routine: terminal only', 'The terminal routine CLI is the only executor: run, watch and resume keep their existing behavior. The app never starts, advances, retries, cancels, settles or reconciles a run. Triggers and automation belong only to routine watch. Give the user the terminal command; do not launch it from an app chat.'],
  ['Routine: live view and history', 'Open Routine, select a run to watch steps, actions, screenshots, evidence and reports. Only that open view watches its run folder. Closing it stops the watch; there are no background scans, polling, routine notifications or questions. app_routine_status reads progress only when the user explicitly asks; generic recaps must not scan routines. Old app runs are read-only archives, including unresolved writes.'],
  ['Routine: packages and export', 'The app can prepare, import and export a package for the terminal without executing it. app_routine_export fills known secret placeholders and writes the zip in the terminal packages folder, returning its path and secret names only. Never copy credentials into a repository or the brain. Old definitions can be converted explicitly; conversion never resumes their runs.'],
];


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
  out.push({ kind: 'concept', title: 'Errore di una pagina («Questa pagina ha avuto un errore», page crash, interface errors, renderer log)', text: PAGE_ERRORS });
  out.push({ kind: 'concept', title: 'Connettori: moduli MCP elicitation nelle domande', text: 'Claude MCP forms appear in Da rispondere: up to eight flat text, enum, boolean or numeric fields; Altro accepts typed input. The user fills or refuses the form; defaults never approve it and there is no always-allow. Empty forms ask for confirmation. Nested schemas, unsupported constraints, URL requests and credential fields are cancelled with an explanation; use the connector login route for credentials. app_pending lists requests read-only; the user answers in the question panel.' });
  out.push({ kind: 'concept', title: 'Guida: Chiedi alla Guida, Per te, da verificare (ask the guide)', text: 'The Guida page (app_ui page guida) has a question box on top, «Chiedi alla Guida»: the user\'s question goes to one light model with no tools (Flash\'s engine, lightest tier) with the matching concept cards and this index; the answer cites cards (clickable) and source files, with its cost. Only the user\'s click asks; no approval (no tools). «Per te» lists the three cards this user needs most from local counters (the "?" opened, cards opened, questions to the Orchestrator, Log errors), zero tokens. A card marked «da verificare» describes code that changed after its text (only in a run from the repo). Cards about roles, delegation and the app\'s IPC show a diagram drawn from the code.' });
  for (const [title, text] of MEASURES_0197) out.push({ kind: 'measure', title, text });
  out.push({ kind: 'page', title: 'Andamento tabs (Trends: costi, qualita, apprendimento, classificatori, uso)', text: ANDAMENTO_TABS });
  out.push({ kind: 'usage', title: 'Uso dell\'app: funzioni e pagine usate di più (usage counter, most used features, quali funzioni uso di più, cosa uso poco)',
    text: `${USAGE_ABOUT} ${values ? (d.usage ?? (() => useCounts.summary()))() : 'The counts are shown only on the Orchestrator\'s own endpoint.'}` });
  for (const [title, text] of ROUTINE_RULES) out.push({ kind: 'routine', title, text });
  out.push({ kind: 'routine', title: 'Routine: creare un pacchetto (author a routine package from the user need)', text: ROUTINE_AUTHORING_SUMMARY });
  for (const c of CONCEPTS) out.push({ kind: 'concept', title: textOf(c.title, lang), text: `${textOf(c.summary, lang)} ${c.points.slice(0, 3).map(p => textOf(p, lang)).join(' ')} (more: the Guida page)` });
  const own = d.tools();
  for (const t of own) out.push({ kind: 'tool', title: t.name, text: t.description });
  for (const [name, text] of otherTools(own)) out.push({ kind: 'tool', title: name, text });
  return out;
}

/** The app's tools the caller does not have (appctl/tool-catalog.ts), each with who has it: name → text. */
export function otherTools(own: readonly { name: string }[]): [name: string, text: string][] {
  const mine = new Set(own.map(t => t.name));
  return Object.entries(TOOL_CATALOG).filter(([name]) => !mine.has(name))
    .map(([name, info]) => [name, `${info.line} (not on your endpoint: ${info.where.map(w => MOUNT_LABEL[w]).join(', ')})`]);
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
  lines.push('Usage: which pages and actions the user uses most (local counter, 14 days): app_guide topic "uso", page andamento/uso.');
  lines.push('Routines: terminal execution only; open Routine for live progress and history, or ask app_routine_status explicitly.');
  lines.push('Concepts (Guida page): ' + CONCEPTS.map(c => textOf(c.title, lang)).join(', '));
  const byMount = new Map<ToolMount, string[]>();
  const mine = new Set(d.tools().map(t => t.name));
  for (const [name, info] of Object.entries(TOOL_CATALOG)) if (!mine.has(name)) for (const w of info.where) { const l = byMount.get(w) ?? []; l.push(name); byMount.set(w, l); }
  if (byMount.size) lines.push('Other tools of the app (not yours; ask app_guide with the name): ' + [...byMount].map(([w, names]) => `${MOUNT_LABEL[w]}: ${names.join(', ')}`).join(' | '));
  lines.push(`Settings: ${d.settings.schema().length} keys, read and change them with app_config (area setting).`);
  lines.push('Ask app_guide with a topic for details ("tema", "notifiche", "Memoria", "chiusura automatica", "permessi Scout"…); app_ui action "outline" = what is on screen now with positions; app_config = change any configuration.');
  return lines.join('\n');
}

/** app_guide's index without a topic, read live (the Guida's «Chiedi alla Guida» gives it to its model, ADR 0196). */
export async function guideIndex(d: GuideDeps, lang: GuideLang): Promise<string> {
  return index(await readUi<UiMap>(d.window(), 'typeof window.__sbAppMap === "function" ? window.__sbAppMap() : null'), d, lang);
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
      const other = exact ? undefined : otherTools(d.tools()).find(([name]) => name === topic);
      if (other) return `[tool] ${other[0]}: ${other[1]}`;
      if (exact) return `[tool] ${exact.name}: ${exact.description.length <= 16000 ? exact.description : `${exact.description.slice(0, 15800)}… [truncated; read the mounted tool schema for the complete contract]`}`;
      const found = search(entries(ui, d, lang), topic);
      if (!found.length) return `Nothing on "${topic}". ${index(ui, d, lang)}`;
      return found.map(e => `[${e.kind}] ${e.title}: ${e.kind === 'tool' ? firstSentence(e.text) : e.text.length > 700 ? `${e.text.slice(0, 699)}…` : e.text}`).join('\n');
    },
  };
}
