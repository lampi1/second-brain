// Model choice of a new chat (ADR 0032, 0083; ADR 0210 removed the routing table): which harness, model and effort a chat
// gets. A role chat takes its card's engine, model (its tier's when the card names none) and effort (routeAgent); any
// other chat ("Nuova chat", a new Orchestrator) takes the user's "Chat aperte dall'Orchestrator" defaults, or what the
// user named (an override). Owner, 2026-10-30 (decision «Toglierlo»): no table picks a model per kind of work any more.
// The brain still owns the model registry and price table (harness/models.json, read here: registry()). Each routed chat
// still carries its kind and area (the one taxonomy of shared/work-concepts.ts) and appends its prediction and measured
// actuals to the improvement loop's shared ledger (ops/state/improve/outcomes.jsonl, append-only, same id = later line
// wins), which the Qualità tab's «Tipo di lavoro» card and the verified outcomes read. Old files of the table
// (ops/state/improve/routing/, userData/routing-api.json) are left on disk and never read. Used by brain/index.ts,
// chats/routed.ts, appctl/tools.ts and wiring.ts; tests in test/unit/brain/routing.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Effort, Harness, ModelRegistry, RegistryModel, RouteAgent, RouteDecision, TaskKind } from '../../shared/contract';
import { TASK_KINDS } from '../../shared/contract';
import { MODEL_TIERS } from '../../shared/roles';
import { enoughVerdicts } from '../../shared/success';
export { taskOf } from '../../shared/work-concepts';
import { conceptOf, taskOf } from '../../shared/work-concepts';
import { engineLabel, engineOf, engines } from '../engines/registry';
import { availableEngine } from '../../shared/engine-readiness';
import { engineReadiness } from '../engines/readiness';
import { brainFile } from '../rules/tools';

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** The app's own areas: their queued work waits behind the other chats' (ADR 0036). */
const APP_AREAS = ['App', 'Pers · App'];

const readJson = (f: string): unknown => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) as unknown; } catch { return null; } };
const isApp = (area: string): boolean => APP_AREAS.includes(area);
/** A chat titled in an app area ("App · …", "Pers · App: …").
 *  Its queued work waits behind the other chats' (ADR 0036; chats/manager.ts). */
export const isAppChat = (title: string): boolean => isApp(areaOf(title));

/** The area of a chat title, as the brain's estimates.mjs reads it: "Alfa · …" → Alfa, "Pers · App: …" → "Pers · App",
 *  an Orchestrator's own; a label that names a kind of work ("Fix · …", the one taxonomy's words, ADR 0186) or no
 *  label → 'altro'. */
export function areaOf(title: string): string {
  const t = String(title ?? '').trim();
  if (/^orchestrator\b/i.test(t)) return 'Orchestrator';
  const m = t.match(/^([A-Za-zÀ-ú-]{2,12}) · (.*)$/);
  if (!m || conceptOf(m[1]!)) return 'altro';
  return m[1] + (m[1] === 'Pers' && /^(App|second-brain)\b/i.test(m[2]!) ? ' · App' : '');
}

// ── the registry ────────────────────────────────────────────────────────────────────────────────────────────────────
const bare = (m: string): string => m.toLowerCase().trim().replace(/\[.*\]$/, '').replace(/-\d{8}$/, '');
/** The registry row of a model id or alias ("opus", "claude-opus-5-5[1m]", "claude-haiku-4-5-20251001"); null = unknown. */
export function modelRow(model: string | null | undefined, reg: ModelRegistry | null): RegistryModel | null {
  if (!model || !reg) return null;
  const id = bare(model);
  return reg.models.find(r => r.id === id) ?? reg.models.find(r => (r.aliases ?? []).includes(id)) ?? reg.models.find(r => r.id === `claude-${id}`) ?? null;
}
/** Fable (the user, 2026-10-14: "non userei fable costa troppo"): only a role's card or the user names it. */
export const isFable = (m: Pick<RegistryModel, 'id'> | null | undefined): boolean => !!m && /fable/i.test(m.id);
/** does the engine take an effort (Claude's thinking budget)? */
const takesEffort = (h: Harness): boolean => !!engineOf(h)?.caps.effort;
/** The user's default effort is the Claude one (orchestratorChats.claudeEffort): another engine that takes an effort
 *  (Cursor, through its thought_level) keeps its own setting (cursorReasoning) unless the chat names one. */
