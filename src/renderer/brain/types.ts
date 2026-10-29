// Shapes of the brain's data API (the brain's own server, proxied by main as 'brain:api'): /api/tables (every parsed
// table), /api/cost, /api/map, /api/files, /api/file, /api/search, /api/version; plus
// /api/quality, /api/scripts, /api/script and /api/changelog, answered by main itself (AppQuality, ADR 0076). The server is another program that may be older
// or newer than the app, so every read goes through a normalizer that fills what is missing (lists → [], text → '')
// instead of trusting the shape. Used by the pages.
import type { AppQuality, BrainScript, BrainScriptSummary, ChangelogAction, ChangelogEntry, ChangelogKind } from '@shared/contract';

export interface ErrorRow { data: string; ora: string; chi: string; area: string; tipo: string; detto: string; vero: string; visto: string; regola: string; riga?: string; responsibleEpisode?: unknown; reporterOrigin?: unknown }
export interface WinRow { data: string; ora: string; harness: string; chat: string; area: string; esito: string; parole: string; consegnato: string; origin?: unknown }
export interface JournalRow { data: string; ora: string; tag: string; area: string; testo: string }
export interface NowRow { sezione: string; filo: string; dove: string; prossimo: string; stato: string; aggiornato: string }
export interface Idea {
  origin?: unknown;
  data: string; area: string; titolo: string; stato: string; idea: string; come: string; perche: string; riprendere: string; fonte: string; per: string;
  notato: string; penso: string; sicurezza: string; nonso: string; testo: string; chi: string; scaduta: string;
}
export interface Reflection { data: string; chat: string; titolo: string; notato: string; penso: string; sicurezza: string; nonso: string }
export interface Proposal { id: string; data: string; proposta: string; tipo: string; stato: string; dettaglio: string }
export interface BugRow { data: string; area: string; bug: string; pattern: string; fonte: string; rif: string }
export interface Measure { date: string; metric: string; value: number; breakdown?: Record<string, number>; human?: number; model?: string; brain?: string }
export interface RuleRow { date: string; type: string; area: string; rule: string; again: number }
/** recurrence.mjs quality(): ai-errors.md as the Qualità page needs it (canonical types, unreadable lines, who saw them). */
export type RuleStatus = 'tornato' | 'non-tornato' | 'troppo-presto' | 'senza-tipo';
export interface QRule { date: string; type: string; area: string; rule: string; status: RuleStatus; ageDays: number | null; again: { date: string; line: string }[] }
export interface SeenDay { date: string; owner: number; other: number; unknown: number }
export interface ErrQuality {
  today: string; windowDays: number; from: string; to: string; lines: number; typed: number;
  unparsed: { date: string; line: string }[]; invalid: { date: string; type: string; line: string }[];
  seenByDay: SeenDay[]; totals: [string, number][]; rules: QRule[];
}
export interface Tables {
  today: string;
  errors: ErrorRow[]; wins: WinRow[]; journal: JournalRow[]; now: NowRow[]; ideas: Idea[]; reflections: Reflection[];
  proposals: Proposal[]; bugs: BugRow[]; measures: Measure[]; briefs: string[];
  recurrence: { totals: [string, number][]; rules: RuleRow[] };
  /** null = a brain whose recurrence.mjs has no quality() yet */
  quality: ErrQuality | null;
}

export interface LiveChat {
  harness: string; title: string; folder: string; when: string; state: string; id: string; ageMin: number | null;
  last: string; lastOwner: string;
  box: { name: string; listening: boolean; unread: number } | null;
  now: NowRow | null;
}

export interface Money { usd: number; calls: number }
export interface CostChat { title: string; folder: string; usd: number; calls: number; ctxMax: number; from: number; to: number; longSave: number }
export interface CostData {
  from: string; to: string; total: number; calls: number;
  byDay: Record<string, Money>; byModel: Record<string, Money>; byKind: Record<string, Money>; byArea: Record<string, Money>;
  chats: CostChat[]; long: number; longSave: number; uncalibrated: string[];
  cursor: { total: number; downloaded?: string; lastRow?: string } | null;
  fixed: { chars: number; usd: number } | null;
  advice: { usd: number; text: string }[];
}


