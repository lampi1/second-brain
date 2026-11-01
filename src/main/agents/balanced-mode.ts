// «Balanced mode» (ADR 0218): the engine, model and effort of a role chat chosen so that the owner's providers are spent
// in proportion to the credit each has left over the time to its renewal («rendere omogeneo il consumo
// proporzionalmente ai crediti rimasti», 2026-11-01), above a quality floor from the runs the app keeps per role and
// model. `pickRoute` is pure and synchronous: it reads the cached pool states (agents/credits.ts) and the stats passed
// in, never the network; deterministic, the same states and history give the same pick. `BalancedMode` wraps it for a
// launch: the setting, the role's card, the engines, a local credit check only when `needsCheck` asks for one.
// Used by appctl/tools.ts (app_create_chat) and agents/delegation.ts (agent_delegate) through wiring.ts; tests in
// test/unit/agents/balanced-mode.test.ts. With the mode on the delegating agent may pick itself (`asked`): the app
// checks only the hard limits; `balanced_status` gives it the data, read locally.
import type { BalancedAsk, BalancedRoute, Effort, Harness, RouteBalanced, RouteDecision } from '../../shared/contract';
import { areaOf, EFFORTS } from '../brain/routing';
import type { AgentModelChoice, AgentRun } from '../../shared/agents';
import { effortOn } from '../../shared/agents';
import { MODEL_TIERS, WORK_ROLE_IDS, type ModelTier, type RoleId } from '../../shared/roles';
import type { CallCtx, McpTool } from '../mcp/server';
import { MIN_SUCCESS_SAMPLE, runsSuccess } from '../../shared/success';
import { taskOf, type TaskKind } from '../../shared/work-concepts';
import { poolOf, type CreditBook, type PoolState } from './credits';
import { cappedTier, withinTierMax } from './model-tier';

/** One engine the caller may start, with the tier's model on it. */
export interface BalancedCandidate {
  engine: Harness;
  model: string;
  /** the efforts the model takes (undefined = any, [] = none) */
  efforts?: readonly Effort[];
}

export type BalancedRun = Pick<AgentRun, 'model' | 'costUsd' | 'endedAt' | 'report' | 'corrections' | 'counters' | 'outcome'>;

export interface BalancedInput {
  roleId: string;
  tier: ModelTier;
  /** the role's own effort, if its card has one */
  roleEffort: Effort | null;
  /** the engine on the role's card: the first tie-break */
  roleEngine: Harness;
  candidates: readonly BalancedCandidate[];
  /** the cached state of a pool (CreditBook.state): never a check */
  state: (pool: string) => PoolState | null;
  /** this role's finished runs (any model): the quality floor and the cost tie-break */
  runs: readonly BalancedRun[];
  /** the pools the balanced picks of the last 24 h went to */
  history: readonly string[];
  now: number;
}

export interface BalancedSkip { pool: string; why: string }
export interface BalancedPick {
  engine: Harness;
  model: string;
  effort: Effort | null;
  pool: string;
  /** this pool's share of the last 24 h's balanced picks, before this one (0..1) */
  share: number;
  /** the share the credits left ask for (0..1) */
  target: number;
  skipped: BalancedSkip[];
  reason: string;
}
export type BalancedResult = { pick: BalancedPick } | { pick: null; skipped: BalancedSkip[]; reason: string };

/** The effort of a tier when the role has none (ADR 0218 §3.5). */
export const TIER_EFFORT: Readonly<Record<ModelTier, Effort>> = { light: 'low', mid: 'medium', top: 'high' };
/** A candidate with this many counted verdicts and a lower success share is left out. */
export const QUALITY_FLOOR = 0.5;
const UNKNOWN_LEFT = 0.5, MIN_PACE = 0.05, PROBATION_FACTOR = 0.25;

