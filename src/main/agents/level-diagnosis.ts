// The levels diagnostic (ADR 0131): from an agent-runs.json, recomputes every role's standing with the same rules as the
// card (standing.ts) and says, per role, how many runs it has, its verified successes by basis and their XP, and why the
// other runs earned nothing (no verdict, only its own word, only an opinion, an unverified review, a broken chain, the
// receipts' reason, one-shots and open runs left out...), and whether the review sampler is off (no verified outcome
// arrives, ADR 0186); the retired roles and Pulse have no level. For the Orchestrator, the same over its decisions plus the
// decision signals; for Flash, its answer outcomes. Read only, pure: diagnose() and formatDiagnosis() are used by
// levels-cli.ts (`npm run levels -- <agent-runs.json>`) and pinned by test/unit/agents/level-diagnosis.test.ts.
import type { AgentRun, AgentStanding } from '../../shared/agents';
import { FLASH_ID } from '../../shared/roles';
import { readRun, readTally } from './runs';
import type { RunTally } from './run-metrics';
import { runReceiptVerdict } from './receipts';
import { readFlashLog, settleDue, type FlashLog } from './flash-outcomes';
import { FLASH_XP } from './xp';
import { chainBlock, counts, decisionSignals, decisionXp, earnIndex, earnedVerdict, gradableBatch, gradableReview, orchestratorDecision, runXp, standings, unrated, type EarnIndex } from './standing';
import { samplerOffLine, type SamplerState } from '../../shared/judging';

/** Why a counted run earned no XP. */
export type NoXpReason = 'verified-partial' | 'verified-fail' | 'not-completed' | 'review-unverified' | 'review-not-graded-yet'
  | `chain:${string}` | 'parent-unverified' | `receipts:${string}` | 'opinion-only' | 'self-only' | 'no-verdict';
export interface RoleDiagnosis {
  agentId: string;
  /** ended runs that count (kept), and the ones left out: still open, headline / fallback one-shots */
  counted: number; open: number; oneshots: number;
  /** verified successes by basis (human, reviewed-evidence, receipts, chain, graded; plan = a clean plan, Orchestrator only) */
  wins: Record<string, number>;
  xp: number;
  /** runs with no XP, by reason */
  noXp: Partial<Record<NoXpReason, number>>;
  /** what the rollups (pruned runs) hold for it */
  rolled: { ended: number; wins: number; xp: number | null; decisions?: number; decisionWins?: number; decisionXp?: number | null };
  /** the Orchestrator's decision signals */
  signals?: { redelegated: number; reworked: number; planClean: number; planChanged: number; planMany: number };
  /** Flash's answers */
  flash?: { open: number; held: number; corrected: number; reasked: number; handed: number; total: FlashLog['total'] };
  standing: AgentStanding | null;
}
/** sampler = the review switch, when the caller knows it (levels-cli.ts reads the app's settings next to the file) */
export interface Diagnosis { runs: number; invalid: number; rollups: number; now: number; roles: RoleDiagnosis[]; sampler?: SamplerState }

/** why a run with no XP-earning success got none */
export function noXpReason(r: AgentRun, ix: EarnIndex): NoXpReason {
  const e = earnedVerdict(r, ix);
  if (e) return e.verdict === 'partial' ? 'verified-partial' : 'verified-fail';
  if (r.endReason !== 'completed') return 'not-completed';
  if (r.reviewOf && (r.agentId === 'sentinel' || r.agentId === 'judge')) return gradableReview(r) ? 'review-not-graded-yet' : 'review-unverified';
  if (r.reviewBatch) return gradableBatch(r) ? 'review-not-graded-yet' : 'review-unverified';
  if (r.parentRunId) { const b = chainBlock(r, ix); return b ? `chain:${b}` : 'parent-unverified'; }
  const rc = r.receipts ? runReceiptVerdict(r) : null;
  if (rc && r.outcome?.basis !== 'orchestrator-opinion') return `receipts:${rc.result === 'pass' ? 'pass-but-report-not-done' : rc.reason}`;
  if (r.outcome?.basis === 'orchestrator-opinion' && r.outcome.verdict !== 'unknown') return 'opinion-only';
  if (r.outcome?.basis === 'self-report' || r.report) return 'self-only';
  return 'no-verdict';
}

const blank = (agentId: string): RoleDiagnosis => ({ agentId, counted: 0, open: 0, oneshots: 0, wins: {}, xp: 0, noXp: {}, rolled: { ended: 0, wins: 0, xp: null }, standing: null });
const bump = <K extends string>(rec: Partial<Record<K, number>>, k: K, n = 1): void => { rec[k] = (rec[k] ?? 0) + n; };
const r2 = (n: number): number => Math.round(n * 100) / 100;

