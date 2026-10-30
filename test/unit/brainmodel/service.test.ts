// The brain model service end to end (ADR 0077) over a real catalog, pack flows and lessons queue, temp folders only:
// the migration turns the runbook / routines sections into brain skills a role loads when a task asks for them (content
// kept, credentials masked, originals untouched, idempotent, with a report); every job changes things by itself with a
// change log entry and an undo, and never redoes what the user undid; the user's skill toggle is logged too; a lesson
// goes to the role, a skill or a rule; repeated tasks become a skill; duplicate skills and memories are merged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { AgentPackFlows, portableId } from '../../../src/main/agents/pack/flows';
import { AgentPackLearning } from '../../../src/main/agents/pack/learning';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { ignoreFile } from '../../../src/main/brainmodel/migration-ignore';
import { migrationReceipt } from '../../../src/main/brainmodel/migration-source';
import { BrainModelService } from '../../../src/main/brainmodel/service';
import { writeDemoBrain } from '../../../src/main/brainmodel/demo';
import type { AgentModelChoice, AgentRun } from '../../../src/shared/agents';
import { changeCriteria, type BrainChange, type LogScan } from '../../../src/shared/brain-model';
import type { ResearchProposal } from '../../../src/shared/maintenance-research';
import { maintenanceEvent } from '../../../src/main/brain/announce';
import type { UpgradeAsk } from '../../../src/main/brainmodel/upgrade';
import { proposeMemory, confirmMemory } from '../../../src/main/rules/memory-records';
import { readWorker } from '../../../src/main/read-work';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const NOW = Date.parse('2026-10-19T09:00:00Z');
const DEV = 'artisan';
const OTHER = 'scout';

function world(opts: { demo?: boolean; upgradeAsk?: UpgradeAsk; scripts?: { file: (id: string) => string; changed: () => void }; runs?: AgentRun[]; applied?: (c: BrainChange[]) => void; logDir?: string; findings?: (logs: LogScan) => { bugs: number; forget: number } } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-brainmodel-'))); roots.push(base);
  const data = path.join(base, 'data'); fs.mkdirSync(data);
  const brain = opts.demo ? writeDemoBrain(path.join(base, 'brain'), NOW) : path.join(base, 'brain');
  if (!opts.demo) { fs.mkdirSync(brain); put(brain, 'brain.json', JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: [], appRules: true } })); }
  const catalog = new AgentCatalogService({ userData: data, models });
  const shipped = [...new Set(catalog.list().profiles.flatMap(p => p.skills))].map(name => ({ name, folder: path.join(base, 'app-skills', name) }));
  for (const s of shipped) put(s.folder, 'SKILL.md', `---\nname: ${s.name}\ndescription: Fixture skill.\n---\nRead the fixture.\n`);
  const flows = new AgentPackFlows({ catalog, brainRoot: () => brain, tempRoot: base, runtimeRoot: path.join(base, 'runtime'),
    sharedSkills: () => { const dir = path.join(brain, '.claude', 'skills'); try { return [...fs.readdirSync(dir).filter(name => fs.existsSync(path.join(dir, name, 'SKILL.md'))).map(name => ({ name, folder: path.join(dir, name) })), ...shipped]; } catch { return shipped; } } });
  catalog.onKnowhowChange((p, previous) => flows.publishCurrent(p, previous));
  const learning = new AgentPackLearning(flows, data);
  let emitted = 0;
  const service = new BrainModelService({ userData: data, root: () => brain, home: null, catalog, packs: flows, learning, runs: () => opts.runs ?? [],
    emit: () => { emitted++; }, auto: false, ...(opts.upgradeAsk ? { upgradeAsk: opts.upgradeAsk } : {}), now: () => NOW, ...(opts.applied ? { applied: opts.applied } : {}),
    ...(opts.logDir ? { logDir: () => opts.logDir! } : {}), ...(opts.findings ? { findings: opts.findings } : {}), ...(opts.scripts ? { scripts: opts.scripts } : {}) });
  const agent = (id: string) => catalog.list().profiles.find(p => p.id === id)!;
  return { base, brain, data, catalog, flows, learning, service, agent, emitted: () => emitted };
}
const snapshot = (root: string) => { const out: Record<string, string> = {}; const walk = (d: string) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) { if (!rel.startsWith('.claude') && !rel.startsWith('agents')) walk(rel); } else if (rel !== 'brain.json') out[rel] = fs.readFileSync(path.join(root, rel), 'utf8'); } }; walk(''); return out; };

describe('the pages\' state cache (ADR 0186)', () => {
  it('two reads without a change compute once; a change, a new run or a verdict computes again; a failure is not kept', async () => {
    const runs: AgentRun[] = [];
    const w = world({ runs });
    const call = vi.spyOn(readWorker, 'call').mockImplementation(async () => w.service.state());
    try {
      const a = await w.service.stateAsync(), b = await w.service.stateAsync();
      expect(call).toHaveBeenCalledTimes(1);
      expect(b).toBe(a);
      w.service.invalidate();
      await w.service.stateAsync();
      expect(call).toHaveBeenCalledTimes(2);
      runs.push({ runId: 'r_000000000001', chatId: 'c1', agentId: DEV, version: 1, goal: 'x', startedBy: 'user', startedAt: NOW - 1000, counters: {}, costUsd: 0, tokens: null } as unknown as AgentRun);
      await w.service.stateAsync();
      expect(call).toHaveBeenCalledTimes(3);
      runs[0] = { ...runs[0]!, outcome: { verdict: 'success', basis: 'human', at: NOW, by: 'user' } } as AgentRun;
      await w.service.stateAsync(); await w.service.stateAsync();
      expect(call).toHaveBeenCalledTimes(4);
      call.mockImplementationOnce(async () => { throw new Error('worker gone'); });
      w.service.invalidate();
      await expect(w.service.stateAsync()).rejects.toThrow('worker gone');
      await w.service.stateAsync();
      expect(call).toHaveBeenCalledTimes(6);
    } finally { call.mockRestore(); }
  });
});

