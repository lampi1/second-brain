// Immutable routine packages: validate all executable content at authoring time and materialize only approved bytes.
// Source paths are provenance, never runtime reads. Used by schema, runtime and portable exports.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FlowPackage, FlowStep } from '../../shared/flows';
import { identifier, integer, keys, object, text } from './schema';
import { DEVOPS_WRITE_OPS } from '../../shared/flow-automation';

export const packageHash = (content: string): string => createHash('sha256').update(content).digest('hex');
const hash = (v: unknown): string => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw new Error('Invalid package sha256'); return v; };
const list = (v: unknown, label: string): unknown[] => { if (!Array.isArray(v) || v.length > 50) throw new Error(`${label}: at most 50 entries`); return v; };
/** Conservative authoring diagnostic, not a filesystem sandbox. Provenance is deliberately excluded. */
export const brainReference = (s: string): boolean => /(?:\bbrain(?:-v\d+)?[/\\]|(?:^|[\s`"'])(?:rules|skills|memory)[/\\]|[A-Za-z]:[/\\][^\n]*\bbrain)/im.test(s);
export function validatePackage(value: unknown): FlowPackage {
  const p = object(value, 'package'); keys(p, ['schema', 'assets', 'outputs', 'requiredOps', 'history', 'intake', 'downgrade', 'production'], 'package');
  if (p.schema !== 1) throw new Error('Unsupported routine package schema');
  const assets = list(p.assets, 'assets').map(value => {
    const a = object(value, 'asset'); keys(a, ['id', 'kind', 'content', 'sha256', 'source'], 'asset');
    const id = identifier(a.id, 'asset id'), kind = text(a.kind, 'asset kind') as FlowPackage['assets'][number]['kind'];
    if (!['script', 'query', 'checklist', 'reference'].includes(kind)) throw new Error('Invalid asset kind');
    // Preserve whitespace: a script's hash must represent exactly the approved bytes.
    if (typeof a.content !== 'string' || Buffer.byteLength(a.content) > 256 * 1024 || a.content.includes('\0')) throw new Error('Asset content exceeds limit');
    const content = a.content, sha256 = hash(a.sha256);
    if (packageHash(content) !== sha256) throw new Error(`Asset ${id}: content does not match sha256`);
    if (brainReference(content)) throw new Error(`Asset ${id}: inline the remaining brain dependency`);
    let source: { path: string; sha256: string } | undefined;
    if (a.source !== undefined) { const s = object(a.source, 'source'); keys(s, ['path', 'sha256'], 'source'); source = { path: text(s.path, 'source path', 1000), sha256: hash(s.sha256) }; }
    return { id, kind, content, sha256, ...(source ? { source } : {}) };
  });
  if (new Set(assets.map(a => a.id)).size !== assets.length) throw new Error('Duplicate asset id');
  if (assets.reduce((n, a) => n + Buffer.byteLength(a.content), 0) > 512 * 1024) throw new Error('Package assets exceed 512 KiB');
  const outputs = list(p.outputs, 'outputs').map(value => {
    const o = object(value, 'output'); keys(o, ['id', 'kind', 'description', 'brainPath'], 'output');
    if (o.kind !== 'lesson' && o.kind !== 'report') throw new Error('Output kind must be lesson or report');
    const brainPath = o.brainPath === undefined ? undefined : text(o.brainPath, 'output brainPath', 200);
    if (brainPath && !/^routine-outputs\/[a-z0-9][a-z0-9_-]{0,60}\.md$/.test(brainPath)) throw new Error('Brain outputs must be append-only notes under routine-outputs/');
    return { id: identifier(o.id, 'output id'), kind: o.kind as 'lesson' | 'report', description: text(o.description, 'output description', 4000), ...(brainPath ? { brainPath } : {}) };
  });
  if (new Set(outputs.map(o => o.id)).size !== outputs.length) throw new Error('Duplicate output id');
  const requiredOps = list(p.requiredOps, 'requiredOps').map(v => text(v, 'required operation', 40));
  if (new Set(requiredOps).size !== requiredOps.length || requiredOps.some(op => !(DEVOPS_WRITE_OPS as readonly string[]).includes(op))) throw new Error('Unknown or duplicate required operation');
  if (p.intake !== undefined && p.intake !== true) throw new Error('intake must be true or absent');
  if (p.history !== undefined && p.history !== true) throw new Error('history must be true or absent');
  if (p.history && !requiredOps.includes('comment')) throw new Error('Run history requires the comment operation');
  let downgrade: FlowPackage['downgrade'];
  if (p.downgrade !== undefined) {
    const d = object(p.downgrade, 'downgrade'); keys(d, ['lessonOutput', 'removeTag', 'addTag', 'state'], 'downgrade');
    const lessonOutput = identifier(d.lessonOutput, 'lessonOutput');
    if (!outputs.some(o => o.id === lessonOutput && o.kind === 'lesson')) throw new Error('Downgrade requires a declared lesson output');
    if (!['tags', 'fields', 'comment', 'pr-abandon'].every(op => requiredOps.includes(op))) throw new Error('Downgrade requires tags, fields, comment and pr-abandon operations');
    const tag = (v: unknown) => { const s = text(v, 'downgrade tag', 100); if (/[;\x00-\x1f]/.test(s)) throw new Error('Invalid downgrade tag'); return s; };
    downgrade = { lessonOutput, removeTag: tag(d.removeTag), addTag: tag(d.addTag), state: text(d.state, 'downgrade state', 100) };
  }
  const production = p.production === undefined ? undefined : list(p.production, 'production intents').map(value => {
    const intent = object(value, 'production intent'); keys(intent, ['id', 'operation', 'targetId', 'recipeAssetId', 'recipeSha256', 'timeoutMs', 'maxRows', 'maxAffectedRows', 'rollbackAssetId'], 'production intent');
    if (!['db-read', 'db-write', 'deploy'].includes(String(intent.operation))) throw new Error('Unknown production operation');
    const operation = intent.operation as 'db-read' | 'db-write' | 'deploy', recipeAssetId = identifier(intent.recipeAssetId, 'recipe asset'), recipeSha256 = hash(intent.recipeSha256);
    const asset = assets.find(a => a.id === recipeAssetId); if (!asset || asset.sha256 !== recipeSha256 || asset.kind !== (operation === 'deploy' ? 'script' : 'query')) throw new Error('Production intent requires an exact embedded recipe');
    const maxRows = intent.maxRows === undefined ? undefined : integer(intent.maxRows, 'maxRows', 1, 10000), maxAffectedRows = intent.maxAffectedRows === undefined ? undefined : integer(intent.maxAffectedRows, 'maxAffectedRows', 1, 10000);
    if (operation === 'db-read' && (!maxRows || maxAffectedRows) || operation === 'db-write' && !maxAffectedRows || operation === 'deploy' && (maxRows || maxAffectedRows)) throw new Error('Production database intents require the appropriate explicit row budget');
    const rollbackAssetId = intent.rollbackAssetId === undefined ? undefined : identifier(intent.rollbackAssetId, 'rollback asset');
    if (rollbackAssetId && !assets.some(a => a.id === rollbackAssetId)) throw new Error('Rollback asset is missing');
    return { id: identifier(intent.id, 'production intent id'), operation, targetId: identifier(intent.targetId, 'production target'), recipeAssetId, recipeSha256, timeoutMs: integer(intent.timeoutMs, 'timeoutMs', 1000, 3600000), ...(maxRows ? { maxRows } : {}), ...(maxAffectedRows ? { maxAffectedRows } : {}), ...(rollbackAssetId ? { rollbackAssetId } : {}) };
  });
  if (production && new Set(production.map(p => p.id)).size !== production.length) throw new Error('Duplicate production intent');
  return { schema: 1, assets, outputs, requiredOps, ...(p.intake ? { intake: true } : {}), ...(production?.length ? { production } : {}), ...(p.history ? { history: true } : {}), ...(downgrade ? { downgrade } : {}) };
}
export function validatePackagedSteps(steps: FlowStep[], pack: FlowPackage): void {
  if (pack.intake && steps[0]?.kind !== 'agent') throw new Error('Explicit intake requires an initial agent step');
  for (const step of steps) {
    if (step.testEnvironment && !pack.requiredOps.includes('test-environment')) throw new Error('Step environment leases require the test-environment operation');
    if (brainReference(step.instructions) || brainReference(step.agentPrompt ?? '')) throw new Error(`${step.id}: inline the brain instructions before packaging`);
    if (step.kind === 'agent' && (!step.agentPrompt || !step.role || !step.tier || !step.engine || !step.model)) throw new Error(`${step.id}: a packaged agent needs its full agentPrompt, role, tier, engine and model`);
    if (step.kind !== 'agent' && step.agentPrompt) throw new Error('agentPrompt belongs to agent steps only');
    if ((step.assets ?? []).some(id => !pack.assets.some(a => a.id === id))) throw new Error(`${step.id}: missing package asset`);
    if (step.action && ['script', 'query'].includes(step.action.kind)) {
      const asset = pack.assets.find(a => a.id === step.action!.ref && a.kind === step.action!.kind);
      if (!asset || asset.sha256 !== step.action.hash) throw new Error(`${step.id}: action must name an embedded asset with its exact hash`);
    }
  }
}
/** Exclusive creation, no links, verify on every use. A changed local cache never replaces approved content. */
export function materializePackage(root: string, pack: FlowPackage): string {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(root) !== path.resolve(root) || fs.lstatSync(root).isSymbolicLink()) throw new Error('Package cache cannot be a link');
  const allowed = new Set(pack.assets.map(a => `${a.kind === 'script' ? 'scripts' : a.kind === 'query' ? 'queries' : 'assets'}/${a.id}`));
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !['scripts', 'queries', 'assets'].includes(entry.name)) throw new Error('Unexpected package cache entry');
    for (const child of fs.readdirSync(path.join(root, entry.name), { withFileTypes: true })) if (!child.isFile() || !allowed.has(`${entry.name}/${child.name}`)) throw new Error('Undeclared package asset in cache');
  }
  for (const a of pack.assets) {
    const dir = path.join(root, a.kind === 'script' ? 'scripts' : a.kind === 'query' ? 'queries' : 'assets');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Package asset directory cannot be a link');
    const file = path.join(dir, a.id);
    if (!fs.existsSync(file)) fs.writeFileSync(file, a.content, { flag: 'wx', mode: 0o400 });
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256 * 1024 || packageHash(fs.readFileSync(fd, 'utf8')) !== a.sha256) throw new Error('Package cache differs from approved content'); }
    finally { fs.closeSync(fd); }
  }
  return root;
}
