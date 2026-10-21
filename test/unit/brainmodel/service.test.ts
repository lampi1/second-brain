// The brain model service end to end (ADR 0077) over a real catalog, pack flows and lessons queue, temp folders only:
// the migration turns the runbook / routines sections into brain skills a role loads when a task asks for them (content
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
import type { AgentModelChoice, AgentRun } from '../../../src/shared/agents';
import type { RoutingInfo } from '../../../src/shared/contract';
import type { BrainChange } from '../../../src/shared/brain-model';
import { maintenanceEvent } from '../../../src/main/brain/announce';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];
const NOW = Date.parse('2026-10-19T09:00:00Z');
const DEV = 'artisan';
const OTHER = 'scout';
const routing: RoutingInfo = { table: null, registry: null, kinds: [], error: null, history: [] };

function world(opts: { demo?: boolean; runs?: AgentRun[]; applied?: (c: BrainChange[]) => void } = {}) {
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
    suggestSkills: async () => [],
    emit: () => { emitted++; }, auto: false, now: () => NOW, ...(opts.applied ? { applied: opts.applied } : {}) });
  const agent = (id: string) => catalog.list().profiles.find(p => p.id === id)!;
  return { base, brain, data, catalog, flows, learning, service, agent, emitted: () => emitted };
}
const snapshot = (root: string) => { const out: Record<string, string> = {}; const walk = (d: string) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) { if (!rel.startsWith('.claude') && !rel.startsWith('agents')) walk(rel); } else if (rel !== 'brain.json') out[rel] = fs.readFileSync(path.join(root, rel), 'utf8'); } }; walk(''); return out; };

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
    // no role is changed: a role loads a skill when its launch gives it (skills_suggest picks them)
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
  it('an empty brain has nothing to migrate and nothing to show', async () => {
    const w = world();
    const state = await w.service.maintain();
    expect(state).toMatchObject({ skills: [], rules: [], memory: [], changes: [] });
    expect(state.migration).toEqual({ at: NOW, items: [] });
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
  const run = (n: number, goal: string, agentId = DEV): AgentRun => ({ runId: `r_00000000000${n}`, chatId: `c${n}`, agentId, version: 1, goal, startedBy: 'user', startedAt: NOW - n * 86400e3, endedAt: NOW - n * 86400e3 + 600e3,
    counters: {} as AgentRun['counters'], costUsd: 0.2, tokens: null, report: { at: NOW - n * 86400e3 + 600e3, outcome: 'done', verified: 'yes', summary: `Esportate le fatture del mese ${n}` } });
  it('keeps repeated tasks as non-loadable candidates until independent verification and replay', async () => {
    const w = world({ runs: [run(1, 'Esporta le fatture di ottobre in Excel'), run(2, 'Esporta le fatture di settembre in Excel'), run(3, 'Esporta le fatture di agosto in Excel')] });
    const state = await w.service.maintain('repeated-task');
    expect(state.skills.filter(s => s.madeBy === 'repeated-task')).toHaveLength(0);
    const candidates = path.join(w.brain, 'memory/skill-candidates');
    expect(fs.readdirSync(candidates)).toHaveLength(1);
    expect(fs.readFileSync(path.join(candidates, fs.readdirSync(candidates)[0]!), 'utf8')).toContain('replay');
    expect(w.agent(DEV).knowhow?.linked ?? []).toEqual([]);
    await w.service.maintain('repeated-task');
    expect(fs.readdirSync(candidates)).toHaveLength(1);
  });
  it('merges two skills that say the same thing and relinks their roles', async () => {
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
    const none = new BrainModelService({ userData: w.data, root: () => null, home: null, catalog: w.catalog, packs: w.flows, learning: w.learning, runs: () => [], routing: () => routing, suggestSkills: async () => [], emit: () => {}, auto: false });
    await expect(none.maintain()).rejects.toThrow(/cartella del brain/);
    expect(none.state()).toMatchObject({ root: null, skills: [], rules: [], memory: [] });
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
