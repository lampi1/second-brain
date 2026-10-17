// Shapes of the brain's data API (the brain's own server, proxied by main as 'brain:api'): /api/tables (every parsed
// table), /api/cost, /api/day (report or brief), /api/map, /api/files, /api/file, /api/search, /api/version; plus
// /api/quality and /api/procedures, /api/procedure, answered by main itself (AppQuality, Procedure). The server is another program that may be older
// or newer than the app, so every read goes through a normalizer that fills what is missing (lists → [], text → '')
// instead of trusting the shape. Used by the pages.
import type { AppQuality, Procedure, ProcedureSummary } from '@shared/contract';

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
export interface Playbook { agent: string; punti: number; proposti: string[]; size: number; review: string[] }
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
  playbooks: Playbook[]; recurrence: { totals: [string, number][]; rules: RuleRow[] };
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

export interface WorkItemRef { type: string; title: string; state: string; assignee?: string; url: string }
export interface DayRow {
  kind: string; title: string; area: string; url?: string; state?: string; type?: string; tag?: string; time?: string;
  target?: string; from?: string; to?: string; his?: number; last?: string;
  /** a chat's project folder (day.mjs ≥ 2026-10-13; '' or absent before) */
  cwd?: string;
}
export interface DayReport { date: string; day: string; devops: boolean | null; areas: string[]; rows: DayRow[]; commits: string[]; text: string }
export interface BriefPr { title: string; target: string; draft?: boolean; url: string; area: string; items: WorkItemRef[]; votes?: string; build?: string; buildUrl?: string; autocomplete?: boolean }
/** aiFound: a bug an AI filed, waiting for a human to validate it (see aiFoundFlag) */
export interface BriefItem { type: string; title: string; state: string; url: string; aiFound: boolean; area: string }
export interface BriefThread { section: string; label: string; date: string; next: string; stale: boolean; done: boolean; area: string }
export interface Brief { date: string; day: string; devops: boolean | null; areas: string[]; prs: BriefPr[]; items: BriefItem[]; threads: BriefThread[]; text: string }

/** label: the speaking name ("Coda dei test"); name: the technical one (file, agent, /skill), when the brain sends it */
export interface MapMember { id: string; label: string; name?: string; what?: string; uses?: number }
export interface MapNode {
  id: string; layer: string; kind: string; label: string; name?: string; short?: string; what?: string; file?: string; modified?: string; degree?: number;
  members?: MapMember[]; uses?: number; reads?: number; events?: string[]; fields?: { model?: string; effort?: string }; playbook?: { punti: number };
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
    playbooks: arr(o.playbooks).filter(isObj).map(p => ({ agent: str(p.agent), punti: num(p.punti), proposti: arr(p.proposti).map(str), size: num(p.size), review: arr(p.review).map(str) })),
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
  };
}

/** /api/procedures: the procedures found in the brain; a row without id or file is dropped. */
export function normProcedures(v: unknown): { root: string | null; procedures: ProcedureSummary[] } {
  const o = obj(v);
  return { root: str(o.root) || null, procedures: arr(o.procedures).filter(isObj).map(procedureOf).filter(p => p.id && p.file) };
}
const procedureOf = (p: Obj): ProcedureSummary => ({
  id: str(p.id), title: str(p.title), purpose: str(p.purpose), area: str(p.area), group: p.group ? str(p.group) : null, file: str(p.file),
  line: num(p.line), source: str(p.source), tags: arr(p.tags).filter((t): t is string => typeof t === 'string'), changedAt: p.changedAt ? str(p.changedAt) : null,
});
/** /api/procedure?id=…: one procedure with its text (credentials already masked by main). */
export function normProcedure(v: unknown): Procedure {
  const o = obj(v);
  return { ...procedureOf(o), path: str(o.path), markdown: str(o.markdown), masked: num(o.masked) };
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

const devops = (v: unknown): boolean | null => (v === false ? false : v === true ? true : null);
export function normReport(v: unknown): DayReport {
  const o = obj(v);
  return {
    date: str(o.date), day: str(o.day || o.date), devops: devops(o.devops), areas: arr(o.areas).map(str),
    rows: arr(o.rows).filter(isObj).map(r => ({ ...r, kind: str(r.kind), title: str(r.title), area: str(r.area) || 'Altro' })) as DayRow[],
    commits: arr(o.commits).map(str), text: str(o.text),
  };
}
// The brief marks the work items an AI found (they wait for a human) with a boolean named after the tracker project
// that holds them; a neutral "aiFound" is read first, else any other true flag of a work item means the same.
const ITEM_FLAGS = new Set(['aiFound', 'done', 'stale', 'draft', 'autocomplete']);
export const aiFoundFlag = (i: Obj): boolean => i.aiFound === true || Object.entries(i).some(([k, v]) => v === true && !ITEM_FLAGS.has(k));
export function normBrief(v: unknown): Brief {
  const o = obj(v);
  const items = (x: unknown): WorkItemRef[] => rows<WorkItemRef>(x, ['type', 'title', 'state', 'assignee', 'url']);
  return {
    date: str(o.date), day: str(o.day || o.date), devops: devops(o.devops), areas: arr(o.areas).map(str),
    prs: arr(o.prs).filter(isObj).map(p => ({ ...strs<BriefPr>(p, ['title', 'target', 'url', 'area', 'votes', 'build', 'buildUrl']), area: str(p.area) || 'Altro', draft: !!p.draft, items: items(p.items) })),
    items: arr(o.items).filter(isObj).map(i => ({ ...strs<BriefItem>(i, ['type', 'title', 'state', 'url', 'area']), area: str(i.area) || 'Altro', aiFound: aiFoundFlag(i) })),
    threads: arr(o.threads).filter(isObj).map(t => ({ ...strs<BriefThread>(t, ['section', 'label', 'date', 'next', 'area']), area: str(t.area) || 'Altro', stale: !!t.stale, done: !!t.done })),
    text: str(o.text),
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
export const normHits = (v: unknown): SearchHit[] => arr(v).filter(isObj).map(h => ({ file: str(h.file), line: num(h.line), text: str(h.text) }));
export const normVersion = (v: unknown): Version => { const o = obj(v); return { site: str(o.site), root: str(o.root), here: str(o.here) }; };
