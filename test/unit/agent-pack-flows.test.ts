// Real catalog + isolated brain integration tests for pack review, probation, learned rules and preset forks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { AgentPackFlows } from '../../src/main/agents/pack/flows';
import { AgentPackLearning, agentLearnTool } from '../../src/main/agents/pack/learning';
import { emitPack } from '../../src/main/agents/pack/emit';
import { readPackSource } from '../../src/main/agents/pack/read';
import { readZip, writeZip } from '../../src/main/agents/pack/zip';
import { ORCHESTRATOR_AGENT_ID, type AgentDraft, type AgentModelChoice } from '../../src/shared/agents';
import type { GuardResult } from '../../src/main/brain/guard';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const draft = (): AgentDraft => ({ name: 'Reviewer', purpose: 'Review changes', instructions: 'Cite evidence.', engine: 'claude', model: 'known-model', avatar: { kind: 'symbol', value: 'eye' } });
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pack-flow-')); roots.push(root);
  const brain = path.join(root, 'brain'), data = path.join(root, 'data'); fs.mkdirSync(brain); fs.mkdirSync(data);
  const catalog = new AgentCatalogService({ userData: data, models }), destination = path.join(root, 'export.sbagent');
  let clock = Date.now(), result: GuardResult = { ok: true };
  const flows = new AgentPackFlows({ catalog, brainRoot: () => brain, version: '0.1.0', guards: () => [], scan: async () => result,
    pickImport: async () => null, pickExport: async () => destination, tempRoot: root, now: () => clock,
    stats: () => ({ runs: 10, successHuman: 8, failHuman: 1, versions: 1, monthsUsed: 1 }) });
  return { root, brain, data, catalog, flows, destination, advance: () => { clock += 600001; }, scan: (r: GuardResult) => { result = r; } };
}
function packFile(root: string, revision = 1, tools = ['read'], script = false): string {
  const hash = 'a'.repeat(64), files = new Map([['skills/reviewer/SKILL.md', Buffer.from('---\nname: reviewer\ndescription: Review changes\n---\nRead learned-rules.md.\n')], ['skills/reviewer/learned-rules.md', Buffer.from('# Learned rules\n')]]);
  if (script) files.set('skills/reviewer/scripts/check.py', Buffer.from('print("review")'));
  const pack = emitPack({ format: 1, packId: 'reviewer-0123456789abcdef', revision, contentHash: hash,
    agent: { id: 'reviewer', name: 'Reviewer', role: 'Review changes', category: 'development', instructionsFile: 'agents/reviewer.md', manifest: {}, engine: 'claude', model: 'known-model', tools: { allow: tools as ['read'], mcp: ['foreign'] }, permissionCeiling: 'acceptEdits' },
    icon: { symbol: 'eye', tone: 'blue' }, skills: [{ name: 'reviewer', ownership: 'owned', hash }], createdAt: '2026-10-18T00:00:00Z', exportedAt: '2026-10-18T00:00:00Z', appVersion: '0.1.0' }, 'Cite evidence.', files);
  const file = path.join(root, `fixture-${revision}.sbagent`); fs.writeFileSync(file, writeZip(pack)); return file;
}