const defaultEffort = (h: Harness, defaults: { effort: Effort | null }): Effort | null => h === 'claude' ? defaults.effort : null;
const looksClaude = (m: string | null): boolean => /\b(claude|opus|sonnet|haiku|fable|mythos)\b/i.test(String(m ?? '').replace(/[-_.]/g, ' '));

/** Explicit null selects the engine default; omission takes the user's defaults. Neither grants permission. */
export interface RouteAsk { harness?: Harness; model?: string | null; effort?: Effort | null; reason?: string }
/** The user's "Chat aperte dall'Orchestrator": the engine, each engine's model ('' / null = the CLI's) and the Claude effort. */
export interface RouteDefaults { harness: Harness; models: Record<Harness, string | null>; effort: Effort | null }
export type Resolved = { harness: Harness; model: string | null; effort: Effort | null; source: RouteDecision['source']; reason: string | null } | { error: string };

/** Harness, model and effort of a new chat that no role decides: the user's defaults (for the engine named, if any)
 *  on an engine this caller may start now, or what was named (an override). The hard rules hold for everything named;
 *  max only when asked, with a reason. */
export function resolve(ask: RouteAsk, defaults: RouteDefaults, reg: ModelRegistry | null, canRun: (h: Harness) => boolean = () => true): Resolved {
  // the user's engine when it may run and is ready, else another ready one (engine off, Claude <-> Cursor off)
  const fallback = availableEngine(engines().map(e => e.id).filter(canRun), defaults.harness, engineReadiness());
  if (!ask.harness && !fallback) return { error: 'Nessun motore disponibile: verifica installazione, accesso e impostazioni.' };
  const baseHarness = fallback ?? defaults.harness;
  const base = { harness: baseHarness, model: defaults.models[baseHarness] || null, effort: defaultEffort(baseHarness, defaults) };
  const harness = ask.harness ?? base.harness;
  // a model belongs to its harness: switching harness takes that harness's default model, never the other one's
  const sameEngine = harness === base.harness;
  const model = ask.model !== undefined ? ask.model : (sameEngine ? base.model : defaults.models[harness] || null);
  const m = modelRow(model, reg);
  let effort = ask.effort !== undefined ? ask.effort : (!takesEffort(harness) ? null : sameEngine ? base.effort : defaultEffort(harness, defaults));
  // an effort nobody named that the chosen model lacks is dropped (the CLI's default), never an error
  if (!ask.effort && effort && m && !(m.efforts ?? []).includes(effort)) effort = null;
  if (model && m && m.harness !== harness) return { error: `${m.id} gira solo su ${m.harness}, non su ${harness}` };
  if (harness !== 'claude' && looksClaude(model)) return { error: 'un modello Claude gira solo sull’harness claude' };
  if (ask.model && harness === 'claude' && reg && !m) return { error: `modello «${ask.model}» non è in harness/models.json del brain` };
  if (ask.effort && !takesEffort(harness)) return { error: `lo sforzo non vale per ${engineLabel(harness)}: scegli il modello` };
  if (effort && !EFFORTS.includes(effort)) return { error: `sforzo «${String(effort)}»: ${EFFORTS.join(' | ')}` };
  if (effort && m && !(m.efforts ?? []).includes(effort)) return { error: `${m.id} non ha lo sforzo «${effort}»` };
  const reason = String(ask.reason ?? '').trim();
  if (ask.effort === 'max' && !reason) return { error: 'sforzo max solo quando l’utente lo chiede, con reason' };
  const said = ask.harness !== undefined || ask.model !== undefined || ask.effort !== undefined;
  // an alias of the default model ("sonnet") is the same model
  const same = (a: string | null, b: string | null): boolean => (a ?? null) === (b ?? null) || (!!a && !!b && !!modelRow(a, reg) && modelRow(a, reg) === modelRow(b, reg));
  const changed = harness !== base.harness || !same(model, base.model) || (effort ?? null) !== (base.effort ?? null);
  const source = said && changed ? 'override' : 'default';
  return { harness, model: model ?? null, effort: effort ?? null, source, reason: source === 'override' ? reason || null : null };
}

