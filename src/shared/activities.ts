// «Attività pianificate» (ADR 0373): the shapes and the pure rules shared by main (main/activities/: the timer, the
// readers, the filter, the triage pass, the store), the renderer (the page that replaces «Task») and the Orchestrator's
// tool app_activity (main/appctl/activities.ts). An ACTIVITY is one thing the user wants watched on a timer: a source
// (DevOps, Outlook, Teams or Gmail), when to look (every N minutes, optionally on some days and inside a time window), a
// deterministic filter, and one sentence of what to propose when something passes. A RUN reads the source at zero
// tokens, keeps only what is new since its cursor and passes the filter; only if something is left, ONE hidden triage pass
// on the cheapest model with no tools runs (at most TRIAGE_MAX_ITEMS items of TRIAGE_ITEM_CHARS characters), and only if
// it proposes actions does the Orchestrator get one grouped news and ask the user Sì/No, one at a time. Every run is
// recorded (the last ACTIVITY_HISTORY_MAX per activity) with what it read, kept, proposed and cost. Nothing here touches
// the disk or the clock: the functions take `now` and return values, so they are unit-tested (test/unit/activities.test.ts).
// Not the removed «flows» / «schedules» (ADR 0325): no channel here is named after them.

export const ACTIVITY_SOURCES = ['devops', 'outlook', 'teams', 'gmail'] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

/** The source's name in the user's words (the page, the Orchestrator's answers). */
export const ACTIVITY_SOURCE_NAME: Record<ActivitySource, string> = { devops: 'DevOps', outlook: 'Outlook', teams: 'Teams', gmail: 'Gmail' };

export const ACTIVITY_EVERY_MIN = 5;
export const ACTIVITY_EVERY_MAX = 720;
export const ACTIVITY_EVERY_DEFAULT = 30;
/** Triage passes an activity may start per local day, by default and at most. Past it the activity stops and says so. */
export const ACTIVITY_CAP_DEFAULT = 20;
export const ACTIVITY_CAP_MAX = 100;
/** Activities in the catalog, run records kept per activity. */
export const ACTIVITIES_MAX = 30;
export const ACTIVITY_HISTORY_MAX = 20;
/** What one triage pass reads: at most this many items, each cut to this many characters (title and text together). */
export const TRIAGE_MAX_ITEMS = 15;
export const TRIAGE_ITEM_CHARS = 300;
export const ACTIVITY_NAME_MAX = 60;
export const ACTIVITY_PROPOSE_MAX = 600;
export const ACTIVITY_LIST_MAX = 20;
export const ACTIVITY_WORD_MAX = 120;
/** Proposals one triage pass may return (the rest is dropped). */
export const TRIAGE_PROPOSALS_MAX = 8;

/** When to look. Days are ISO (1 = Monday … 7 = Sunday), empty = every day; the window is local time 'HH:MM', from < to,
 *  absent = all day. */
export interface ActivitySchedule {
  everyMin: number;
  days: number[];
  window: { from: string; to: string } | null;
}

/** The deterministic filter, applied before any model. Empty lists and false flags let everything through. */
export interface ActivityFilter {
  /** the item's sender (address or name) contains one of these, case-insensitive */
  senders: string[];
  /** the item's title contains one of these, case-insensitive */
  subjectWords: string[];
  /** only items that mention the user (Teams @mention, DevOps mention, a mail that names them) */
  mentionsOnly: boolean;
  unreadOnly: boolean;
  /** drops no-reply, noreply and do-not-reply senders */
  excludeNoReply: boolean;
}

/** One activity as the user (or the Orchestrator) wrote it: everything except the app's own bookkeeping. */
export interface ActivityInput {
  name: string;
  source: ActivitySource;
  schedule: ActivitySchedule;
  filter: ActivityFilter;
  /** the user's sentence of what to propose when something passes, e.g. «se un collega segnala un bug, proponimi un fix» */
  propose: string;
  /** triage passes per local day (1..ACTIVITY_CAP_MAX) */
  dailyCap: number;
  enabled: boolean;
}

