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

function world(opts: { demo?: boolean; scripts?: { file: (id: string) => string; changed: () => void }; runs?: AgentRun[]; applied?: (c: BrainChange[]) => void; logDir?: string; handoff?: (text: string) => Promise<boolean> } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-brainmodel-'))); roots.push(base);
  const data = path.join(base, 'data'); fs.mkdirSync(data);
  const brain = opts.demo ? writeDemoBrain(path.join(base, 'brain'), NOW) : path.join(base, 'brain');
  if (!opts.demo) { fs.mkdirSync(brain); put(brain, 'brain.json', JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: [], appRules: true } })); }
  const catalog = new AgentCatalogService({ userData: data, models });
  const flows = new AgentPackFlows({ catalog, brainRoot: () => brain, tempRoot: base, runtimeRoot: path.join(base, 'runtime'),
    sharedSkills: () => { const dir = path.join(brain, '.claude', 'skills'); try { return fs.readdirSync(dir).map(name => ({ name, folder: path.join(dir, name) })); } catch { return []; } } });
  catalog.onKnowhowChange((p, previous) => flows.publishCurrent(p, previous));
  const learning = new AgentPackLearning(flows, data);
  let emitted = 0;
  const service = new BrainModelService({ userData: data, root: () => brain, home: null, catalog, packs: flows, learning, runs: () => opts.runs ?? [], routing: () => routing,
    suggestSkills: async () => [],
    emit: () => { emitted++; }, auto: false, now: () => NOW, ...(opts.applied ? { applied: opts.applied } : {}),
    ...(opts.logDir ? { logDir: () => opts.logDir! } : {}), ...(opts.handoff ? { handoff: opts.handoff } : {}), ...(opts.scripts ? { scripts: opts.scripts } : {}) });
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
    expect(state.lastRun!.jobs.map(j => j.job)).toEqual(['migration', 'upgrade', 'corrections', 'repeated-task', 'merge-skills', 'merge-memory']);
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

describe('one Manutenzione that reads the logs and hands the result to the Orchestrator (#150)', () => {
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
    const sent: string[] = [];
    const w = world({ logDir: logs, handoff: async text => { sent.push(text); return true; } });
    await w.service.maintain('migration');
    expect(sent).toEqual([]); // a single job is not the full pass
    let state = await w.service.maintain();
    const groups = state.lastRun!.logs!.groups;
    expect(groups.map(g => [g.lvl, g.scope, g.count])).toEqual([['error', 'task', 2], ['warn', 'chats', 2], ['warn', 'cli', 1]]);
    expect(state.lastRun!.handoff).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Lettura delle novità failed');
    expect(sent[0]).toContain(path.join(logs, 'app-2026-10-19.jsonl'));
    expect(sent[0]).toMatch(/Herald.*issue aperte.*commenta.*nuova/s);
    // the user marks the drift as known: listed apart and never handed on
    const drift = groups.find(g => g.scope === 'cli')!;
    state = w.service.noise(drift.key, true);
    expect(state.lastRun!.logs!.groups.find(g => g.key === drift.key)!.known).toBe(true);
    // the next pass reads only what came after the previous one: nothing new here
    await w.service.maintain('corrections'); // a one-job pass (like a timer's) keeps the log step's time
    state = await w.service.maintain();
    expect(state.lastRun!.logs!.since).toBe(NOW);
    expect(sent[1]).toContain('nessun gruppo nuovo');
  });
  it('says so when no Orchestrator is open', async () => {
    const logs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-logs-'))); roots.push(logs);
    const w = world({ logDir: logs, handoff: async () => false });
    const state = await w.service.maintain();
    expect(state.lastRun!.handoff).toEqual({ sent: false, why: 'nessun Orchestrator aperto' });
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