export interface RouteRequest {
  /** the chat's title ("Area · cosa"): its area and, with the prompt, its kind */
  title: string; prompt: string;
  /** the agent's own kind (app_create_chat `kind`); else the brain's rules on title and prompt */
  kind?: TaskKind;
  /** Verified app-source work uses app routing regardless of its title. */
  appCode?: boolean;
  /** the caller's own area (a DevOps record's project or repo); else the title's label */
  area?: string;
  ask: RouteAsk; defaults: RouteDefaults;
  /** the engines this caller may start now (settings engines.*, Claude <-> Cursor messages) */
  canRun?: (h: Harness) => boolean;
  /** the role the chat starts from (ADR 0083): it decides; absent = the user's defaults */
  agent?: AgentChoice;
}
/** The role a chat starts from, as the catalog resolved it: engine, model (null = the engine's default), effort, tier,
 *  and who launched it; stats = its own results line (agentStatsLine), shown as the route's reason. */
export interface AgentChoice {
  id: string; name: string; version: number; harness: Harness; model: string | null; effort: Effort | null;
  chosenBy: RouteAgent['chosenBy']; tier?: RouteAgent['tier']; stats?: string | null;
}
/** An agent version's results for its route's reason: "12 run, 9 con esito, 78% riuscite" (agents/run-metrics.ts
 *  VersionMetrics: ended runs, runs with a verdict, their success share); null = no ended run yet. */
export function agentStatsLine(m: { ended: number; successRate: { value: number | null; n: number } } | null | undefined): string | null {
  if (!m || m.ended <= 0) return null;
  if (!m.successRate.n || m.successRate.value === null) return `${m.ended} run, nessuna con esito`;
  if (!enoughVerdicts(m.successRate)) return `${m.ended} run, ${m.successRate.n} con esito (troppo pochi per una percentuale)`;
  return `${m.ended} run, ${m.successRate.n} con esito, ${Math.round(100 * m.successRate.value)}% riuscite`;
}
const CHOSEN_BY: Record<RouteAgent['chosenBy'], string> = { orchestrator: 'avviato dall’Orchestrator', parent: 'avviato dal suo genitore', app: 'avviato dall’app' };

/** The route of a role chat (ADR 0083): the resolved engine, model and effort as they are. Never 'override': nothing
 *  overrides the role. */
export function routeAgent(req: RouteRequest & { agent: AgentChoice }, reg: ModelRegistry | null,
  rules: { tasks?: [string, string, string][] } | null, now = Date.now()): RouteResult {
  const a = req.agent;
  const kind = req.kind ?? taskOf(req.title, req.prompt, rules?.tasks);
  const area = req.appCode ? 'App' : req.area?.trim().slice(0, 40) || areaOf(req.title);
  const model = a.model;
  let effort = a.effort;
  const from: RouteAgent['modelFrom'] = !model ? 'engine' : a.tier ? 'tier' : 'role';
  const m = modelRow(model, reg);
  if (model && m && m.harness !== a.harness) return { error: `${m.id} gira solo su ${m.harness}, non su ${a.harness}` };
  if (a.harness !== 'claude' && looksClaude(model)) return { error: 'un modello Claude gira solo sull’harness claude' };
  if (effort && !takesEffort(a.harness)) effort = null;
  const reason = [`ruolo ${a.name} v${a.version}`, CHOSEN_BY[a.chosenBy], a.tier ? `livello ${a.tier}` : null, a.stats ?? null].filter(Boolean).join(' · ').slice(0, 300);
  return { harness: a.harness, model, effort, route: { policy: 'routing', version: null, source: 'agent', reason, kind, area, at: now,
    agent: { id: a.id, version: a.version, chosenBy: a.chosenBy, modelFrom: from, ...(a.tier ? { tier: a.tier } : {}) } } };
}
export type RouteResult = { harness: Harness; model: string | null; effort: Effort | null; route: RouteDecision } | { error: string };

