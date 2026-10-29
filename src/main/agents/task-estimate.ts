// The task estimate (ADR 0087; owner, 2026-10-19: «l'orchestratore deve essere bravo a capire se può cavarsela in fretta
// anche con le stime per task simile»): how long and how much a request should take, from the agent runs of similar past
// tasks, and the path that follows: the Orchestrator answers a small question itself, starts ONE agent with no children
// for a quick single-part job, and plans a delegation tree only for work of several parts. Similar = same agent and same
// kind of work (shared/work-concepts.ts taskOf on the run's goal, the routing table's own kinds), else the same kind on any agent, else the same
// agent on any kind; the most recent MAX_SIMILAR of the first group with MIN_SIMILAR or more. ADR 0186 (10 days of real
// data: held 41% of the time, actual/estimate median 2.01): a job is measured as the user lives it, the run's elapsed
// time (start to end) and the cost of the whole tree it started (its delegated children too), not one run's execution
// time; the figure is then multiplied by the median actual/estimate ratio of the past jobs of the same kind (a
// backtest, each estimated only from the runs ended before it started); the confidence comes from the spread of the
// similar jobs' actuals, never from how many there are. Parts: a pasted or quoted block (a mail, a log, code) is one
// part; a join counts only when an imperative verb follows it. Only a new request is estimated (newRequest: never "ok",
// "vai", a short answer in an ongoing chat). Pure apart from a kind cache. Used by the task_estimate tool and
// app_create_chat's answer (appctl/tools.ts), by IPC agents:estimates (index.ts) for the strips, by the request
// estimate line (wiring.ts, chats/manager.ts) and by estimate-accuracy.ts's backtest.
import type { AgentRun } from '../../shared/agents';
import type { TaskKind } from '../../shared/contract';
import { MAX_SIMILAR, MIN_SIMILAR, QUICK_MS, QUICK_USD, type EstimateActual, type EstimateBasis, type EstimateConfidence, type FastPath, type RunEstimateView, type TaskEstimate } from '../../shared/task-estimate';
import { taskOf } from '../../shared/work-concepts';
import type { ToolDef } from '../appctl/tools';
import { estimateRecords } from '../activity/records';
import { logEvent } from '../activity/journal';

/** accents off, lower case, one space */
const normalize = (text: string): string => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** A question: it ends with "?" or opens with a question word (the job ledger's old "question" rule, ADR 0186). */
const QUESTION = /\?\s*$|^(cosa|come|quanto|quanti|quale|quali|qual|dove|quando|chi|what|how|which|where|when|who|is|are|can|does|do|spiegami|spiega|explain|dimmi|tell me)\b|\bstatus\b|\bcome siamo messi\b/;
/** Kinds that make or check something: a question about them is still work for an agent. */
const MAKES: readonly TaskKind[] = ['bug-fix', 'app-feature', 'review', 'qa-run', 'writing'];

/** A longer first-to-last span without a measured execution time is a run left open, not work. */
export const MAX_ELAPSED_MS = 8 * 3600_000;
/** Above this a single-part job is still one agent, but the Orchestrator is told it is long. */
export const LONG_MS = 45 * 60_000;
/** A request this short that asks a question is one the Orchestrator can answer itself. */
export const SELF_CHARS = 400;

interface Sample { endedAt: number; timeMs: number | null; costUsd: number | null }
interface Ratio { endedAt: number; time: number | null; cost: number | null }

/** The request without the app's own leading label line ("[Messaggio di un agente …]"), which says nothing of the task. */
export const requestText = (text: string): string => String(text ?? '').replace(/^\s*\[[^\]\n]{0,300}\]\s*/, '');

const kinds = new Map<string, { goal: string; kind: TaskKind }>();
/** The classifier's kind of a run's goal (cached per run: the goal is frozen at the run's end). */
export function kindOfRun(r: Pick<AgentRun, 'runId' | 'goal'>): TaskKind {
  const hit = kinds.get(r.runId);
  if (hit && hit.goal === r.goal) return hit.kind;
  const kind = taskOf('', requestText(r.goal), undefined);
  if (kinds.size > 20_000) kinds.clear();
  kinds.set(r.runId, { goal: r.goal, kind });
  return kind;
}

