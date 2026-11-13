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
import type { PhoneStatus } from '../../shared/contract/phone';
import { phoneHub } from '../ipc-handlers/phone';

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
  /** false on the open /mcp/app mount: settings are listed without their current values (local paths, budgets) */
  showValues?: () => boolean;
  /** the usage counter's summary (tests); absent = the app's own counter (use-counter.ts) */
  usage?: () => string;
  /** the phone bridge's live status (tests); absent = the controller the IPC hub holds (ipc-handlers/phone.ts). Never the token. */
  phone?: () => PhoneStatus;
}

// ADR 0207: what the Orchestrator needs to add a connector for the user without ever handling a secret
const CONNECTOR_ADD = 'Impostazioni › Connettori, «Aggiungi server MCP» (app_ui page impostazioni/connectors): the user pastes a README\'s JSON (mcpServers), a command line (npx …, uvx …, docker run …) or an https URL and the form fills itself, or picks a popular server (filesystem, fetch, memory, sequential-thinking, git, playwright, context7, brave-search); «Salva e prova» saves, stores typed tokens encrypted and tests. Every server card has role chips (who may use it), Orchestrator and Flash included; Flash (quick chats) starts off and gets reading tools only. You: app_config area connector — action get (servers, access per role incl. flash, token slots set or not, last test), add with snippet (the same paste) or def ({label, transport stdio|http, command, args, env, url, headers, tokens:[{name, placement env|header, header?, prefix?}]}), set key access (role incl. flash, value all|read|none) | enabled | label | purpose | command | args | env | url | headers | tokens, test, remove, undo (the key from a change), form (opens the add form prefilled for the user). Every change posts a feed card with «Annulla». A server you add, or whose command, args, env or url you change, is saved OFF and waits for the user\'s own click «Attiva» (on its feed card or its card in Impostazioni › Connettori, both showing exactly the command line or address it will start): tell the user to read it and click «Attiva»; you cannot switch it on or test it before that. Flash only ever gets reading tools, a tool list included. Secret values: never ask for them, never repeat them; a pasted value is dropped and the user types it in the form (action form). Import from Claude/Cursor: the user\'s button «Importa da Claude e Cursor» on the same page.';
const SETTINGS_PAGE = 'Impostazioni: a left nav by category (Tu, Lavoro, Strumenti, App) and a search on top (also Ctrl+K «Impostazioni › <sezione>») that filters rows and highlights the words. Each row: name and one line on the left, the control on the right; a shield marks protected settings (another agent can only propose them; the user\'s click or their request to you changes them, at once). Every change saves at once; a «Salvato» pill with «Annulla» appears top right («Modificato dall\'Orchestrator» for yours). Undo of your setting change: app_config action undo with its changeId.';
/** How the Agenti page measures the roles (agents/judge-sample.ts, standing.ts), so the Orchestrator explains the counters and the
 *  review switch from the code's rules. */
