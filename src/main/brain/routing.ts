// Model routing: which harness, model and effort a chat opened by an agent gets (the user, 2026-10-13: "la Regia sceglie
// modello e sforzo per tipo di lavoro, tracciato e migliorato nel tempo, configurabile"; any engine of the registry,
// engines/registry.ts, asked by its caps: ADR 0046). The brain owns the data: the model registry and price table (harness/models.json)
// and the versioned routing table (ops/state/improve/routing/v<N>.json + current.json, every change a new version +
// a line in ops/state/improve/audit.jsonl), the same files the brain's ops/tools/routing.mjs reads; this module mirrors
// its rules (match, resolve, check) so app_create_chat decides at zero tokens and in-process. It also appends the
// routing predictions and their measured actuals to the shared ledger of the improvement loop
// (ops/state/improve/outcomes.jsonl, append-only, same id = later line wins). Routed only at chat creation: switching
// mid-chat restarts the prompt cache. With the table's `exploration` rate a chat may try a little-sampled arm
// instead (source 'explore'), so the loop can compare arms; never on a row the user locked («L'AI può cambiarla» off),
// which no agent may change either (agentLimits). Used by brain/index.ts (routing:get/save), appctl/tools.ts and wiring.ts. ADR 0032.
import fs from 'node:fs';
import path from 'node:path';
import type { Effort, Harness, ModelRegistry, RegistryModel, RouteDecision, RoutingChange, RoutingInfo, RoutingRow, RoutingTable, TaskKind } from '../../shared/contract';
import { TASK_KINDS } from '../../shared/contract';
import { areaOf } from './brain-estimates';
import { log } from '../log';
import { engineLabel, engineOf } from '../engines/registry';

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** the areas of the chats on the app itself: only on the engine of the registry's appChats model (the user's rule,
 *  harness/models.md) */
export const APP_AREAS = ['App', 'Pers · App'];

const readJson = (f: string): unknown => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) as unknown; } catch { return null; } };
/** Temp file + rename. On Windows the rename can fail for a moment (EPERM/EBUSY while an antivirus or the indexer
 *  holds the file, seen under the full test run): retry briefly, then write the file directly (as config.ts). */
const writeAtomic = (f: string, text: string): void => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, f); return; } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1));
    }
  }
  fs.writeFileSync(f, text);
  try { fs.unlinkSync(tmp); } catch { /* left behind: harmless */ }
};
const areasOf = (r: Pick<RoutingRow, 'area'>): string[] | null => (r.area === undefined || r.area === null ? null : Array.isArray(r.area) ? r.area : [r.area]);
const isApp = (area: string): boolean => APP_AREAS.includes(area);
/** A chat on the app itself: of the "Migliora l'app" space, or titled in an app area ("App · …", "Pers · App: …").
 *  Its queued work waits behind the other chats' (ADR 0036; chats/manager.ts). */
export const isAppChat = (title: string, space?: string): boolean => space === 'app' || isApp(areaOf(title, undefined));

// ── the registry ────────────────────────────────────────────────────────────────────────────────────────────────────
const bare = (m: string): string => m.toLowerCase().trim().replace(/\[.*\]$/, '').replace(/-\d{8}$/, '');
/** The registry row of a model id or alias ("opus", "claude-opus-5-5[1m]", "claude-haiku-4-5-20251001"); null = unknown. */
export function modelRow(model: string | null | undefined, reg: ModelRegistry | null): RegistryModel | null {
  if (!model || !reg) return null;
  const id = bare(model);
  return reg.models.find(r => r.id === id) ?? reg.models.find(r => (r.aliases ?? []).includes(id)) ?? reg.models.find(r => r.id === `claude-${id}`) ?? null;
}
const harnessAuto = (h: string, reg: ModelRegistry): boolean => reg.harnesses?.[h as Harness]?.routing === 'auto';
/** Fable: never from the table nor from exploration, whatever the registry says (the user, 2026-10-14: "non userei fable
 *  costa troppo"); only an agent's override with a reason, or the user, names it. */
export const isFable = (m: Pick<RegistryModel, 'id'> | null | undefined): boolean => !!m && /fable/i.test(m.id);
/** the engine the app's own chats run on: appChats's model's engine (Claude without one) */
const appEngine = (reg: ModelRegistry | null): Harness => modelRow(reg?.appChats?.model ?? null, reg)?.harness ?? 'claude';
const appRefusal = (reg: ModelRegistry | null): string => `le chat sull’app vanno solo su ${engineLabel(appEngine(reg))}`;
/** does the engine take an effort (Claude's thinking budget)? */
const takesEffort = (h: Harness): boolean => !!engineOf(h)?.caps.effort;
const looksClaude = (m: string | null): boolean => /\b(claude|opus|sonnet|haiku|fable|mythos)\b/i.test(String(m ?? '').replace(/[-_.]/g, ' '));