/** label: the speaking name ("Coda dei test"); name: the technical one (file, agent, /skill), when the brain sends it */
export interface MapMember { id: string; label: string; name?: string; what?: string; uses?: number }
export interface MapNode {
  id: string; layer: string; kind: string; label: string; name?: string; short?: string; what?: string; file?: string; modified?: string; degree?: number;
  members?: MapMember[]; uses?: number; reads?: number; events?: string[]; fields?: { model?: string; effort?: string };
}
export interface MapEdge { from: string; to: string; kind: string; label: string; source?: { file: string; text: string }; count?: number }
export interface FlowStep { from: string; to: string; label: string; verified: boolean; source: { file: string; text: string }; fromLabel?: string; toLabel?: string }
export interface Flow { id: string; title: string; steps: FlowStep[] }
export interface MapData {
  generated: string; root: string; layers: { id: string; label: string; hint: string }[];
  nodes: MapNode[]; edges: MapEdge[]; flows: Flow[];
  weak: { kind: string; text: string; ids: string[] }[]; warnings: string[]; problems: string[];
  simple: { nodes: MapNode[]; edges: MapEdge[]; flows: Flow[] } | null;
}

export interface FileText { path: string; size: number; modified: string; text: string }
export interface SearchHit { file: string; line: number; text: string }
export interface Version { site: string; root: string; here: string }

// ── normalizers ───────────────────────────────────────────────────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** every listed key as a string (missing → '') plus the other fields untouched */
function strs<T>(v: unknown, keys: readonly string[]): T {
  const o = obj(v);
  const out: Obj = { ...o };
  for (const k of keys) out[k] = str(o[k]);
  return out as T;
}
const rows = <T>(v: unknown, keys: readonly string[]): T[] => arr(v).filter(isObj).map(x => strs<T>(x, keys));
const money = (v: unknown): Record<string, Money> => Object.fromEntries(Object.entries(obj(v)).map(([k, x]) => [k, { usd: num(obj(x).usd), calls: num(obj(x).calls) }]));

export function normTables(v: unknown): Tables {
  const o = obj(v);
  const rec = obj(o.recurrence);
  return {
    today: str(o.today),
    errors: rows(o.errors, ['data', 'ora', 'chi', 'area', 'tipo', 'detto', 'vero', 'visto', 'regola', 'riga']),
    wins: rows(o.wins, ['data', 'ora', 'harness', 'chat', 'area', 'esito', 'parole', 'consegnato']),
    journal: rows(o.journal, ['data', 'ora', 'tag', 'area', 'testo']),
    now: rows(o.now, ['sezione', 'filo', 'dove', 'prossimo', 'stato', 'aggiornato']),
    ideas: rows(o.ideas, ['data', 'area', 'titolo', 'stato', 'idea', 'come', 'perche', 'riprendere', 'fonte', 'per', 'notato', 'penso', 'sicurezza', 'nonso', 'testo', 'chi', 'scaduta']),
    reflections: rows(o.reflections, ['data', 'chat', 'titolo', 'notato', 'penso', 'sicurezza', 'nonso']),
    proposals: rows(o.proposals, ['id', 'data', 'proposta', 'tipo', 'stato', 'dettaglio']),
    bugs: rows(o.bugs, ['data', 'area', 'bug', 'pattern', 'fonte', 'rif']),
    measures: arr(o.measures).filter(isObj).map(m => ({ ...m, date: str(m.date), metric: str(m.metric), value: num(m.value), breakdown: isObj(m.breakdown) ? Object.fromEntries(Object.entries(m.breakdown).map(([k, x]) => [k, num(x)])) : {} })) as Measure[],
    briefs: arr(o.briefs).map(str),
    recurrence: {
      totals: arr(rec.totals).filter(Array.isArray).map(t => [str((t as unknown[])[0]), num((t as unknown[])[1])] as [string, number]),
      rules: arr(rec.rules).filter(isObj).map(r => ({ date: str(r.date), type: str(r.type), area: str(r.area), rule: str(r.rule), again: num(r.again) })),
    },
    quality: normErrQuality(o.quality),
  };
}