/** Routes one chat: its kind and area (for the ledger), then its role (routeAgent) or resolve() on the user's
 *  defaults. The brain's estimates rules travel in estimates.json (`tasks` for the kind); without them a chat whose
 *  words name no kind is 'altro'. */
export function routeChat(req: RouteRequest, reg: ModelRegistry | null, rules: { tasks?: [string, string, string][] } | null, now = Date.now()): RouteResult {
  if (req.agent) return routeAgent({ ...req, agent: req.agent }, reg, rules, now);
  const kind = req.kind ?? taskOf(req.title, req.prompt, rules?.tasks);
  const area = req.appCode ? 'App' : req.area?.trim().slice(0, 40) || areaOf(req.title);
  const r = resolve(req.ask, req.defaults, reg, req.canRun);
  if ('error' in r) return r;
  return { harness: r.harness, model: r.model, effort: r.effort,
    route: { policy: 'routing', version: null, source: r.source, reason: r.reason, kind, area, at: now } };
}

/** A route read back from chats.json (chats/store.ts): kept only when well formed. */
export function validRoute(v: unknown): RouteDecision | null {
  const r = v as Partial<RouteDecision> | null;
  if (!r || typeof r !== 'object' || r.policy !== 'routing' || !['table', 'default', 'override', 'explore', 'agent'].includes(String(r.source))) return null;
  if (!(TASK_KINDS as readonly string[]).includes(String(r.kind)) || typeof r.area !== 'string' || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  return { policy: 'routing', version: Number.isInteger(r.version) ? r.version as number : null, source: r.source as RouteDecision['source'],
    reason: typeof r.reason === 'string' ? r.reason.slice(0, 300) : null, kind: r.kind as TaskKind, area: r.area.slice(0, 40), at: r.at,
    ...(typeof r.ledgerId === 'string' && /^app:[\w-]{1,80}$/.test(r.ledgerId) ? { ledgerId: r.ledgerId } : {}),
    ...(Number.isInteger(r.handoffs) && (r.handoffs as number) > 0 ? { handoffs: Math.min(r.handoffs as number, 1000) } : {}),
    ...(validAgent(r.agent) ? { agent: validAgent(r.agent)! } : {}) };
}
function validAgent(v: unknown): RouteAgent | null {
  const a = v as Partial<RouteAgent> | null;
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(a.id) || !Number.isSafeInteger(a.version) || (a.version as number) < 0
    || !['orchestrator', 'parent', 'app'].includes(String(a.chosenBy))) return null;
  return { id: a.id, version: a.version as number, chosenBy: a.chosenBy as RouteAgent['chosenBy'], ...((MODEL_TIERS as readonly unknown[]).includes(a.tier) ? { tier: a.tier } : {}),
    ...(a.modelFrom === 'role' || a.modelFrom === 'tier' || a.modelFrom === 'table' || a.modelFrom === 'engine' ? { modelFrom: a.modelFrom } : {}) };
}

// ── the shared ledger (ops/state/improve/outcomes.jsonl) ────────────────────────────────────────────────────────────
export interface RoutingPrediction {
  id: string; at: number; domain: 'routing';
  item: { harness: Harness; model: string | null; effort: Effort | null; area: string; kind: TaskKind; promptChars: number | null };
  predicted: { policy: 'routing'; version: number | null; value: { harness: Harness; model: string | null; effort: Effort | null; source: RouteDecision['source']; reason: string | null } };
}
export interface RoutingActual {
  id: string; domain: 'routing';
  actual: { usd: number; minutes: number | null; turns: number; ctxPeak: number | null; handoffs: number };
  /** measured = the app only measured (the brain's loop settles success); a known outcome = an agent run's verdict
   *  (the user's, a reviewed one, the Orchestrator's opinion: issue #72), carried on every later line of the same id */
  outcome: { known: false; source: 'measured' } | KnownOutcome;
}
export interface KnownOutcome { known: true; success: boolean; partial?: true; source: 'agent-user' | 'agent-review' | 'agent-orchestrator'; runId: string; at: number }

/** An agent run's verdict as a known outcome of its chat's ledger line; null = no verdict that counts (unknown, a self
 *  report, a one-shot). */