/** A pool's weight: the credit left over the share of its period still to go (ADR 0218 §3.3). Null = left out. */
export function poolWeight(s: PoolState | null, now: number): number | null {
  if (s?.status === 'exhausted') return null;
  const left = s?.left ?? UNKNOWN_LEFT;
  if (left <= 0) return null;
  const period = s?.periodMs && s.periodMs > 0 ? s.periodMs : 1;
  const timeLeft = s?.resetsAt != null ? Math.max(0, s.resetsAt - now) : period / 2;
  const pace = Math.min(1, Math.max(MIN_PACE, timeLeft / period));
  return (left / pace) * (s?.status === 'probation' ? PROBATION_FACTOR : 1);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
function inTime(ms: number): string {
  const h = ms / 3600e3;
  return h < 1 ? `${Math.max(1, Math.round(ms / 60e3))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} g`;
}

/** Picks the engine, model and effort of one role chat. Null pick = every candidate is out: the role's card stays. */
export function pickRoute(input: BalancedInput): BalancedResult {
  const skipped: BalancedSkip[] = [];
  type Row = { c: BalancedCandidate; pool: string; weight: number; success: number | null; n: number; cost: number | null; state: PoolState | null };
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const c of input.candidates) {
    const pool = poolOf(c.engine, c.model);
    if (seen.has(pool)) continue;
    seen.add(pool);
    const state = input.state(pool);
    const weight = poolWeight(state, input.now);
    if (weight === null) { skipped.push({ pool, why: state?.note ? `crediti finiti (${state.note})` : 'crediti finiti' }); continue; }
    const own = input.runs.filter(r => r.model === c.model);
    const share = runsSuccess(own);
    if (share.n >= MIN_SUCCESS_SAMPLE && share.value !== null && share.value < QUALITY_FLOOR) {
      skipped.push({ pool, why: `${c.model}: ${pct(share.value)} riuscite su ${share.n} run, sotto la soglia` });
      continue;
    }
    const costs = own.map(r => r.costUsd).filter((x): x is number => typeof x === 'number');
    rows.push({ c, pool, weight, success: share.value, n: share.n, cost: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null, state });
  }
  if (!rows.length) return { pick: null, skipped, reason: `Balanced mode: nessun motore con crediti e qualità sufficienti (${skipped.map(s => `${s.pool}: ${s.why}`).join('; ') || 'nessun motore attivo'}); resta il motore del ruolo` };

  const total = rows.reduce((a, r) => a + r.weight, 0);
  const counts = new Map<string, number>();
  for (const p of input.history) if (rows.some(r => r.pool === p)) counts.set(p, (counts.get(p) ?? 0) + 1);
  const n = [...counts.values()].reduce((a, b) => a + b, 0);
  // the pool furthest below its target once this pick is counted (a largest-remainder share, deterministic)
  const deficit = (r: Row) => (r.weight / total) * (n + 1) - (counts.get(r.pool) ?? 0);
  const best = [...rows].sort((a, b) =>
    deficit(b) - deficit(a)
    || Number(b.c.engine === input.roleEngine) - Number(a.c.engine === input.roleEngine)
    || (b.success ?? -1) - (a.success ?? -1)
    || (a.cost ?? Infinity) - (b.cost ?? Infinity)
    || a.pool.localeCompare(b.pool))[0]!;

  const effort = effortOn(input.roleEffort ?? TIER_EFFORT[input.tier], best.c.efforts);
  const share = n ? (counts.get(best.pool) ?? 0) / n : 0, target = best.weight / total;
  const s = best.state;
  const credit = s?.left != null ? `credito ${pct(s.left)}` : s?.status === 'probation' ? 'chat di prova dopo il limite' : 'credito non leggibile';
  const renew = s?.resetsAt != null ? `, rinnovo tra ${inTime(s.resetsAt - input.now)}` : '';
  const stats = best.n ? ` · ${best.n} run, ${pct(best.success ?? 0)} riuscite` : ' · nessun run con esito per questo modello';
  const skip = skipped.length ? ` · esclusi: ${skipped.map(x => `${x.pool} (${x.why})`).join(', ')}` : '';
  const reason = `Balanced mode, scelta della formula: ${best.pool} (${credit}${renew}) · quota ${pct(share)} su obiettivo ${pct(target)} · modello ${best.c.model}${effort ? ` · effort ${effort}` : ''} · livello ${input.tier}${stats}${skip}`;
  return { pick: { engine: best.c.engine, model: best.c.model, effort, pool: best.pool, share, target, skipped, reason: reason.slice(0, 300) } };
}

