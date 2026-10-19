// The Classificatori grid's numbers (owner, 2026-10-19: "i classificatori li voglio con card e statistiche per
// ciascuno"): one card per classifier that keeps a record. Tipo di lavoro (routing's taskOf, from the ledger's routing
// predictions), Scelta del modello (who chose each chat's model and with which model), Skill per un compito
// (skills_suggest against the skills the launch gave) and Tipo nel registro dei costi (estimates.ts classify, from
// userData/jobs.jsonl). Per card: decisions, its own hit measure, the verified success of what it decided, the
// average cost, the last 8 ISO weeks, the slices (per kind / model / skill, with the role that ran it most) and the
// success when it hit versus when it missed. A missing value is null, never zero. Pure: no IO. Used by classifiers.ts;
// unit tests in test/unit/brainmodel/classifier-cards.test.ts.
import type { AgentRun } from '../../shared/agents';
import type { ClassifierCard, ClassifierSlice, ClassifierStat, ClassifierWeek } from '../../shared/brain-model';

export interface LedgerPrediction { id: string; at: number; kind: string; model: string | null; source: string }
export interface Launch { at: number; chatId: string; agentId: string; suggested: string[]; used: string[] }
export interface JobRow { at: number; kind: string; usd: number | null }
export interface CardInputs {
  now: number;
  predictions: LedgerPrediction[];
  actuals: Map<string, { usd: number }>;
  /** known outcomes written on the ledger (ADR 0078), by ledger id */
  outcomes: Map<string, boolean>;
  runs: AgentRun[];
  launches: Launch[];
  jobs: JobRow[];
  /** the skill suggester's cut (0-100) */
  skillThreshold: number;
}

const WEEKS = 8;
/** ISO week label "2026-W42" of a time (same rule as classifiers.ts weekOf). */
export function isoWeek(ms: number): string {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = d.getUTCFullYear(), w = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400e3 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
export const lastIsoWeeks = (now: number, n = WEEKS): string[] => Array.from({ length: n }, (_, i) => isoWeek(now - (n - 1 - i) * 7 * 86400e3));

const share = (k: number, n: number): ClassifierStat => ({ value: n ? k / n : null, n });
const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const verified = (r: AgentRun | undefined): boolean | null => {
  const o = r?.outcome;
  if (!o || o.verdict === 'unknown' || (o.basis !== 'human' && o.basis !== 'reviewed-evidence')) return null;
  return o.verdict === 'success';
};

/** One decided case, normalised: when, its slice key, whether it hit, its verified outcome, its cost, who ran it. */
interface Case { at: number; key: string; hit: boolean; ok: boolean | null; usd: number | null; role: string | null }

function card(id: ClassifierCard['id'], cases: Case[], now: number, threshold: number | null): ClassifierCard {
  const weeks = lastIsoWeeks(now);
  const wk: ClassifierWeek[] = weeks.map(week => {
    const c = cases.filter(x => isoWeek(x.at) === week), known = c.filter(x => x.ok !== null);
    return { week, decisions: c.length, hits: c.filter(x => x.hit).length, known: known.length, ok: known.filter(x => x.ok).length, avgCostUsd: avg(c.flatMap(x => (x.usd === null ? [] : [x.usd]))) };
  });
  const keys = new Map<string, Case[]>();
  for (const c of cases) keys.set(c.key, [...(keys.get(c.key) ?? []), c]);
  const slices: ClassifierSlice[] = [...keys].map(([key, c]) => {
    const known = c.filter(x => x.ok !== null), roles = new Map<string, number>();
    for (const x of c) if (x.role) roles.set(x.role, (roles.get(x.role) ?? 0) + 1);
    const top = [...roles].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { key, count: c.length, known: known.length, ok: known.filter(x => x.ok).length, avgCostUsd: avg(c.flatMap(x => (x.usd === null ? [] : [x.usd]))), ...(top ? { top: { key: top[0], count: top[1] } } : {}) };
  }).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const known = cases.filter(x => x.ok !== null);
  const side = (hit: boolean) => { const k = known.filter(x => x.hit === hit); return share(k.filter(x => x.ok).length, k.length); };
  const hitSide = side(true), missSide = side(false);
  return {
    id, decisions: cases.length, hit: share(cases.filter(x => x.hit).length, cases.length), success: share(known.filter(x => x.ok).length, known.length),
    avgCostUsd: avg(cases.flatMap(x => (x.usd === null ? [] : [x.usd]))), threshold, weeks: wk, slices,
    compare: hitSide.n || missSide.n ? { hit: hitSide, miss: missSide } : null,
    lastAt: cases.length ? Math.max(...cases.map(x => x.at)) : null,
  };
}

/** The four record-keeping classifiers' cards. */
export function classifierCards(i: CardInputs): ClassifierCard[] {
  const runByChat = new Map(i.runs.map(r => [r.chatId, r]));
  const outcomeOf = (ledgerId: string): boolean | null => {
    const v = verified(runByChat.get(ledgerId.replace(/^app:/, '')));
    return v ?? (i.outcomes.has(ledgerId) ? i.outcomes.get(ledgerId)! : null);
  };
  const routed = i.predictions.map(p => ({ p, ok: outcomeOf(p.id), usd: i.actuals.get(p.id)?.usd ?? null, role: runByChat.get(p.id.replace(/^app:/, ''))?.agentId ?? null }));
  const kind = card('kind', routed.map(({ p, ok, usd, role }) => ({ at: p.at, key: p.kind || 'altro', hit: !!p.kind && p.kind !== 'altro', ok, usd, role })), i.now, null);
  const model = card('model', routed.map(({ p, ok, usd, role }) => ({ at: p.at, key: p.model ?? '—', hit: p.source === 'table', ok, usd, role })), i.now, null);
  const skills = card('skills', i.launches.flatMap(l => {
    const ok = verified(runByChat.get(l.chatId)), usd = runByChat.get(l.chatId)?.costUsd ?? null;
    const hit = l.suggested.length > 0 && l.used.every(s => l.suggested.includes(s));
    // one case per launch, sliced by its first used skill (or "nessuna")
    return [{ at: l.at, key: l.used[0] ?? '', hit, ok, usd, role: l.agentId }];
  }), i.now, i.skillThreshold);
  const jobkind = card('jobkind', i.jobs.map(j => ({ at: j.at, key: j.kind, hit: j.kind !== 'other', ok: null, usd: j.usd, role: null })), i.now, null);
  return [kind, model, skills, jobkind];
}