export interface Activity extends ActivityInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/** A thing a reader found in the source, in one shape for all four sources (the filter and the triage read only this). */
export interface ActivityItem {
  /** stable across reads (message id, work item id + revision, chat message id): the cursor remembers it */
  key: string;
  /** ms */
  at: number;
  /** who sent it, as «Name <address>» or the name or the address */
  from: string;
  title: string;
  /** a short plain-text snippet, never the whole body (the triage cuts it to TRIAGE_ITEM_CHARS) */
  text: string;
  unread: boolean;
  mentionsMe: boolean;
  url?: string;
}

/** What a run remembers of a source between runs, so that only new items come back. Opaque to the page. */
export interface ActivityCursor {
  /** the newest item time seen (ms), 0 = nothing yet */
  at: number;
  /** keys seen at or after `at - 1 day`, to tell new from already seen when times tie; capped by the engine */
  keys: string[];
}

/** A reader's answer: the items of the source it can see now (the engine drops the seen ones with the cursor). */
export interface ActivityReadResult {
  items: ActivityItem[];
  /** short, in the user's words: «accesso scaduto», «connettore non collegato»; set = the run ends as an error */
  error?: string;
  /** the reader had to use the model (Gmail until the app has its own Gmail connector): tokens and cost go on the run */
  usage?: ActivityUsage;
}

/** What a reader of one source implements (main/activities/sources/<source>.ts). `cursor` lets it ask the source only
 *  for what is newer; it may ignore it. A reader never throws for an expected failure: it returns `error`. */
export interface ActivitySourceReader {
  source: ActivitySource;
  read(activity: Activity, cursor: ActivityCursor, now: number): Promise<ActivityReadResult>;
}

/** Tokens and cost as the engine measured them (null = the engine gave none). */
export interface ActivityUsage { tokens: number | null; costUsd: number | null; model: string | null }

/** What the triage pass proposes for one kept item. */
export interface ActivityProposal {
  /** the item's key */
  key: string;
  title: string;
  /** one sentence: what to do, in the user's words */
  action: string;
  url?: string;
}

/** How a run ended: idle = nothing new passed (0 tokens) · quiet = triage ran, no proposal · proposed = the Orchestrator
 *  got a news · capped = the daily triage cap stopped it · error = the source or the triage failed. */
export type ActivityRunStatus = 'idle' | 'quiet' | 'proposed' | 'capped' | 'error';

/** One run of one activity, as kept in its history and shown in the page. */
export interface ActivityRun {
  id: string;
  activityId: string;
  /** start, ms */
  at: number;
  durationMs: number;
  trigger: 'timer' | 'manual';
  status: ActivityRunStatus;
  /** items the source gave */
  read: number;
  /** items that were new and passed the filter */
  kept: number;
  /** actions proposed to the Orchestrator */
  proposals: number;
  /** a model was used (the triage, or a Gmail read without a connector) */
  usedModel: boolean;
  tokens: number | null;
  costUsd: number | null;
  model: string | null;
  /** short, in the user's words; set when status is error */
  error?: string;
}

/** The page's row: the activity plus what the app knows about it now. */
export interface ActivityView extends Activity {
  /** «ogni 30 min · lun-ven 08:00-19:00» (describeSchedule) */
  scheduleText: string;
  lastRun: ActivityRun | null;
  /** the next automatic run (ms); null = off, paused, or running */
  nextAt: number | null;
  running: boolean;
  /** triage passes started today and the cost of today's runs (null cost = nothing measured) */
  todayTriage: number;
  todayCostUsd: number | null;
  /** the activity's last read could not use a connector: Gmail without one costs tokens on every run */
  usesModelToRead: boolean;
}

export interface ActivitiesState {
  activities: ActivityView[];
  /** the global pause: nothing runs on the timer (a manual run still works) */
  paused: boolean;
  /** the app has its own Gmail connector (so Gmail reads at zero tokens) */
  gmailConnector: boolean;
  /** the ready-made examples the page offers (DevOps, Outlook, Teams) */
  templates: ActivityTemplate[];
}