/** A run as the stats read it: its role, its goal (the kind of work) and when it started. */
export type BalancedRunRow = BalancedRun & Pick<AgentRun, 'agentId' | 'goal' | 'startedAt'>;

export interface BalancedModeDeps {
  /** the «Balanced mode» setting */
  on: () => boolean;
  book: Pick<CreditBook, 'state' | 'list' | 'refresh' | 'recentPicks' | 'recordPick'>;
  /** the role's card: engine, own model and effort, tier and tierMax */
  role: (id: string) => { engine: Harness; model: string | null; effort: Effort | null; tier: ModelTier; tierMax: ModelTier } | null;
  /** every engine with its state and models (catalog.models) */
  engines: () => readonly (Pick<AgentModelChoice, 'engine' | 'enabled' | 'trusted' | 'models'> & { modelSelectable?: boolean })[];
  tierModel: (engine: Harness, tier: ModelTier) => string | null;
  /** every model of a tier on an engine (tierCandidates); missing = the tier's model only */
  tierModels?: (engine: Harness, tier: ModelTier) => readonly string[];
  /** every run the app keeps (any role) */
  runs: () => readonly BalancedRunRow[];
  now?: () => number;
}
/** What a caller passes on: the pick for catalog.resolve, the reason and the weights for route.reason / route.balanced. */
export interface BalancedChoice { balancedRoute: BalancedRoute | null; reason: string; balanced: RouteBalanced | null; suggestedRole: RoleId | null }

/** One row of balanced_status's stats: a role on a model for one kind of work (verified verdicts only). */
export interface BalancedStat { roleId: string; model: string; kind: TaskKind; runs: number; verdicts: number; success: number | null; avgCostUsd: number | null; avgMinutes: number | null }
export interface BalancedPoolRow { pool: string; status: PoolState['status']; left: number | null; resetsAt: string | null; checkedAt: string; note?: string; target: number | null; share: number }
/** balanced_status: what the delegating agent reads before it picks (ADR 0218 §4). */
export interface BalancedStatus {
  on: boolean;
  pools: BalancedPoolRow[];
  stats: BalancedStat[];
  /** the formula's pick for the role asked: the recommended default */
  proposal: { engine: Harness; model: string; effort: Effort | null; pool: string; reason: string } | null;
  /** the role the work fits better than the one asked (from title and prompt), a hint */
  suggestedRole?: RoleId;
  howTo: string;
}

interface LaunchArgs { roleId: string; tier?: ModelTier; title: string; prompt: string; canRun: (h: Harness) => boolean; pending?: readonly string[]; asked?: BalancedAsk }
type Role = NonNullable<ReturnType<BalancedModeDeps['role']>>;

const STATS_MAX = 40;
const HOW_TO = 'Balanced mode on: pick engine, model and effort yourself from these data and pass them as balanced {engine, model, effort?, why} in app_create_chat / agent_delegate. Prefer the proposal unless the stats say otherwise (e.g. a model that does badly on this kind of work). Pass nothing and the formula decides. The app refuses only an exhausted pool, an engine you may not open, a model that is neither the card\'s own nor one of a tier up to the role\'s tierMax.';

/** «Balanced mode» for one launch: the setting, the credit book and the role's stats together. */
export class BalancedMode {
  constructor(private readonly d: BalancedModeDeps) {}

  get enabled(): boolean { return this.d.on(); }

  private now(): number { return this.d.now?.() ?? Date.now(); }