export function diagnose(runs: readonly AgentRun[], rollups: readonly RunTally[], now: number, flash: FlashLog | null = null, invalid = 0, sampler?: SamplerState): Diagnosis {
  const ix = earnIndex(runs), roles = new Map<string, RoleDiagnosis>();
  const of = (id: string) => { let d = roles.get(id); if (!d) roles.set(id, d = blank(id)); return d; };
  for (const t of rollups) {
    if (unrated(t.agentId)) continue; // the retired roles and Pulse have no level (ADR 0186)
    const d = of(t.agentId);
    d.rolled.ended += t.ended; d.rolled.wins += t.verdicts.success + (t.earnedWins ?? 0);
    if (t.xp !== undefined) d.rolled.xp = r2((d.rolled.xp ?? 0) + t.xp);
    if (t.decisions) {
      const o = of('orchestrator');
      o.rolled.decisions = (o.rolled.decisions ?? 0) + t.decisions;
      o.rolled.decisionWins = (o.rolled.decisionWins ?? 0) + (t.decisionWins ?? 0);
      if (t.decisionXp !== undefined) o.rolled.decisionXp = r2((o.rolled.decisionXp ?? 0) + t.decisionXp);
    }
  }
  for (const r of runs) {
    if (unrated(r.agentId)) continue;
    const d = of(r.agentId), decision = orchestratorDecision(r);
    const targets = decision ? [d, of('orchestrator')] : [d];
    if (r.endedAt === undefined) { for (const x of targets) x.open++; continue; }
    if (!counts(r)) { d.oneshots++; continue; }
    const e = earnedVerdict(r, ix);
    for (const x of targets) x.counted++;
    if (e?.verdict === 'success') { bump(d.wins, e.basis); d.xp += runXp(r, ix); } else bump(d.noXp, noXpReason(r, ix));
    if (!decision) continue;
    const o = of('orchestrator'), s = decisionSignals(r, ix), sig = o.signals ??= { redelegated: 0, reworked: 0, planClean: 0, planChanged: 0, planMany: 0 };
    if (s.redelegated) sig.redelegated++;
    if (s.reworked) sig.reworked++;
    if (s.plan === 'clean') sig.planClean++; else if (s.plan === 'changed') sig.planChanged++; else if (s.plan === 'many') sig.planMany++;
    const xp = decisionXp(r, ix, e);
    o.xp += xp;
    if (e?.verdict === 'success') bump(o.wins, e.basis);
    else if (xp > 0) bump(o.wins, 'plan');
    if (e?.verdict !== 'success') bump(o.noXp, noXpReason(r, ix));
  }
  if (flash) {
    const log = structuredClone(flash);
    settleDue(log, now);
    const f = of(FLASH_ID), why = (w: string) => log.done.filter(x => x.why === w).length;
    f.flash = { open: log.open.length, held: why('held'), corrected: why('corrected'), reasked: why('reasked'), handed: why('handed'), total: log.total };
    f.counted = log.total.success + log.total.partial + log.total.fail;
    if (log.total.success) bump(f.wins, 'held', log.total.success);
    f.xp = log.total.success * FLASH_XP;
  }
  const st = standings(runs, rollups, now, flash);
  for (const d of roles.values()) { d.xp = r2(d.xp); d.standing = st.get(d.agentId) ?? null; }
  return { runs: runs.length, invalid, rollups: rollups.length, now, ...(sampler ? { sampler } : {}), roles: [...roles.values()].sort((a, b) => (a.agentId === 'orchestrator' ? -1 : b.agentId === 'orchestrator' ? 1 : a.agentId.localeCompare(b.agentId, 'en'))) };
}

/** An agent-runs.json's content (parsed JSON) read with the store's own checks; runs out of shape are counted, not used. */
export function diagnoseFile(raw: unknown, now: number, sampler?: SamplerState): Diagnosis {
  const f = raw as { version?: unknown; runs?: unknown; rollups?: unknown; flash?: unknown } | null;
  if (!f || typeof f !== 'object' || f.version !== 1 || !Array.isArray(f.runs)) throw new Error('not an agent-runs.json (version 1 with a runs list)');
  const runs: AgentRun[] = [];
  let invalid = 0;
  const seen = new Set<string>();
  for (const v of f.runs) {
    const r = readRun(v);
    if (!r || seen.has(r.runId)) { invalid++; continue; }
    seen.add(r.runId); runs.push(r);
  }
  const rollups = (Array.isArray(f.rollups) ? f.rollups : []).map(readTally).filter((t): t is RunTally => !!t);
  return diagnose(runs, rollups, now, f.flash === undefined ? null : readFlashLog(f.flash), invalid, sampler);
}