describe('one-time migration', () => {
  it('turns every runbook and routines section into a brain skill, without losing or leaking content', async () => {
    const w = world({ demo: true });
    const before = snapshot(w.brain);
    const state = await w.service.maintain('migration');
    const report = state.migration!;
    expect(report.items.length).toBeGreaterThanOrEqual(6);
    expect(report.items.every(i => i.status === 'moved')).toBe(true);
    // the content is kept, with where it came from
    const release = report.items.find(i => i.title === 'Pubblicare una versione in test')!;
    const text = fs.readFileSync(path.join(w.brain, '.claude/skills', release.skill!, 'SKILL.md'), 'utf8');
    expect(text).toMatch(/^---\nname: pubblicare-una-versione-in-test\ndescription: /);
    expect(text).toContain('Spostata qui da `');
    // the fake credential stays only in the original
    const query = report.items.find(i => i.title === 'Query in sola lettura su produzione')!;
    expect(fs.readFileSync(path.join(w.brain, '.claude/skills', query.skill!, 'SKILL.md'), 'utf8')).not.toMatch(/demo-non-reale/);
    expect(query.note).toMatch(/nascost/);
    expect(snapshot(w.brain)).toEqual(before); // originals untouched
    // no role is changed: a role loads a skill when its launch gives it (the Orchestrator passes them)
    expect(w.catalog.list().profiles.every(p => p.lastEditedBy === 'default')).toBe(true);
    // one change per skill, all undoable
    expect(state.changes.filter(c => c.job === 'migration')).toHaveLength(report.items.length);
    expect(state.changes.every(c => c.kind === 'skill' && c.canRollback)).toBe(true);
    expect(state.skills.find(s => s.name === release.skill)).toMatchObject({ usedBy: [], madeBy: 'migration', home: 'brain' });
  });
  it('is idempotent and never redoes a skill the user undid', async () => {
    const w = world({ demo: true });
    const first = await w.service.maintain('migration');
    const again = await w.service.maintain('migration');
    expect(again.changes).toHaveLength(first.changes.length);
    expect(again.migration!.items.every(i => i.status === 'moved')).toBe(true); // the merged report keeps "moved"
    const skillChange = again.changes.find(c => c.job === 'migration' && c.kind === 'skill')!;
    const undone = w.service.rollback(skillChange.id);
    expect(fs.existsSync(path.join(w.brain, '.claude/skills', skillChange.target, 'SKILL.md'))).toBe(false);
    expect(undone.changes.find(c => c.id === skillChange.id)).toMatchObject({ canRollback: false });
    expect(() => w.service.rollback(skillChange.id)).toThrow(/non si può più annullare/);
    await w.service.maintain('migration');
    expect(fs.existsSync(path.join(w.brain, '.claude/skills', skillChange.target, 'SKILL.md'))).toBe(false);
  });
  it('keeps equally named sections in different groups separate, and refuses ambiguous legacy associations', async () => {
    const w = world();
    put(w.brain, 'runbooks/grouped.md', '# Operations\n\n## First group\n\n### Deploy test\n1. Build the first fixture.\n2. Verify the first result.\n\n## Second group\n\n### Deploy test\n1. Build the second fixture.\n2. Verify the second result.\n');
    const first = await w.service.maintain('migration');
    expect(first.skills).toHaveLength(2);
    const again = await w.service.maintain('migration');
    expect(again.skills).toHaveLength(2);
    expect(again.changes).toHaveLength(first.changes.length);
    const texts = again.skills.map(skill => fs.readFileSync(skill.file, 'utf8'));
    expect(texts.filter(text => text.includes('first fixture'))).toHaveLength(1);
    expect(texts.filter(text => text.includes('second fixture'))).toHaveLength(1);
    const legacy = world();
    put(legacy.brain, 'runbooks/grouped.md', fs.readFileSync(path.join(w.brain, 'runbooks/grouped.md'), 'utf8'));
    put(legacy.brain, '.claude/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Deploy.\n---\nSpostata qui da `runbooks/grouped.md` (sezione «Deploy test», riga 3) il 2026-10-19.\n');
    const kept = await legacy.service.maintain('migration');
    expect(kept.skills).toHaveLength(1);
    expect(kept.changes).toHaveLength(0);
    expect(kept.migration!.items.every(item => item.status === 'skipped')).toBe(true);
  });
  it('an empty brain has nothing to migrate and nothing to show', async () => {
    const w = world();
    const state = await w.service.maintain();
    expect(state).toMatchObject({ skills: [], rules: [], memory: [], changes: [] });
    expect(state.migration).toEqual({ at: NOW, items: [] });
    expect(state.lastRun!.jobs.map(j => j.job)).toEqual(['migration', 'upgrade', 'corrections', 'repeated-task', 'merge-skills', 'merge-memory']);
    expect(w.emitted()).toBe(1);
  });
  it('keeps source identity across line shifts and updates the same unedited generated skill', async () => {
    const w = world(), source = '# Operations\n\n## Deploy test\n\n1. Build the test fixture.\n2. Verify the output.\n';
    put(w.brain, 'runbooks/deploy.md', source);
    const first = await w.service.maintain('migration'), name = first.skills[0]!.name;
    const skill = first.skills[0]!.file, original = fs.readFileSync(skill, 'utf8');
    put(w.brain, 'runbooks/deploy.md', `\n\n${source}`);
    const moved = await w.service.maintain('migration');
    expect(moved.skills.map(s => s.name)).toEqual([name]);
    expect(moved.changes).toHaveLength(first.changes.length);
    expect(moved.migration!.items).toHaveLength(1);
    expect(fs.readFileSync(skill, 'utf8')).toBe(original);
    put(w.brain, 'runbooks/deploy.md', source.replace('Verify the output', 'Verify both outputs'));
    const updated = await w.service.maintain('migration');
    expect(updated.skills.map(s => s.name)).toEqual([name]);
    expect(fs.readFileSync(skill, 'utf8')).toContain('Verify both outputs');
    const change = updated.changes.find(c => c.job === 'migration' && c.action === 'update')!;
    expect(change).toBeDefined();
    w.service.rollback(change.id);
    await w.service.maintain('migration');
    expect(fs.readFileSync(skill, 'utf8')).toBe(original);
  });
  it('recognizes old line-based provenance and preserves later user edits on source conflicts', async () => {
    const w = world();
    put(w.brain, 'runbooks/check.md', '# Ops\n\n\n## Check source\n\n1. Read the fixture.\n2. Check the output.\n');
    put(w.brain, '.claude/skills/check-source/SKILL.md', '---\nname: check-source\ndescription: Check\n---\n\n# Check source\n\n1. Read the fixture.\n2. Check the output.\n\nSpostata qui da `runbooks/check.md` (sezione «Check source», riga 3) il 2026-10-01.\n');
    const legacy = await w.service.maintain('migration');
    expect(legacy.skills).toHaveLength(1); expect(legacy.changes).toHaveLength(0);
    put(w.brain, 'runbooks/fresh.md', '# Ops\n\n## New check\n1. Read a fixture.\n2. Check a result.\n');
    const made = await w.service.maintain('migration'), generated = made.skills.find(s => s.name === 'new-check')!;
    fs.appendFileSync(generated.file, '\nMy additional condition.\n');
    const edited = fs.readFileSync(generated.file, 'utf8');
    put(w.brain, 'runbooks/fresh.md', '# Ops\n\n## New check\n1. Read a new fixture.\n2. Check a result.\n');
    const conflict = await w.service.maintain('migration');
    expect(conflict.skills).toHaveLength(2);
    expect(fs.readFileSync(generated.file, 'utf8')).toBe(edited);
    expect(conflict.migration!.items.find(i => i.skill === 'new-check')!.note).toMatch(/modificat/);
  });
});

function lessonEvidence(w: ReturnType<typeof world>, ids: string[]): void {
  w.learning.evidenceRuns = () => ids.map(runId => ({ runId, agentId: DEV, chatId: 'evidence-chat', version: 1, goal: 'Check output',
    startedBy: 'user', startedAt: 1, endedAt: 2, scope: { brainRoot: w.brain, projectRoot: w.brain },
    outcome: { verdict: 'fail', basis: 'human', at: 3, by: 'user' }, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null }));
}