  private tierModels(engine: Harness, tier: ModelTier): readonly string[] {
    if (this.d.tierModels) return this.d.tierModels(engine, tier);
    const m = this.d.tierModel(engine, tier);
    return m ? [m] : [];
  }

  private candidates(role: Role, tier: ModelTier, canRun: (h: Harness) => boolean): BalancedCandidate[] {
    const out: BalancedCandidate[] = [];
    for (const e of this.d.engines()) {
      if (!e.enabled || !e.trusted || e.modelSelectable === false || !canRun(e.engine)) continue;
      const model = (e.engine === role.engine ? role.model : null) ?? this.d.tierModel(e.engine, tier);
      if (!model) continue;
      const efforts = e.models.find(m => m.id === model)?.efforts;
      out.push({ engine: e.engine, model, ...(efforts ? { efforts } : {}) });
    }
    return out;
  }

  private formula(roleId: string, role: Role, tier: ModelTier, candidates: readonly BalancedCandidate[], pending: readonly string[]): BalancedResult {
    return pickRoute({ roleId, tier, roleEffort: role.effort, roleEngine: role.engine, candidates, state: p => this.d.book.state(p),
      runs: this.d.runs().filter(r => r.agentId === roleId), history: [...this.d.book.recentPicks(), ...pending], now: this.now() });
  }

  /** Each pool's target share (its weight over the sum) and its share of the recent balanced picks. */
  private shares(pools: readonly string[], pending: readonly string[]): Map<string, { target: number | null; share: number }> {
    const now = this.now(), weights = new Map(pools.map(p => [p, poolWeight(this.d.book.state(p), now)] as const));
    const total = [...weights.values()].reduce<number>((a, w) => a + (w ?? 0), 0);
    const history = [...this.d.book.recentPicks(), ...pending].filter(p => weights.has(p));
    return new Map(pools.map(p => [p, { target: total > 0 && weights.get(p) != null ? weights.get(p)! / total : null, share: history.length ? history.filter(x => x === p).length / history.length : 0 }]));
  }

  /** Null when the setting is off (the card decides). A local credit check runs only when `needsCheck` asks for it.
   *  `pending` = the pools picked earlier in the same batch (agent_delegate), not created yet: counted as picks.
   *  `asked` = the delegating agent's own pick: checked against the hard limits only, else the formula's pick. */
  async choose(a: LaunchArgs): Promise<BalancedChoice | null> {
    if (!this.d.on()) {
      if (a.asked) throw new Error('balanced: only with Balanced mode on; otherwise the role\'s card decides (Brain → Agenti).');
      return null;
    }
    const role = this.d.role(a.roleId);
    if (!role) return null;
    const tier = cappedTier(a.tier ?? role.tier, role.tierMax);
    const candidates = this.candidates(role, tier, a.canRun);
    const pools = candidates.map(c => poolOf(c.engine, c.model));
    if (a.asked) pools.push(poolOf(a.asked.engine, a.asked.model));
    await this.d.book.refresh(pools, { costly: tier === 'top' });
    const r = this.formula(a.roleId, role, tier, candidates, a.pending ?? []);
    const fit = suggestRole(taskOf(a.title, a.prompt, undefined), a.title);
    const suggestedRole = fit && fit !== a.roleId ? fit : null;
    const hint = suggestedRole ? ` · ruolo suggerito: ${suggestedRole}` : '';
    if (a.asked) return this.agentPick(a.asked, role, tier, a.canRun, r, pools, a.pending ?? [], suggestedRole, hint);
    if (!r.pick) return { balancedRoute: null, reason: `${r.reason}${hint}`.slice(0, 300), balanced: null, suggestedRole };
    const p = r.pick;
    return { balancedRoute: { engine: p.engine, model: p.model, ...(p.effort ? { effort: p.effort } : {}), pool: p.pool },
      reason: `${p.reason.slice(0, 300 - hint.length)}${hint}`, suggestedRole,
      balanced: { by: 'formula', pool: p.pool, share: p.share, target: p.target, skipped: p.skipped, ...(suggestedRole ? { suggestedRole } : {}) } };
  }