describe('pack review transactions', () => {
  it('exports each shipped preset with its real skill files', async () => {
    const f = setup();
    f.flows.deps.presetSkills = id => readPackSource(path.resolve('src/main/agents/presets', id));
    for (const agent of f.catalog.list().profiles) {
      const plan = await f.flows.exportPlan(agent.id, 'sbagent');
      expect(plan.items.some(item => item.id === `skills/${agent.id}`)).toBe(true);
      expect((await f.flows.export(plan.token, false)).ok).toBe(true);
    }
  });
  it('exports without stats by default, keeps stable pack identity and consumes its token', async () => {
    const f = setup(), agent = f.catalog.save(draft());
    const plan = await f.flows.exportPlan(agent.id, 'sbagent');
    expect(plan.items.every(i => i.included)).toBe(true);
    const result = await f.flows.export(plan.token, false); expect(result.ok).toBe(true);
    const manifest = JSON.parse(readZip(fs.readFileSync(f.destination)).get('sbagent.json')!.toString());
    expect(manifest).not.toHaveProperty('stats'); expect(manifest.packId).toBe(f.catalog.list().profiles.find(p => p.id === agent.id)!.pack!.id);
    await expect(f.flows.export(plan.token, false)).rejects.toThrow('expired');
    const next = await f.flows.exportPlan(agent.id, 'sbagent'); await f.flows.export(next.token, true);
    expect(JSON.parse(readZip(fs.readFileSync(f.destination)).get('sbagent.json')!.toString()).stats.runs).toBe(10);
  });
  it('does not write an export with guard findings and expires reviews', async () => {
    const f = setup(), agent = f.catalog.save(draft());
    f.scan({ ok: false, findings: [{ file: 'skills/reviewer/reference.md', line: 1, rule: 'email' }] });
    const plan = await f.flows.exportPlan(agent.id, 'sbagent'); expect((await f.flows.export(plan.token, false)).ok).toBe(false);
    expect(fs.existsSync(f.destination)).toBe(false); f.advance(); await expect(f.flows.export(plan.token, false)).rejects.toThrow('expired');
  });
  it('drops a previously selected anonymous summary after cancelling and unticking', async () => {
    const f = setup(), agent = f.catalog.save(draft()), plan = await f.flows.exportPlan(agent.id, 'sbagent');
    let cancelled = true;
    f.flows.deps.pickExport = async () => cancelled ? null : f.destination;
    expect((await f.flows.export(plan.token, true)).ok).toBe(false);
    cancelled = false; expect((await f.flows.export(plan.token, false)).ok).toBe(true);
    expect(JSON.parse(readZip(fs.readFileSync(f.destination)).get('sbagent.json')!.toString())).not.toHaveProperty('stats');
  });
  it('imports in probation, clamps permissions/MCP and removes unapproved scripts', async () => {
    const f = setup(), file = packFile(f.root, 1, ['read', 'mcp'], true);
    const review = (await f.flows.importInspect({ dropped: file }))!;
    expect(review.scripts).toHaveLength(1); expect(review.clamps).toContain('acceptEdits requested, not granted');
    expect(fs.readdirSync(f.brain)).toEqual([]);
    const [agent] = await f.flows.importApply(review.token, false, 'rename');
    expect(agent).toMatchObject({ permissionCeiling: 'default', tools: { mcp: [] }, probation: { source: { kind: 'import', revision: 1 } }, instructions: 'Cite evidence.' });
    expect(fs.existsSync(path.join(f.brain, agent!.knowhow!.folder, 'skills/reviewer/scripts/check.py'))).toBe(false);
    expect(new AgentCatalogService({ userData: f.data, models }).list().profiles.find(p => p.id === agent!.id)?.probation).toEqual(agent!.probation);
    await expect(f.flows.importApply(review.token, false, 'rename')).rejects.toThrow('expired');
  });
  it('offers newer revisions as trials and equal revisions as already present', async () => {
    const f = setup(), first = (await f.flows.importInspect({ dropped: packFile(f.root) }))!;
    const [agent] = await f.flows.importApply(first.token, false, 'rename'); f.catalog.keep(agent!.id);
    const same = (await f.flows.importInspect({ dropped: packFile(f.root) }))!; expect(same.collision.kind).toBe('present');
    await expect(f.flows.importApply(same.token, false, 'update')).rejects.toThrow('newer'); f.flows.cancel(same.token);
    const update = (await f.flows.importInspect({ dropped: packFile(f.root, 2) }))!; expect(update.collision.kind).toBe('update');
    const [changed] = await f.flows.importApply(update.token, false, 'update'); expect(changed).toMatchObject({ trial: { baseline: 1, version: 2 }, pack: { revision: 2 } });
    expect(f.catalog.resolveTrial(changed!.id, 'rollback').activeVersion).toBe(1);
  });
  it('copies collisions and enforces the ten-agent probation cap before touching the brain', async () => {
    const f = setup(), file = packFile(f.root);
    for (let i = 0; i < 10; i++) { const review = (await f.flows.importInspect({ dropped: file }))!; await f.flows.importApply(review.token, false, i ? 'copy' : 'rename'); }
    expect(f.catalog.list().profiles.filter(p => p.probation).map(p => p.id)).toContain('reviewer-2');
    const review = (await f.flows.importInspect({ dropped: file }))!;
    const before = fs.readdirSync(path.join(f.brain, 'agents'));
    await expect(f.flows.importApply(review.token, false, 'copy')).rejects.toThrow('PROBATION_CAP');
    expect(fs.readdirSync(path.join(f.brain, 'agents'))).toEqual(before);
  });
  it('refuses secret findings and requires a decision for personal data', async () => {
    const f = setup(), file = packFile(f.root);
    for (const rule of ['openai-key', 'jwt', 'azure-sas']) { f.scan({ ok: false, findings: [{ file: 'skills/reviewer/SKILL.md', line: 1, rule }] }); await expect(f.flows.importInspect({ dropped: file })).rejects.toThrow('secrets'); }
    f.scan({ ok: false, findings: [{ file: 'skills/reviewer/SKILL.md', line: 1, rule: 'email' }] });
    const review = (await f.flows.importInspect({ dropped: file }))!;
    await expect(f.flows.importApply(review.token, false, 'rename')).rejects.toThrow('personal-data');
    expect(await f.flows.importApply(review.token, false, 'rename', true)).toHaveLength(1);
  });
  it('validates an entire foreign plugin before committing any agent or brain file', async () => {
    const f = setup(), folder = path.join(f.root, 'foreign'); fs.mkdirSync(path.join(folder, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'plugin.json'), '{"name":"reviews"}');
    fs.writeFileSync(path.join(folder, 'agents/first.md'), '---\nname: first\ndescription: First\n---\nValid.');
    fs.writeFileSync(path.join(folder, 'agents/second.md'), '---\nname: second\ndescription: Second\n---\n' + 'x'.repeat(8001));
    const review = (await f.flows.importInspect({ dropped: folder }))!, before = f.catalog.list().profiles;
    await expect(f.flows.importApply(review.token, false, 'rename')).rejects.toThrow();
    expect(f.catalog.list().profiles).toEqual(before); expect(fs.readdirSync(f.brain)).toEqual([]);
  });
  it('can re-export a renamed imported pack with its stable pack identity', async () => {
    const f = setup(), file = packFile(f.root), first = (await f.flows.importInspect({ dropped: file }))!;
    await f.flows.importApply(first.token, false, 'rename');
    const second = (await f.flows.importInspect({ dropped: file }))!;
    const [copy] = await f.flows.importApply(second.token, false, 'copy');
    const plan = await f.flows.exportPlan(copy!.id, 'sbagent');
    expect((await f.flows.export(plan.token, false)).ok).toBe(true);
  });
  it('builds a hook-free native skill package and publishes editable files in the brain', async () => {
    const f = setup(), review = (await f.flows.importInspect({ dropped: packFile(f.root) }))!;
    const [agent] = await f.flows.importApply(review.token, false, 'rename');
    expect(fs.existsSync(path.join(f.brain, 'agents/reviewer/skills/reviewer/SKILL.md'))).toBe(true);
    const runtime = f.flows.runtime(agent!.id);
    expect(fs.existsSync(path.join(runtime.pluginDir, '.claude-plugin/plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(runtime.skillRoot, 'reviewer/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(runtime.pluginDir, 'hooks'))).toBe(false);
    expect(runtime.instructions).toContain('learned-rules.md');
  });
});

describe('async learning and brain forks', () => {
  it('does not resurrect later rules after restoring a pre-knowhow version and saving twice', () => {
    const f = setup(), learning = new AgentPackLearning(f.flows, f.data), preset = f.catalog.list().profiles[0]!;
    const proposal = learning.propose(preset.id, 'Later lesson.', 'run:example'); learning.decide(preset.id, proposal.id, 'approve');
    const before = f.flows.profile(preset.id), restored = f.catalog.resolveTrial(preset.id, 'rollback');
    f.flows.publishCurrent(restored, before.knowhow?.hash);
    const first = learning.save({ ...restored, name: 'First' }, restored.id);
    learning.save({ ...first, name: 'Second' }, first.id);
    expect(learning.list(first.id).text).not.toContain('Later lesson.');
  });
  it('preserves direct brain edits on save and learned-rule approval', () => {
    const f = setup(), learning = new AgentPackLearning(f.flows, f.data);
    const agent = learning.save(draft()), file = path.join(f.brain, 'agents', agent.id, 'skills', agent.id, 'learned-rules.md');
    fs.appendFileSync(file, 'Manual lesson.\n');
    learning.save({ ...agent, name: 'Renamed' }, agent.id);
    expect(fs.readFileSync(file, 'utf8')).toContain('Manual lesson.');
    fs.appendFileSync(file, 'Another manual lesson.\n');
    const proposal = learning.propose(agent.id, 'Approved lesson.', 'run:example');
    learning.decide(agent.id, proposal.id, 'approve');
    expect(fs.readFileSync(file, 'utf8')).toContain('Another manual lesson.');
    expect(learning.list(agent.id).text).toContain('Approved lesson.');
  });
  it('removes deleted owned files from an export on rescan', async () => {
    const f = setup(), learning = new AgentPackLearning(f.flows, f.data);
    const agent = learning.save(draft()), file = path.join(f.brain, 'agents', agent.id, 'skills', agent.id, 'reference.md');
    fs.writeFileSync(file, 'Remove before export.');
    const plan = await f.flows.exportPlan(agent.id, 'sbagent');
    await f.flows.exportFix(plan.token, '', 'rescan');
    fs.unlinkSync(file);
    const refreshed = await f.flows.exportFix(plan.token, '', 'rescan');
    expect(refreshed.items.some(i => i.id.endsWith('/reference.md'))).toBe(false);
    await f.flows.export(plan.token, false);
    expect(readZip(fs.readFileSync(f.destination)).has(`skills/${agent.id}/reference.md`)).toBe(false);
  });
  it('queues without editing, forks on approval into brain storage and starts a trial', () => {
    const f = setup(), preset = f.catalog.list().profiles[0]!;
    const learning = new AgentPackLearning(f.flows, f.data);
    const proposal = learning.propose(preset.id, 'Cite evidence.', 'run:example');
    expect(fs.readdirSync(f.brain)).toEqual([]); expect(learning.list(preset.id).proposals).toHaveLength(1);
    learning.decide(preset.id, proposal.id, 'approve');
    const fork = f.flows.profile(preset.id); expect(fork.origin).toEqual(preset.origin); expect(fork.knowhow).toBeDefined(); expect(fork.trial).toMatchObject({ baseline: 1, version: 2 }); expect(fork.probation).toBeUndefined();
    expect(learning.list(preset.id).text).toContain('Cite evidence.'); expect(learning.list(preset.id).proposals).toEqual([]);
    expect(agentLearnTool(learning).name).toBe('agent_learn_propose');
  });
  it('keeps the Orchestrator out of routing when a learned rule starts its trial', () => {
    const f = setup(), coordinator = f.catalog.list().profiles.find(p => p.id === ORCHESTRATOR_AGENT_ID)!;
    expect(coordinator.routable).toBe(false);
    const learning = new AgentPackLearning(f.flows, f.data);
    learning.decide(coordinator.id, learning.propose(coordinator.id, 'Cite evidence.', 'run:example').id, 'approve');
    expect(f.catalog.list().profiles.find(p => p.id === ORCHESTRATOR_AGENT_ID)).toMatchObject({ routable: false, trial: { version: 2 } });
  });
  it('does not save a catalog edit if the brain is unavailable', () => {
    const f = setup(), before = f.catalog.list().profiles;
    const learning = new AgentPackLearning(f.flows, f.data);
    fs.rmdirSync(f.brain);
    expect(() => learning.save(draft())).toThrow(); expect(f.catalog.list().profiles).toEqual(before);
  });
  it('adds learned rules only to the agent own skill when another skill sorts first', async () => {
    const f = setup(), review = (await f.flows.importInspect({ dropped: packFile(f.root) }))!;
    const [imported] = await f.flows.importApply(review.token, false, 'rename'); f.catalog.keep(imported!.id);
    const agent = f.flows.profile(imported!.id), files = f.flows.ownSkills(agent);
    files.set('skills/aaa/SKILL.md', Buffer.from('---\nname: aaa\ndescription: Another skill\n---\nRead rules.'));
    files.set('skills/aaa/learned-rules.md', Buffer.from('Untouched.'));
    const knowhow = f.flows.persistSkills(agent.id, files); const saved = f.catalog.save({ ...agent, knowhow }, agent.id);
    f.flows.publishCurrent(saved, agent.knowhow?.hash);
    const learning = new AgentPackLearning(f.flows, f.data), p = learning.propose(agent.id, 'Own rule.', 'run:example');
    learning.decide(agent.id, p.id, 'approve');
    const updated = f.flows.ownSkills(f.flows.profile(agent.id));
    expect(updated.get('skills/aaa/learned-rules.md')!.toString()).toBe('Untouched.');
    expect(updated.get('skills/reviewer/learned-rules.md')!.toString()).toContain('Own rule.');
  });
});