// ── task kind ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** accents off: \b does not see an accented letter as part of a word (the brain's estimates.mjs `plain`) */
const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
// A title that only names a topic ("Magazzino · Telemetria ordini": ops-read) loses to a prompt that asks to build
// or fix something: that chat writes code (2026-10-14: an implementation on two repos went to Haiku). Same rule and
// words as the brain's estimates.mjs taskOf.
const TOPIC_KINDS: readonly string[] = ['ops-read', 'research-web'];
const BUILD = /\b(implement\w*|pull request|(apri|aprire|apra|crea|creare|open) (la |una |a )?pr|refactor\w*)\b/i;
const FIX = /\b(fix\w*|hotfix|correggi\w*|corregger\w*|sistema (il|la|i|le) (bug|errore|crash))\b/i;
/** Task kind of a chat with the brain's rules (estimates.json `tasks`, from estimates.mjs TASKS): the title first, then
 *  the first prompt (which wins over a topic-only title when it builds or fixes); a Regia is its own kind; no rules or no
 *  match = 'altro'. */
export function taskOf(title: string, prompt: string, rules: [string, string, string][] | undefined): TaskKind {
  const t = String(title ?? '').trim();
  if (/^regia\b/i.test(t)) return 'regia';
  const word = (s: string): TaskKind | null => {
    for (const [k, src, flags] of rules ?? []) {
      try { if (new RegExp(src, flags).test(plain(s)) && (TASK_KINDS as readonly string[]).includes(k)) return k as TaskKind; } catch { /* a bad rule is skipped */ }
    }
    return null;
  };
  const k = word(t), p = plain(String(prompt ?? '').slice(0, 2000));
  if ((!k || TOPIC_KINDS.includes(k)) && (BUILD.test(p) || FIX.test(p))) return BUILD.test(p) ? 'app-feature' : 'bug-fix';
  return k ?? word(p) ?? 'altro';
}

// ── the table's rules ───────────────────────────────────────────────────────────────────────────────────────────────
/** Hard-rule errors of a table (Italian, one per broken rule); [] = valid. Same rules as routing.mjs check(). */
export function checkTable(routes: unknown, reg: ModelRegistry | null): string[] {
  if (!Array.isArray(routes)) return ['manca l’elenco delle righe'];
  if (!reg) return ['il cervello non ha harness/models.json: nessun modello da scegliere'];
  const errs: string[] = [];
  routes.forEach((x: unknown, i) => {
    const r = (x ?? {}) as Partial<RoutingRow>;
    const at = `riga ${i + 1}`;
    if (r.kind !== '*' && !(TASK_KINDS as readonly string[]).includes(String(r.kind))) errs.push(`${at}: tipo «${String(r.kind)}» sconosciuto`);
    const areas = areasOf(r as RoutingRow) ?? [];
    if (areas.some(a => typeof a !== 'string' || !a.trim())) errs.push(`${at}: area vuota`);
    // `area: []` matches no chat (match()) while the switches read it as "no area": never in a table
    if (Array.isArray(r.area) && !r.area.length) errs.push(`${at}: area vuota`);
    const m = modelRow(typeof r.model === 'string' ? r.model : null, reg);
    if (!m) { errs.push(`${at}: modello «${String(r.model)}» non è in harness/models.json`); return; }
    if (m.harness !== r.harness) errs.push(`${at}: ${m.id} gira solo su ${m.harness}, non su ${String(r.harness)}`);
    if (!harnessAuto(String(r.harness), reg) || m.routing !== 'auto') errs.push(`${at}: ${m.id} su ${String(r.harness)} è solo manuale (la tabella non lo sceglie da sola)`);
    if (isFable(m)) errs.push(`${at}: Fable mai dalla tabella (costa troppo)`);
    const ac = reg.appChats;
    if (ac && areas.some(isApp) && (modelRow(ac.model, reg) !== m || (r.effort ?? null) !== (ac.effort ?? null))) errs.push(`${at}: le chat sull’app vanno sempre su ${ac.model}${ac.effort ? ` ${ac.effort}` : ''} (altri modelli solo con l’esplorazione)`);
    if (r.harness !== appEngine(reg) && (areas.some(isApp) || !areas.length)) errs.push(`${at}: ${appRefusal(reg)}`);
    if (r.effort === 'max') errs.push(`${at}: sforzo max solo su richiesta, mai dalla tabella`);
    else if (r.effort && !(m.efforts ?? []).includes(r.effort)) errs.push(`${at}: ${m.id} non ha lo sforzo «${r.effort}»`);
  });
  // a row without an area reaches the app's chats too: a table with rows needs "any kind · each app area" (checked above
  // to be appChats), so no kind-only row ever routes them elsewhere
  const ac = reg.appChats;
  if (ac && routes.length && !APP_AREAS.every(a => routes.some((x: unknown) => { const r = (x ?? {}) as Partial<RoutingRow>; return r.kind === '*' && (areasOf(r as RoutingRow) ?? []).includes(a); })))
    errs.push(`manca la riga «qualsiasi tipo · ${APP_AREAS.join(', ')}» su ${ac.model}${ac.effort ? ` ${ac.effort}` : ''}: senza, le chat sull’app prenderebbero le righe per tipo`);
  return errs;
}

