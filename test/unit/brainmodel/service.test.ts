// The brain model service end to end (ADR 0077) over a real catalog, pack flows and lessons queue, temp folders only:
// the one-time migration turns the former runbook / routines sections into skills declared by the right agents (content
// kept, credentials masked, originals untouched, idempotent, with a report); every job changes things by itself with a
// change log entry and an undo, and never redoes what the user undid; the user's skill toggle is logged too; a lesson
// goes to the role, a skill or a rule; repeated tasks become a skill; duplicate skills and memories are merged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { AgentPackFlows, portableId } from '../../../src/main/agents/pack/flows';
import { AgentPackLearning } from '../../../src/main/agents/pack/learning';
import { BrainModelService } from '../../../src/main/brainmodel/service';
import { writeDemoBrain } from '../../../src/main/brainmodel/demo';
import { GENERAL_AGENT_ID, ORCHESTRATOR_AGENT_ID, type AgentModelChoice, type AgentRun } from '../../../src/shared/agents';
import type { RoutingInfo } from '../../../src/shared/contract';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const NOW = Date.parse('2026-10-19T09:00:00Z');
const DEV = 'default-implementer';
const routing: RoutingInfo = { table: null, registry: null, kinds: [], error: null, history: [] };

function world(opts: { demo?: boolean; runs?: AgentRun[] } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-brainmodel-'))); roots.push(base);
  const data = path.join(base, 'data'); fs.mkdirSync(data);
  const brain = opts.demo ? writeDemoBrain(path.join(base, 'brain'), NOW) : path.join(base, 'brain');
  if (!opts.demo) { fs.mkdirSync(brain); put(brain, 'brain.json', JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: [], appRules: true } })); }
  const catalog = new AgentCatalogService({ userData: data, models });
  const flows = new AgentPackFlows({ catalog, brainRoot: () => brain, version: '0.1.0', guards: () => [], scan: async () => ({ ok: true }), pickImport: async () => null, pickExport: async () => null, tempRoot: base, runtimeRoot: path.join(base, 'runtime'),
    sharedSkills: () => { const dir = path.join(brain, '.claude', 'skills'); try { return fs.readdirSync(dir).map(name => ({ name, folder: path.join(dir, name) })); } catch { return []; } } });
  catalog.onKnowhowChange((p, previous) => flows.publishCurrent(p, previous));
  const learning = new AgentPackLearning(flows, data);
  let emitted = 0;
  const service = new BrainModelService({ userData: data, root: () => brain, home: null, catalog, packs: flows, learning, runs: () => opts.runs ?? [], routing: () => routing,
    top: async text => (/rilasci|versione|deploy|hotfix|regression/i.test(text) ? { id: DEV, score: 80 } : /orchestr/i.test(text) ? { id: ORCHESTRATOR_AGENT_ID, score: 90 } : null),
    emit: () => { emitted++; }, auto: false, now: () => NOW });
  const agent = (id: string) => catalog.list().profiles.find(p => p.id === id)!;
  return { base, brain, data, catalog, flows, learning, service, agent, emitted: () => emitted };
}
const snapshot = (root: string) => { const out: Record<string, string> = {}; const walk = (d: string) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) { if (!rel.startsWith('.claude') && !rel.startsWith('agents')) walk(rel); } else if (rel !== 'brain.json') out[rel] = fs.readFileSync(path.join(root, rel), 'utf8'); } }; walk(''); return out; };

