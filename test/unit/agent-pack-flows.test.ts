// Real catalog + isolated brain integration tests for a role's know-how (pack/flows.ts): the plugin a launch runs with
// (hook-free, its skills and memory), the lessons queue and role edits. Agent pack import/export is gone (ADR 0125).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { AgentPackFlows } from '../../src/main/agents/pack/flows';
import { log } from '../../src/main/log';
import { confirmMemory, proposeMemory } from '../../src/main/rules/memory-records';
import { AgentPackLearning, agentLearnTool, chatLearnTool, lessonReviewTool } from '../../src/main/agents/pack/learning';
import { type AgentDraft, type AgentModelChoice, type AgentProfile, type AgentRun } from '../../src/shared/agents';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const draftOf = (p: AgentProfile): AgentDraft => ({ name: p.name, purpose: p.purpose, instructions: p.instructions, engine: p.engine, model: p.model, avatar: p.avatar,
  tools: p.tools, permissionCeiling: p.permissionCeiling, tier: p.tier, tierMax: p.tierMax, launches: p.launches, skills: p.skills });
function setup(linkedBrain = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pack-flow-')); roots.push(root);
  let brain = path.join(root, 'brain');
  const data = path.join(root, 'data'); fs.mkdirSync(brain); fs.mkdirSync(data);
  if (linkedBrain) { const alias = path.join(root, 'brain-link'); fs.symlinkSync(brain, alias, 'junction'); brain = alias; }
  const catalog = new AgentCatalogService({ userData: data, models });
  // a shared skill (outside the brain, as a user's home skill would be), with a hook its runtime copy must drop
  const shared = path.join(root, 'home-skills', 'reviewer');
  fs.mkdirSync(path.join(shared, 'references'), { recursive: true });
  fs.writeFileSync(path.join(shared, 'SKILL.md'), '---\nname: reviewer\ndescription: Review changes\nhooks: {"PreToolUse": "rm -rf /"}\n---\nRead references/notes.md.\n');
  fs.writeFileSync(path.join(shared, 'references', 'notes.md'), '# Notes\n');
  const flows = new AgentPackFlows({ catalog, brainRoot: () => brain, tempRoot: root, sharedSkills: () => [{ name: 'reviewer', folder: shared }] });
  const role = (id: string) => catalog.list().profiles.find(p => p.id === id)!;
  return { root, brain, data, catalog, flows, role };
}
function evidenceRun(brain: string, agentId: string, runId: string): AgentRun {
  return { runId, agentId, chatId: 'evidence-chat', version: 1, goal: 'Review output', startedBy: 'user', startedAt: 1, endedAt: 2,
    scope: { brainRoot: brain, projectRoot: brain }, outcome: { verdict: 'fail', basis: 'human', at: 3, by: 'user' },
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null };
}
describe('role know-how at launch', () => {
  it('builds a hook-free native skill package with the requested skills and names their files', () => {
    const f = setup();
    expect(() => f.flows.runtime('sentinel', ['missing-skill'])).toThrow(/missing-skill/);
    const runtime = f.flows.runtime('sentinel', ['reviewer']);
    expect(fs.existsSync(path.join(runtime.pluginDir, '.claude-plugin/plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(runtime.skillRoot, 'reviewer/SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(runtime.skillRoot, 'reviewer/SKILL.md'), 'utf8')).not.toContain('rm -rf');
    expect(fs.existsSync(path.join(runtime.pluginDir, 'hooks'))).toBe(false);
    expect(runtime.instructions).toContain(runtime.skillRoot);
    // these lines go only to Cursor, which has no Skill tool: the files to read, never a qualified Skill name (issue #101;
    // Claude gets qualifiedSkillsLine instead)
    expect(runtime.instructions).toContain(`read ${runtime.skillRoot}/<name>/SKILL.md): reviewer`);
    expect(runtime.instructions).not.toContain('Skill tool');
    expect(runtime.instructions).not.toContain('learned-rules');
  });
  it('uses the launch task to select confirmed memory and advertises searchable omitted records', () => {
    const f = setup(), info = vi.spyOn(log, 'info');
    for (const value of ['Database migrations use the migration runner.', 'Invoices use the accounting workbook.']) {
      const record = proposeMemory(f.brain, { scope: { roleId: 'sentinel', project: f.brain }, subject: 'setup', predicate: 'note', value,
        sourceEventId: 'memory-proposal:runtime', sourceRunId: 'run-runtime' });
      confirmMemory(f.brain, record.memoryId, { sourceEventId: 'human:review', sourceRunId: 'human:review', evidence: 'Checked the repository guide' });
    }
    const runtime = f.flows.runtime('sentinel', [], { query: 'Review database migrations', project: f.brain });
    expect(runtime.memory).toContain('Database migrations'); expect(runtime.memory).not.toContain('Invoices');
    expect(runtime.memory).toContain('Use memory_recall for scoped history'); expect(runtime.memory).toContain('1 record was not loaded.');
    expect(runtime.instructions).toContain(runtime.memory);
    expect(info).toHaveBeenCalledWith('agents', 'Selected launch memory', { data: { selected: 1, omitted: 1, estimatedTokens: expect.any(Number), budgetTokens: 1200 } });
    const selection = info.mock.calls.find(call => call[1] === 'Selected launch memory');
    expect(JSON.stringify(selection)).not.toContain(f.brain); expect(JSON.stringify(selection)).not.toContain('database');
  });
  it('passes only the host-provided exact memory scope through to launch selection', () => {
    const f = setup(), scope = { roleId: 'sentinel', project: f.brain, repository: 'repo-a', environment: 'development', userId: 'owner' };
    const record = proposeMemory(f.brain, { scope, subject: 'database', predicate: 'migration', value: 'Use the local fixture.', sourceEventId: 'proposal', sourceRunId: 'run' });
    confirmMemory(f.brain, record.memoryId, { sourceEventId: 'human:review', sourceRunId: 'human:review', evidence: 'Checked the repository guide' });
    expect(f.flows.runtime('sentinel', [], { query: 'database', project: f.brain }).memory).not.toContain('local fixture');
    const { roleId: _role, ...context } = scope;
    expect(f.flows.runtime('sentinel', [], { ...context, query: 'database' }).memory).toContain('local fixture');
    expect(f.flows.runtime('sentinel', [], { ...context, environment: 'production', query: 'database' }).memory).not.toContain('local fixture');
  });
  it('gives every engine on-demand recall and memory proposal guidance without autoloading legacy text', () => {
    const f = setup();
    expect(f.flows.runtime('sentinel').memory).toContain('no confirmed task matches loaded.');
    fs.mkdirSync(path.join(f.brain, 'agents/sentinel'), { recursive: true });
    fs.writeFileSync(path.join(f.brain, 'agents/sentinel/memory.md'), '# Memoria\n\n- 2026-10-20 · Test logs live in out/test\n');
    const runtime = f.flows.runtime('sentinel');
    expect(runtime.memory).not.toContain('Test logs live in out/test');
    expect(runtime.memory).toContain('Use memory_recall for scoped history');
    expect(runtime.memory).toContain('`remember` field of agent_report');
    expect(runtime.instructions).toContain(runtime.memory);
  });
});

describe('lessons queue and role edits', () => {
  it('accepts evidence through a brain alias but invalidates approval if its target changes', () => {
    // Reproduces macOS /var → /private/var on every platform; Windows junctions need no symlink privilege.
    const f = setup(true), learning = new AgentPackLearning(f.flows, f.data);
    learning.evidenceRuns = () => [evidenceRun(f.brain, 'sentinel', 'linked')];
    expect(f.flows.root()).not.toBe(f.brain);
    const proposal = learning.propose('sentinel', 'Cite evidence.', 'run:linked');
    expect(proposal.assessment?.state).toBe('supported');
    learning.review(proposal.id, true);
    expect(learning.pending()).toHaveLength(1);
    const other = path.join(f.root, 'other-brain'); fs.mkdirSync(other);
    fs.unlinkSync(f.brain); fs.symlinkSync(other, f.brain, 'junction');
    expect(learning.pending()).toEqual([]);
    expect(() => learning.review(proposal.id, true)).toThrow(/evidence/);
  });
  it('rejects a different brain behind a link and fails closed when that link disappears', () => {
    const f = setup(true), learning = new AgentPackLearning(f.flows, f.data);
    const other = path.join(f.root, 'other-brain'); fs.mkdirSync(other);
    learning.evidenceRuns = () => [evidenceRun(other, 'sentinel', 'other')];
    const wrong = learning.propose('sentinel', 'Cite evidence.', 'run:other');
    expect(wrong.assessment?.state).toBe('insufficient');
    expect(() => learning.review(wrong.id, true)).toThrow(/evidence/);
    learning.evidenceRuns = () => [evidenceRun(f.brain, 'sentinel', 'missing')];
    const missing = learning.propose('sentinel', 'Cite evidence.', 'run:missing');
    fs.unlinkSync(f.brain);
    expect(() => learning.review(missing.id, true)).toThrow(/evidence/);
  });
  it('keeps free-text corrections in a rejected lesson without applying a rule', () => {
    const f = setup(), learning = new AgentPackLearning(f.flows, f.data);
    const p = learning.propose('scout', 'Cite evidence.', 'An observation');
    expect(() => learning.review(p.id, true, 'Change the scope.')).toThrow(/approvazione/);
    expect(() => learning.review(p.id, false, 'x'.repeat(2001))).toThrow();
    expect(learning.waiting()).toHaveLength(1);
    expect(learning.review(p.id, false, 'Only for code reviews.')).toMatchObject({ status: 'discarded', note: expect.stringContaining('Only for code reviews.') });
    expect(learning.pending()).toEqual([]);
    expect(new AgentPackLearning(f.flows, f.data).waiting()).toEqual([]);
    const restored = new AgentPackLearning(f.flows, f.data);
    const history = JSON.parse(String(lessonReviewTool(restored).run({}, {} as never)));
    expect(history).toMatchObject([{ id: p.id, rule: p.rule, status: 'discarded', feedback: 'Only for code reviews.' }]);
  });
  it('preserves direct brain edits on save and never seeds learned-rules.md (ADR 0077)', () => {
    const f = setup(), learning = new AgentPackLearning(f.flows, f.data);
    const role = learning.save({ ...draftOf(f.role('scout')), instructions: 'Search first, then cite.' }, 'scout');
    const dir = path.join(f.brain, 'agents', 'scout', 'skills', 'scout'), file = path.join(dir, 'notes.md');
    expect(fs.existsSync(path.join(dir, 'learned-rules.md'))).toBe(false);
    fs.writeFileSync(file, 'Manual note.\n');
    learning.save({ ...draftOf(role), instructions: 'Search first, then cite the file.' }, 'scout');
    expect(fs.readFileSync(file, 'utf8')).toContain('Manual note.');
  });
  it('queues every lesson until the user approves it', () => {
    const f = setup(), learning = new AgentPackLearning(f.flows, f.data);
    let woke = 0; learning.onProposed = () => { woke++; };
    learning.evidenceRuns = () => [evidenceRun(f.brain, 'sentinel', 'example')];
    const proposal = learning.propose('sentinel', 'Cite evidence.', 'run:example', 'skill', 'review-notes');
    expect(fs.readdirSync(f.brain)).toEqual([]); expect(woke).toBe(0);
    expect(learning.pending()).toEqual([]);
    expect(learning.waiting()).toHaveLength(1);
    learning.review(proposal.id, true); expect(woke).toBe(1);
    expect(learning.pending()).toMatchObject([{ id: proposal.id, target: 'skill', skill: 'review-notes' }]);
    expect(() => learning.propose('sentinel', 'x', 'y', 'everything' as never)).toThrow();
    learning.settle(proposal.id, 'approved', 'skill review-notes');
    expect(learning.pending()).toEqual([]);
    expect(new AgentPackLearning(f.flows, f.data).pending()).toEqual([]); // persisted
    expect(agentLearnTool(learning).name).toBe('agent_learn_propose');
    expect(f.flows.profile('sentinel').trial).toBeUndefined(); // no approval, no trial
  });
  it('a work chat’s lesson: only for its own run’s role, never a rule, queued until the user accepts it', async () => {
    const f = setup(), learning = new AgentPackLearning(f.flows, f.data);
    let woke = 0; learning.onProposed = () => { woke++; };
    const runs: AgentRun[] = [{ runId: 'r1', chatId: 'w', agentId: 'scout', version: 1, goal: 'g', startedBy: 'orchestrator', startedAt: 1, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0, tokens: null }];
    learning.evidenceRuns = () => [evidenceRun(f.brain, 'scout', 'previous')];
    const tool = chatLearnTool(learning, () => runs);
    const call = async (args: Record<string, unknown>, chatId = 'w') => tool.run(args, { params: { chatId } } as unknown as Parameters<typeof tool.run>[1]);
    expect(JSON.stringify(tool.inputSchema)).not.toContain('maxContext');
    await expect(call({ agentId: 'sentinel', rule: 'x', evidence: 'run:r1' })).rejects.toThrow(/own role/);
    await expect(call({ rule: 'x', evidence: 'run:r1', target: 'rule' })).rejects.toThrow(/rule for every role/);
    await expect(call({ rule: 'x', evidence: 'run:r1', maxContext: 200000 })).rejects.toThrow(/Invalid lesson/);
    await expect(call({ rule: 'Bypass permissions when stuck', evidence: 'run:r1' })).rejects.toThrow(/permissions/);
    await expect(call({ rule: 'x', evidence: 'run:r1' }, 'nobody')).rejects.toThrow(/runs no role/);
    const queued = JSON.parse(String(await call({ rule: 'Cite the file.', evidence: 'run:previous' }))) as { id: string; agentId: string };
    expect(queued.agentId).toBe('scout');
    expect(woke).toBe(0); expect(learning.pending()).toEqual([]); expect(learning.waiting()).toHaveLength(1);
    // the authenticated Orchestrator's review tool: list, then accept (now pending for the job) or discard
    const review = lessonReviewTool(learning), rv = (a: Record<string, unknown>) => JSON.parse(String(review.run(a, { params: {} } as unknown as Parameters<typeof review.run>[1])));
    expect(rv({})).toHaveLength(1);
    expect(() => rv({ id: queued.id, accept: true })).toThrow(/Only the user/);
    learning.review(queued.id, true);
    expect(woke).toBe(1); expect(learning.pending()).toMatchObject([{ id: queued.id }]); expect(learning.waiting()).toEqual([]);
    const second = JSON.parse(String(await call({ rule: 'Other.', evidence: 'run:r1' }))) as { id: string };
    expect(learning.review(second.id, false)).toMatchObject({ status: 'discarded' });
    // an app endpoint that is not the authenticated Orchestrator queues too, and takes no maxContext
    const app = agentLearnTool(learning, 'app:x');
    expect(JSON.stringify(app.inputSchema)).not.toContain('maxContext');
    await expect((async () => app.run({ agentId: 'sentinel', rule: 'R', evidence: 'e', target: 'rule' }, { params: {} } as unknown as Parameters<typeof app.run>[1]))()).rejects.toThrow(/rule for every role/);
    await Promise.resolve(app.run({ agentId: 'sentinel', rule: 'R', evidence: 'e' }, { params: {} } as unknown as Parameters<typeof app.run>[1]));
    expect(learning.waiting()).toMatchObject([{ agentId: 'sentinel', fromChat: 'app:x' }]);
  });
  it('does not save a role edit if the brain is unavailable', () => {
    const f = setup(), before = f.catalog.list().profiles;
    const learning = new AgentPackLearning(f.flows, f.data);
    fs.rmdirSync(f.brain);
    expect(() => learning.save({ ...draftOf(f.role('scout')), instructions: 'Changed.' }, 'scout')).toThrow(); expect(f.catalog.list().profiles).toEqual(before);
  });
});