/** The exploration rate's error (Italian), null = valid or omitted: a number from 0 to 0.5 (routing.mjs check()). */
export function checkExploration(x: unknown): string | null {
  if (x === undefined) return null;
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 0.5 ? null : 'esplorazione: da 0 a 50%';
}

/** The cost weight's error (Italian), null = valid or omitted: 0 (only quality) to 10 (only cost); routing.mjs check(). */
export function checkCostWeight(x: unknown): string | null {
  if (x === undefined) return null;
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 10 ? null : 'peso del costo: da 0 a 10';
}
/** The user's λ until they set one (2026-10-14: 7 of 10). */
export const COST_WEIGHT = 7;

const rowKey = (r: Pick<RoutingRow, 'kind' | 'area'>): string => `${r.kind}|${[...(areasOf(r) ?? [])].sort().join(',')}`;
const rowName = (r: Pick<RoutingRow, 'kind' | 'area'>): string => `${r.kind === '*' ? 'qualsiasi tipo' : r.kind}${areasOf(r)?.length ? ` · ${areasOf(r)!.join(', ')}` : ''}`;
// A row the AI adds or moves must not take a locked row's chats either: a more specific row (area, kind and area) or an
// equally specific one placed before it would win match() for some of them. A row that already won them before may stay.
const rank = (r: RoutingRow): number => (areasOf(r)?.length ? 2 : 0) + (r.kind !== '*' ? 1 : 0);
const overlaps = (a: RoutingRow, b: RoutingRow): boolean => (a.kind === '*' || b.kind === '*' || a.kind === b.kind)
  && (!areasOf(a)?.length || !areasOf(b)?.length || areasOf(a)!.some(x => areasOf(b)!.includes(x)));
const beats = (list: RoutingRow[], n: RoutingRow, p: RoutingRow): boolean => overlaps(n, p) && (rank(n) > rank(p) || (rank(n) === rank(p) && list.indexOf(n) < list.indexOf(p)));
/** What an agent may not do to the table in force (the user, 2026-10-14: a switch per row «se lo disabilito blocca all'app
 *  la possibilità di modificare quel modello per quel task in autonomia»): change or remove a locked row, lock or unlock a
 *  row, change the cost weight (the user's λ); and an agent always writes each row's "perché" (the user may leave it out:
 *  "non deve essere richiesto il motivo… lo scrivi te non io", 2026-10-14; the brain's loop fills it). Italian errors;
 *  [] = allowed. Same rule as routing.mjs agentLimits(). */
export function agentLimits(prev: (Pick<RoutingTable, 'routes'> & { costWeight?: number }) | null, routes: RoutingRow[], costWeight?: number): string[] {
  const errs: string[] = [];
  const was = prev?.routes ?? [];
  for (const p of was.filter(r => r.locked === true)) {
    const n = routes.find(r => rowKey(r) === rowKey(p));
    if (!n) errs.push(`la riga «${rowName(p)}» è bloccata dall’utente: l’AI non la toglie`);
    else if (n.harness !== p.harness || n.model !== p.model || (n.effort ?? null) !== (p.effort ?? null) || n.locked !== true) errs.push(`la riga «${rowName(p)}» è bloccata dall’utente: l’AI non la cambia`);
  }
  for (const n of routes.filter(r => r.locked === true)) if (!was.some(p => p.locked === true && rowKey(p) === rowKey(n))) errs.push(`solo l’utente blocca una riga («${rowName(n)}»)`);
  for (const p of routes.filter(r => r.locked === true)) {
    const old = was.find(r => r.locked === true && rowKey(r) === rowKey(p));
    if (!old) continue;
    for (const n of routes) {
      // locked rows too: swapping two of them moves chats from one of the user's choices to the other
      if (n === p || !beats(routes, n, p)) continue;
      const o = was.find(r => rowKey(r) === rowKey(n));
      if (o && beats(was, o, old)) continue;
      errs.push(`la riga «${rowName(n)}» prenderebbe le chat della riga bloccata «${rowName(p)}»: l’AI non la mette`);
    }
  }
  if (costWeight !== undefined && costWeight !== (prev?.costWeight ?? COST_WEIGHT)) errs.push('il peso del costo lo decide l’utente');
  routes.forEach((r, i) => { if (typeof r.why !== 'string' || !r.why.trim()) errs.push(`riga ${i + 1}: manca il perché (l’AI lo scrive sempre)`); });
  return errs;
}