export interface ActivityTemplate { id: string; label: string; input: ActivityInput }

/** The Orchestrator's tool. One call = one action; `id` is an activity's id or its name. */
export const ACTIVITY_ACTIONS = ['list', 'create', 'update', 'enable', 'disable', 'delete', 'run', 'history', 'pause'] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** What app_activity takes: `create` needs name, source and propose (the rest defaults); `update` takes `id` and any of
 *  the fields, merged over the activity; `list` and `history` (id) only read. No approval (ADR 0275). */
export interface ActivityToolArgs {
  action: ActivityAction;
  id?: string;
  name?: string;
  source?: ActivitySource;
  schedule?: Partial<ActivitySchedule>;
  filter?: Partial<ActivityFilter>;
  propose?: string;
  dailyCap?: number;
  enabled?: boolean;
  /** `pause`: true = the global pause (no activity starts by itself), false = resume */
  paused?: boolean;
}

/** The result of a create/update/enable/disable/delete/run, in one shape for the page and the tool. */
export type ActivityResult =
  | { ok: true; id: string; state: ActivitiesState; run?: ActivityRun }
  | { ok: false; error: string };

// ---- defaults and templates -------------------------------------------------------------------------------------------

export function defaultSchedule(): ActivitySchedule { return { everyMin: ACTIVITY_EVERY_DEFAULT, days: [], window: null }; }
export function defaultFilter(): ActivityFilter { return { senders: [], subjectWords: [], mentionsOnly: false, unreadOnly: false, excludeNoReply: false }; }

export function defaultActivity(source: ActivitySource): ActivityInput {
  return {
    name: ACTIVITY_SOURCE_NAME[source], source, schedule: defaultSchedule(), filter: defaultFilter(),
    propose: '', dailyCap: ACTIVITY_CAP_DEFAULT, enabled: false,
  };
}

const WORKDAYS = [1, 2, 3, 4, 5];
const WORK_WINDOW = { from: '08:00', to: '19:00' };

/** The ready-made examples (page + Orchestrator): all off until the user turns one on. */
export function activityTemplates(): ActivityTemplate[] {
  const base = (source: ActivitySource, name: string, propose: string, filter: Partial<ActivityFilter>, everyMin = ACTIVITY_EVERY_DEFAULT): ActivityInput => ({
    ...defaultActivity(source), name, propose, schedule: { everyMin, days: WORKDAYS, window: WORK_WINDOW }, filter: { ...defaultFilter(), ...filter },
  });
  return [
    { id: 'devops', label: 'DevOps: novità sui miei lavori', input: base('devops', 'DevOps', 'Se un collega segnala un bug o mi chiede una review, proponimi cosa fare.', { mentionsOnly: false, unreadOnly: true }) },
    { id: 'outlook', label: 'Outlook: mail non lette', input: base('outlook', 'Outlook', 'Se una mail chiede una mia risposta o una decisione, proponimi la risposta.', { unreadOnly: true, excludeNoReply: true }, 15) },
    { id: 'teams', label: 'Teams: menzioni', input: base('teams', 'Teams', 'Se mi chiedono qualcosa in una chat, proponimi cosa rispondere o fare.', { mentionsOnly: true, unreadOnly: true }, 10) },
  ];
}

/** Whether a source is read without tokens now: DevOps, Outlook and Teams always; Gmail only with the app's own connector. */
export function readsAtZeroTokens(source: ActivitySource, gmailConnector: boolean): boolean {
  return source !== 'gmail' || gmailConnector;
}

// ---- validation -------------------------------------------------------------------------------------------------------

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanList(v: unknown, label: string, errors: string[]): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) { errors.push(`${label}: serve un elenco di parole`); return []; }
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') { errors.push(`${label}: solo testo`); continue; }
    const s = raw.trim().slice(0, ACTIVITY_WORD_MAX);
    if (s && !out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > ACTIVITY_LIST_MAX) { errors.push(`${label}: al massimo ${ACTIVITY_LIST_MAX} voci`); return out.slice(0, ACTIVITY_LIST_MAX); }
  return out;
}