const STATUSES: readonly RuleStatus[] = ['tornato', 'non-tornato', 'troppo-presto', 'senza-tipo'];
export function normErrQuality(v: unknown): ErrQuality | null {
  if (!isObj(v)) return null;
  const lines = (x: unknown) => arr(x).filter(isObj).map(l => ({ date: str(l.date), line: str(l.line) }));
  return {
    today: str(v.today), windowDays: num(v.windowDays) || 14, from: str(v.from), to: str(v.to), lines: num(v.lines), typed: num(v.typed),
    unparsed: lines(v.unparsed), invalid: arr(v.invalid).filter(isObj).map(l => ({ date: str(l.date), type: str(l.type), line: str(l.line) })),
    seenByDay: arr(v.seenByDay).filter(isObj).map(d => ({ date: str(d.date), owner: num(d.owner), other: num(d.other), unknown: num(d.unknown) })),
    totals: arr(v.totals).filter(Array.isArray).map(t => [str((t as unknown[])[0]), num((t as unknown[])[1])] as [string, number]),
    rules: arr(v.rules).filter(isObj).map(r => ({ date: str(r.date), type: str(r.type), area: str(r.area), rule: str(r.rule),
      status: STATUSES.includes(r.status as RuleStatus) ? r.status as RuleStatus : 'senza-tipo', ageDays: r.ageDays == null ? null : num(r.ageDays), again: lines(r.again) })),
  };
}

/** /api/quality (main's own half: turns, PRs, reopened bugs); every field filled. */
export function normAppQuality(v: unknown): AppQuality {
  const o = obj(v), t = obj(o.turns), p = obj(o.prs), r = obj(o.reopen);
  const nul = (x: unknown) => (typeof x === 'string' && x ? x : null);
  return {
    turns: { from: nul(t.from), to: nul(t.to), byDay: arr(t.byDay).filter(isObj).map(d => ({ date: str(d.date), claude: num(d.claude), cursor: num(d.cursor) })) },
    prs: { at: p.at == null ? null : num(p.at), total: num(p.total), error: nul(p.error),
      blocked: arr(p.blocked).filter(isObj).map(b => ({ id: num(b.id), title: str(b.title), repo: str(b.repo), url: str(b.url), reasons: arr(b.reasons).map(str) })) },
    reopen: { at: nul(r.at), days: num(r.days) || 90, resolved: num(r.resolved), reopened: num(r.reopened), error: nul(r.error), refreshing: r.refreshing === true,
      bugs: arr(r.bugs).filter(isObj).map(b => ({ id: num(b.id), title: str(b.title), state: str(b.state), url: str(b.url),
        reopened: arr(b.reopened).filter(isObj).map(x => ({ resolvedAt: str(x.resolvedAt), reopenedAt: str(x.reopenedAt), by: str(x.by), to: str(x.to) })) })) },
    // ADR 0197: absent from an older main (the page then counts ai-errors.md alone and says so)
    ...(isObj(o.corrections) ? { corrections: {
      since: nul(o.corrections.since),
      byDay: arr(o.corrections.byDay).filter(isObj).map(d => ({ date: str(d.date), messages: num(d.messages), tagged: num(d.tagged), afterReport: num(d.afterReport), recognized: num(d.recognized), semantic: num(d.semantic),
        chats: arr(d.chats).filter((c): c is string => typeof c === 'string') })),
      runs: arr(o.corrections.runs).filter(isObj).map(d => ({ date: str(d.date), tagged: num(d.tagged), afterReport: num(d.afterReport) })),
    } } : {}),
  };
}


/** /api/scripts (ADR 0076): the brain's scripts, newest change first. */
export function normScripts(v: unknown): { root: string | null; scripts: BrainScriptSummary[] } {
  const o = obj(v);
  return { root: str(o.root) || null, scripts: arr(o.scripts).filter(isObj).map(scriptOf).filter(s => s.id && s.file) };
}
const TESTED = new Set(['ok', 'failed', 'untested']);
const scriptOf = (s: Obj): BrainScriptSummary => {
  const t = obj(s.tested);
  return {
    id: str(s.id), file: str(s.file), title: str(s.title), description: str(s.description), usage: str(s.usage), language: str(s.language),
    tags: arr(s.tags).filter((x): x is string => typeof x === 'string'),
    tested: { state: TESTED.has(str(t.state)) ? str(t.state) as BrainScriptSummary['tested']['state'] : 'untested', at: t.at ? str(t.at) : null, note: str(t.note) },
    changedAt: s.changedAt ? str(s.changedAt) : null, bytes: num(s.bytes),
  };
};
/** /api/script?id=…: one script with its code (credentials already masked by main). */
export function normScript(v: unknown): BrainScript {
  const o = obj(v);
  return { ...scriptOf(o), path: str(o.path), code: str(o.code), masked: num(o.masked) };
}
const KINDS = new Set<string>(['script', 'rule', 'procedure', 'note', 'agent', 'skill', 'other']);
const ACTIONS = new Set<string>(['added', 'edited', 'fixed', 'deleted', 'restored']);
/** /api/changelog: the brain's changelog lines, newest first. */
export function normChangelog(v: unknown): { root: string | null; entries: ChangelogEntry[] } {
  const o = obj(v);
  return { root: str(o.root) || null, entries: arr(o.entries).filter(isObj).map(e => ({
    at: str(e.at), kind: (KINDS.has(str(e.kind)) ? str(e.kind) : 'other') as ChangelogKind, action: (ACTIONS.has(str(e.action)) ? str(e.action) : 'edited') as ChangelogAction,
    target: str(e.target), by: str(e.by), summary: str(e.summary),
  })).filter(e => e.at) };
}