/** The row for a task: the most specific wins (kind and area > area > kind > '*'), ties go to the first; null = none. */
export function match(routes: RoutingRow[] | undefined, item: { kind: TaskKind; area: string }): RoutingRow | null {
  let best: RoutingRow | null = null, score = -1;
  for (const r of routes ?? []) {
    const areas = areasOf(r);
    if (r.kind !== '*' && r.kind !== item.kind) continue;
    if (areas && !areas.includes(item.area)) continue;
    // an area row beats a kind-only row: "App · any" keeps every app chat on its model (the user, 2026-10-14)
    const s = (areas ? 2 : 0) + (r.kind !== '*' ? 1 : 0);
    if (s > score) { best = r; score = s; }
  }
  return best;
}

export interface RouteAsk { harness?: Harness; model?: string; effort?: Effort; reason?: string }
/** The user's "Chat aperte dalla Regia": the engine, each engine's model ('' / null = the CLI's) and the Claude effort. */
export interface RouteDefaults { harness: Harness; models: Record<Harness, string | null>; effort: Effort | null }
export type Resolved = { harness: Harness; model: string | null; effort: Effort | null; source: RouteDecision['source']; reason: string | null } | { error: string };

/** Harness, model and effort of a new chat: the table's row, else the user's defaults (for the engine named, if any).
 *  Naming something other than a row says is an override and needs a reason; with no row, naming is free as before
 *  (still recorded as an override). Hard rules hold for everything an agent names; max only when asked, with a reason. */
export function resolve(table: Pick<RoutingTable, 'routes'> | null, item: { kind: TaskKind; area: string }, ask: RouteAsk, defaults: RouteDefaults, reg: ModelRegistry | null,
  canRun: (h: Harness) => boolean = () => true): Resolved {
  const row = match(table?.routes, item);
  // a row on a harness the app cannot start (api) or may not start now (engine off, Claude <-> Cursor off for this
  // Regia) is not usable: the defaults decide, as before the table
  const usable = row && engineOf(row.harness) && canRun(row.harness) ? row : null;
  const base = usable
    ? { harness: usable.harness as Harness, model: usable.model as string | null, effort: usable.effort ?? null }
    : { harness: defaults.harness, model: defaults.models[defaults.harness] || null, effort: takesEffort(defaults.harness) ? defaults.effort : null };
  const harness = ask.harness ?? base.harness;
  // a model belongs to its harness: switching harness takes that harness's default model, never the other one's
  const sameEngine = harness === base.harness;
  const model = ask.model ?? (sameEngine ? base.model : defaults.models[harness] || null);
  const m = modelRow(model, reg);
  let effort = ask.effort ?? (!takesEffort(harness) ? null : sameEngine ? base.effort : defaults.effort);
  // an effort nobody named that the chosen model lacks is dropped (the CLI's default), never an error
  if (!ask.effort && effort && m && !(m.efforts ?? []).includes(effort)) effort = null;
  if (model && m && m.harness !== harness) return { error: `${m.id} gira solo su ${m.harness}, non su ${harness}` };
  if (harness !== 'claude' && looksClaude(model)) return { error: 'un modello Claude gira solo sull’harness claude' };
  if (isApp(item.area) && harness !== appEngine(reg)) return { error: appRefusal(reg) };
  if (ask.model && harness === 'claude' && reg && !m) return { error: `modello «${ask.model}» non è in harness/models.json del cervello` };
  if (ask.effort && !takesEffort(harness)) return { error: `lo sforzo non vale per ${engineLabel(harness)}: scegli il modello` };
  if (effort && !EFFORTS.includes(effort)) return { error: `sforzo «${String(effort)}»: ${EFFORTS.join(' | ')}` };
  if (effort && m && !(m.efforts ?? []).includes(effort)) return { error: `${m.id} non ha lo sforzo «${effort}»` };
  const reason = String(ask.reason ?? '').trim();
  const said = ask.harness !== undefined || ask.model !== undefined || ask.effort !== undefined;
  // an alias of the row's model ("sonnet") is the same model
  const same = (a: string | null, b: string | null): boolean => (a ?? null) === (b ?? null) || (!!a && !!b && !!modelRow(a, reg) && modelRow(a, reg) === modelRow(b, reg));
  const changed = harness !== base.harness || !same(model, base.model) || (effort ?? null) !== (base.effort ?? null);
  if (ask.effort === 'max' && !reason) return { error: 'sforzo max solo quando l’utente lo chiede, con reason' };
  if (usable && said && changed && !reason) return { error: `override senza motivo: la tabella dice ${usable.model}${usable.effort ? ` (${usable.effort})` : ''} per questo lavoro; ometti harness/model/effort o dai reason` };
  const source = said && changed ? 'override' : usable ? 'table' : 'default';
  return { harness, model: model ?? null, effort: effort ?? null, source, reason: source === 'override' ? reason || null : usable?.why ?? null };
}