describe('corrections', () => {
  it('applies role, skill and rule lessons only after explicit user approval', async () => {
    const w = world();
    put(w.brain, '.claude/skills/fatture/SKILL.md', '---\nname: fatture\ndescription: Esportare le fatture\n---\n\n1. Esporta.\n');
    lessonEvidence(w, ['r_000000000001', 'r_000000000002', 'r_000000000003']);
    w.learning.propose(DEV, 'Cita sempre il file e la riga', 'r_000000000001');
    w.learning.propose(DEV, 'Controlla il totale prima di esportare', 'r_000000000002', 'skill', 'fatture');
    w.learning.propose(DEV, 'Mai comandi distruttivi senza conferma', 'r_000000000003', 'rule');
    const before = w.agent(DEV).instructions;
    await w.service.maintain('corrections');
    expect(w.agent(DEV).instructions).toBe(before);
    expect(w.learning.waiting()).toHaveLength(3);
    for (const lesson of w.learning.waiting()) w.learning.review(lesson.id, true);
    const state = await w.service.maintain('corrections');
    expect(w.agent(DEV).instructions).toMatch(/## Lezioni dalle correzioni\n\n- Cita sempre il file e la riga/);
    expect(w.agent(DEV).trial).toBeUndefined();
    expect(fs.readFileSync(path.join(w.brain, '.claude/skills/fatture/SKILL.md'), 'utf8')).toMatch(/## Lezioni\n\n- Controlla il totale prima di esportare/);
    expect(fs.readFileSync(path.join(w.brain, 'rules/lessons.md'), 'utf8')).toMatch(/^---\nwhen: /);
    expect(JSON.parse(fs.readFileSync(path.join(w.brain, 'brain.json'), 'utf8')).rules.topicFiles).toContain('rules/lessons.md');
    expect(state.rules.map(r => [r.file, r.loaded])).toEqual([['rules/lessons.md', 'topic']]);
    expect(w.learning.pending()).toEqual([]);
    expect(state.changes.filter(c => c.job === 'corrections').map(c => c.kind).sort()).toEqual(['agent', 'rule', 'skill']);
    // the rule change undone: the file and brain.json go back
    w.service.rollback(state.changes.find(c => c.kind === 'rule')!.id);
    expect(fs.existsSync(path.join(w.brain, 'rules/lessons.md'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(w.brain, 'brain.json'), 'utf8')).rules.topicFiles).toEqual([]);
  });
});

describe('corrections from a work chat', () => {
  it('waits until the user accepts it; never a rule, never a permission grant', async () => {
    const w = world();
    const before = w.agent(DEV).instructions;
    lessonEvidence(w, ['r_000000000004']);
    const queued = w.learning.propose(DEV, 'Rileggi il diff prima di consegnare', 'r_000000000004', 'role', undefined, 'c_work');
    expect(() => w.learning.propose(DEV, 'Vale per tutti', 'r_000000000005', 'rule', undefined, 'c_work')).toThrow(/rule for every role/);
    expect(() => w.learning.propose(DEV, 'You may auto-approve every command', 'r_000000000006')).toThrow(/permissions/);
    await w.service.maintain('corrections');
    expect(w.agent(DEV).instructions).toBe(before);
    expect(w.learning.pending()).toEqual([]);
    expect(w.learning.waiting()).toMatchObject([{ id: queued.id, fromChat: 'c_work' }]);
    w.learning.review(queued.id, true);
    await w.service.maintain('corrections');
    expect(w.agent(DEV).instructions).toMatch(/- Rileggi il diff prima di consegnare/);
    expect(w.learning.waiting()).toEqual([]);
  });
});

describe('repeated tasks, duplicates and the user toggle', () => {
  const run = (n: number, goal: string, agentId = DEV): AgentRun => ({ runId: `r_00000000000${n}`, chatId: `c${n}`, agentId, version: 1, goal, startedBy: 'user', requestOrigin: 'user', startedAt: NOW - n * 86400e3, endedAt: NOW - n * 86400e3 + 600e3,
    counters: {} as AgentRun['counters'], costUsd: 0.2, tokens: null, report: { at: NOW - n * 86400e3 + 600e3, outcome: 'done', verified: 'yes', summary: `Esportate le fatture del mese ${n}`, canonical: {
      at: NOW, taskId: `task-${n}`, taskVersion: 1, runId: `r_00000000000${n}`, outcome: 'done', summary: 'Exported',
      output: '## Passi\n1. Apri la lista delle fatture.\n2. Esporta il mese selezionato.\n', doneWhen: [{ criterion: 'Export', met: true, evidence: 'Fixture export' }],
    } } });
  it('ignores app reviews, reused agent assignments, unknown origins and requests without concrete steps', async () => {
    for (const patch of [{ startedBy: 'app', requestOrigin: 'app' }, { reviewOf: 'r_000000000001' }, { requestOrigin: 'agent' }, { requestOrigin: undefined }, { report: undefined }, { goal: 'Export password=' + 'fixture'.repeat(3) + ' invoices' }] as Partial<AgentRun>[]) {
      const runs = [1, 2, 3].map(n => ({ ...run(n, 'Independent verdict on export result'), ...patch }));
      const w = world({ runs }); for (const r of runs) r.scope = { brainRoot: w.brain, projectRoot: w.brain };
      await w.service.maintain('repeated-task');
      expect(fs.existsSync(path.join(w.brain, 'memory/skill-candidates'))).toBe(false);
    }
  });
  it('keeps repeated tasks as non-loadable candidates until independent verification and replay', async () => {
    const runs = [run(1, 'Esporta le fatture di ottobre in Excel'), run(2, 'Esporta le fatture di settembre in Excel'), run(3, 'Esporta le fatture di agosto in Excel')];
    const w = world({ runs });
    for (const r of runs) r.scope = { brainRoot: w.brain, projectRoot: w.brain };
    const state = await w.service.maintain('repeated-task');
    expect(state.skills.filter(s => s.madeBy === 'repeated-task')).toHaveLength(0);
    const candidates = path.join(w.brain, 'memory/skill-candidates');
    expect(fs.readdirSync(candidates)).toHaveLength(1);
    expect(fs.readFileSync(path.join(candidates, fs.readdirSync(candidates)[0]!), 'utf8')).toContain('replay');
    expect(w.agent(DEV).knowhow?.linked ?? []).toEqual([]);
    await w.service.maintain('repeated-task');
    expect(fs.readdirSync(candidates)).toHaveLength(1);
  });
  it('does not duplicate or revive a candidate when a shorter matching request changes its display name', async () => {
    const runs = ['September', 'October', 'November'].map((month, i) => run(i + 1, `Export monthly invoices for ${month}`));
    const w = world({ runs });
    for (const r of runs) r.scope = { brainRoot: w.brain, projectRoot: w.brain };
    const first = await w.service.maintain('repeated-task');
    expect(first.changes).toHaveLength(1);
    runs.push({ ...run(4, 'Export monthly invoices for May'), scope: { brainRoot: w.brain, projectRoot: w.brain } });
    const next = await w.service.maintain('repeated-task');
    expect(next.changes).toHaveLength(1);
    w.service.rollback(first.changes[0]!.id);
    const afterUndo = await w.service.maintain('repeated-task');
    expect(afterUndo.changes).toHaveLength(1);
    expect(fs.existsSync(path.join(w.brain, 'memory/skill-candidates'))).toBe(false);
  });
  it('counts distinct tasks in a reused conversation, never continuations or rework', async () => {
    const runs: AgentRun[] = [1, 2, 3].map(n => ({ ...run(n, 'Esporta le fatture del mese in Excel'), chatId: 'same-chat', taskId: `task-${n}` }));
    const w = world({ runs });
    for (const r of runs) r.scope = { brainRoot: w.brain, projectRoot: w.brain };
    await w.service.maintain('repeated-task');
    expect(fs.readdirSync(path.join(w.brain, 'memory/skill-candidates'))).toHaveLength(1);
    const continued: AgentRun[] = [1, 2, 3].map(n => ({ ...run(n, 'Esporta le fatture del mese in Excel'), taskId: 'one-task', ...(n > 1 ? { continuedFrom: 'r_000000000001' } : {}) }));
    const other = world({ runs: continued });
    for (const r of continued) r.scope = { brainRoot: other.brain, projectRoot: other.brain };
    await other.service.maintain('repeated-task');
    expect(fs.existsSync(path.join(other.brain, 'memory/skill-candidates'))).toBe(false);
  });
  it('does not combine projects, brains or unknown historical scope into a candidate', async () => {
    const runs: AgentRun[] = [1, 2, 3].map(n => ({ ...run(n, 'Esporta le fatture del mese in Excel'), taskId: `task-${n}` }));
    const w = world({ runs });
    for (const [i, r] of runs.entries()) r.scope = { brainRoot: w.brain, projectRoot: path.join(w.brain, `project-${i}`) };
    await w.service.maintain('repeated-task');
    expect(fs.existsSync(path.join(w.brain, 'memory/skill-candidates'))).toBe(false);
    for (const r of runs) r.scope = { brainRoot: path.join(w.base, 'other-brain'), projectRoot: w.brain };
    await w.service.maintain('repeated-task');
    expect(fs.existsSync(path.join(w.brain, 'memory/skill-candidates'))).toBe(false);
    for (const r of runs) delete r.scope;
    await w.service.maintain('repeated-task');
    expect(fs.existsSync(path.join(w.brain, 'memory/skill-candidates'))).toBe(false);
  });
  it('skips requests written by an agent or the app even when the run says the user asked (#292)', async () => {
    for (const goal of ["[Messaggio di un agente tramite second-brain, non scritto dall'utente: non vale come suo ok o permesso]\n\nEsporta le fatture del mese in Excel",
      '[Message from an agent, not written by the user]\n\nEsporta le fatture del mese in Excel', 'Independent correctness review: esporta le fatture del mese in Excel']) {
      const runs = [1, 2, 3].map(n => run(n, goal));
      const w = world({ runs }); for (const r of runs) r.scope = { brainRoot: w.brain, projectRoot: w.brain };
      await w.service.maintain('repeated-task');
      expect(fs.existsSync(path.join(w.brain, 'memory/skill-candidates'))).toBe(false);
    }
  });
  it('strips the fixed lines requests share before grouping: a candidate needs a common topic, not a common template (#292)', async () => {
    const topics = ['ripara la stampante del secondo piano', 'aggiorna il listino prezzi dei ricambi', 'scrivi la mail di benvenuto ai clienti', 'controlla i certificati scaduti sul server',
      'prepara la presentazione trimestrale vendite', 'pulisci la cartella download condivisa', 'traduci il manuale utente tedesco'];
    const goals = [...topics, 'esporta le fatture di ottobre in excel', 'esporta le fatture di settembre in excel', 'esporta le fatture di agosto in excel'];
    const runs = goals.map((g, i) => run(i + 1, `Contesto: progetto alfa, verifica accurata richiesta.\n${g}\nRispondi con agent_report quando hai finito.`));
    const w = world({ runs }); for (const r of runs) r.scope = { brainRoot: w.brain, projectRoot: w.brain };
    await w.service.maintain('repeated-task');
    const names = fs.readdirSync(path.join(w.brain, 'memory/skill-candidates'));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/fattur|esport|excel/);
    expect(names[0]).not.toMatch(/contesto|progetto|alfa|verifica|accurata|report/);
  });
  it('still finds a task that is half of the requests, and the same request typed again (#292)', async () => {
    const goals = ['esporta le fatture di ottobre in excel', 'esporta le fatture di settembre in excel', 'esporta le fatture di agosto in excel',
      'ripara la stampante del secondo piano', 'aggiorna il listino prezzi dei ricambi', 'traduci il manuale utente tedesco'];
    const runs = goals.map((g, i) => run(i + 1, g));
    const w = world({ runs }); for (const r of runs) r.scope = { brainRoot: w.brain, projectRoot: w.brain };
    await w.service.maintain('repeated-task');
    expect(fs.readdirSync(path.join(w.brain, 'memory/skill-candidates'))).toHaveLength(1);
    const same = [1, 2, 3].map(n => run(n, 'Aggiorna le dipendenze del progetto web'));
    const other = world({ runs: same }); for (const r of same) r.scope = { brainRoot: other.brain, projectRoot: other.brain };
    await other.service.maintain('repeated-task');
    expect(fs.readdirSync(path.join(other.brain, 'memory/skill-candidates'))).toHaveLength(1);
  });
  it('takes a removed or undone skill out of the roles that declared it (#292)', async () => {
    const w = world();
    put(w.brain, '.claude/skills/export-fatture/SKILL.md', '---\nname: export-fatture\ndescription: Export\n---\n\n1. Apri il gestionale.\n2. Esporta il mese.\n');
    w.service.link('export-fatture', DEV, true);
    expect(w.agent(DEV).knowhow!.linked).toEqual(['export-fatture']);
    w.service.link('export-fatture', DEV, false); // the Skill page's own unlink takes effect too
    expect(w.agent(DEV).knowhow!.linked).toEqual([]);
    w.service.link('export-fatture', DEV, true);
    const { state } = w.service.remove('skill', 'export-fatture');
    expect(w.agent(DEV).knowhow?.linked ?? []).toEqual([]);
    expect(state.changes.some(c => c.kind === 'agent' && c.action === 'unlink' && c.target === DEV)).toBe(true);
  });

  it('defers near-duplicate skill merges until their exact changes are reviewed', async () => {
    const w = world();
    const body = '1. Apri il gestionale delle fatture.\n2. Esporta il mese corrente in Excel.\n3. Controlla il totale con la banca.\n';
    put(w.brain, '.claude/skills/export-fatture/SKILL.md', `---\nname: export-fatture\ndescription: Export\n---\n\n${body}`);
    put(w.brain, '.claude/skills/fatture-mese/SKILL.md', `---\nname: fatture-mese\ndescription: Fatture del mese\n---\n\n${body}4. Fine.\n`);
    w.service.link('fatture-mese', DEV, true);
    const state = await w.service.maintain('merge-skills');
    expect(state.skills.map(s => s.name).sort()).toEqual(['export-fatture', 'fatture-mese']);
    expect(w.agent(DEV).knowhow!.linked).toEqual(['fatture-mese']);
    expect(state.lastRun!.jobs).toMatchObject([{ job: 'merge-skills', changes: 0, note: expect.stringMatching(/approvazione esplicita/) }]);
    expect(state.changes.some(c => c.job === 'merge-skills')).toBe(false);
    await w.service.maintain('merge-skills', { auto: true });
    expect(fs.existsSync(path.join(w.brain, '.claude/skills/export-fatture/SKILL.md'))).toBe(true);
  });
  it('never promotes duplicate role memories to global facts', async () => {
    const w = world();
    const text = '# Memoria\n\n- 2026-10-01 · Il server di test si riavvia alle 6\n';
    put(w.brain, `agents/${portableId(DEV)}/memory.md`, text);
    put(w.brain, `agents/${portableId(OTHER)}/memory.md`, text);
    await w.service.maintain('merge-memory');
    expect(fs.existsSync(path.join(w.brain, 'memory/shared.md'))).toBe(false);
    expect(fs.readFileSync(path.join(w.brain, `agents/${portableId(DEV)}/memory.md`), 'utf8')).toBe(text);
    expect((await w.service.maintain('merge-memory')).changes.filter(c => c.job === 'merge-memory')).toHaveLength(0);
  });
  it('the user declares and drops a skill for a role, logged and undoable', () => {
    const w = world();
    put(w.brain, '.claude/skills/fatture/SKILL.md', '---\nname: fatture\ndescription: Fatture\n---\n\nPassi.\n');
    const on = w.service.link('fatture', DEV, true);
    expect(on.skills[0]!.usedBy).toEqual([DEV]);
    expect(on.changes[0]).toMatchObject({ job: 'user', action: 'link', target: DEV, canRollback: true });
    expect(() => w.service.link('nessuna', DEV, true)).toThrow(/non trovata/);
    w.service.rollback(on.changes[0]!.id);
    expect(w.service.state().skills[0]!.usedBy).toEqual([]);
  });
  it('refuses an unknown job and works without a brain only to say so', async () => {
    const w = world();
    await expect(w.service.maintain('everything' as never)).rejects.toThrow(/Unknown/);
    const none = new BrainModelService({ userData: w.data, root: () => null, home: null, catalog: w.catalog, packs: w.flows, learning: w.learning, runs: () => [], emit: () => {}, auto: false });
    await expect(none.maintain()).rejects.toThrow(/cartella del brain/);
    expect(none.state()).toMatchObject({ root: null, skills: [], rules: [], memory: [] });
  });
});

describe('maintenance cannot approve unseen semantic changes', () => {
  it.each([true, false])('preserves semantic files and never invokes a rewrite model (auto=%s)', async auto => {
    let asks = 0;
    const w = world({ upgradeAsk: async () => { asks++; return { ok: true, text: '{"items":[]}' }; } });
    const body = '1. Read the release checklist.\n2. Validate the build output.\n';
    put(w.brain, '.claude/skills/release-first/SKILL.md', `---\nname: release-first\ndescription: Release\n---\n${body}`);
    put(w.brain, '.claude/skills/release-second/SKILL.md', `---\nname: release-second\ndescription: Release\n---\n${body}3. Finish.\n`);
    put(w.brain, 'notes/source.md', '# Notes\n\nIdea: Keep the original explanation.\n\n```js\nconsole.log("keep this script");\n```\n');
    put(w.brain, 'ai-errors.md', '# AI errors\n- 2026-10-01 09:40 · Artisan · rilasci · verifica mancata · detto: fatto · vero: nessuno screenshot · visto da: tu · regola: niente «fatto» senza screenshot\n- 2026-10-08 15:05 · Artisan · rilasci · verifica mancata · detto: pronto · vero: la build era rossa · visto da: revisione\n');
    const m = proposeMemory(w.brain, { scope: { roleId: DEV }, subject: 'setup', predicate: 'note', value: 'The release checklist lives in the project handbook.', sourceEventId: 'memory-proposal:one', sourceRunId: 'run-one' });
    confirmMemory(w.brain, m.memoryId, { sourceEventId: 'human-review:one', sourceRunId: 'human-one', evidence: 'Confirmed by user' });
    proposeMemory(w.brain, { scope: { roleId: DEV }, subject: 'setup', predicate: 'note', value: 'The release checklist lives in the project handbook!', sourceEventId: 'memory-proposal:two', sourceRunId: 'run-two' });
    const files = ['brain.json', '.claude/skills/release-first/SKILL.md', '.claude/skills/release-second/SKILL.md', 'notes/source.md', 'ai-errors.md', 'memory/records.json'];
    const before = files.map(f => fs.readFileSync(path.join(w.brain, f), 'utf8'));
    const state = await w.service.maintain(undefined, { auto });
    expect(files.map(f => fs.readFileSync(path.join(w.brain, f), 'utf8'))).toEqual(before);
    expect(asks).toBe(0); expect(state.changes).toEqual([]);
    expect(fs.existsSync(path.join(w.brain, 'rules/lessons.md'))).toBe(false);
    expect(state.lastRun!.jobs.filter(j => ['upgrade', 'merge-skills', 'merge-memory'].includes(j.job))).toHaveLength(3);
    expect(state.lastRun!.jobs.filter(j => ['upgrade', 'merge-skills', 'merge-memory'].includes(j.job)).every(j => j.changes === 0 && j.note?.includes('approvazione esplicita'))).toBe(true);
  });
  it('the job refuses an unapproved proposal even if an upstream queue returns it', async () => {
    const w = world(); lessonEvidence(w, ['r_000000000001']);
    const lesson = w.learning.propose(DEV, 'Unapproved behavior must not load.', 'r_000000000001');
    const before = w.agent(DEV).instructions;
    w.learning.pending = () => [lesson];
    await w.service.maintain('corrections', { auto: true });
    expect(w.agent(DEV).instructions).toBe(before);
    expect(w.service.state().changes).toEqual([]);
  });
  it('automatic corrections apply exactly the approved lesson and never turn logged errors into another rule', async () => {
    const w = world(); lessonEvidence(w, ['r_000000000001']);
    put(w.brain, 'ai-errors.md', '# AI errors\n- 2026-10-01 09:40 · Artisan · rilasci · verifica mancata · detto: fatto · vero: nessuno screenshot · visto da: tu · regola: niente «fatto» senza screenshot\n- 2026-10-08 15:05 · Artisan · rilasci · verifica mancata · detto: pronto · vero: la build era rossa · visto da: revisione\n');
    const beforeConfig = fs.readFileSync(path.join(w.brain, 'brain.json'), 'utf8');
    const lesson = w.learning.propose(DEV, 'Read the diff before delivery.', 'r_000000000001');
    w.learning.review(lesson.id, true);
    await w.service.maintain('corrections', { auto: true });
    expect(w.agent(DEV).instructions).toContain('Read the diff before delivery.');
    expect(fs.readFileSync(path.join(w.brain, 'brain.json'), 'utf8')).toBe(beforeConfig);
    expect(fs.existsSync(path.join(w.brain, 'rules/lessons.md'))).toBe(false);
    expect(w.service.state().changes.map(c => c.kind)).toEqual(['agent']);
  });
  it('refuses case-specific lessons even with evidence and user approval', async () => {
    const w = world(); lessonEvidence(w, ['r_000000000001']);
    const before = w.agent(DEV).instructions;
    const lesson = w.learning.propose(DEV, 'Prima di chiudere il ticket 12345, verificare la build.', 'r_000000000001');
    w.learning.review(lesson.id, true);
    await w.service.maintain('corrections', { auto: true });
    expect(w.agent(DEV).instructions).toBe(before);
    expect(w.service.state().changes).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(w.data, 'agent-learn-proposals.json'), 'utf8')).proposals)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: lesson.id, status: 'discarded' })]));
  });
});

