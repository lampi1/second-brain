// Strict flow definition validation and canonical hashing; the host rejects unknown executable fields.
import { createHash } from 'node:crypto';
import type { FlowDefinition, FlowScope, FlowStep } from '../../shared/flows';
import { MODEL_TIERS, WORK_ROLE_IDS, tierRank, type ModelTier, type WorkRoleId } from '../../shared/roles';

export const BUILTIN_CHECKS = ['scope-present', 'inputs-present'] as const;
/** The only host execution adapter (ADR 0145): DevOps writes through the app, limited by the user-approved grant. */
export const DEVOPS_WRITE_ADAPTER = 'devops-write';
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
  const raw = object(value, 'definition'); keys(raw, ['id', 'title', 'description', 'category', 'aliases', 'scope', 'steps'], 'definition');
  if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 60) throw new Error('A flow needs 1–60 steps');
  const ids: string[] = [];
  const steps: FlowStep[] = raw.steps.map((value: unknown) => {
    const row = object(value, 'step'); keys(row, ['id', 'title', 'kind', 'instructions', 'inputs', 'action', 'evidence', 'timeoutMs', 'maxAttempts', 'effect', 'reviewOf', 'workspaceInput', 'adapter', 'role', 'tier'], 'step');
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
      const a = object(row.action, 'action'); keys(a, ['kind', 'ref'], 'action');
      const kind = text(a.kind, 'action kind') as NonNullable<FlowStep['action']>['kind'];
      if (!['builtin', 'script', 'query', 'action'].includes(kind)) throw new Error('Unknown action kind');
      action = { kind, ref: identifier(a.ref, 'action ref') };
    }
    if (kind === 'check' && !action) throw new Error('Checks require an explicit action reference');
    if (action?.kind === 'builtin' && (kind !== 'check' || effect !== 'read-only' || !BUILTIN_CHECKS.includes(action.ref as typeof BUILTIN_CHECKS[number]))) throw new Error('Unknown or unsafe builtin');
    if (action?.kind === 'builtin' && evidence.some(label => label !== 'metadata')) throw new Error('Builtin checks can certify metadata evidence only');
    if (row.adapter !== undefined && (row.adapter !== DEVOPS_WRITE_ADAPTER || kind !== 'agent' || effect !== 'external-write' || action)) throw new Error('The devops-write adapter fits only an external-write agent step without action');
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
    ids.push(id);
    return { id, title: text(row.title, 'step title', 300), kind, instructions: text(row.instructions, 'instructions', 16000), inputs,
      ...(action ? { action } : {}), ...(workspaceInput ? { workspaceInput } : {}), evidence, timeoutMs: integer(row.timeoutMs, 'timeoutMs', 1000, 86_400_000), maxAttempts: integer(row.maxAttempts, 'maxAttempts', 1, 5), effect, ...(reviewOf ? { reviewOf } : {}), ...(row.adapter ? { adapter: DEVOPS_WRITE_ADAPTER } : {}), ...(role ? { role } : {}), ...(tier ? { tier } : {}) };
  });
  const aliases = strings(raw.aliases, 'aliases', 40, 200);
  if (aliases.some(alias => !normalize(alias))) throw new Error('Aliases need at least one letter or number');
  return { id: identifier(raw.id, 'flow id'), title: text(raw.title, 'title', 300), description: text(raw.description, 'description', 16000),
    ...(raw.category === undefined ? {} : { category: text(raw.category, 'category', 200) }), aliases, scope: validateScope(raw.scope), steps };
}
export function digest(definition: FlowDefinition): string { return createHash('sha256').update(JSON.stringify(validateDefinition(definition))).digest('hex'); }
export function normalize(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
export function inScope(required: FlowScope, actual: FlowScope): boolean {
  const area = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
  return (!required.project || required.project.normalize('NFKC').trim().toLowerCase() === (actual.project ?? '').normalize('NFKC').trim().toLowerCase())
    && (!required.areaPath || !!actual.areaPath && (area(actual.areaPath) === area(required.areaPath) || area(actual.areaPath).startsWith(`${area(required.areaPath)}/`)));
}
