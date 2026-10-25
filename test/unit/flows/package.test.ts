// Package integrity, portable identity and explicit output/production contracts without a user's brain or live engine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { FlowDefinition, FlowSnapshot } from '../../../src/shared/flows';
import { digest, validateDefinition } from '../../../src/main/flows/schema';
import { materializePackage, packageHash } from '../../../src/main/flows/package';
import { exportFlow, parsePortable } from '../../../src/main/flows/portable';
import { FlowService } from '../../../src/main/flows/service';
import { projectRunOutput } from '../../../src/main/flows/run-output';
import { routineDossier, saveDossier } from '../../../src/main/flows/dossier';
const dirs: string[] = [];
const temp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-package-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function definition(): FlowDefinition {
  const content = 'export const value = 42;\n';
  return { id: 'sample', title: 'Sample', description: 'Self-contained routine', aliases: ['sample'], scope: {},
    steps: [{ id: 'inspect', title: 'Inspect', kind: 'agent', instructions: 'Inspect the supplied repository and checklist.', agentPrompt: 'Read evidence and report it. Do not invent findings.', role: 'scout', tier: 'mid', engine: 'claude', model: 'sonnet', inputs: ['workspace'], workspaceInput: 'workspace', assets: ['helper.mjs'], evidence: ['finding'], timeoutMs: 60000, maxAttempts: 2, effect: 'read-only' }],
    package: { schema: 1, assets: [{ id: 'helper.mjs', kind: 'script', content, sha256: packageHash(content), source: { path: 'scripts/helper.mjs', sha256: packageHash(content) } }], outputs: [{ id: 'lesson', kind: 'lesson', description: 'Evidence for a future reviewed update', brainPath: 'routine-outputs/lessons.md' }], requiredOps: [] } };
}
it('pins prompts/assets and rejects unresolved brain dependencies, missing assets and changed bytes', () => {
  const d = definition(); expect(validateDefinition(d)).toEqual(d);
  const hash = digest(d); d.steps[0]!.agentPrompt += ' Different instruction.'; expect(digest(d)).not.toBe(hash);
  d.package!.assets[0]!.content += '// changed'; expect(() => validateDefinition(d)).toThrow('sha256');
  const missing = definition(); missing.steps[0]!.assets = ['missing']; expect(() => validateDefinition(missing)).toThrow('missing package asset');
  const brain = definition(); brain.steps[0]!.instructions = 'Read rules/team.md before running'; expect(() => validateDefinition(brain)).toThrow('brain');
  const unfrozen = definition(); delete unfrozen.steps[0]!.model; expect(() => validateDefinition(unfrozen)).toThrow('full agentPrompt');
});
it('exports the same version without consulting mutable brain files and imports only an inert draft', () => {
  const d = definition(), version = { definition: d, version: 1, draftRevision: 1, digest: digest(d), activatedAt: 1 };
  const snapshot: FlowSnapshot = { contextKey: 'test', drafts: [], versions: [version], active: { sample: 1 }, runs: [] };
  for (const format of ['json', 'markdown'] as const) {
    const out = exportFlow(snapshot, { flowId: 'sample', version: 1, format }, () => { throw new Error('Must not read the brain'); });
    expect(parsePortable(out.content).definition).toEqual(d); expect(out.content).toContain('Read evidence');
  }
  const service = new FlowService({ file: path.join(temp(), 'state.json'), contextKey: 'test' });
  expect(service.propose({ definition: d, expectedRevision: 0 }).status).toBe('proposed'); expect(service.snapshot().active).toEqual({});
});
it('rejects modified, undeclared, linked and ancestor-linked cache contents', () => {
  const d = definition(), base = temp(), root = path.join(base, 'cache'); materializePackage(root, d.package!);
  fs.writeFileSync(path.join(root, 'scripts', 'unapproved.mjs'), 'export const unsafe = true');
  expect(() => materializePackage(root, d.package!)).toThrow('Undeclared'); fs.unlinkSync(path.join(root, 'scripts', 'unapproved.mjs'));
  const file = path.join(root, 'scripts', 'helper.mjs'); fs.chmodSync(file, 0o600); fs.writeFileSync(file, 'changed'); expect(() => materializePackage(root, d.package!)).toThrow('differs');
  const other = temp(); fs.symlinkSync(other, path.join(base, 'link'), 'dir'); expect(() => materializePackage(path.join(base, 'link', 'cache'), d.package!)).toThrow('link');
});
it('projects only declared append-only notes idempotently and rejects linked destinations', () => {
  const root = temp(), content = 'A verified observation.', output = { id: 'lesson', at: 1, content, sha256: packageHash(content), brainPath: 'routine-outputs/lessons.md' };
  projectRunOutput(root, 'run-1', output); projectRunOutput(root, 'run-1', output);
  expect(fs.readFileSync(path.join(root, output.brainPath), 'utf8').match(/verified observation/g)).toHaveLength(1);
  expect(() => projectRunOutput(root, 'run-1', { ...output, brainPath: '../rules.md' })).toThrow('approved');
  fs.unlinkSync(path.join(root, output.brainPath)); fs.symlinkSync(path.join(temp(), 'outside.md'), path.join(root, output.brainPath)); expect(() => projectRunOutput(root, 'run-2', output)).toThrow();
});
it('production preparation pins recipes and row budgets without making a production adapter executable', () => {
  const d = definition(), content = 'SELECT id FROM sample'; d.package!.assets.push({ id: 'read.sql', kind: 'query', content, sha256: packageHash(content) });
  d.package!.production = [{ id: 'inspect-prod', operation: 'db-read', targetId: 'explicit-target', recipeAssetId: 'read.sql', recipeSha256: packageHash(content), maxRows: 20, timeoutMs: 5000 }];
  expect(validateDefinition(d).package!.production).toHaveLength(1);
  delete d.package!.production[0]!.maxRows; expect(() => validateDefinition(d)).toThrow('row budget');
});
it('dossier redacts nested credential keys and retains uncertainty and evidence gaps', () => {
  const d = definition(), version = { definition: d, version: 1, draftRevision: 1, digest: digest(d), activatedAt: 1 };
  const run = { id: 'r1', revision: 1, flowId: d.id, flowVersion: 1, definitionDigest: version.digest, ownerOrchestratorId: 'app', subjectKey: 'x', scope: {}, inputs: { password: 'private-value', api_key: 'another-private-value' }, status: 'blocked' as const, currentStep: 0, steps: [{ stepId: 'inspect', status: 'blocked' as const, attempts: 1, reason: 'password=private-value' }], createdAt: 1, updatedAt: 1 };
  const dossier = routineDossier(run, version, [{ state: 'pending', result: { connectionString: 'private-connection' } }], []);
  const json = JSON.stringify(dossier); expect(json).not.toContain('private-value'); expect(json).not.toContain('private-connection'); expect(dossier.coverage.unresolved).toHaveLength(2);
  const files = saveDossier(temp(), dossier); expect(fs.readFileSync(files.markdown, 'utf8')).toContain('outside host adapter telemetry'); expect(fs.readFileSync(files.json, 'utf8')).toContain('pending');
});