export function knownOutcome(run: { runId: string; outcome?: { verdict: string; basis: string; at: number } }): KnownOutcome | null {
  const o = run.outcome;
  if (!o || !['success', 'partial', 'fail'].includes(o.verdict)) return null;
  const source = o.basis === 'human' ? 'agent-user' : o.basis === 'reviewed-evidence' ? 'agent-review' : o.basis === 'orchestrator-opinion' ? 'agent-orchestrator' : null;
  if (!source) return null;
  return { known: true, success: o.verdict === 'success', ...(o.verdict === 'partial' ? { partial: true as const } : {}), source, runId: run.runId, at: o.at };
}

/** The known-outcome sources that count as verified (ADR 0095): the user's verdict (the brain's 'human', the app's
 *  'agent-user'), a reviewed one (an independent review's 'agent-review', the brain's sample judge 'judge', ADR 0047). The rest
 *  (the brain's 'proxy' = closed without an error line, the Orchestrator's opinion, a source not named) is known but
 *  unverified: shown apart, never in "verificati". */
export const VERIFIED_OUTCOME_SOURCES: readonly string[] = ['human', 'agent-user', 'agent-review', 'judge'];
/** A ledger line's known outcome, as the readers fold it. */
export interface LedgerOutcome { success: boolean; verified: boolean; source: string }
/** What one ledger line says about its id's outcome: a known outcome; 'clear' (an explicit `known: false` that is not a
 *  measured line: a retraction); or null (nothing: no outcome, or a measured line, which never undoes a known outcome,
 *  ADR 0078). Tolerant of the brain's lines: `known` may be left out when `success` is a boolean, `basis` may name the
 *  source. */
export function lineOutcome(o: unknown): LedgerOutcome | 'clear' | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as { known?: unknown; success?: unknown; source?: unknown; basis?: unknown };
  const source = typeof x.source === 'string' ? x.source : typeof x.basis === 'string' ? x.basis : '';
  if (x.known === false) return source === 'measured' || source === '' ? null : 'clear';
  if ((x.known === true || x.known === undefined) && typeof x.success === 'boolean') return { success: x.success, verified: VERIFIED_OUTCOME_SOURCES.includes(source), source };
  return null;
}
/** Later line wins, except that an unverified outcome never replaces a verified one (ADR 0047: an explicit verdict
 *  beats the judge, the judge beats the proxy) and a measured line changes nothing. */
export function foldOutcome(map: Map<string, LedgerOutcome>, id: string, o: unknown): void {
  const next = lineOutcome(o);
  if (next === 'clear') { map.delete(id); return; }
  if (!next) return;
  const prev = map.get(id);
  if (prev?.verified && !next.verified) return;
  map.set(id, next);
}

const verifiedOutcome = (o: { source?: string } | undefined): boolean => !!o && VERIFIED_OUTCOME_SOURCES.includes(String(o.source ?? (o as { basis?: string }).basis ?? ''));

/** The prediction line of a routed chat (written once, at its first turn end, with `at` = when it was routed). */
export function predictionLine(route: RouteDecision, chat: { id: string; harness: Harness; model: string | null; effort: Effort | null; promptChars: number | null }): RoutingPrediction {
  return {
    id: chat.id, at: route.at, domain: 'routing',
    item: { harness: chat.harness, model: chat.model, effort: chat.effort, area: route.area, kind: route.kind, promptChars: chat.promptChars },
    predicted: { policy: 'routing', version: route.version, value: { harness: chat.harness, model: chat.model, effort: chat.effort, source: route.source, reason: route.reason } },
  };
}

// ── the files: the model registry and the ledger ────────────────────────────────────────────────────────────────────
export class Routing {
  private regCache: { file: string; mtime: number; reg: ModelRegistry | null } | null = null;

  constructor(private root: () => string | null) {}

  private dir(): string | null { const r = this.root(); return r ? path.join(r, 'ops', 'state', 'improve') : null; }