const REASONS: Record<string, string> = {
  'verified-partial': 'verified, but partial', 'verified-fail': 'verified, but failed', 'not-completed': 'closed or stale, never completed',
  'review-unverified': 'a review with no verdict', 'review-not-graded-yet': 'a review nothing has graded yet (no user verdict, audit, parent feedback or rework)',
  'parent-unverified': 'delegated child, parent not verified', 'opinion-only': 'only the Orchestrator\'s opinion (weighs, earns no XP)',
  'self-only': 'only its own report (weighs nothing)', 'no-verdict': 'no verdict at all',
  'chain:no-parent': 'delegated child, parent gone or open', 'chain:not-completed': 'delegated child, not completed', 'chain:no-full-report': 'delegated child, no agent_report with every criterion met',
  'chain:late-report': 'delegated child, report after the parent ended', 'chain:corrected': 'delegated child, corrected / reopened / reworked (or corrections not recorded)',
  'chain:judged-badly': 'delegated child, its parent judged it partial or failed',
};
const reason = (k: string): string => REASONS[k] ?? (k.startsWith('receipts:') ? `receipts undecided (${k.slice(9)})` : k);
const pct = (v: number | null): string => v === null ? 'in rodaggio' : `${Math.round(v * 100)}%`;

/** Plain text, one block per role. */
export function formatDiagnosis(d: Diagnosis): string {
  const off = d.sampler ? samplerOffLine(d.sampler, ms => new Date(ms).toISOString().slice(0, 10)) : '';
  const out = [`agent-runs: ${d.runs} runs kept${d.invalid ? ` (${d.invalid} out of shape, left out)` : ''}, ${d.rollups} rollups · at ${new Date(d.now).toISOString()}`, ...(off ? [off] : []), ''];
  for (const r of d.roles) {
    const s = r.standing;
    out.push(`${r.agentId}: ${s ? `Lv ${s.level} · ${s.xp} XP${s.nextAt !== null ? ` (Lv ${s.level + 1} at ${s.nextAt})` : ''} · ${s.wins} verified successes · performance ${pct(s.performance)}${s.spread !== null ? ` ±${Math.round(s.spread * 100)}` : ''} on ${s.evaluated} verdicts` : 'no standing'}`);
    const label = r.agentId === 'orchestrator' ? 'decisions' : r.agentId === FLASH_ID ? 'answers settled' : 'runs counted';
    out.push(`  ${label}: ${r.counted}${r.open ? ` · open ${r.open}` : ''}${r.oneshots ? ` · one-shots left out ${r.oneshots}` : ''}`);
    const wins = Object.entries(r.wins);
    out.push(`  XP${r.agentId === FLASH_ID ? '' : ' from kept runs'}: ${r.xp}${wins.length ? ` · successes by basis: ${wins.map(([k, n]) => `${k} ${n}`).join(', ')}` : ' · no verified success'}`);
    if (r.rolled.ended || r.rolled.decisions) out.push(`  pruned (rollups): ${r.rolled.ended} runs, ${r.rolled.wins} successes, ${r.rolled.xp ?? 'XP not kept (counted at 1 each)'}${r.rolled.decisions ? ` · decisions ${r.rolled.decisions}, ${r.rolled.decisionWins ?? 0} successes, XP ${r.rolled.decisionXp ?? 'not kept'}` : ''}`);
    if (r.signals) out.push(`  decision signals: re-delegated ${r.signals.redelegated}, reopened/reworked ${r.signals.reworked}, plan approved as proposed ${r.signals.planClean}, after changes ${r.signals.planChanged + r.signals.planMany}`);
    if (r.flash) out.push(`  answers: held ${r.flash.held}, corrected ${r.flash.corrected}, asked again ${r.flash.reasked}, handed to the Orchestrator ${r.flash.handed}, still open ${r.flash.open} (recent list; totals ${r.flash.total.success}/${r.flash.total.partial}/${r.flash.total.fail})`);
    const why = (Object.entries(r.noXp) as [string, number][]).sort((a, b) => b[1] - a[1]);
    if (why.length) { out.push('  no XP because:'); for (const [k, n] of why) out.push(`    ${String(n).padStart(4)}  ${reason(k)}`); }
    out.push('');
  }
  return out.join('\n');
}