// ── exploration ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Samples an arm needs before the loop may judge it (the shared loop's minimum n per arm). */
export const EXPLORE_MIN = 20;
type Arm = { harness: Harness; model: string | null; effort: Effort | null };
/** The ledger key of an arm: harness, registry id of the model (an alias counts as its model), effort. */
export const armKey = (a: Arm, reg: ModelRegistry | null): string => `${a.harness}|${modelRow(a.model, reg)?.id ?? a.model ?? ''}|${a.effort ?? ''}`;

/** With probability `table.exploration` (0 to 0.5) a chat whose agent named nothing tries another arm, the one with the
 *  fewest samples for its kind among those under EXPLORE_MIN: so the loop gets data on arms the table never picks. Only
 *  auto models on the engine the chat gets anyway (an app chat stays on Claude, a work chat on Cursor stays on Cursor:
 *  exploring never spends the other engine's tokens; the user, 2026-10-14), if the caller may start it; never max, never
 *  a Regia (the user's own work), never the arm it would get anyway. null = no exploration this time. */
export function explore(table: Pick<RoutingTable, 'exploration'> | null, item: { kind: TaskKind; area: string }, base: Arm, reg: ModelRegistry | null,
  canRun: (h: Harness) => boolean, counts: (kind: TaskKind) => Map<string, number>, rnd: () => number = Math.random): (Arm & { samples: number }) | null {
  const rate = Math.min(Math.max(Number(table?.exploration) || 0, 0), 0.5);
  if (!reg || rate <= 0 || item.kind === 'regia' || rnd() >= rate) return null;
  const arms: Arm[] = [];
  for (const m of reg.models) {
    const h = m.harness;
    if (h !== base.harness || (isApp(item.area) && h !== appEngine(reg)) || !harnessAuto(h, reg) || m.routing !== 'auto' || isFable(m) || !canRun(h)) continue;
    const efforts = takesEffort(h) ? (m.efforts ?? []).filter(e => e !== 'max') : [];
    for (const effort of efforts.length ? efforts : [null]) arms.push({ harness: h, model: m.id, effort });
  }
  // an empty default is the CLI's own model and effort: the registry's default model and that model's default effort
  // (what the ledger records for such a chat), so the arm it would get anyway is still left out
  const dm = modelRow(reg.defaultModel, reg);
  const bm = base.model ? modelRow(base.model, reg) : dm?.harness === base.harness ? dm : null;
  const own = armKey({ harness: base.harness, model: bm?.id ?? base.model, effort: base.effort ?? (takesEffort(base.harness) ? bm?.defaultEffort ?? null : null) }, reg);
  const n = counts(item.kind);
  let best: (Arm & { samples: number }) | null = null;
  for (const a of arms) {
    const k = armKey(a, reg), c = n.get(k) ?? 0;
    if (k !== own && c < EXPLORE_MIN && (!best || c < best.samples)) best = { ...a, samples: c };
  }
  return best;
}

export interface RouteRequest {
  /** the chat's title ("Area · cosa"): its area and, with the prompt, its kind */
  title: string; prompt: string;
  /** the agent's own kind (app_create_chat `kind`); else the brain's rules on title and prompt */
  kind?: TaskKind;
  /** a chat of the "Migliora l'app" section is on the app whatever its title says */
  appSpace?: boolean;
  /** the caller's own area (a DevOps record's project or repo); else the title's label */
  area?: string;
  ask: RouteAsk; defaults: RouteDefaults;
  /** the engines this caller may start now (settings engines.*, Claude <-> Cursor messages) */
  canRun?: (h: Harness) => boolean;
  /** the ledger's samples per arm for a kind (Routing.armCounts) and the dice, for exploration; none = no exploration */
  counts?: (kind: TaskKind) => Map<string, number>;
  rnd?: () => number;
}
export type RouteResult = { harness: Harness; model: string | null; effort: Effort | null; route: RouteDecision } | { error: string };

/** Routes one chat: kind and area, then resolve() on the table in force. The brain's estimates rules travel in
 *  estimates.json (`kinds` for the area, `tasks` for the kind); without them every chat is 'altro'. */
