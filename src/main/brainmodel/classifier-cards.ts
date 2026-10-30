// The Classificatori grid's numbers (owner, 2026-10-19: "i classificatori li voglio con card e statistiche per
// ciascuno"): one card per classifier that keeps a record. Tipo di lavoro (taskOf, from the ledger's prediction lines)
// and Tipo nel registro dei costi (estimates.ts classify, from userData/jobs.jsonl); the «Scelta del modello» card left
// with the routing table (ADR 0210). Per card: decisions, its own hit measure, the verified success of what it decided, the
// average cost, the last 8 ISO weeks, the slices (per kind, with the role that ran it most) and the
// success when it hit versus when it missed. Verified success = the user's or a reviewed verdict, from the agent run
// (agent-runs.json) or from the ledger (outcomes.jsonl, which outlives a reinstall); a chat in both counts once, the
// run's verdict first. A chat whose only outcome is unverified (the brain's proxy, the Orchestrator's opinion) counts
// in `unverified`, never in success (ADR 0095, issue #110). A missing value is null, never zero. Pure: no IO. Used by classifiers.ts;
// unit tests in test/unit/brainmodel/classifier-cards.test.ts.
import { verifiedVerdict } from '../../shared/run-verdict';
import type { AgentRun } from '../../shared/agents';
import type { ClassifierCard, ClassifierSlice, ClassifierStat, ClassifierWeek } from '../../shared/brain-model';
import type { LedgerOutcome } from '../brain/routing';

export interface LedgerPrediction { id: string; at: number; kind: string }
export interface JobRow { at: number; kind: string; usd: number | null }
export interface CardInputs {
  now: number;
  predictions: LedgerPrediction[];
  actuals: Map<string, { usd: number }>;
  /** known outcomes written on the ledger (ADR 0078, 0095), by ledger id */
  outcomes: Map<string, LedgerOutcome>;
  runs: AgentRun[];
  jobs: JobRow[];
}

const WEEKS = 8;
/** ISO week label "2026-W42" of a time (also classifiers.ts weekOf). */
export function isoWeek(ms: number): string {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = d.getUTCFullYear(), w = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400e3 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
export const lastIsoWeeks = (now: number, n = WEEKS): string[] => Array.from({ length: n }, (_, i) => isoWeek(now - (n - 1 - i) * 7 * 86400e3));

const share = (k: number, n: number): ClassifierStat => ({ value: n ? k / n : null, n });
const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const verified = (r: AgentRun | undefined): boolean | null => {
  const v = r ? verifiedVerdict(r, [], 0) : null;
  return v ? v.verdict === 'success' : null;
};
const chatOf = (ledgerId: string) => ledgerId.replace(/^app:/, '');
/** A ledger id's verified outcome: its agent run's verdict (the user's or a reviewed one), else the ledger's verified
 *  outcome; one value per id, so a chat in both sources counts once. null = none verified. */
export function verifiedOf(ledgerId: string, runByChat: Map<string, AgentRun>, outcomes: Map<string, LedgerOutcome>): boolean | null {
  const v = verified(runByChat.get(chatOf(ledgerId)));
  if (v !== null) return v;
  const o = outcomes.get(ledgerId);
  return o?.verified ? o.success : null;
}
/** A ledger id's unverified outcome (the brain's proxy, the Orchestrator's opinion), only when none is verified. */
function unverifiedOf(ledgerId: string, runByChat: Map<string, AgentRun>, outcomes: Map<string, LedgerOutcome>): boolean | null {
  if (verifiedOf(ledgerId, runByChat, outcomes) !== null) return null;
  const o = outcomes.get(ledgerId);
  return o && !o.verified ? o.success : null;
}

/** One decided case, normalised: when, its slice key, whether it hit, its verified outcome, its unverified one (only
 *  without a verified one), its cost, who ran it. */
interface Case { at: number; key: string; hit: boolean; ok: boolean | null; proxy?: boolean | null; usd: number | null; role: string | null }

function card(id: ClassifierCard['id'], cases: Case[], now: number): ClassifierCard {
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
  const known = cases.filter(x => x.ok !== null), proxied = cases.filter(x => x.proxy === true || x.proxy === false);
  const side = (hit: boolean) => { const k = known.filter(x => x.hit === hit); return share(k.filter(x => x.ok).length, k.length); };
  const hitSide = side(true), missSide = side(false);
  return {
    id, decisions: cases.length, hit: share(cases.filter(x => x.hit).length, cases.length), success: share(known.filter(x => x.ok).length, known.length),
    unverified: share(proxied.filter(x => x.proxy).length, proxied.length),
    avgCostUsd: avg(cases.flatMap(x => (x.usd === null ? [] : [x.usd]))), weeks: wk, slices,
    compare: hitSide.n || missSide.n ? { hit: hitSide, miss: missSide } : null,
    lastAt: cases.length ? Math.max(...cases.map(x => x.at)) : null,
  };
}

/** The record-keeping classifiers' cards. */
export function classifierCards(i: CardInputs): ClassifierCard[] {
  const runByChat = new Map([...i.runs].sort((a, b) => b.startedAt - a.startedAt).map(r => [r.chatId, r]));
  const routed = i.predictions.map(p => ({ p, ok: verifiedOf(p.id, runByChat, i.outcomes), proxy: unverifiedOf(p.id, runByChat, i.outcomes), usd: i.actuals.get(p.id)?.usd ?? null, role: runByChat.get(chatOf(p.id))?.agentId ?? null }));
  const kind = card('kind', routed.map(({ p, ok, proxy, usd, role }) => ({ at: p.at, key: p.kind || 'altro', hit: !!p.kind && p.kind !== 'altro', ok, proxy, usd, role })), i.now);
  const jobkind = card('jobkind', i.jobs.map(j => ({ at: j.at, key: j.kind, hit: j.kind !== 'altro', ok: null, usd: j.usd, role: null })), i.now);
  return [kind, jobkind];
}