/** What an ended run actually took as a job (ADR 0186), or null when it is not a task to learn from (open, a one-shot
 *  job, nothing measured): its elapsed time when it completed within MAX_ELAPSED_MS (else its execution time), and the
 *  cost of its tree (treeCostUsd: its own and its delegated children's; omitted = its own). */
export function actualOf(r: AgentRun, treeCostUsd?: number | null): EstimateActual | null {
  if (r.endedAt === undefined || r.source === 'oneshot') return null;
  const elapsed = r.endedAt - r.startedAt;
  const timeMs = r.endReason === 'completed' && elapsed > 0 && elapsed <= MAX_ELAPSED_MS ? elapsed
    : typeof r.executionMs === 'number' && r.executionMs > 0 ? r.executionMs : null;
  const own = typeof r.costUsd === 'number' && r.costUsd > 0 ? r.costUsd : null;
  const costUsd = treeCostUsd !== undefined && treeCostUsd !== null && treeCostUsd > 0 ? treeCostUsd : own;
  return timeMs === null && costUsd === null ? null : { timeMs, costUsd };
}

/** Each run's tree cost: its own reported cost plus its delegated children's, down the parentRunId links. */
export function treeCosts(runs: readonly AgentRun[]): Map<string, number> {
  const kids = new Map<string, AgentRun[]>(), out = new Map<string, number>();
  for (const r of runs) if (r.parentRunId) kids.set(r.parentRunId, [...(kids.get(r.parentRunId) ?? []), r]);
  const sum = (r: AgentRun, depth: number): number => {
    const hit = out.get(r.runId);
    if (hit !== undefined) return hit;
    const own = typeof r.costUsd === 'number' && r.costUsd > 0 ? r.costUsd : 0;
    const total = own + (depth > 16 ? 0 : (kids.get(r.runId) ?? []).reduce((n, k) => n + sum(k, depth + 1), 0));
    out.set(r.runId, total);
    return total;
  };
  for (const r of runs) sum(r, 0);
  return out;
}

/** The ended runs grouped the three ways a task can be similar, each group sorted by end time; and, per kind, the
 *  backtested actual/estimate ratios that calibrate the figure (ADR 0186). */
export class SimilarIndex {
  private groups = new Map<string, Sample[]>();
  private ratios = new Map<TaskKind, Ratio[]>();
  private actuals = new Map<string, EstimateActual | null>();
  constructor(runs: readonly AgentRun[]) {
    const costs = treeCosts(runs);
    const ended: { r: AgentRun; a: EstimateActual; kind: TaskKind }[] = [];
    for (const r of runs) {
      const a = actualOf(r, costs.get(r.runId));
      this.actuals.set(r.runId, a);
      if (!a) continue;
      const kind = kindOfRun(r), s: Sample = { endedAt: r.endedAt!, ...a };
      ended.push({ r, a, kind });
      for (const key of [`ak:${r.agentId}:${kind}`, `k:${kind}`, `a:${r.agentId}`]) {
        const g = this.groups.get(key);
        if (g) g.push(s); else this.groups.set(key, [s]);
      }
    }
    for (const g of this.groups.values()) g.sort((x, y) => x.endedAt - y.endedAt);
    // the backtest: each job against the raw figure it would have had at its start
    for (const { r, a, kind } of ended) {
      const raw = rawFigures(this, kind, r.agentId, r.startedAt);
      const time = raw.t && a.timeMs !== null && raw.t.mid > 0 ? a.timeMs / raw.t.mid : null;
      const cost = raw.c && a.costUsd !== null && raw.c.mid > 0 ? a.costUsd / raw.c.mid : null;
      if (time === null && cost === null) continue;
      const list = this.ratios.get(kind);
      const x = { endedAt: r.endedAt!, time, cost };
      if (list) list.push(x); else this.ratios.set(kind, [x]);
    }
    for (const g of this.ratios.values()) g.sort((x, y) => x.endedAt - y.endedAt);
  }
  /** The most recent MAX_SIMILAR samples of a group that ended before `before`. */
  pick(key: string, before: number): Sample[] {
    return recent(this.groups.get(key), before);
  }
  /** The calibration of a kind at `before`: the median actual/estimate ratio of its last MAX_SIMILAR jobs (time, cost);
   *  1 with fewer than MIN_SIMILAR of them; kept inside ×0.25..×4. */
  calibration(kind: TaskKind, before: number): { time: number; cost: number } {
    const r = recent(this.ratios.get(kind), before);
    const of = (xs: (number | null)[]): number => {
      const v = xs.filter((x): x is number => x !== null && Number.isFinite(x) && x > 0).sort((a, b) => a - b);
      return v.length >= MIN_SIMILAR ? Math.min(4, Math.max(0.25, quantile(v, 0.5))) : 1;
    };
    return { time: of(r.map(x => x.time)), cost: of(r.map(x => x.cost)) };
  }
  /** A run's actual as the index measured it (its tree cost included); undefined = not in the index. */
  actual(runId: string): EstimateActual | null | undefined { return this.actuals.get(runId); }
}