/** The schedule from anything (a partial one fills with `base`, the default when absent); errors name what is wrong. */
export function validateSchedule(input: unknown, base: ActivitySchedule = defaultSchedule()): Validated<ActivitySchedule> {
  const errors: string[] = [];
  const o = input === undefined || input === null ? {} : input;
  if (!isObj(o)) return { ok: false, errors: ['orario: formato non valido'] };
  let everyMin = base.everyMin;
  if (o.everyMin !== undefined) {
    if (typeof o.everyMin !== 'number' || !Number.isInteger(o.everyMin) || o.everyMin < ACTIVITY_EVERY_MIN || o.everyMin > ACTIVITY_EVERY_MAX) errors.push(`ogni quanti minuti: da ${ACTIVITY_EVERY_MIN} a ${ACTIVITY_EVERY_MAX}`);
    else everyMin = o.everyMin;
  }
  let days = base.days;
  if (o.days !== undefined) {
    if (!Array.isArray(o.days) || o.days.some(d => typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 7)) errors.push('giorni: numeri da 1 (lunedì) a 7 (domenica)');
    else days = [...new Set(o.days as number[])].sort((a, b) => a - b);
    if (days.length === 7) days = [];
  }
  let window = base.window;
  if (o.window !== undefined) {
    if (o.window === null) window = null;
    else if (!isObj(o.window) || typeof o.window.from !== 'string' || typeof o.window.to !== 'string' || !HHMM.test(o.window.from) || !HHMM.test(o.window.to)) errors.push('fascia oraria: da e a nel formato HH:MM');
    else if (minutesOf(o.window.from) >= minutesOf(o.window.to)) errors.push('fascia oraria: «da» deve essere prima di «a» (niente fasce che passano la mezzanotte)');
    else window = { from: o.window.from, to: o.window.to };
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { everyMin, days, window } };
}

/** The filter from anything, over `base` (the default when absent). */
export function validateFilter(input: unknown, base: ActivityFilter = defaultFilter()): Validated<ActivityFilter> {
  const errors: string[] = [];
  const o = input === undefined || input === null ? {} : input;
  if (!isObj(o)) return { ok: false, errors: ['filtro: formato non valido'] };
  const flag = (k: 'mentionsOnly' | 'unreadOnly' | 'excludeNoReply'): boolean => {
    if (o[k] === undefined) return base[k];
    if (typeof o[k] !== 'boolean') { errors.push(`filtro ${k}: sì o no`); return base[k]; }
    return o[k] as boolean;
  };
  const value: ActivityFilter = {
    senders: o.senders === undefined ? base.senders : cleanList(o.senders, 'mittenti', errors),
    subjectWords: o.subjectWords === undefined ? base.subjectWords : cleanList(o.subjectWords, 'parole nel titolo', errors),
    mentionsOnly: flag('mentionsOnly'), unreadOnly: flag('unreadOnly'), excludeNoReply: flag('excludeNoReply'),
  };
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** An activity from anything the user or the Orchestrator typed, filled over `base` (default for the source when absent).
 *  Strict: a wrong field is an error, never silently fixed. */
export function validateActivityInput(input: unknown, base?: ActivityInput): Validated<ActivityInput> {
  if (!isObj(input)) return { ok: false, errors: ['attività: formato non valido'] };
  const errors: string[] = [];
  let source = base?.source;
  if (input.source !== undefined) {
    if (typeof input.source !== 'string' || !(ACTIVITY_SOURCES as readonly string[]).includes(input.source)) errors.push(`fonte: una tra ${ACTIVITY_SOURCES.join(', ')}`);
    else source = input.source as ActivitySource;
  }
  if (!source) errors.push('fonte: obbligatoria');
  const start = base ?? defaultActivity(source ?? 'devops');
  let name = start.name;
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) errors.push('nome: obbligatorio');
    else name = input.name.trim().slice(0, ACTIVITY_NAME_MAX);
  }
  let propose = start.propose;
  if (input.propose !== undefined) {
    if (typeof input.propose !== 'string') errors.push('cosa proporre: testo');
    else propose = input.propose.trim().slice(0, ACTIVITY_PROPOSE_MAX);
  }
  if (!propose) errors.push('cosa proporre: scrivi con parole tue cosa vuoi che ti proponga');
  let dailyCap = start.dailyCap;
  if (input.dailyCap !== undefined) {
    if (typeof input.dailyCap !== 'number' || !Number.isInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > ACTIVITY_CAP_MAX) errors.push(`tetto giornaliero: da 1 a ${ACTIVITY_CAP_MAX}`);
    else dailyCap = input.dailyCap;
  }
  let enabled = start.enabled;
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') errors.push('acceso: sì o no');
    else enabled = input.enabled;
  }
  const schedule = validateSchedule(input.schedule, start.schedule);
  if (!schedule.ok) errors.push(...schedule.errors);
  const filter = validateFilter(input.filter, start.filter);
  if (!filter.ok) errors.push(...filter.errors);
  if (errors.length || !schedule.ok || !filter.ok || !source) return { ok: false, errors };
  return { ok: true, value: { name, source, schedule: schedule.value, filter: filter.value, propose, dailyCap, enabled } };
}