const AGENT_REVIEWS = 'Automatic reviews (ADR 0203): setting judging (Agenti page switch «Abilita controllo livello e performance»; change: app_config area setting judging). On = a sample of the finished root work runs is reviewed by ONE hidden read-only Sentinel run a night: no chat, no Grindhouse strip, no notification. Sample: 25% of each role\'s undecided runs, 10% when its performance spread is under 10 points with 5 verdicts on its current model, skills and rules, back to 25% after a change to them. Never sampled: a run the user judged, one its receipts decide (recorded at once, zero tokens), a reworked or reopened run, a delegated child, a review. No second review of the reviewer. Off = none.';
const AGENT_REVIEWS_NIGHT = 'Nightly review timing and cap (ADR 0203): due once a day, at 03:00 if the app is running, else at the first idle moment after the next start (open 5 min, no keyboard/mouse for 10 min); missed nights = still one session over the last 7 days, oldest first. Daily cap: setting judgingCapUsd (default 1 $, «Tetto al giorno» beside the switch; change: app_config area setting judgingCapUsd): as many runs as it buys at the median cost of a reviewed run. The Log shows «Revisione notturna: N run, X $»; the work roles\' cards say «Aggiornato stanotte alle 03:00».';
const AGENT_LEVELS = 'Agent cards: «Lavori conclusi» counts the ended runs; the Orchestrator\'s are the root jobs it opened, Flash\'s its answers. Level = XP from verified successes only (user verdict, verified review, receipts, verified parent, a Sentinel review graded later by the user, a second review, its parent\'s feedback or a rework of the reviewed run), by job size; Flash also earns a small low-trust XP from observed outcomes (the user did not correct or re-ask). The retired roles (Judge, Scribe, Router) have no level and no stats; their old runs stay readable. Receipts: a turn outside git knows its files from its edit tools when it ran no command that may write. Why a level is stuck: npm run levels.';
/** A page that crashed and where interface errors go (ADR 0192), so the Orchestrator tells the user what the card means. */
const PAGE_ERRORS = 'A page that fails to render shows «Questa pagina ha avuto un errore» in its place (each page, the focus view, the 3D map and this column\'s body have their own): «Ricarica la pagina» mounts it again; the rest of the app, the chats and the agents keep working. Every interface error (that card, an uncaught exception, an unhandled promise rejection) goes to the technical log, scope renderer, rate-limited: app_logs or npm run logs -- --scope renderer. A «Manutenzione» click sees them in its pack (ui-errors) and can propose an «Apri issue» card; the daily digest keeps the counts 90 days. Nothing to approve: reloading the page is the user\'s click.';
/** The measures added by ADR 0197, read only (no setting, no tool changes them): where they are and what they rest on. */
const MEASURES_0197: [title: string, text: string][] = [
  ['Qualità: correzioni tue ogni 100 turni (errors you had to catch)', 'Page qualita (app_ui page qualita), card «Errori che hai dovuto trovare tu». Main counts each message the user sends to an app chat when sent, never its text: «Correggi il pensiero» tag, a correction to a run whose agent had reported («riapertura dopo il report», also written on the run as corrections.afterReport), else the brain correction detector (local semantic model when warm, the hook regex otherwise; «non capisco» never counts). Per day in userData/user-corrections.json; ai-errors.md rows seen by him count only beyond those. «Come lo conto» on the card; no data = «nessun dato», never 0.'],
  ['Agenti: stima con tutti i giudizi e accordo Sentinel–te (PPI, kappa)', 'Role page (Agenti › a role): beside «Successi verificati», only when at least 5 runs are judged both by the user and by an automatic judge (newest Sentinel review, else the receipts), «Stima con tutti i giudizi» = mean of the automatic judgments + mean(user − automatic) on those runs, 90% range (prediction-powered inference). «Accordo Sentinel–te» = share of equal verdicts and Cohen\'s kappa with n. Kept runs only; read only.'],
];
/** Andamento's tabs (ADR 0202): the four statistics pages in one, and where their old ids land. */
const ANDAMENTO_TABS = 'One page, rail › Andamento (G C), four tabs: Costi (app_ui page andamento/costi, period andamento/costi/1|7|30|90), Qualità (andamento/qualita), Apprendimento (andamento/apprendimento, once a Memoria tab), Uso (andamento/uso, the local usage counter). The old ids costi, qualita, apprendimento, classificatori (→ Qualità; its section left with ADR 0291) and memoria/apprendimento open their tab; keys G Q and G J too. Read only, nothing to approve.';
/** How a chat's engine, model and effort are chosen (ADR 0210: the routing table is gone). */
const MODEL_CHOICE = 'Every agent runs on the engine, model and effort on its card, unless Balanced mode is on (its own card) (Agenti › role: engine, model; no model = the model of its tier on that engine, Impostazioni › Ruoli › livelli; a launch may ask a higher tier up to the role\'s max). No table picks a model per kind of work any more (owner, 2026-10-30): app_routing and app_routing_save are gone, old routing files in the brain are ignored. A chat without a role (Nuova chat, a new Orchestrator) takes the user\'s «Chat aperte dall\'Orchestrator» defaults or what the user names. To change a role\'s model: Agenti › the role (the back of its card: the shared picker, «Salva nel ruolo» = default of its new chats), or app_config. One picker everywhere (ModelPicker): the four engines with search, each engine\'s state and why it cannot take a model, context and effort per model, loading/error/empty said. On the Orchestrator\'s chip and a strip\'s ⋯ «Modello ed effort…»: «Solo questa chat» changes that chat only (its own engine); on the Orchestrator «Predefinito dell\'Orchestrator» saves engine and model on its card (next Orchestrator on that engine); Flash\'s chip saves its card (it follows the card at every question). «Predefinito della CLI» (the engine picks) is a model row, distinct from the effort. Each chat still records its kind of work for the ledger.';
/** Balanced mode (ADR 0218): who picks the engine, model and effort of a delegation while it is on. */
const BALANCED_MODE = 'Balanced mode (setting balancedMode, off by default, protected; ADR 0218): its switch is the first row of the Orchestrator\'s model menu, mirrored in Impostazioni › Ruoli e deleghe. On: every role card\'s model button reads «Balanced» and the agent that delegates (Orchestrator, Strategist) picks engine, model and effort of each role chat so that credits are spent evenly, in proportion to what each provider has left. It reads balanced_status (read-only, no network: each credit pool with left, renewal, target and real share; stats per role and model; the formula\'s proposal), then passes balanced: {engine, model, effort?, why} (engine, model and why required) to app_create_chat or to each agent_delegate task. The app checks only hard limits (engine enabled and trusted, it can apply a model choice, the caller may start it, the model is the card\'s own or one of a tier up to the role\'s max tier, pool not exhausted); no choice = the formula picks. route.reason says who chose and why. Credits: Claude read from its plan windows; OpenCode only «finished» from its log; Cursor and Codex learn from limit errors. Off: each role goes back to its card.';
const PHONE_BRIDGE = 'Telefono (ADR 0219, Impostazioni › Telefono): the user\'s own private Telegram bot brings messages and voice notes from the phone to the Orchestrator; it runs only in the stable instance (dev shows «Solo istanza stable»). The user pastes the BotFather token once: it is encrypted with safeStorage, write-only, used only by the main process towards api.telegram.org and redacted from logs; no agent, chat, tool or file ever gets it, so never ask the user for it or for its value (send them to Impostazioni › Telefono). Pairing: «Associa telefono» shows a 6-digit code that expires; /start <code> from Telegram binds one Telegram user, everyone else is dropped silently (the counter in Settings). Approval boundary: from the phone the user answers only simple yes/no questions and Strategist plans, with buttons; permissions, commands, production and messages to people stay «Serve il PC»; text typed on the phone never approves anything. Voice notes are decoded in the page and transcribed locally (max 5 min, 20 MB), no recording is created. Focus: the phone gets only what Focus lets through; quiet hours (default 22-7, optional) mute non-urgent messages. /pausa and /stop from the phone pause or stop the bot until the user turns it on again in Settings.';
/** Remote Control (ADR 0229): where its button is, what it does; no tool, the user's click only.
 * Worker requests use the Orchestrator desktop panel or supported Telegram buttons, never text relays.
 * X hides the banner without disconnecting; the phone icon retrieves its link again. */