  /** The agent's pick, refused only on a hard limit (ADR 0218 §4): an engine off or not allowed to the caller, an
   *  unknown model, a model above the role's tierMax, an exhausted pool. */
  private agentPick(ask: BalancedAsk, role: Role, tier: ModelTier, canRun: (h: Harness) => boolean, r: BalancedResult, pools: readonly string[], pending: readonly string[], suggestedRole: RoleId | null, hint: string): BalancedChoice {
    const e = this.d.engines().find(x => x.engine === ask.engine);
    if (!e || !e.enabled || !e.trusted) throw new Error(`balanced.engine ${ask.engine}: switched off or to confirm again in Settings → Engines.`);
    if (e.modelSelectable === false) throw new Error(`balanced.engine ${ask.engine}: it cannot apply a model choice, so its tier cannot be held; pick another engine or pass nothing.`);
    if (!canRun(ask.engine)) throw new Error(`balanced.engine ${ask.engine}: you may not open chats on this engine (Settings → Engines).`);
    // only the card's own model or a model of a tier up to tierMax (any of the tier's models): never one in no tier
    const own = ask.engine === role.engine && role.model === ask.model;
    const models = (t: ModelTier) => this.tierModels(ask.engine, t);
    if (!own && !withinTierMax(models, ask.model, role.tierMax)) {
      if (MODEL_TIERS.some(t => models(t).includes(ask.model))) throw new Error(`balanced.model ${ask.model}: above the role's tierMax (${role.tierMax}).`);
      throw new Error(`balanced.model ${ask.model}: in no tier up to the role's tierMax (${role.tierMax}) on ${ask.engine}: pick a model of balanced_status or Settings → Roles → tiers.`);
    }
    const pool = poolOf(ask.engine, ask.model);
    const state = this.d.book.state(pool);
    if (state?.status === 'exhausted') throw new Error(`balanced: the ${pool} credit is exhausted (${state.note ?? 'limit reached'}); pick another engine or pass nothing.`);
    const effort = effortOn(ask.effort ?? role.effort ?? TIER_EFFORT[tier], e.models.find(m => m.id === ask.model)?.efforts);
    const skipped = r.pick ? r.pick.skipped : r.skipped;
    const all = [...new Set(pools)];
    const w = this.shares(all, pending).get(pool)!;
    const why = ask.why.replace(/\s+/g, ' ').trim().slice(0, 120);
    const formula = r.pick ? `${r.pick.pool} · ${r.pick.model}` : 'nessuna';
    const credit = state?.left != null ? `credito ${Math.round(state.left * 100)}%` : 'credito non leggibile';
    const reason = `Balanced mode, scelta dell'agente: ${why} · ${pool} (${credit}) · modello ${ask.model}${effort ? ` · effort ${effort}` : ''} · formula proponeva ${formula}`;
    return { balancedRoute: { engine: ask.engine, model: ask.model, ...(effort ? { effort } : {}), pool },
      reason: `${reason.slice(0, 300 - hint.length)}${hint}`, suggestedRole,
      balanced: { by: 'agent', pool, share: w.share, target: w.target ?? 0, skipped, ...(suggestedRole ? { suggestedRole } : {}) } };
  }