// ---- schedule ---------------------------------------------------------------------------------------------------------

const DAY_NAME = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

/** The schedule in the user's words: «ogni 30 min», «ogni 2 ore · lun-ven · 08:00-19:00». */
export function describeSchedule(s: ActivitySchedule): string {
  const every = s.everyMin % 60 === 0 ? (s.everyMin === 60 ? 'ogni ora' : `ogni ${s.everyMin / 60} ore`) : `ogni ${s.everyMin} min`;
  const parts = [every];
  if (s.days.length) {
    const sorted = [...s.days].sort((a, b) => a - b);
    const run = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
    parts.push(run && sorted.length > 2 ? `${DAY_NAME[sorted[0]!]}-${DAY_NAME[sorted[sorted.length - 1]!]}` : sorted.map(d => DAY_NAME[d]).join(', '));
  }
  if (s.window) parts.push(`${s.window.from}-${s.window.to}`);
  return parts.join(' · ');
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a local date. */
const isoDay = (d: Date): number => d.getDay() === 0 ? 7 : d.getDay();
const minuteOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();

/** Whether `at` (ms, local time) is on an allowed day and inside the window. The window's end is exclusive. */
export function inSchedule(s: ActivitySchedule, at: number): boolean {
  const d = new Date(at);
  if (s.days.length && !s.days.includes(isoDay(d))) return false;
  if (!s.window) return true;
  const m = minuteOfDay(d);
  return m >= minutesOf(s.window.from) && m < minutesOf(s.window.to);
}

/** The next time the timer may run it: `lastRunAt + everyMin` (or `now` for a first run), moved forward to the next
 *  allowed moment (the window's start on the next allowed day). Never before `now`. Looks 8 days ahead; null = never
 *  (cannot happen with a valid schedule). */
export function nextRunAt(s: ActivitySchedule, lastRunAt: number | null, now: number): number | null {
  let t = Math.max(now, lastRunAt === null ? now : lastRunAt + s.everyMin * 60_000);
  if (inSchedule(s, t)) return t;
  for (let i = 0; i < 9; i++) {
    const d = new Date(t);
    const allowedDay = !s.days.length || s.days.includes(isoDay(d));
    if (allowedDay && s.window) {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutesOf(s.window.from)).getTime();
      if (start > t && inSchedule(s, start)) return start;
    }
    t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    if (inSchedule(s, t)) return t;
  }
  return null;
}