it('recovery persists a blocked transition and work-item outbox entry, with reserved host downgrade lessons', () => {
  const d = definition(); d.package!.history = true; d.package!.requiredOps = ['comment', 'tags', 'fields', 'pr-abandon'];
  d.package!.downgrade = { lessonOutput: 'lesson', removeTag: 'ai-fixable', addTag: 'ai-needs-human', state: 'New' };
  const file = path.join(temp(), 'state.json'), flow = new FlowService({ file, contextKey: 'test' });
  flow.propose({ definition: d, expectedRevision: 0 }); flow.decideDefinition({ id: d.id, expectedRevision: 1, answer: 'yes' });
  const run = flow.start({ flowId: d.id, flowVersion: 1, subjectKey: 'sample', scope: {}, inputs: { workspace: '/fixture' } }, 'owner');
  const bound = flow.bindAgent(run.id, run.revision, 'inspect', { chatId: 'worker', chatRunId: 'worker-run', taskVersion: 1, launched: { roleId: 'scout', tier: 'mid', packageDigest: run.definitionDigest, promptHash: packageHash(d.steps[0]!.agentPrompt!), engine: 'claude', model: 'sonnet' } }, 'owner');
  expect(() => flow.output(run.id, 'lesson', 'Agent cannot occupy the host lesson')).toThrow('reserved');
  const restored = new FlowService({ file, contextKey: 'test' }), recovered = restored.status(run.id, 'owner');
  expect(recovered.status).toBe('blocked'); expect(recovered.trace!.length).toBeGreaterThan(bound.trace!.length); expect(recovered.history!.length).toBeGreaterThan(bound.history!.length);
  restored.beginDowngrade(run.id, 'Fixture needs a human'); restored.output(run.id, 'lesson', 'Host correction', 'host'); restored.downgradeProgress(run.id, 1);
  expect(restored.status(run.id, 'owner').disposition?.phase).toBe(1);
});