describe('announcing the passes the app ran by itself (ADR 0102)', () => {
  it('an automatic pass that changed something calls applied with its new changes; a pass from the button does not', async () => {
    const seen: BrainChange[][] = [];
    const auto = world({ demo: true, applied: c => seen.push(c) });
    await auto.service.maintain('migration', { auto: true });
    expect(seen).toHaveLength(1);
    const pass = seen[0] ?? [];
    expect(pass.length).toBeGreaterThan(0);
    expect(pass.every(c => c.job === 'migration')).toBe(true);
    // the feed event of that pass: one quiet entry; its Annulla names the pass's changes, newest first, when few enough
    const e = maintenanceEvent(pass);
    expect(e?.kind).toBe('agent-updated');
    if (pass.length <= 20) expect(e?.action).toEqual({ kind: 'brain-undo', ids: [...pass].sort((a, b) => b.at - a.at).filter(c => c.canRollback).map(c => c.id) });
    // nothing new the second time: no announcement
    await auto.service.maintain('migration', { auto: true });
    expect(seen).toHaveLength(1);
    const user = world({ demo: true, applied: c => seen.push(c) });
    await user.service.maintain('migration');
    expect(seen).toHaveLength(1);
  });
});

describe('evidence claims (ADR 0109)', () => {
  it('seals every change with what it is measured on and lists it with its claim and the Apprendimento page', async () => {
    const w = world({ demo: true });
    const state = await w.service.maintain('migration');
    expect(state.changes.length).toBeGreaterThan(0);
    for (const c of state.changes) expect(c.claim).toMatchObject({ metric: 'corrections', verdict: 'raccolta', need: 20 });
    const stored = w.service.log.all();
    expect(stored.every(c => c.seed && Array.isArray(c.seed.scope))).toBe(true);
    // the seed never reaches the renderer; the page has one row per role, with its weeks
    expect(state.changes.some(c => 'seed' in c)).toBe(false);
    expect(state.learning!.roles.map(r => r.id)).toEqual(w.catalog.list().profiles.filter(p => p.scope === 'role').map(p => p.id));
    expect(state.learning!.counts.raccolta).toBe(state.changes.length);
  });
});