  /** What balanced_status returns: every pool the caller could use (cached, a local check only when due), its target
   *  and real share, the stats per role × model × kind of work, and the formula's proposal for the role asked. */
  async status(a: { roleId?: string; tier?: ModelTier; title?: string; prompt?: string; canRun: (h: Harness) => boolean }): Promise<BalancedStatus> {
    const role = a.roleId ? this.d.role(a.roleId) : null;
    const tier = role ? cappedTier(a.tier ?? role.tier, role.tierMax) : (a.tier ?? 'mid');
    const candidates = role ? this.candidates(role, tier, a.canRun)
      : this.d.engines().filter(e => e.enabled && e.trusted && a.canRun(e.engine)).flatMap(e => { const m = this.d.tierModel(e.engine, tier); return m ? [{ engine: e.engine, model: m }] : []; });
    const pools = [...new Set([...candidates.map(c => poolOf(c.engine, c.model)), ...this.d.book.list().map(s => s.pool)])];
    await this.d.book.refresh(pools, { costly: tier === 'top' });
    const shares = this.shares(pools, []);
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
    const rows = pools.map(p => {
      const s = this.d.book.state(p), w = shares.get(p)!;
      return { pool: p, status: s?.status ?? 'unknown', left: s?.left ?? null, resetsAt: iso(s?.resetsAt ?? null), checkedAt: iso(s?.at ?? this.now())!, ...(s?.note ? { note: s.note } : {}), target: w.target, share: w.share };
    });
    const r = role && a.roleId ? this.formula(a.roleId, role, tier, candidates, []) : null;
    const fit = a.title || a.prompt ? suggestRole(taskOf(a.title ?? '', a.prompt ?? '', undefined), a.title ?? '') : null;
    return { on: this.d.on(), pools: rows, stats: balancedStats(this.d.runs(), a.roleId),
      proposal: r?.pick ? { engine: r.pick.engine, model: r.pick.model, effort: r.pick.effort, pool: r.pick.pool, reason: r.pick.reason } : null,
      ...(fit && fit !== a.roleId ? { suggestedRole: fit } : {}), howTo: HOW_TO };
  }

  /** The chat of this pick was created: the next pick sees it (even inside the same agent_delegate call). */
  record(choice: BalancedChoice | null): void {
    if (choice?.balancedRoute) this.d.book.recordPick(choice.balancedRoute.pool);
  }
}

/** The finished runs grouped by role × model × kind of work (read from the run's goal), the busiest first. */
export function balancedStats(runs: readonly BalancedRunRow[], roleId?: string): BalancedStat[] {
  const groups = new Map<string, { roleId: string; model: string; kind: TaskKind; runs: BalancedRunRow[] }>();
  for (const r of runs) {
    if (r.endedAt === undefined || !r.model || (roleId && r.agentId !== roleId)) continue;
    const kind = taskOf('', r.goal ?? '', undefined);
    const key = `${r.agentId}\u0000${r.model}\u0000${kind}`;
    const g = groups.get(key) ?? { roleId: r.agentId, model: r.model, kind, runs: [] };
    g.runs.push(r);
    groups.set(key, g);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
  return [...groups.values()].map(g => {
    const s = runsSuccess(g.runs);
    return { roleId: g.roleId, model: g.model, kind: g.kind, runs: g.runs.length, verdicts: s.n, success: s.value === null ? null : Math.round(s.value * 100) / 100,
      avgCostUsd: avg(g.runs.map(r => r.costUsd).filter((x): x is number => typeof x === 'number')),
      avgMinutes: avg(g.runs.map(r => (r.endedAt! - r.startedAt) / 60e3).filter(x => Number.isFinite(x) && x >= 0)) };
  }).sort((a, b) => b.runs - a.runs || a.roleId.localeCompare(b.roleId) || a.model.localeCompare(b.model) || a.kind.localeCompare(b.kind)).slice(0, STATS_MAX);
}

/** The read-only balanced_status tool (Orchestrator and role chats): local reads only, never the network. */
export function balancedStatusTool(mode: Pick<BalancedMode, 'status'>, canRunOf: (ctx: CallCtx) => (h: Harness) => boolean): McpTool {
  return {
    name: 'balanced_status',
    description: `Balanced mode data, read before delegating: each credit pool (left, renewal, state, target share and real share of the last 24 h), stats per role × model × kind of work (runs, verified success, average cost and minutes), and the formula's proposal for roleId. Local reads only. ${HOW_TO}`,
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      roleId: { type: 'string', enum: [...WORK_ROLE_IDS], description: 'the role you are about to launch: its proposal and only its stats' },
      tier: { type: 'string', enum: [...MODEL_TIERS] },
      title: { type: 'string', maxLength: 200 }, prompt: { type: 'string', maxLength: 4000, description: 'optional: the task, for the suggested role' },
    } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: (args, ctx) => balancedStatusRun(mode, args, canRunOf(ctx)),
  };
}