const REMOTE_CONTROL = 'Controllo remoto (ADR 0229): the phone icon on the Orchestrator\'s head (Claude engine only) turns on Claude Code Remote Control of the Orchestrator\'s own session. A line under the head shows the claude.ai/code link: the user opens it on the phone (Claude app or browser) and continues the same session there; no QR code (no library), «Copia link» instead. Messages typed on the phone appear in the app chat marked «dal telefono»; permission questions also go to the phone; a work chat\'s Sì/No question reaches it through relay_question (ADR 0239), the user answers «sì» or «no» there. It survives an app restart (same link, reattached). Only the user turns it on or off with that button: there is no agent tool, so tell the user where it is. Works also when Telegram is blocked.';
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
  return text;
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
  out.push({ kind: 'agents', title: 'Agenti: revisioni automatiche notturne on/off, campione (reviews, judging)', text: AGENT_REVIEWS });
  out.push({ kind: 'agents', title: 'Agenti: revisioni automatiche, quando e tetto di spesa (nightly review, judgingCapUsd)', text: AGENT_REVIEWS_NIGHT });
  out.push({ kind: 'agents', title: 'Agenti: lavori conclusi e livelli (completed counter, levels, XP)', text: AGENT_LEVELS });
  out.push({ kind: 'concept', title: 'Errore di una pagina («Questa pagina ha avuto un errore», page crash, interface errors, renderer log)', text: PAGE_ERRORS });
  out.push({ kind: 'concept', title: 'Connettori: aggiungere un server MCP (add, paste JSON, catalog, test, Flash, Orchestrator)', text: CONNECTOR_ADD });
  out.push({ kind: 'concept', title: 'Impostazioni: ricerca, «Salvato» e Annulla (settings search, saved, undo, protected)', text: SETTINGS_PAGE });
  out.push({ kind: 'concept', title: 'Domande iniziali, skill dei ruoli e Plan', text: 'Per un nuovo lavoro l’Orchestrator verifica se resta una scelta importante. Il ruolo che la incontra chiede direttamente, una domanda Sì/No alla volta. Se vede uno svantaggio concreto propone una sola alternativa. In Plan contano tre risposte, inclusa la prima risposta verificata tramite intakeQuestion su app_create_chat o app_assign_task new-task. «Basta domande» chiude le domande. L’approvazione del piano resta nel suo pannello. agent_catalog elenca le skill di ogni ruolo; app_config apre la configurazione agenti. Le skill si leggono per il compito e non concedono permessi.' });
  out.push({ kind: 'concept', title: 'Connettori: moduli MCP elicitation nelle domande', text: 'Claude MCP forms appear in Da rispondere: up to eight flat text, enum, boolean or numeric fields; Altro accepts typed input. The user fills or refuses the form; defaults never approve it and there is no always-allow. Empty forms ask for confirmation. Nested schemas, unsupported constraints, URL requests and credential fields are cancelled with an explanation; use the connector login route for credentials. app_pending lists requests read-only; the user answers in the question panel.' });
  out.push({ kind: 'concept', title: 'Guida: Chiedi alla Guida, Per te, da verificare (ask the guide)', text: 'The Guida page (app_ui page guida) has a question box on top, «Chiedi alla Guida»: the user\'s question goes to one light model with no tools (Flash\'s engine, lightest tier) with the matching concept cards and this index; the answer cites cards (clickable) and source files, with its cost. Only the user\'s click asks; no approval (no tools). «Per te» lists the three cards this user needs most from local counters (the "?" opened, cards opened, questions to the Orchestrator, Log errors), zero tokens. A card marked «da verificare» describes code that changed after its text (only in a run from the repo). Cards about roles, delegation and the app\'s IPC show a diagram drawn from the code.' });
  for (const [title, text] of MEASURES_0197) out.push({ kind: 'measure', title, text });
  out.push({ kind: 'page', title: 'Andamento tabs (Trends: costi, qualita, apprendimento, uso)', text: ANDAMENTO_TABS });
  out.push({ kind: 'concept', title: 'Modello di un agente: chi lo sceglie (model choice, no routing table)', text: MODEL_CHOICE });
  out.push({ kind: 'concept', title: 'Balanced mode: crediti in equilibrio tra i provider (auto model choice, credits)', text: BALANCED_MODE });
  out.push({ kind: 'concept', title: 'Copie di lavoro delle chat delegate (worktree pool, cleanup, disk cap, warm folders)', text: 'A delegated chat that writes works in an app worktree of the parent\'s repository on its own branch sb/delegate-<12 hex> at the parent\'s HEAD (ADR 0227, every engine). A free, clean slot of the same repository is reused (git checkout -B + clean -fd, never -x: build outputs stay); one with changes, unpushed commits, an open chat or a lease never is. «Pulisci ora» in Impostazioni › Avanzate (app_ui page impostazioni, block #st-worktree-pool); the automatic cleanup (5 min after start, then every 6 h) only measures until the user\'s first «Pulisci ora», never before. A cleanup removes only the app\'s clean orphans over the limits (settings worktreePoolPerRepo 6, worktreePoolTotal 20, worktreeDiskCapGb 40, protected), then git worktree prune; worktrees holding work are only listed there with the space of each repository. A child whose slot went to another child cannot be reopened. Warm Claude engines wait in the 3 folders where new chats are made most, a delegated child\'s in its repository\'s next free slot.' });
  out.push({ kind: 'concept', title: 'Telefono: l\'Orchestrator su Telegram (phone bridge, bot, token, pairing, approval boundary)', text: PHONE_BRIDGE });
  out.push({ kind: 'concept', title: 'Controllo remoto: l\'Orchestrator dal telefono su claude.ai (Remote Control, phone, link, claude.ai/code)', text: `${REMOTE_CONTROL}\nThe banner X only hides it; the phone icon retrieves the link and Spegni disconnects. Worker requests and Strategist plans wait as rows in the Orchestrator (ADR 0269) and on Telegram buttons. From Remote Control the Orchestrator answers for the user, as on the PC (ADR 0275): questions, permissions, plans with app_resolve_question; a production/DB/Azure command or permission is shown to him whole and done after his yes. Never send him to a chat or the PC. Canonical outcomes arrive automatically; no Sintetizza or Fai il punto button is needed. Conversational recap still uses app_work_list and app_digest.` });
  out.push({ kind: 'concept', title: 'Telefono: stato adesso (phone bridge status, Telegram, pairing)', text: phoneNow(d) });
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

/** The phone bridge now, as Impostazioni › Telefono shows it: state, token set or not (never its value), pairing. */
export function phoneNow(d: Pick<GuideDeps, 'phone'>): string {
  let st: PhoneStatus;
  try { st = (d.phone ?? (() => phoneHub.controller().status()))(); } catch { return 'Now: status unreadable.'; }
  const pairing = st.paired ? 'phone paired' : st.pairing ? (st.pairing.expiresAt > Date.now() ? 'pairing code shown' : 'pairing code expired') : 'no phone paired';
  const quiet = st.quietHours ? ` · quiet hours ${st.quietHours.from}-${st.quietHours.to}` : '';
  return `Now: state ${st.state}${st.error ? ` (${st.error})` : ''} · token ${st.hasToken ? 'set' : 'not set'} · ${st.enabled ? 'enabled' : 'disabled'} · ${pairing}${quiet} · dropped updates ${st.dropped}.`;
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