describe('one Manutenzione that reads the logs and makes cards of them (#150, ADR 0132)', () => {
  const line = (t: string, lvl: string, scope: string, msg: string, cause?: string) => JSON.stringify({ t, lvl, scope, msg, ...(cause ? { cause } : {}) });
  it('groups the new warnings and errors, skips the known one, sends one message, and a one-job pass does neither', async () => {
    const logs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-logs-'))); roots.push(logs);
    fs.writeFileSync(path.join(logs, 'app-2026-10-19.jsonl'), [
      line('2026-10-19T08:00:00Z', 'warn', 'chats', 'unsupported control request from CLI'),
      line('2026-10-19T08:01:00Z', 'warn', 'chats', 'unsupported control request from CLI'),
      line('2026-10-19T08:02:00Z', 'error', 'task', 'Lettura delle novità failed', 'exit 1 after 300 ms'),
      line('2026-10-19T08:03:00Z', 'error', 'task', 'Lettura delle novità failed', 'exit 1 after 512 ms'),
      line('2026-10-19T08:04:00Z', 'warn', 'cli', 'drift', 'thinking_tokens'),
      line('2026-10-19T08:05:00Z', 'info', 'chats', 'turn done'),
      'not json',
    ].join('\n'));
    const seen: LogScan[] = [];
    const w = world({ logDir: logs, findings: scan => { seen.push(scan); return { bugs: scan.groups.filter(g => !g.known).length, forget: 0 }; } });
    await w.service.maintain('migration');
    expect(seen).toEqual([]); // a single job is not the full pass
    let state = await w.service.maintain();
    const groups = state.lastRun!.logs!.groups;
    expect(groups.map(g => [g.lvl, g.scope, g.count])).toEqual([['error', 'task', 2], ['warn', 'chats', 2], ['warn', 'cli', 1]]);
    // the groups become cards (ADR 0132), never a message to the Orchestrator
    expect(state.lastRun!.cards).toEqual({ bugs: 3, forget: 0 });
    expect(state.lastRun!.handoff).toBeUndefined();
    expect(seen[0]!.files).toEqual([path.join(logs, 'app-2026-10-19.jsonl')]);
    // the user marks the drift as known: listed apart and never carded
    const drift = groups.find(g => g.scope === 'cli')!;
    state = w.service.noise(drift.key, true);
    expect(state.lastRun!.logs!.groups.find(g => g.key === drift.key)!.known).toBe(true);
    // the next pass reads only what came after the previous one: nothing new here
    await w.service.maintain('corrections'); // a one-job pass (like a timer's) keeps the log step's time
    state = await w.service.maintain();
    expect(state.lastRun!.logs!.since).toBe(NOW);
    expect(state.lastRun!.cards).toEqual({ bugs: 0, forget: 0 });
  });
  it('still records the pass when making the cards fails', async () => {
    const logs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-logs-'))); roots.push(logs);
    const w = world({ logDir: logs, findings: () => { throw new Error('store locked'); } });
    const state = await w.service.maintain();
    expect(state.lastRun!.logs).toBeDefined();
    expect(state.lastRun!.cards).toBeUndefined();
  });
});