function recent<T extends { endedAt: number }>(g: readonly T[] | undefined, before: number): T[] {
  if (!g) return [];
  let lo = 0, hi = g.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (g[mid]!.endedAt < before) lo = mid + 1; else hi = mid; }
  return g.slice(Math.max(0, lo - MAX_SIMILAR), lo);
}

/** The q-quantile of sorted numbers (linear interpolation). */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}
const spread = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { mid: quantile(s, 0.5), low: quantile(s, 0.25), high: quantile(s, 0.75) }; };
type Spread = ReturnType<typeof spread>;

/** The similar samples and their uncalibrated figures (median, middle half) for a kind and an agent at `before`. */
function rawFigures(index: SimilarIndex, kind: TaskKind, agentId: string | undefined, before: number): { basis: EstimateBasis | null; samples: Sample[]; t: Spread | null; c: Spread | null } {
  const tiers: [EstimateBasis, string][] = agentId
    ? [['agent-kind', `ak:${agentId}:${kind}`], ['kind', `k:${kind}`], ['agent', `a:${agentId}`]]
    : [['kind', `k:${kind}`]];
  let basis: EstimateBasis | null = null, samples: Sample[] = [];
  for (const [b, key] of tiers) {
    const s = index.pick(key, before);
    if (s.length >= MIN_SIMILAR) { basis = b; samples = s; break; }
  }
  const times = samples.map(s => s.timeMs).filter((v): v is number => v !== null);
  const costs = samples.map(s => s.costUsd).filter((v): v is number => v !== null);
  return { basis, samples, t: times.length >= MIN_SIMILAR ? spread(times) : null, c: costs.length >= MIN_SIMILAR ? spread(costs) : null };
}

const LIST_ITEM = /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/;
/** Where a request may change step: ";" or a join word (a bare "poi", "then", "also" is not one by itself, ADR 0186). */
const SEPARATOR = /;|\b(?:e poi|poi|inoltre|e anche|infine|dopodiche|dopo di che|and then|then|also|after that|finally|as well as)\b/;
/** A step starts with an imperative (Italian or English; a clitic may follow: «aggiungilo», «mandala»). Telling the
 *  user (dimmi, spiegami, fammi sapere, tell me, let me know) is not a step of its own. */