export function routeChat(req: RouteRequest, table: RoutingTable | null, reg: ModelRegistry | null,
  rules: { kinds?: [string, string, string][]; tasks?: [string, string, string][] } | null, now = Date.now()): RouteResult {
  const kind = req.kind ?? taskOf(req.title, req.prompt, rules?.tasks);
  const area = req.appSpace ? 'App' : req.area?.trim().slice(0, 40) || areaOf(req.title, rules?.kinds);
  const r = resolve(table, { kind, area }, req.ask, req.defaults, reg, req.canRun);
  if ('error' in r) return r;
  const named = req.ask.harness !== undefined || req.ask.model !== undefined || req.ask.effort !== undefined;
  // a row the user locked keeps all its chats: exploration never tries another model there
  const x = !named && req.counts && !match(table?.routes, { kind, area })?.locked ? explore(table, { kind, area }, r, reg, req.canRun ?? (() => true), req.counts, req.rnd) : null;
  if (x) return { harness: x.harness, model: x.model, effort: x.effort,
    route: { policy: 'routing', version: table?.version ?? null, source: 'explore', reason: `esplorazione: ${x.samples} campioni su ${EXPLORE_MIN} per ${kind}`, kind, area, at: now } };
  return { harness: r.harness, model: r.model, effort: r.effort,
    route: { policy: 'routing', version: table?.version ?? null, source: r.source, reason: r.reason, kind, area, at: now } };
}

