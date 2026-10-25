// Strict flow definition validation and canonical hashing; the host rejects unknown executable fields.
import { validatePackage, validatePackagedSteps } from './package';
import { createHash } from 'node:crypto';
import type { FlowDefinition, FlowParam, FlowScope, FlowStep } from '../../shared/flows';
import type { Effort } from '../../shared/contract';
import { MODEL_TIERS, WORK_ROLE_IDS, tierRank, type ModelTier, type WorkRoleId } from '../../shared/roles';

export const BUILTIN_CHECKS = ['scope-present', 'inputs-present'] as const;
/** Host execution adapters remain limited by the exact user-approved automation grant. */
export const DEVOPS_WRITE_ADAPTER = 'devops-write';
export const TEST_DB_READ_ADAPTER = 'test-db-read';
export const testDbAdapted = (step: FlowStep): boolean => (step.testDbRead === true || step.adapter === TEST_DB_READ_ADAPTER) && step.kind === 'agent' && !step.action && (step.effect === 'read-only' || adapted(step));
/** A step that runs a saved brain script or query, pinned by content hash (ADR 0155): the runner executes it in test,
 *  never in prod (the user's «Esegui»). */
export const commandStep = (step: FlowStep): boolean => step.kind === 'check' && (step.action?.kind === 'script' || step.action?.kind === 'query') && !!step.action.hash;
export const PARAM_TYPES = ['string', 'int', 'list', 'file', 'enum', 'env'] as const;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const PLACEHOLDER = /\{\{\s*([a-z0-9][a-z0-9._:-]{0,100})\s*\}\}/gi;
/** The {{names}} a step's args reference. */
export const placeholders = (value: string): string[] => [...value.matchAll(PLACEHOLDER)].map(m => m[1]!.toLowerCase());
/** An external-write step the host can run: it declares the adapter; production and non-builtin actions never qualify. */
export const adapted = (step: FlowStep): boolean => step.effect === 'external-write' && step.adapter === DEVOPS_WRITE_ADAPTER && step.kind === 'agent' && !step.action;
const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label}: unknown field`);
}
export function text(value: unknown, label: string, max = 4000, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000]/u.test(value)) throw new Error(`${label}: invalid text`);
  return value.trim();
}
export function identifier(value: unknown, label: string): string {
  const result = text(value, label, 80); if (!ID.test(result)) throw new Error(`${label}: invalid identifier`); return result;
}
export function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${label}: invalid integer`);
  return value as number;
}
function strings(value: unknown, label: string, max: number, itemMax = 4000): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}: invalid list`);
  const values = value.map((v: unknown) => text(v, label, itemMax));
  if (new Set(values).size !== values.length) throw new Error(`${label}: duplicate value`);
  return values;
}
export function validateScope(value: unknown): FlowScope {
  const raw = object(value, 'scope'); keys(raw, ['project', 'areaPath'], 'scope');
  return { ...(raw.project === undefined ? {} : { project: text(raw.project, 'project', 300) }),
    ...(raw.areaPath === undefined ? {} : { areaPath: text(raw.areaPath, 'areaPath', 1000) }) };
}
export function validateInputs(value: unknown): Record<string, string> {
  const raw = object(value, 'inputs'); if (Object.keys(raw).length > 100) throw new Error('Too many inputs');
  return Object.fromEntries(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [identifier(key, 'input name'), text(value, 'input value', 16000, true)]));
}
/** The highest tier a role may run now (the catalog's tierMax); given on propose so a step never asks above it. */
export type RoleTierMax = (role: WorkRoleId) => ModelTier | undefined;
export function validateDefinition(value: unknown, tierMax?: RoleTierMax): FlowDefinition {
  const raw = object(value, 'definition'); keys(raw, ['id', 'title', 'description', 'category', 'aliases', 'scope', 'steps', 'params', 'package'], 'definition');
  if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 60) throw new Error('A flow needs 1–60 steps');
  const ids: string[] = [];
  const steps: FlowStep[] = raw.steps.map((value: unknown) => {
    const row = object(value, 'step'); keys(row, ['id', 'title', 'kind', 'instructions', 'inputs', 'action', 'evidence', 'timeoutMs', 'maxAttempts', 'effect', 'reviewOf', 'workspaceInput', 'adapter', 'testDbRead', 'role', 'tier', 'engine', 'model', 'effort', 'onFail', 'env', 'args', 'agentPrompt', 'assets'], 'step');
    const id = identifier(row.id, 'step id'); if (ids.includes(id)) throw new Error('Duplicate step id');
    const kind = text(row.kind, 'kind') as FlowStep['kind']; if (!['check', 'agent', 'approval', 'manual'].includes(kind)) throw new Error('Unknown step kind');
    const effect = text(row.effect, 'effect') as FlowStep['effect']; if (!['read-only', 'code', 'external-write', 'production'].includes(effect)) throw new Error('Unknown effect');
    const inputs = strings(row.inputs, 'step inputs', 30, 80); inputs.forEach(v => identifier(v, 'input'));
    const workspaceInput = row.workspaceInput === undefined ? undefined : identifier(row.workspaceInput, 'workspaceInput');
    if (kind === 'agent' && (!workspaceInput || !inputs.includes(workspaceInput))) throw new Error('Agent steps require a workspaceInput declared in inputs');
    if (workspaceInput && !inputs.includes(workspaceInput)) throw new Error('workspaceInput must reference a declared input');
    const evidence = strings(row.evidence, 'evidence', 30, 200);
    let action: FlowStep['action'];
    if (row.action !== undefined) {
      const a = object(row.action, 'action'); keys(a, ['kind', 'ref', 'hash'], 'action');
      const kind = text(a.kind, 'action kind') as NonNullable<FlowStep['action']>['kind'];
      if (!['builtin', 'script', 'query', 'action'].includes(kind)) throw new Error('Unknown action kind');
      const hash = a.hash === undefined ? undefined : text(a.hash, 'action hash', 64);
      if (hash !== undefined && (!/^[a-f0-9]{64}$/.test(hash) || !['script', 'query'].includes(kind))) throw new Error('action hash: the sha256 of a script or query');
      action = { kind, ref: identifier(a.ref, 'action ref'), ...(hash ? { hash } : {}) };
    }
    if (kind === 'check' && !action) throw new Error('Checks require an explicit action reference');
    if (action?.kind === 'builtin' && (kind !== 'check' || effect !== 'read-only' || !BUILTIN_CHECKS.includes(action.ref as typeof BUILTIN_CHECKS[number]))) throw new Error('Unknown or unsafe builtin');
    if (action?.kind === 'builtin' && evidence.some(label => label !== 'metadata')) throw new Error('Builtin checks can certify metadata evidence only');
    if (row.adapter !== undefined && (kind !== 'agent' || action || !((row.adapter === DEVOPS_WRITE_ADAPTER && effect === 'external-write') || (row.adapter === TEST_DB_READ_ADAPTER && effect === 'read-only')))) throw new Error('Adapters require an agent step without action: devops-write is external-write; test-db-read is read-only');
    if (row.testDbRead !== undefined && (row.testDbRead !== true || kind !== 'agent' || action || !(effect === 'read-only' || (effect === 'external-write' && row.adapter === DEVOPS_WRITE_ADAPTER)))) throw new Error('testDbRead requires a read-only agent or a DevOps write agent, without action');
    let reviewOf: string | undefined;
    if (row.reviewOf !== undefined) {
      reviewOf = identifier(row.reviewOf, 'reviewOf');
      if (kind !== 'agent' || !ids.includes(reviewOf) || (raw.steps as Record<string, unknown>[]).find(s => s.id === reviewOf)?.kind !== 'agent') throw new Error('Review must reference an earlier agent step');
    }
    const role = row.role === undefined ? undefined : text(row.role, 'role', 40) as WorkRoleId;
    if (role !== undefined && (!(WORK_ROLE_IDS as readonly string[]).includes(role) || kind !== 'agent')) throw new Error('role: one of strategist|scout|artisan|sentinel|herald, on an agent step only');
    const tier = row.tier === undefined ? undefined : text(row.tier, 'tier', 10) as ModelTier;
    if (tier !== undefined && (!(MODEL_TIERS as readonly string[]).includes(tier) || !role)) throw new Error('tier: one of light|mid|top, on a step that declares its role');
    if (reviewOf && role && role !== 'sentinel') throw new Error('A review step runs as sentinel');
    const max = role && tier && tierMax ? tierMax(role) : undefined;
    if (role && tier && tierMax && (!max || tierRank(tier) > tierRank(max))) throw new Error(`tier ${tier} exceeds the ${role} role's maximum (${max ?? 'unknown role'})`);
    const engine = row.engine === undefined ? undefined : text(row.engine, 'engine', 31);
    if (engine !== undefined && (!/^[a-z][a-z0-9-]{0,30}$/.test(engine) || !role)) throw new Error('engine: an engine id, on a step that declares its role');
    const model = row.model === undefined ? undefined : text(row.model, 'model', 120);
    if (model !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,119}$/.test(model) || !role)) throw new Error('model: a model id, on a step that declares its role');
    const effort = row.effort === undefined ? undefined : text(row.effort, 'effort', 10) as Effort;
    if (effort !== undefined && (!EFFORTS.includes(effort) || !role)) throw new Error('effort: low|medium|high|xhigh|max, on a step that declares its role');
    let onFail: FlowStep['onFail'];
    if (row.onFail !== undefined) {
      const o = object(row.onFail, 'onFail'); keys(o, ['goto'], 'onFail');
      const goto = identifier(o.goto, 'onFail goto');
      if (!ids.includes(goto)) throw new Error('onFail goto must name an earlier step');
      onFail = { goto };
    }
    const env = row.env === undefined ? undefined : text(row.env, 'env', 4) as 'test' | 'prod';
    if (env !== undefined && (!['test', 'prod'].includes(env) || !action || !['script', 'query'].includes(action.kind))) throw new Error('env: test|prod, on a script or query step');
    if (env === 'prod' && effect !== 'production') throw new Error('A prod step has the production effect');
    // either one makes a script/query step prod: it then waits for the user's «Esegui» (ADR 0155)
    if (effect === 'production' && action && ['script', 'query'].includes(action.kind) && env !== 'prod') throw new Error('A script or query step with the production effect declares env: prod');
    if (action && ['script', 'query'].includes(action.kind) && action.hash && kind !== 'check') throw new Error('A pinned script or query runs as a check step');
    let args: Record<string, string> | undefined;
    if (row.args !== undefined) {
      const a = object(row.args, 'args'); if (Object.keys(a).length > 30 || !action || !['script', 'query'].includes(action.kind)) throw new Error('args: up to 30, on a script or query step');
      args = Object.fromEntries(Object.entries(a).sort(([x], [y]) => x.localeCompare(y)).map(([key, value]) => {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(key)) throw new Error('args: invalid name');
        return [key, text(value, 'arg value', 1000, true)];
      }));
      // a query's target is part of what the user approved: never filled from a run input
      if (action!.kind === 'query' && ['server', 'database'].some(key => args![key]?.includes('{{'))) throw new Error('A query names its server and database literally, never as {{input}}');
    }
    ids.push(id);
    return { ...(row.agentPrompt === undefined ? {} : { agentPrompt: text(row.agentPrompt, 'agentPrompt', 64000) }), ...(row.assets === undefined ? {} : { assets: strings(row.assets, 'assets', 50, 80).map(v => identifier(v, 'asset id')) }), id, title: text(row.title, 'step title', 300), kind, instructions: text(row.instructions, 'instructions', 16000), inputs,
      ...(action ? { action } : {}), ...(workspaceInput ? { workspaceInput } : {}), evidence, timeoutMs: integer(row.timeoutMs, 'timeoutMs', 1000, 86_400_000), maxAttempts: integer(row.maxAttempts, 'maxAttempts', 1, 5), effect, ...(reviewOf ? { reviewOf } : {}), ...(row.adapter ? { adapter: row.adapter as FlowStep['adapter'] } : {}), ...(row.testDbRead === true ? { testDbRead: true as const } : {}), ...(role ? { role } : {}), ...(tier ? { tier } : {}),
      ...(engine ? { engine } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(onFail ? { onFail } : {}), ...(env ? { env } : {}), ...(args ? { args } : {}) };
  });
  const pack = raw.package === undefined ? undefined : validatePackage(raw.package);
  if (pack) validatePackagedSteps(steps, pack);
  else if (steps.some(step => step.agentPrompt || step.assets)) throw new Error('Frozen prompts/assets require a package');
  const params = raw.params === undefined ? undefined : validateParams(raw.params);
  const aliases = strings(raw.aliases, 'aliases', 40, 200);
  if (aliases.some(alias => !normalize(alias))) throw new Error('Aliases need at least one letter or number');
  return { id: identifier(raw.id, 'flow id'), title: text(raw.title, 'title', 300), description: text(raw.description, 'description', 16000),
    ...(raw.category === undefined ? {} : { category: text(raw.category, 'category', 200) }), aliases, scope: validateScope(raw.scope), steps, ...(params ? { params } : {}), ...(pack ? { package: pack } : {}) };
}
function validateParams(value: unknown): FlowParam[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('params: up to 30');
  const names = new Set<string>();
  return value.map((v: unknown) => {
    const p = object(v, 'param'); keys(p, ['name', 'label', 'type', 'options', 'required', 'default'], 'param');
    const name = identifier(p.name, 'param name'); if (names.has(name)) throw new Error('Duplicate param'); names.add(name);
    const type = text(p.type, 'param type', 10) as FlowParam['type'];
    if (!(PARAM_TYPES as readonly string[]).includes(type)) throw new Error('param type: string|int|list|file|enum|env');
    const options = p.options === undefined ? undefined : strings(p.options, 'param options', 50, 200);
    if (type === 'enum' && !options?.length) throw new Error('An enum param lists its options');
    if (p.required !== undefined && typeof p.required !== 'boolean') throw new Error('param required: boolean');
    const fallback = p.default === undefined ? undefined : text(p.default, 'param default', 1000, true);
    return { name, type, ...(p.label === undefined ? {} : { label: text(p.label, 'param label', 200) }), ...(options ? { options } : {}),
      ...(p.required === undefined ? {} : { required: p.required as boolean }), ...(fallback === undefined ? {} : { default: fallback }) };
  });
}
/** Checks the values a start gives against the typed params; returns them normalized, or the problems in words. */
export function checkParams(params: readonly FlowParam[] | undefined, values: Record<string, string>, attachments: readonly string[] = []): { values: Record<string, string>; problems: string[] } {
  const out: Record<string, string> = {}, problems: string[] = [];
  for (const p of params ?? []) {
    const raw = (values[p.name] ?? p.default ?? '').trim(), label = p.label ?? p.name;
    if (!raw) { if (p.required) problems.push(`«${label}» è obbligatorio`); continue; }
    if (p.type === 'int' && !/^-?\d{1,15}$/.test(raw)) problems.push(`«${label}» deve essere un numero intero`);
    if (p.type === 'enum' && !p.options!.includes(raw)) problems.push(`«${label}» deve essere uno tra: ${p.options!.join(', ')}`);
    if (p.type === 'env' && !['test', 'prod'].includes(raw)) problems.push(`«${label}» deve essere test o prod`);
    if (p.type === 'file' && !attachments.includes(raw)) problems.push(`«${label}» deve nominare un allegato della run`);
    out[p.name] = p.type === 'list' ? raw.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).join('\n') : raw;
  }
  return { values: out, problems };
}
export function digest(definition: FlowDefinition): string { return createHash('sha256').update(JSON.stringify(validateDefinition(definition))).digest('hex'); }
export function normalize(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
export function inScope(required: FlowScope, actual: FlowScope): boolean {
  const area = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
  return (!required.project || required.project.normalize('NFKC').trim().toLowerCase() === (actual.project ?? '').normalize('NFKC').trim().toLowerCase())
    && (!required.areaPath || !!actual.areaPath && (area(actual.areaPath) === area(required.areaPath) || area(actual.areaPath).startsWith(`${area(required.areaPath)}/`)));
}