/** balanced_status's body: the app mount (appctl/tools.ts) knows its caller without a ctx. */
export async function balancedStatusRun(mode: Pick<BalancedMode, 'status'>, args: Record<string, unknown>, canRun: (h: Harness) => boolean): Promise<string> {
  const roleId = typeof args.roleId === 'string' && (WORK_ROLE_IDS as readonly string[]).includes(args.roleId) ? args.roleId : undefined;
  const tier = (MODEL_TIERS as readonly unknown[]).includes(args.tier) ? args.tier as ModelTier : undefined;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 4000) : undefined);
  const title = text(args.title), prompt = text(args.prompt);
  return JSON.stringify(await mode.status({ ...(roleId ? { roleId } : {}), ...(tier ? { tier } : {}), ...(title ? { title } : {}), ...(prompt ? { prompt } : {}), canRun }));
}

/** A `balanced` argument of app_create_chat / agent_delegate, checked for shape (the limits are BalancedMode's). */
export function balancedAskOf(v: unknown, where: string): BalancedAsk | undefined {
  if (v === undefined) return undefined;
  const b = v as Partial<BalancedAsk> | null;
  if (!b || typeof b !== 'object' || typeof b.engine !== 'string' || typeof b.model !== 'string' || !b.model.trim() || b.model.length > 120
    || typeof b.why !== 'string' || !b.why.trim() || (b.effort !== undefined && !(EFFORTS as readonly unknown[]).includes(b.effort)))
    throw new Error(`${where}: { engine, model, effort?, why } (balanced_status says what to pick).`);
  return { engine: b.engine as Harness, model: b.model.trim(), ...(b.effort ? { effort: b.effort } : {}), why: b.why.trim().slice(0, 300) };
}

/** The JSON schema of `balanced` in the delegating tools. */
export const BALANCED_ASK_SCHEMA = {
  type: 'object', required: ['engine', 'model', 'why'], additionalProperties: false,
  description: 'only with Balanced mode on: your pick after balanced_status; omit it and the formula picks',
  properties: { engine: { type: 'string' }, model: { type: 'string', maxLength: 120 }, effort: { type: 'string', enum: [...EFFORTS] }, why: { type: 'string', maxLength: 300, description: 'why, in a few words (shown in the route)' } },
} as const;

/** The route a balanced-picked child of agent_delegate carries (its chat shows the reason; the ledger reads it like any). */
export function balancedDecision(c: BalancedChoice, a: { roleId: string; version: number; tier?: ModelTier; title: string; prompt: string; now: number }): RouteDecision {
  return { policy: 'routing', version: null, source: 'agent', reason: c.reason, kind: taskOf(a.title, a.prompt, undefined), area: areaOf(a.title), at: a.now,
    agent: { id: a.roleId, version: a.version, chosenBy: 'parent', ...(a.tier ? { tier: a.tier } : {}), modelFrom: 'tier' }, ...(c.balanced ? { balanced: c.balanced } : {}) };
}

/** The role the kind of work fits (ADR 0218 «Suggested role»); null = no clear one. */
export function suggestRole(kind: TaskKind, title: string): RoleId | null {
  if (/\b(piano|pianifica|plan|planning|design|progett\w*|architettur\w*|strategi\w*)\b/i.test(title)) return 'strategist';
  switch (kind) {
    case 'review': case 'qa-run': return 'sentinel';
    case 'research-web': case 'investigation': case 'ops-read': case 'triage': return 'scout';
    case 'writing': return 'herald';
    case 'bug-fix': case 'app-feature': return 'artisan';
    default: return null;
  }
}