  /** harness/models.json, re-read only when it changes; null without a brain or the file. */
  registry(): ModelRegistry | null {
    const r = this.root();
    if (!r) return null;
    // a fresh brain has no table of its own: the release's (rules/tools.ts brainFile) until the owner adds one
    const f = brainFile(r, 'harness/models.json');
    if (!f) return null;
    let mtime: number;
    try { mtime = fs.statSync(f).mtimeMs; } catch { return null; }
    if (this.regCache?.mtime !== mtime || this.regCache.file !== f) {
      const j = readJson(f) as ModelRegistry | null;
      this.regCache = { file: f, mtime, reg: j && Array.isArray(j.models) ? j : null };
    }
    return this.regCache.reg;
  }

  /** The last measured actuals of a ledger id (later line wins), to carry totals across an app restart or a hand-off. */
  lastActual(id: string): RoutingActual['actual'] | null {
    const d = this.dir();
    if (!d) return null;
    let text: string;
    try { text = fs.readFileSync(path.join(d, 'outcomes.jsonl'), 'utf8'); } catch { return null; }
    const key = JSON.stringify(id);
    let last: RoutingActual['actual'] | null = null;
    for (const line of text.split('\n')) {
      if (!line.includes(key)) continue;
      try { const j = JSON.parse(line) as Partial<RoutingActual>; if (j.id === id && j.domain === 'routing' && j.actual) last = j.actual; } catch { /* a torn line */ }
    }
    return last;
  }

  /** Appends one line to the shared ledger; false without a brain (nothing is lost but this line). A measured line of an
   *  id that already has a known outcome carries that outcome (the same id = the later line wins: a verdict must not be
   *  undone by the next turn's actuals). */
  observe(rec: RoutingPrediction | RoutingActual): boolean {
    const d = this.dir();
    if (!d) return false;
    fs.mkdirSync(d, { recursive: true });
    let line = rec;
    if ('outcome' in rec) {
      const known = this.knownOutcomes(d);
      if (rec.outcome.known) known.set(rec.id, rec.outcome);
      else if (known.has(rec.id)) line = { ...rec, outcome: known.get(rec.id)! };
    }
    const f = path.join(d, 'outcomes.jsonl');
    fs.appendFileSync(f, `${JSON.stringify({ ...line, ts: Date.now() })}\n`);
    // our own line is not news: only another writer's (the brain's settlement) makes knownOutcomes read the file again
    if (this.known?.dir === d) try { this.known.size = fs.statSync(f).size; } catch { /* re-read next time */ }
    return true;
  }

  /** A verdict as a known outcome of a ledger id, with its last measured actuals (zeros before any turn ended). */
  observeOutcome(id: string, outcome: KnownOutcome): boolean {
    return this.observe({ id, domain: 'routing', outcome, actual: this.lastActual(id) ?? { usd: 0, minutes: null, turns: 0, ctxPeak: null, handoffs: 0 } });
  }

  private known: { dir: string; size: number; map: Map<string, KnownOutcome> } | null = null;
  /** The known outcomes of the ledger by id, carried by the next measured line. Read again whenever the file grew by
   *  someone else's lines (the brain's loop settles outcomes into the same file, ADR 0047): with a stale copy the next
   *  turn's measured line would say `known: false` after the brain's verdict (issue #110). */
  private knownOutcomes(d: string): Map<string, KnownOutcome> {
    const f = path.join(d, 'outcomes.jsonl');
    let size = 0;
    try { size = fs.statSync(f).size; } catch { /* none yet */ }
    if (this.known?.dir === d && this.known.size === size) return this.known.map;
    const map = new Map<string, KnownOutcome>();
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { /* none yet */ }
    for (const line of text.split('\n')) {
      if (!line.includes('"known"') && !line.includes('"success"')) continue;
      try {
        const j = JSON.parse(line) as Partial<RoutingActual> & { domain?: unknown; outcome?: Record<string, unknown> };
        if ((j.domain !== 'routing' && j.domain !== undefined) || typeof j.id !== 'string' || !j.outcome) continue;
        const o = lineOutcome(j.outcome);
        if (o === 'clear') map.delete(j.id);
        else if (o && !(o.verified === false && verifiedOutcome(map.get(j.id)))) map.set(j.id, { ...(j.outcome as unknown as KnownOutcome), known: true });
      } catch { /* a torn line */ }
    }
    this.known = { dir: d, size, map };
    return map;
  }
}