/** A route read back from chats.json (chats/store.ts): kept only when well formed. */
export function validRoute(v: unknown): RouteDecision | null {
  const r = v as Partial<RouteDecision> | null;
  if (!r || typeof r !== 'object' || r.policy !== 'routing' || !['table', 'default', 'override', 'explore'].includes(String(r.source))) return null;
  if (!(TASK_KINDS as readonly string[]).includes(String(r.kind)) || typeof r.area !== 'string' || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  return { policy: 'routing', version: Number.isInteger(r.version) ? r.version as number : null, source: r.source as RouteDecision['source'],
    reason: typeof r.reason === 'string' ? r.reason.slice(0, 300) : null, kind: r.kind as TaskKind, area: r.area.slice(0, 40), at: r.at,
    ...(typeof r.ledgerId === 'string' && /^app:[\w-]{1,80}$/.test(r.ledgerId) ? { ledgerId: r.ledgerId } : {}),
    ...(Number.isInteger(r.handoffs) && (r.handoffs as number) > 0 ? { handoffs: Math.min(r.handoffs as number, 1000) } : {}) };
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
  /** success needs the user's corrections and reopenings: the loop settles it; the app only measures */
  outcome: { known: false; source: 'measured' };
}

/** The prediction line of a routed chat (written once, at its first turn end, with `at` = when it was routed). */
export function predictionLine(route: RouteDecision, chat: { id: string; harness: Harness; model: string | null; effort: Effort | null; promptChars: number | null }): RoutingPrediction {
  return {
    id: chat.id, at: route.at, domain: 'routing',
    item: { harness: chat.harness, model: chat.model, effort: chat.effort, area: route.area, kind: route.kind, promptChars: chat.promptChars },
    predicted: { policy: 'routing', version: route.version, value: { harness: chat.harness, model: chat.model, effort: chat.effort, source: route.source, reason: route.reason } },
  };
}

/** Who saves: an agent's name starts with "agente:" (app_routing_save, routing.mjs save); the rest is the user. */
export const isAgent = (by: string): boolean => by.startsWith('agente');
export interface SaveOptions { exploration?: number; costWeight?: number; evidence?: string | null; base?: number }

// ── the files ───────────────────────────────────────────────────────────────────────────────────────────────────────
export class Routing {
  private regCache: { mtime: number; reg: ModelRegistry | null } | null = null;

  constructor(private root: () => string | null) {}

  private dir(): string | null { const r = this.root(); return r ? path.join(r, 'ops', 'state', 'improve') : null; }

  /** harness/models.json, re-read only when it changes; null without a brain or the file. */
  registry(): ModelRegistry | null {
    const r = this.root();
    if (!r) return null;
    const f = path.join(r, 'harness', 'models.json');
    let mtime: number;
    try { mtime = fs.statSync(f).mtimeMs; } catch { return null; }
    if (this.regCache?.mtime !== mtime) {
      const j = readJson(f) as ModelRegistry | null;
      this.regCache = { mtime, reg: j && Array.isArray(j.models) ? j : null };
    }
    return this.regCache.reg;
  }

  /** The table current.json points at, as stored (the editor shows it even when it breaks a rule). */
  stored(): RoutingTable | null {
    const d = this.dir();
    if (!d) return null;
    const c = readJson(path.join(d, 'routing', 'current.json')) as { version?: unknown; appliedAt?: unknown; by?: unknown } | null;
    const v = Number(c?.version);
    if (!Number.isInteger(v) || v < 1) return null;
    const t = readJson(path.join(d, 'routing', `v${v}.json`)) as { routes?: unknown; exploration?: unknown; costWeight?: unknown } | null;
    if (!t || !Array.isArray(t.routes)) return null;
    return { version: v, appliedAt: typeof c?.appliedAt === 'string' ? c.appliedAt : null, by: typeof c?.by === 'string' ? c.by : null,
      exploration: typeof t.exploration === 'number' ? t.exploration : 0, routes: t.routes as RoutingRow[],
      costWeight: typeof t.costWeight === 'number' ? t.costWeight : COST_WEIGHT };
  }

  /** The table in force: the stored one only when it keeps the hard rules (a file written by hand or by an agent is
   *  not trusted: max effort, a manual model…); else null and every chat gets the user's defaults. */
  table(): RoutingTable | null {
    const t = this.stored();
    if (!t) return null;
    const errors = checkTable(t.routes, this.registry());
    if (!errors.length) return t;
    if (this.warned !== t.version) {
      this.warned = t.version;
      log.warn('brain', 'routing table ignored: it breaks a hard rule', { cause: errors.join('; '), hint: 'fix it in Impostazioni → Instradamento modelli (a save writes a new valid version)' });
    }
    return null;
  }
  private warned: number | null = null;

  info(): RoutingInfo {
    const reg = this.registry();
    const t = this.stored();
    const broken = t ? checkTable(t.routes, reg) : [];
    return { table: t, registry: reg, kinds: TASK_KINDS, error: !this.root() ? 'nessun cervello collegato' : !reg ? 'il cervello non ha harness/models.json'
      : broken.length ? `tabella ignorata (decidono i default), infrange una regola: ${broken.join('; ')}` : null, history: this.history() };
  }

  /** The table's last changes (audit.jsonl, domain routing), newest first: who, when, why, with what data. */
  history(limit = 30): RoutingChange[] {
    const d = this.dir();
    if (!d) return [];
    let text: string;
    try { text = fs.readFileSync(path.join(d, 'audit.jsonl'), 'utf8'); } catch { return []; }
    const out: RoutingChange[] = [];
    for (const line of text.split('\n')) {
      if (!line.includes('"routing"')) continue;
      try {
        const j = JSON.parse(line) as Partial<RoutingChange> & { domain?: unknown };
        if (j.domain !== 'routing' || !Number.isInteger(j.to) || typeof j.at !== 'string') continue;
        const x = j.exploration as { from?: unknown; to?: unknown } | undefined, cw = j.costWeight as { from?: unknown; to?: unknown } | undefined;
        out.push({ at: j.at, from: Number.isInteger(j.from) ? j.from! : null, to: j.to!, by: typeof j.by === 'string' ? j.by.slice(0, 120) : '?',
          reason: typeof j.reason === 'string' ? j.reason.slice(0, 300) : null, evidence: typeof j.evidence === 'string' ? j.evidence.slice(0, 300) : null,
          ...(x && typeof x.from === 'number' && typeof x.to === 'number' ? { exploration: { from: x.from, to: x.to } } : {}),
          ...(cw && typeof cw.from === 'number' && typeof cw.to === 'number' ? { costWeight: { from: cw.from, to: cw.to } } : {}),
          stored: fs.existsSync(path.join(d, 'routing', `v${j.to}.json`)) });
      } catch { /* a torn line */ }
    }
    return out.reverse().slice(0, limit);
  }

  /** An older version back in force: a new version with its rows and exploration (and, by the user, its cost weight),
   *  checked against today's rules (one that breaks one now, e.g. a Fable row, or an agent touching a locked row, is
   *  refused); history stays linear. */
  restore(version: number, by: string, now = Date.now()): RoutingInfo {
    const d = this.dir();
    if (!d) throw new Error('nessun cervello collegato');
    const t = Number.isInteger(version) && version > 0 ? readJson(path.join(d, 'routing', `v${version}.json`)) as { routes?: unknown; exploration?: unknown; costWeight?: unknown } | null : null;
    if (!t || !Array.isArray(t.routes)) throw new Error(`versione ${version} non trovata`);
    const cw = !isAgent(by) ? (typeof t.costWeight === 'number' ? t.costWeight : COST_WEIGHT) : undefined;
    return this.save(t.routes as RoutingRow[], by, `ripristino della versione ${version}`, now, { exploration: typeof t.exploration === 'number' ? t.exploration : 0, costWeight: cw });
  }

  /** The next version: one above the highest v<N>.json on disk (a rollback moves only current.json: never overwrite). */
  private nextVersion(d: string): number {
    let max = 0;
    try { for (const f of fs.readdirSync(path.join(d, 'routing'))) { const m = /^v(\d+)\.json$/.exec(f); if (m) max = Math.max(max, Number(m[1])); } } catch { /* no folder yet */ }
    return max + 1;
  }

  /** A new version, from the user's page or an agent (`by` says who; an agent gives its reason and the data behind it,
   *  `evidence`): refused (throws, Italian) when it breaks a hard rule; one audit line. `exploration` (0 to 0.5) is
   *  saved the same way, and the cost weight (0 to 10, the user's only); omitted = the version in force keeps its own.
   *  `base` = the version the edit started from: another version in force since then refuses the save (no silent
   *  overwrite). An agent (`by` "agente: …") never touches a locked row nor the cost weight (agentLimits). */
  save(routes: RoutingRow[], by: string, reason: string | null, now = Date.now(), o: SaveOptions = {}): RoutingInfo {
    const { exploration, costWeight, evidence, base } = o;
    const d = this.dir();
    if (!d) throw new Error('nessun cervello collegato');
    // two writers (the user's page, agents) send the whole table: one built on an older version would undo the other's change
    const inForce = this.stored()?.version ?? 0;
    if (base !== undefined && base !== inForce) throw new Error(`tabella non salvata: è cambiata (ora versione ${inForce}, la tua modifica parte dalla ${base}): ricarica e rifai la modifica`);
    const xErr = checkExploration(exploration) ?? checkCostWeight(costWeight);
    if (xErr) throw new Error(`tabella non salvata: ${xErr}`);
    const clean = Array.isArray(routes) ? routes.map(r => ({
      kind: r.kind, ...(areasOf(r)?.length ? { area: areasOf(r)!.length === 1 ? areasOf(r)![0]! : areasOf(r)! } : {}),
      harness: r.harness, model: String(r.model ?? '').trim(), effort: r.effort || null,
      why: String(r.why ?? '').trim().slice(0, 300), since: String(r.since ?? '').trim().slice(0, 20) || new Date(now).toISOString().slice(0, 10),
      evidence: String(r.evidence ?? '').trim().slice(0, 300) || evidence?.trim().slice(0, 300) || (by.startsWith('utente') ? 'scelta dell’utente (Impostazioni)' : by),
      ...(r.locked === true ? { locked: true } : {}),
    })) : routes;
    const errors = [...checkTable(clean, this.registry()), ...(isAgent(by) && Array.isArray(clean) ? agentLimits(this.stored(), clean, costWeight) : [])];
    if (errors.length) throw new Error(`tabella non salvata: ${errors.join('; ')}`);
    const was = this.stored();
    const version = this.nextVersion(d);
    const before = was?.exploration ?? 0, x = exploration === undefined ? before : Math.round(exploration * 100) / 100;
    const cwBefore = was?.costWeight ?? COST_WEIGHT, cw = costWeight === undefined ? cwBefore : Math.round(costWeight * 10) / 10;
    writeAtomic(path.join(d, 'routing', `v${version}.json`), `${JSON.stringify({ version, exploration: x, costWeight: cw, routes: clean }, null, 1)}\n`);
    writeAtomic(path.join(d, 'routing', 'current.json'), `${JSON.stringify({ version, appliedAt: new Date(now).toISOString(), by })}\n`);
    fs.appendFileSync(path.join(d, 'audit.jsonl'), `${JSON.stringify({ at: new Date(now).toISOString(), domain: 'routing', from: was?.version ?? null, to: version, by, reason,
      ...(evidence ? { evidence: evidence.slice(0, 300) } : {}), ...(x !== before ? { exploration: { from: before, to: x } } : {}),
      ...(cw !== cwBefore ? { costWeight: { from: cwBefore, to: cw } } : {}) })}\n`);
    return this.info();
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

  /** Samples per arm (armKey) of one task kind: the routing predictions of the app's chats in the shared ledger, one per job. */
  armCounts(kind: TaskKind): Map<string, number> {
    const out = new Map<string, number>();
    const d = this.dir();
    if (!d) return out;
    let text: string;
    try { text = fs.readFileSync(path.join(d, 'outcomes.jsonl'), 'utf8'); } catch { return out; }
    const reg = this.registry(), seen = new Set<string>();
    for (const line of text.split('\n')) {
      if (!line.includes('"predicted"') || !line.includes('"routing"')) continue;
      try {
        const j = JSON.parse(line) as Partial<RoutingPrediction>;
        // only the app's chats (app:<chat id>): other lines of the routing domain (the brain's sub-agent lines, sub:…)
        // measure another unit of work and never count as a chat's sample
        if (j.domain !== 'routing' || !j.item || j.item.kind !== kind || !j.predicted || typeof j.id !== 'string' || !j.id.startsWith('app:') || seen.has(j.id)) continue;
        seen.add(j.id);
        const k = armKey(j.item, reg);
        out.set(k, (out.get(k) ?? 0) + 1);
      } catch { /* a torn line */ }
    }
    return out;
  }

  /** Appends one line to the shared ledger; false without a brain (nothing is lost but this line). */
  observe(rec: RoutingPrediction | RoutingActual): boolean {
    const d = this.dir();
    if (!d) return false;
    fs.mkdirSync(d, { recursive: true });
    fs.appendFileSync(path.join(d, 'outcomes.jsonl'), `${JSON.stringify({ ...rec, ts: Date.now() })}\n`);
    return true;
  }
}