export function normCost(v: unknown): CostData {
  const o = obj(v), cur = isObj(o.cursor) ? o.cursor : null, fixed = isObj(o.fixed) ? o.fixed : null;
  const chats = Array.isArray(o.chats) ? o.chats : Object.values(obj(o.chats));
  return {
    from: str(o.from), to: str(o.to), total: num(o.total), calls: num(o.calls),
    byDay: money(o.byDay), byModel: money(o.byModel), byKind: money(o.byKind), byArea: money(o.byArea),
    chats: chats.filter(isObj).map(c => ({ title: str(c.title), folder: str(c.folder), usd: num(c.usd), calls: num(c.calls), ctxMax: num(c.ctxMax), from: num(c.from), to: num(c.to), longSave: num(c.longSave) })),
    long: num(o.long), longSave: num(o.longSave), uncalibrated: arr(o.uncalibrated).map(str),
    cursor: cur ? { total: num(cur.total), downloaded: cur.downloaded ? str(cur.downloaded) : undefined, lastRow: cur.lastRow ? str(cur.lastRow) : undefined } : null,
    fixed: fixed ? { chars: num(fixed.chars), usd: num(fixed.usd) } : null,
    advice: arr(o.advice).filter(isObj).map(a => ({ usd: num(a.usd), text: str(a.text) })),
  };
}

const normNodes = (v: unknown): MapNode[] => arr(v).filter(isObj).map(n => ({ ...n, id: str(n.id), layer: str(n.layer), kind: str(n.kind), label: str(n.label) || str(n.id), members: arr(n.members).filter(isObj).map(m => ({ ...m, id: str(m.id), label: str(m.label) })) })) as MapNode[];
const normEdges = (v: unknown): MapEdge[] => arr(v).filter(isObj).map(e => ({ ...e, from: str(e.from), to: str(e.to), kind: str(e.kind), label: str(e.label) })) as MapEdge[];
const normFlows = (v: unknown): Flow[] => arr(v).filter(isObj).map(f => ({ id: str(f.id), title: str(f.title), steps: arr(f.steps).filter(isObj).map(s => ({ ...s, from: str(s.from), to: str(s.to), label: str(s.label), verified: s.verified !== false, source: { file: str(obj(s.source).file), text: str(obj(s.source).text) } })) as FlowStep[] }));
export function normMap(v: unknown): MapData {
  const o = obj(v), s = isObj(o.simple) ? o.simple : null;
  return {
    generated: str(o.generated), root: str(o.root), layers: arr(o.layers).filter(isObj).map(l => ({ id: str(l.id), label: str(l.label), hint: str(l.hint) })),
    nodes: normNodes(o.nodes), edges: normEdges(o.edges), flows: normFlows(o.flows),
    weak: arr(o.weak).filter(isObj).map(w => ({ kind: str(w.kind), text: str(w.text), ids: arr(w.ids).map(str) })),
    warnings: arr(o.warnings).map(str), problems: arr(o.problems).map(str),
    simple: s ? { nodes: normNodes(s.nodes), edges: normEdges(s.edges), flows: normFlows(s.flows) } : null,
  };
}

export const normFiles = (v: unknown): string[] => arr(v).map(str).filter(Boolean);
export const normFile = (v: unknown): FileText => { const o = obj(v); return { path: str(o.path), size: num(o.size), modified: str(o.modified), text: str(o.text) }; };