const IMPERATIVE = /^(?:(?:anche|pure|tu|devi|puoi|please|also)\s+)*(?:fai|fa|aggiungi|crea|controlla|sistema|metti|scrivi|apri|manda|invia|rimuovi|togli|elimina|cancella|aggiorna|verifica|cerca|prepara|correggi|cambia|sposta|leggi|guarda|prova|lancia|esegui|implementa|rinomina|testa|pubblica|carica|scarica|installa|configura|unisci|mergia|committa|pusha|apri|chiudi|rispondi|riassumi|traduci|analizza|confronta|calcola|genera|disegna|migra|add|fix|create|check|update|remove|delete|write|open|send|run|make|build|test|review|deploy|move|change|rename|install|configure|merge|commit|push|close|reply|summarize|translate|analy[sz]e|compare|generate|draw|migrate|implement|refactor|look)(?:lo|la|li|le|ne|celo|cela|melo|mela)?\b/;
/** A pasted block: a mail's header line, or a log line (a timestamp, a stack frame, an error line). */
const MAIL_HEADER = /^\s*(?:da|from|a|to|cc|oggetto|subject|inviato|sent|data|date)\s*:\s*\S/i;
const LOG_LINE = /^\s*(?:\[?\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{2}|\[?\d{2}:\d{2}:\d{2}|at\s+\S+\s*\(|\w*(?:error|exception)\b.*:|traceback\b)/i;

/** The request without what was pasted or quoted into it: fenced code, `>` quotes, a mail (from its first header line
 *  on) and log lines. Their lists and joins are not parts of the task (ADR 0186). */
export function ownRequest(text: string): string {
  const lines = String(text ?? '').replace(/```[\s\S]*?(?:```|$)/g, '\n').split(/\r?\n/).filter(l => !/^\s*>/.test(l));
  const mail = lines.findIndex(l => MAIL_HEADER.test(l));
  const head = mail > 0 || (mail === 0 && lines.slice(1).some(l => MAIL_HEADER.test(l))) ? lines.slice(0, mail) : lines;
  return head.filter(l => !LOG_LINE.test(l)).join('\n');
}

/** Independent parts of a request (ADR 0186): the items of a real list (two or more, at most 8), else 1 + the joins
 *  followed by an imperative verb ("fai A; poi fai B" = 2, "guarda il log e poi dimmi" = 1). Pasted blocks count 1. */
export function partsOf(text: string): number {
  const own = ownRequest(text);
  const items = own.split(/\r?\n/).filter(l => LIST_ITEM.test(l)).length;
  if (items >= 2) return Math.min(8, items);
  const pieces = normalize(own).split(SEPARATOR).slice(1);
  return 1 + pieces.filter(p => IMPERATIVE.test(p.replace(/^[\s,.:;!-]+/, ''))).length;
}

/** The confidence from the spread of the similar jobs' actuals (ADR 0186: the old "30 similar jobs" was the cap, not a
 *  quality signal): the middle half within ×2 = high, within ×4 medium, else low; one step lower when only the agent
 *  matched (another kind of work). */
function confidenceOf(basis: EstimateBasis, s: Spread | null): EstimateConfidence {
  const width = s && s.low > 0 ? s.high / s.low : Infinity;
  const level = width <= 2 ? 2 : width <= 4 ? 1 : 0;
  return (['low', 'medium', 'high'] as const)[Math.max(0, level - (basis === 'agent' ? 1 : 0))]!;
}

/** A short follow-up in an ongoing chat ("sì", "ok", "vai", "continua", an answer under FOLLOW_UP_CHARS): not a new
 *  request, so no estimate (ADR 0186: after 401 of 582 "one-agent" estimates the Orchestrator started no run). */
export const FOLLOW_UP_CHARS = 40;
const FOLLOW_UP = /^(?:s[iì]|ok(?:ay)?|vai|va bene|continua|procedi|prosegui|avanti|fallo|fatto|perfetto|grazie|no|yes|go|go on|continue|proceed|done|thanks)(?![\wàèéìòù])[\s.,!]*$/i;
export function newRequest(text: string, ongoing: boolean): boolean {
  const t = requestText(text).trim();
  if (!t || FOLLOW_UP.test(t)) return false;
  return !(ongoing && t.length < FOLLOW_UP_CHARS);
}

const mins = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

export interface EstimateInput {
  /** the request or the run's goal */
  text: string;
  /** the agent (catalog role) that would run it; omitted = any agent */
  agentId?: string;
  /** only runs ended before this time (a run's own start, for the strips and the backtest) */
  before?: number;
}

/** The estimate of one request from the index. */
export function estimateTask(index: SimilarIndex, input: EstimateInput): TaskEstimate {
  const text = requestText(input.text);
  const kind = taskOf('', ownRequest(text) || text, undefined), before = input.before ?? Infinity;
  const { basis, samples, t, c } = rawFigures(index, kind, input.agentId, before);
  const cal = index.calibration(kind, before);
  const parts = partsOf(text);
  const timeMs = t ? Math.round(t.mid * cal.time) : null, costUsd = c ? Math.round(c.mid * cal.cost * 1000) / 1000 : null;
  const quick = timeMs !== null && timeMs <= QUICK_MS && (costUsd === null || costUsd <= QUICK_USD);
  const shortQuestion = !MAKES.includes(kind) && QUESTION.test(normalize(text)) && text.trim().length <= SELF_CHARS;
  // a tree only for three parts or more, or two parts of a long, slow request (ADR 0186: 25 trees came from requests
  // under 300 characters); two small parts are one agent's work
  const path: FastPath = parts >= 3 || (parts === 2 && !quick && text.trim().length > SELF_CHARS) ? 'tree'
    : shortQuestion && parts === 1 && (quick || timeMs === null) ? 'self' : 'one-agent';
  const figure = timeMs !== null ? `similar tasks took ~${mins(timeMs)} (median of ${samples.length}${cal.time !== 1 ? `, ×${cal.time.toFixed(2)} from past estimates of this kind` : ''})` : basis ? `${samples.length} similar tasks, no measured time` : `fewer than ${MIN_SIMILAR} similar tasks, no figure`;
  const why = path === 'self'
    ? `A short question, ${parts} part; ${figure}: answer it yourself, without starting a chat.`
    : path === 'one-agent'
      ? `${parts === 1 ? 'One part' : 'Two small parts'}; ${figure}${timeMs !== null && timeMs > LONG_MS ? ' (long: tell the user)' : ''}: start ONE agent with app_create_chat and tell it to do the work itself, without agent_delegate.`
      : `${parts} independent parts; ${figure}: plan it (a strategist, or one chat per part in parallel).`;
  const scale = (v: number, k: number) => Math.round(v * k);
  return {
    kind, basis, n: samples.length,
    timeMs, timeLowMs: t ? scale(t.low, cal.time) : null, timeHighMs: t ? scale(t.high, cal.time) : null,
    costUsd, costLowUsd: c ? Math.round(c.low * cal.cost * 1000) / 1000 : null, costHighUsd: c ? Math.round(c.high * cal.cost * 1000) / 1000 : null,
    confidence: basis ? confidenceOf(basis, t) : null, parts, quick, path, why,
  };
}

/** Half to double: a real time inside it is an estimate that held (the strips' ✓). */
export const held = (estimateMs: number, actualMs: number): boolean => actualMs >= estimateMs / 2 && actualMs <= estimateMs * 2;

/** The strips' view of some runs: each one's estimate from the runs ended before it started, and its actual once ended. */
export function runEstimates(runs: readonly AgentRun[], runIds: readonly string[], index = new SimilarIndex(runs)): Record<string, RunEstimateView> {
  const want = new Set(runIds), out: Record<string, RunEstimateView> = {};
  for (const r of runs) {
    if (!want.has(r.runId) || r.source === 'oneshot') continue;
    const estimate = estimateTask(index, { text: r.goal, agentId: r.agentId, before: r.startedAt });
    const actual = index.actual(r.runId) ?? actualOf(r);
    const hit = estimate.timeMs !== null && actual?.timeMs != null ? held(estimate.timeMs, actual.timeMs) : null;
    out[r.runId] = { runId: r.runId, estimate: estimate.basis ? estimate : null, actual, hit };
  }
  return out;
}

/** task_estimate for the Orchestrator: numbers only, never another run's content. */
export function estimateTool(runs: () => readonly AgentRun[]): ToolDef {
  return {
    name: 'task_estimate',
    description: 'Estimate a request (a user\'s message already ends with this estimate as "[app estimate · …]": call it only for another wording or a given role) from similar past tasks (same agent and kind first): median work time, cost, the middle-half range, how many similar tasks it rests on (n), confidence, the independent parts it has, and the path: "self" = a short question you answer yourself; "one-agent" = start ONE chat with app_create_chat that does it alone (no agent_delegate children); "tree" = several parts, plan them. Numbers only, never a run\'s content.',
    inputSchema: { type: 'object', required: ['request'], additionalProperties: false, properties: {
      request: { type: 'string', description: 'the user\'s request, as you would give it to the agent' },
      agentId: { type: 'string', description: 'optional: the role that would run it (agent_catalog); omitted = any agent' },
    } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: a => {
      const request = typeof a.request === 'string' ? a.request.trim() : '';
      if (!request || request.length > 8000) throw new Error('task_estimate: request = 1 to 8000 characters.');
      if (a.agentId !== undefined && (typeof a.agentId !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(a.agentId))) throw new Error('task_estimate: agentId = a role id from agent_catalog.');
      const e = estimateTask(new SimilarIndex(runs()), { text: request, ...(a.agentId ? { agentId: a.agentId as string } : {}) });
      for (const r of estimateRecords(e, request, 'chiesta dall’Orchestrator')) logEvent(r); // the Log page (ADR 0111)
      return e;
    },
  };
}