describe('one-time migration', () => {
  it('turns every former section into a skill linked to the right agent, without losing or leaking content', async () => {
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
    expect(release.agents).toEqual([DEV]); // the classifier's first pick
    // nothing ranked: the general agent, never the Orchestrator
    expect(report.items.every(i => i.agents.length === 1 && i.agents[0] !== ORCHESTRATOR_AGENT_ID)).toBe(true);
    expect(report.items.some(i => i.agents[0] === GENERAL_AGENT_ID)).toBe(true);
    // the fake credential stays only in the original
    const query = report.items.find(i => i.title === 'Query in sola lettura su produzione')!;
    expect(fs.readFileSync(path.join(w.brain, '.claude/skills', query.skill!, 'SKILL.md'), 'utf8')).not.toMatch(/demo-non-reale/);
    expect(query.note).toMatch(/nascost/);
    expect(snapshot(w.brain)).toEqual(before); // originals untouched
    // the agents declare them and get them at start
    expect(w.agent(DEV).knowhow!.linked).toContain(release.skill);
    expect(w.agent(DEV).lastEditedBy).toBe('maintenance');
    const runtime = w.flows.runtime(DEV);
    expect(fs.existsSync(path.join(runtime.skillRoot, release.skill!, 'SKILL.md'))).toBe(true);
    expect(runtime.instructions).toContain(release.skill!);
    // one change per skill and per agent, all undoable
    expect(state.changes.filter(c => c.job === 'migration' && c.kind === 'skill')).toHaveLength(report.items.length);
    expect(state.changes.every(c => c.canRollback)).toBe(true);
    expect(state.skills.find(s => s.name === release.skill)).toMatchObject({ usedBy: [DEV], madeBy: 'migration', home: 'brain' });
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
  it('undoing an agent change restores its previous version', async () => {
    const w = world({ demo: true });
    const v = w.agent(DEV).activeVersion;
    const state = await w.service.maintain('migration');
    const change = state.changes.find(c => c.kind === 'agent' && c.target === DEV)!;
    w.service.rollback(change.id);
    expect(w.agent(DEV).activeVersion).toBe(v);
    expect(w.agent(DEV).knowhow?.linked ?? []).toEqual([]);
  });
  it('an empty brain has nothing to migrate and nothing to show', async () => {
    const w = world();
    const state = await w.service.maintain();
    expect(state).toMatchObject({ skills: [], rules: [], memory: [], changes: [] });
    expect(state.migration).toEqual({ at: NOW, items: [], lessons: [] });
    expect(state.lastRun!.jobs.map(j => j.job)).toEqual(['migration', 'corrections', 'repeated-task', 'merge-skills', 'merge-memory']);
    expect(w.emitted()).toBe(1);
  });
});

describe('corrections', () => {
  it('applies each lesson at once to the role, a skill or the rules, with no approval', async () => {
    const w = world();
    put(w.brain, '.claude/skills/fatture/SKILL.md', '---\nname: fatture\ndescription: Esportare le fatture\n---\n\n1. Esporta.\n');
    w.learning.propose(DEV, 'Cita sempre il file e la riga', 'r_000000000001');
    w.learning.propose(DEV, 'Controlla il totale prima di esportare', 'r_000000000002', 'skill', 'fatture');
    w.learning.propose(DEV, 'Mai comandi distruttivi senza conferma', 'r_000000000003', 'rule');
    const state = await w.service.maintain('corrections'); // waits for the run the first proposal started
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
  it('waits until the Orchestrator accepts it; never a rule, never a permission grant', async () => {
    const w = world();
    const before = w.agent(DEV).instructions;
    const queued = w.learning.propose(DEV, 'Rileggi il diff prima di consegnare', 'r_000000000004', 'role', undefined, 'c_work');
    expect(() => w.learning.propose(DEV, 'Vale per tutti', 'r_000000000005', 'rule', undefined, 'c_work')).toThrow(/rule for every agent/);
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
  const run = (n: number, goal: string, agentId = DEV): AgentRun => ({ runId: `r_00000000000${n}`, chatId: `c${n}`, agentId, version: 1, goal, startedBy: 'user', startedAt: NOW - n * 86400e3, endedAt: NOW - n * 86400e3 + 600e3,
    counters: {} as AgentRun['counters'], costUsd: 0.2, tokens: null, report: { ok: true, outcome: 'done', summary: `Esportate le fatture del mese ${n}` } as AgentRun['report'] });
  it('makes a skill from a task repeated in three chats, declared by the agent that ran it', async () => {
    const w = world({ runs: [run(1, 'Esporta le fatture di ottobre in Excel'), run(2, 'Esporta le fatture di settembre in Excel'), run(3, 'Esporta le fatture di agosto in Excel'), run(4, 'Scrivi una mail al cliente')] });
    const state = await w.service.maintain('repeated-task');
    const made = state.skills.find(s => s.madeBy === 'repeated-task')!;
    expect(made.name).toMatch(/fatture|esporta|excel/);
    expect(made.usedBy).toEqual([DEV]);
    expect(fs.readFileSync(made.file, 'utf8')).toContain('viste 3 volte');
    const again = await w.service.maintain('repeated-task');
    expect(again.skills.filter(s => s.madeBy === 'repeated-task')).toHaveLength(1);
  });
  it('merges two skills that say the same thing and relinks their agents', async () => {
    const w = world();
    const body = '1. Apri il gestionale delle fatture.\n2. Esporta il mese corrente in Excel.\n3. Controlla il totale con la banca.\n';
    put(w.brain, '.claude/skills/export-fatture/SKILL.md', `---\nname: export-fatture\ndescription: Export\n---\n\n${body}`);
    put(w.brain, '.claude/skills/fatture-mese/SKILL.md', `---\nname: fatture-mese\ndescription: Fatture del mese\n---\n\n${body}4. Fine.\n`);
    w.service.link('fatture-mese', DEV, true);
    const state = await w.service.maintain('merge-skills');
    expect(state.skills.map(s => s.name)).toEqual(['fatture-mese']); // the one an agent used is kept
    expect(w.agent(DEV).knowhow!.linked).toEqual(['fatture-mese']);
    const merge = state.changes.find(c => c.job === 'merge-skills')!;
    w.service.rollback(merge.id);
    expect(fs.existsSync(path.join(w.brain, '.claude/skills/export-fatture/SKILL.md'))).toBe(true);
    await w.service.maintain('merge-skills');
    expect(fs.existsSync(path.join(w.brain, '.claude/skills/export-fatture/SKILL.md'))).toBe(true); // not redone
  });
  it('moves memories several agents share to memory/shared.md, once, and gives it to every agent', async () => {
    const w = world();
    put(w.brain, `agents/${portableId(DEV)}/memory.md`, '# Memoria\n\n- 2026-10-01 · Il server di test si riavvia alle 6\n- 2026-10-02 · Solo mio\n');
    put(w.brain, `agents/${portableId(GENERAL_AGENT_ID)}/memory.md`, '# Memoria\n\n- 2026-10-05 · Il server di test si riavvia alle 6\n');
    const state = await w.service.maintain('merge-memory');
    expect(fs.readFileSync(path.join(w.brain, 'memory/shared.md'), 'utf8')).toContain('Il server di test si riavvia alle 6');
    expect(fs.readFileSync(path.join(w.brain, `agents/${portableId(DEV)}/memory.md`), 'utf8')).not.toContain('riavvia');
    expect(fs.readFileSync(path.join(w.brain, `agents/${portableId(DEV)}/memory.md`), 'utf8')).toContain('Solo mio');
    expect(state.memory.map(m => m.kind)).toEqual(expect.arrayContaining(['shared', 'agent']));
    expect(w.flows.runtime(GENERAL_AGENT_ID).instructions).toContain('Il server di test si riavvia alle 6');
    expect((await w.service.maintain('merge-memory')).changes).toHaveLength(1);
  });
  it('the user declares and drops a skill for an agent, logged and undoable', () => {
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
    const none = new BrainModelService({ userData: w.data, root: () => null, home: null, catalog: w.catalog, packs: w.flows, learning: w.learning, runs: () => [], routing: () => routing, top: async () => null, emit: () => {}, auto: false });
    await expect(none.maintain()).rejects.toThrow(/cartella del brain/);
    expect(none.state()).toMatchObject({ root: null, skills: [], rules: [], memory: [] });
  });
});

describe('the Orchestrator\'s agent changes (ADR 0082)', () => {
  it('are logged with an undo: a trial version is rejected, an archive is restored', () => {
    const w = world();
    const p = w.catalog.save({ name: 'Reader', purpose: 'Read files', instructions: 'Report observations.', engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'eye' }, tools: { allow: ['read'] }, permissionCeiling: 'default' });
    const trial = w.catalog.approveTrial(p.id, { ...p, instructions: 'Report briefly.' }, 'Shorter');
    w.service.recordAgentChange({ agentId: p.id, name: p.name, op: 'update', reason: 'Shorter', evidence: ['run:r_1'], version: { before: 1, after: trial.activeVersion } });
    let change = w.service.state().changes[0]!;
    expect(change).toMatchObject({ job: 'orchestrator', kind: 'agent', target: p.id, canRollback: true, evidence: ['run:r_1'] });
    expect(change.summary).toMatch(/v2 in prova/);
    w.service.rollback(change.id);
    expect(w.agent(p.id)).toMatchObject({ activeVersion: 1, instructions: 'Report observations.' });
    expect(w.agent(p.id).trial).toBeUndefined();
    w.catalog.archive(p.id);
    w.service.recordAgentChange({ agentId: p.id, name: p.name, op: 'archive', reason: 'Unused', evidence: [], status: { before: 'active', after: 'archived' } });
    change = w.service.state().changes[0]!;
    expect(change).toMatchObject({ action: 'archive', canRollback: true });
    w.service.rollback(change.id);
    expect(w.catalog.list().profiles.find(x => x.id === p.id)?.status).toBe('active');
    expect(w.service.state().changes[0]!.canRollback).toBe(false);
  });
});