/** Local day key of a time ('2026-11-28'): the daily cap resets when it changes. */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Triage passes (and Gmail model reads) already started on the local day of `now`, from the activity's history. */
export function triageToday(runs: readonly ActivityRun[], now: number): number {
  const today = dayKey(now);
  return runs.filter(r => r.usedModel && dayKey(r.at) === today).length;
}

// ---- filter -----------------------------------------------------------------------------------------------------------

/** no-reply, noreply, do-not-reply, donotreply as a whole word of the sender (not «noreplyfan»... any such is rare, accepted). */
export function isNoReply(from: string): boolean {
  return /(^|[^a-z0-9])(no[-_.]?reply|do[-_.]?not[-_.]?reply)([^a-z0-9]|$)/i.test(from);
}

/** Whether one item passes the filter. Pure, zero tokens. */
export function passesFilter(item: ActivityItem, f: ActivityFilter): boolean {
  if (f.unreadOnly && !item.unread) return false;
  if (f.mentionsOnly && !item.mentionsMe) return false;
  if (f.excludeNoReply && isNoReply(item.from)) return false;
  if (f.senders.length) {
    const from = item.from.toLowerCase();
    if (!f.senders.some(s => from.includes(s.toLowerCase()))) return false;
  }
  if (f.subjectWords.length) {
    const title = item.title.toLowerCase();
    if (!f.subjectWords.some(w => title.includes(w.toLowerCase()))) return false;
  }
  return true;
}

/** What is new (after the cursor) and passes the filter, oldest first, plus the cursor to keep. Items with the same time
 *  as the cursor are told apart by key. The cursor moves over everything READ, not only what was kept: an item the filter
 *  dropped is never looked at again. */
export function selectNew(items: readonly ActivityItem[], cursor: ActivityCursor, filter: ActivityFilter, keysMax = 200): { kept: ActivityItem[]; cursor: ActivityCursor; newCount: number } {
  const seen = new Set(cursor.keys);
  const fresh = items.filter(i => i.at >= cursor.at && !seen.has(i.key));
  const kept = fresh.filter(i => passesFilter(i, filter)).sort((a, b) => a.at - b.at);
  const at = fresh.reduce((m, i) => Math.max(m, i.at), cursor.at);
  const keys = [...new Set([...cursor.keys, ...fresh.map(i => i.key)])].slice(-keysMax);
  return { kept, cursor: { at, keys }, newCount: fresh.length };
}

/** One kept item as the triage reads it: the sender, the title and the text, cut so the whole stays in TRIAGE_ITEM_CHARS. */
export interface TriageItem { key: string; from: string; title: string; text: string }

/** At most TRIAGE_MAX_ITEMS items (the newest), each cut to TRIAGE_ITEM_CHARS characters in all; `dropped` counts the rest. */
export function clipForTriage(kept: readonly ActivityItem[]): { items: TriageItem[]; dropped: number } {
  const newest = [...kept].sort((a, b) => b.at - a.at).slice(0, TRIAGE_MAX_ITEMS);
  const items = newest.map(i => {
    const from = i.from.slice(0, 60);
    const title = i.title.slice(0, 120);
    const room = Math.max(0, TRIAGE_ITEM_CHARS - from.length - title.length);
    return { key: i.key, from, title, text: i.text.replace(/\s+/g, ' ').trim().slice(0, room) };
  });
  return { items, dropped: Math.max(0, kept.length - TRIAGE_MAX_ITEMS) };
}

/** Run records of an activity: newest first, the last ACTIVITY_HISTORY_MAX. */
export function trimHistory(runs: readonly ActivityRun[]): ActivityRun[] {
  return [...runs].sort((a, b) => b.at - a.at).slice(0, ACTIVITY_HISTORY_MAX);
}

/** The cost of a set of runs: null when none was measured, else the sum of the ones that were. */
export function sumCost(runs: readonly Pick<ActivityRun, 'costUsd'>[]): number | null {
  const measured = runs.filter(r => r.costUsd !== null);
  return measured.length ? measured.reduce((s, r) => s + (r.costUsd ?? 0), 0) : null;
}