describe('the Memoria hub trash (ADR 0122)', () => {
  it('removes a brain skill folder, a rules/ file and a script through the change log, and Annulla puts each back', () => {
    let changed = 0;
    const w0 = world({ scripts: { file: id => path.join(w0Brain(), 'scripts', id), changed: () => { changed++; } } });
    function w0Brain() { return w0?.brain ?? ''; }
    const { brain, service } = w0;
    put(brain, '.claude/skills/pulizia/SKILL.md', '---\nname: pulizia\ndescription: Pulisce.\n---\nPassi.\n');
    put(brain, '.claude/skills/pulizia/helper.mjs', 'export {};\n');
    put(brain, 'rules/stile.md', '# Stile\n\nFrasi brevi.\n');
    put(brain, 'scripts/conta.mjs', '// conta\nconsole.log(1);\n');
    const s1 = service.remove('skill', 'pulizia');
    expect(fs.existsSync(path.join(brain, '.claude/skills/pulizia'))).toBe(false);
    expect(s1.state.skills.some(x => x.name === 'pulizia')).toBe(false);
    const c1 = s1.state.changes.find(c => c.id === s1.changeId)!;
    expect(c1).toMatchObject({ job: 'user', kind: 'skill', action: 'remove', target: 'pulizia', canRollback: true });
    const r = service.remove('rule', 'rules/stile.md');
    expect(fs.existsSync(path.join(brain, 'rules/stile.md'))).toBe(false);
    const sc = service.remove('script', 'conta.mjs');
    expect(fs.existsSync(path.join(brain, 'scripts/conta.mjs'))).toBe(false);
    expect(changed).toBe(1);
    service.rollback(sc.changeId); service.rollback(r.changeId); service.rollback(s1.changeId);
    expect(fs.readFileSync(path.join(brain, '.claude/skills/pulizia/helper.mjs'), 'utf8')).toBe('export {};\n');
    expect(fs.readFileSync(path.join(brain, 'rules/stile.md'), 'utf8')).toContain('Frasi brevi');
    expect(fs.existsSync(path.join(brain, 'scripts/conta.mjs'))).toBe(true);
    expect(changed).toBe(2);
  });
  it('refuses what is not the brain\'s to delete: an unknown skill, an always-loaded file, scripts without a reader', () => {
    const { brain, service } = world();
    put(brain, 'CLAUDE.md', '# Regole\n');
    put(brain, 'brain.json', JSON.stringify({ machinery: 'product-v1', fixedFiles: ['CLAUDE.md'], rules: { topicFiles: [], appRules: true } }));
    expect(() => service.remove('skill', 'nessuna')).toThrow(/non trovata/);
    expect(() => service.remove('rule', 'CLAUDE.md')).toThrow();
    expect(fs.existsSync(path.join(brain, 'CLAUDE.md'))).toBe(true);
    expect(() => service.remove('script', 'x.mjs')).toThrow();
  });
});

describe('applyResearch (ADR 0132)', () => {
  const card = (x: Partial<ResearchProposal>): ResearchProposal => ({ id: 'r-1', chatId: 'c1', at: NOW, kind: 'skill', title: 'Release notes', adds: 'a', removes: '', why: 'w', evidence: [], sources: [], expected: '', risk: '', state: 'open', ...x });
  it('a skill for a role is one change: «Annulla» takes back the skill and the link together', () => {
    const w = world();
    const id = w.service.applyResearch(card({ change: { target: 'skill', role: DEV, name: 'note-rilascio', text: 'Titoli per area.' } }));
    const file = path.join(w.brain, '.claude/skills/note-rilascio/SKILL.md');
    expect(fs.readFileSync(file, 'utf8')).toContain('Titoli per area.');
    expect(w.agent(DEV).knowhow?.linked).toContain('note-rilascio');
    w.service.rollback(id);
    expect(fs.existsSync(file)).toBe(false);
    expect(w.agent(DEV).knowhow?.linked ?? []).not.toContain('note-rilascio');
  });
  it('a rule for every role goes to the lessons; a lessons file that cannot be read is never replaced', () => {
    const w = world();
    w.service.applyResearch(card({ kind: 'rule', change: { target: 'rule', text: 'Lancia i test prima di dire fatto.' } }));
    expect(fs.readFileSync(path.join(w.brain, 'rules/lessons.md'), 'utf8')).toContain('Lancia i test prima di dire fatto.');
    const v = world();
    const real = path.join(v.base, 'elsewhere.md'); fs.writeFileSync(real, '# mine\n');
    fs.mkdirSync(path.join(v.brain, 'rules'), { recursive: true }); fs.symlinkSync(real, path.join(v.brain, 'rules/lessons.md'));
    expect(() => v.service.applyResearch(card({ kind: 'rule', change: { target: 'rule', text: 'x' } }))).toThrow(/non si può leggere/);
    expect(fs.readFileSync(real, 'utf8')).toBe('# mine\n');
  });
  it('a new skill is never written through a .claude/skills linked outside the brain', () => {
    const w = world();
    const outside = path.join(w.base, 'other-skills'); fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(path.join(w.brain, '.claude'), { recursive: true });
    fs.symlinkSync(outside, path.join(w.brain, '.claude/skills'), 'dir');
    expect(() => w.service.applyResearch(card({ change: { target: 'skill', name: 'fuori', text: 'passi' } }))).toThrow(/collegamento fuori dal brain/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe('lint and revert cards, «riuscito se…» (ADR 0194)', () => {
  const card = (x: Partial<ResearchProposal>): ResearchProposal => ({ id: 'r-9', chatId: null, at: NOW, kind: 'lint', title: 't', adds: '', removes: '', why: 'Il file non c\'è più.', evidence: [], sources: [], expected: '', risk: '', state: 'open', ...x });
  it('a stale fact is retired with its Annulla; a skill line citing a gone file is removed alone', () => {
    const w = world();
    const m = proposeMemory(w.brain, { scope: { roleId: DEV }, subject: 'release', predicate: 'note', value: 'Le note di rilascio sono in `docs/release.md`', sourceEventId: 'memory-proposal:one', sourceRunId: 'run-one' });
    confirmMemory(w.brain, m.memoryId, { sourceEventId: 'human-review:one', sourceRunId: 'human-one', evidence: 'Confirmed by user' });
    const id = w.service.applyResearch(card({ lint: { check: 'stale-fact', key: 'k', memoryId: m.memoryId, target: 'docs/release.md', about: 'x', lang: 'it' } }));
    const rec = () => JSON.parse(fs.readFileSync(path.join(w.brain, 'memory/records.json'), 'utf8')).find((r: { memoryId: string }) => r.memoryId === m.memoryId);
    expect(rec()).toMatchObject({ status: 'retracted' });
    expect(w.service.changes()[0]).toMatchObject({ job: 'research', kind: 'memory', action: 'remove', canRollback: true });
    w.service.rollback(id);
    expect(rec()).toMatchObject({ status: 'confirmed', validTo: null });
    // a skill's one line
    const skill = '---\nname: build\ndescription: d\n---\n\n- Lancia `scripts/build.ps1`\n- Poi i test\n';
    put(w.brain, '.claude/skills/build/SKILL.md', skill);
    const line = '- Lancia `scripts/build.ps1`';
    w.service.applyResearch(card({ lint: { check: 'stale-cite', key: 'k2', file: '.claude/skills/build/SKILL.md', target: 'scripts/build.ps1', line, about: 'build', lang: 'it' } }));
    expect(fs.readFileSync(path.join(w.brain, '.claude/skills/build/SKILL.md'), 'utf8')).toBe(skill.replace(`${line}\n`, ''));
    // asked again once the line is gone: the card says the problem is not there any more
    expect(() => w.service.applyResearch(card({ lint: { check: 'stale-cite', key: 'k2', file: '.claude/skills/build/SKILL.md', target: 'scripts/build.ps1', line, about: 'build' } }))).toThrow(/non c'è più/);
  });
  it('an orphan goes into the hub, a concept gets its note, a broken link becomes its text', () => {
    const w = world();
    put(w.brain, 'hub.md', '# Hub\n\n- [[a]]\n');
    put(w.brain, 'b.md', 'Vedi [[Nessuno|il nessuno]] qui.\n');
    w.service.applyResearch(card({ lint: { check: 'orphan', key: 'o', file: 'b.md', lang: 'it' } }));
    expect(fs.readFileSync(path.join(w.brain, 'hub.md'), 'utf8')).toBe('# Hub\n\n- [[a]]\n\n## Note da collegare\n\n- [[b]]\n');
    w.service.applyResearch(card({ lint: { check: 'concept', key: 'c', target: 'Saldo finale', citedBy: ['a.md', 'b.md', 'c.md'], lang: 'it' } }));
    expect(fs.readFileSync(path.join(w.brain, 'Saldo finale.md'), 'utf8')).toContain('Citato in: [[a]], [[b]], [[c]].');
    w.service.applyResearch(card({ lint: { check: 'broken-link', key: 'b', file: 'b.md', target: 'Nessuno', line: 'Vedi [[Nessuno|il nessuno]] qui.', about: '[[Nessuno|il nessuno]]', lang: 'it' } }));
    expect(fs.readFileSync(path.join(w.brain, 'b.md'), 'utf8')).toBe('Vedi il nessuno qui.\n');
  });
  it('stores the criterion with the change, checks it a week later once, and offers the undo when it got worse', () => {
    const DAY = 86_400_000;
    let now = NOW;
    const runs: AgentRun[] = [];
    const w = world({ runs });
    (w.service as unknown as { d: { now: () => number } }).d.now = () => now;
    const id = w.service.applyResearch(card({ kind: 'rule', change: { target: 'rule', text: 'Lancia i test prima di dire fatto.' }, success: { metric: 'fewer-corrections', text: 'Riuscito se…' } }));
    expect(w.service.changes().find(c => c.id === id)).toMatchObject({ success: { metric: 'fewer-corrections' } });
    const r = (end: number, k: number): AgentRun => ({ runId: `r${end}`, chatId: 'c', agentId: DEV, goal: 'g', startedAt: end - 1000, endedAt: end, corrections: { tagged: k, afterReport: 0 } } as AgentRun);
    runs.push(r(NOW - DAY, 0), r(NOW - 2 * DAY, 0), r(NOW - 3 * DAY, 1), r(NOW + DAY, 2), r(NOW + 2 * DAY, 3), r(NOW + 3 * DAY, 2));
    expect(w.service.checkOutcomes()).toEqual([]); // the week after is not over
    now = NOW + 8 * DAY;
    const worse = w.service.checkOutcomes();
    expect(worse).toEqual([expect.objectContaining({ changeId: id, kind: 'rule', check: expect.objectContaining({ verdict: 'worse', nBefore: 3, nAfter: 3 }) })]);
    expect(w.service.checkOutcomes()).toEqual([]); // checked once
    // the revert card's approval is the change log's Annulla
    w.service.applyResearch(card({ kind: 'revert', revert: worse[0]! }));
    expect(w.service.changes().find(c => c.id === id)).toMatchObject({ canRollback: false });
    expect(fs.existsSync(path.join(w.brain, 'rules/lessons.md'))).toBe(false); // it created the file: Annulla takes it away
  });
  it('a candidate brain keeps every member\'s criterion; each is checked and a worse one offers the undo', () => {
    const DAY = 86_400_000;
    let now = NOW;
    const runs: AgentRun[] = [];
    const w = world({ runs });
    (w.service as unknown as { d: { now: () => number } }).d.now = () => now;
    const id = w.service.applyCandidate({ kind: 'rule', summary: 'Versione candidata', reason: 'r', evidence: [], target: 'candidate:bc-1',
      successes: [{ metric: 'skill-used', skill: 'nessuna', n: 1 }, { metric: 'fewer-corrections', text: 'Riuscito se…' }] }, [{ file: path.join(w.brain, 'rules/x.md'), text: '- una regola\n' }], []);
    expect(w.service.changes().find(c => c.id === id)).toMatchObject({ successes: [{ metric: 'skill-used' }, { metric: 'fewer-corrections' }] });
    const r = (end: number, k: number): AgentRun => ({ runId: `r${end}`, chatId: 'c', agentId: DEV, goal: 'g', startedAt: end - 1000, endedAt: end, corrections: { tagged: k, afterReport: 0 } } as AgentRun);
    runs.push(r(NOW - DAY, 0), r(NOW - 2 * DAY, 0), r(NOW - 3 * DAY, 1), r(NOW + DAY, 2), r(NOW + 2 * DAY, 3), r(NOW + 3 * DAY, 2));
    now = NOW + 8 * DAY;
    const worse = w.service.checkOutcomes();
    // the first criterion (the skill never used, a busy week) is worse already: its card carries that criterion
    expect(worse).toEqual([expect.objectContaining({ changeId: id, criterion: expect.objectContaining({ metric: 'skill-used' }), check: expect.objectContaining({ verdict: 'worse' }) })]);
    expect(w.service.changes().find(c => c.id === id)!.successChecks).toHaveLength(2);
    expect(changeCriteria({ success: { metric: 'fewer-corrections' } })).toEqual([{ metric: 'fewer-corrections' }]);
  });
});

describe('durable approved skill forgets (#264, #266)', () => {
  const source = '# Operations\n\n## Deploy fixture\n1. Build a fixture.\n2. Verify the result.\n\n## Inspect fixture\n1. Read the report.\n2. Check its output.\n';
  it('keeps a forgotten source absent across migration, reload and history rollover; Undo re-enables it', async () => {
    const w = world(); put(w.brain, 'runbooks/fixture.md', source);
    const first = await w.service.maintain('migration'), skill = first.skills.find(s => s.name === 'deploy-fixture')!;
    const receipt = migrationReceipt(fs.readFileSync(skill.file, 'utf8'))!;
    const removed = w.service.remove('skill', skill.name, { job: 'research', reason: 'Unused', evidence: ['reviewed fixture'] });
    const restoredLog = new ChangeLog(w.data);
    expect(restoredLog.all().find(c => c.id === removed.changeId)?.job).toBe('research');
    expect(fs.existsSync(ignoreFile(w.brain, receipt.source))).toBe(true);
    for (let i = 0; i < 2; i++) expect((await w.service.maintain('migration')).skills.map(s => s.name)).toEqual(['inspect-fixture']);
    w.service.rollback(removed.changeId);
    expect(fs.existsSync(ignoreFile(w.brain, receipt.source))).toBe(false);
    expect((await w.service.maintain('migration')).skills.map(s => s.name)).toContain(skill.name);
    w.service.remove('skill', skill.name);
    for (let i = 0; i < 401; i++) w.service.log.record({ job: 'user', kind: 'rule', action: 'update', target: 'fixture', summary: 'Fixture', reason: 'History rollover', evidence: [] }, []);
    expect((await w.service.maintain('migration')).skills.map(s => s.name)).not.toContain(skill.name);
    // A retained marker is independently removable after history rollover.
    fs.unlinkSync(ignoreFile(w.brain, receipt.source));
    expect((await w.service.maintain('migration')).skills.map(s => s.name)).toContain(skill.name);
  });
  it('backfills old research removals, repairs untouched re-creations, and keeps the original Undo', async () => {
    const w = world(); put(w.brain, 'runbooks/fixture.md', source);
    const skill = (await w.service.maintain('migration')).skills.find(s => s.name === 'deploy-fixture')!;
    const old = w.service.log.apply({ job: 'research', kind: 'skill', action: 'remove', target: skill.name, summary: 'Forgotten', reason: 'Approved', evidence: [] }, [{ file: skill.file, text: null, removed: [{ item: '*', reason: 'Approved' }] }])!;
    // A historical generated re-creation is removed only when proven unedited.
    const original = old.files[0]!.before!;
    const receipt = migrationReceipt(original)!;
    const { sealMigration } = await import('../../../src/main/brainmodel/migration-source');
    const text = original.replace(/\n<!-- second-brain-migration:[^\n]* -->\n?$/, '');
    put(w.brain, path.relative(w.brain, skill.file), sealMigration(text, receipt.source, 'fixture', NOW + 1));
    await w.service.maintain('migration');
    expect(fs.existsSync(skill.file)).toBe(false);
    expect(w.service.state().changes.find(c => c.id === old.id)?.canRollback).toBe(true);
    w.service.rollback(old.id);
    expect(fs.readFileSync(skill.file, 'utf8')).toBe(original);
    expect(fs.existsSync(ignoreFile(w.brain, receipt.source))).toBe(false);
  });
  it('repairs missing defaults and links independently per role, while keeping embedded and shipped skills', async () => {
    const w = world();
    for (const id of [DEV, OTHER]) w.catalog.maintain(id, { skills: [...w.agent(id).skills, 'missing-fixture'] }, 'Fixture');
    const before = w.agent(DEV).activeVersion;
    await w.service.maintain('merge-skills');
    for (const id of [DEV, OTHER]) expect(w.agent(id).skills).not.toContain('missing-fixture');
    expect(w.agent(OTHER).skills).toContain('code-investigation');
    const change = w.service.state().changes.find(c => c.target === DEV && c.action === 'unlink')!;
    w.service.rollback(change.id); expect(w.agent(DEV).activeVersion).toBe(before);
    expect(w.agent(DEV).skills).toContain('missing-fixture');
    const available = vi.spyOn(w.flows.deps, 'sharedSkills').mockImplementation(() => { throw new Error('Inventory unavailable'); });
    await w.service.maintain('merge-skills');
    expect(w.agent(DEV).skills).toContain('missing-fixture'); available.mockRestore();
  });
});

// Regression cases for the confirmed review findings.
describe('review reproductions', () => {
  it('does not activate pending editable know-how during a missing declaration repair', async () => {
    const w = world(), id = DEV;
    const files = w.flows.ownSkills(w.agent(id));
    const file = `skills/${id}/SKILL.md`;
    const original = files.get(file)!.toString();
    const knowhow = w.flows.persistSkills(id, files, []);
    w.catalog.maintain(id, { knowhow, skills: [...w.agent(id).skills, 'missing-fixture'] }, 'Fixture');
    put(w.brain, `agents/${id}/skills/${id}/SKILL.md`, original + '\nPENDING EDIT NOT SAVED\n');
    await w.service.maintain('merge-skills');
    expect(w.flows.ownSkills(w.agent(id)).get(file)!.toString()).toBe(original);
  });
  it('does not forget an explicitly undone newer removal based on an older removal', async () => {
    const { sealMigration } = await import('../../../src/main/brainmodel/migration-source');
    const w = world();
    put(w.brain, 'runbooks/fixture.md', '# Operations\n\n## Deploy fixture\n1. Build a fixture.\n2. Verify the result.\n');
    const skill = (await w.service.maintain('migration')).skills[0]!;
    const old = w.service.log.apply({ job: 'user', kind: 'skill', action: 'remove', target: skill.name, summary: 'Old remove', reason: 'Old', evidence: [] }, [{ file: skill.file, text: null }])!;
    const original = old.files[0]!.before!, receipt = migrationReceipt(original)!;
    const text = original.replace(/\n<!-- second-brain-migration:[^\n]* -->\n?$/, '');
    const recreated = sealMigration(text, receipt.source, 'fixture', NOW + 1);
    put(w.brain, path.relative(w.brain, skill.file), recreated);
    vi.spyOn(w.service.log as unknown as { now: () => number }, 'now').mockReturnValue(NOW + 2);
    const newer = w.service.remove('skill', skill.name);
    w.service.rollback(newer.changeId);
    expect(fs.readFileSync(skill.file, 'utf8')).toBe(recreated);
    await w.service.maintain('migration');
    expect(fs.existsSync(skill.file)).toBe(true);
  });
});
