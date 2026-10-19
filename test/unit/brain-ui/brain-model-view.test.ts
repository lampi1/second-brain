// The Brain section's view helpers and pages (ADR 0077): one skill list from the brain model and the skill editor,
// filters, the Mappa links graph, the agent-choice match, "no data yet" instead of zero, and the Regole / Memoria /
// Classificatori pages rendered from a fixed state in both languages.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrainModelState, ClassifierChoice } from '../../../src/shared/brain-model';
import type { SkillCatalog, SkillEntry } from '../../../src/shared/contract';
vi.mock('../../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(() => new Promise(() => {})), on: () => () => {} } }));
import { choiceMatch, changesOf, filterSkills, linkGraph, memorySections, noData, pct, skillRows, usd } from '../../../src/renderer/lib/brain-model-view';
// the store's hook (useSyncExternalStore) has no server snapshot: the pages read a fixed state instead
const store = vi.hoisted(() => ({ value: { state: null as unknown, error: null, busy: false } }));
vi.mock('../../../src/renderer/store/brain-model', () => ({
  useBrainModel: () => store.value, brainModel: { get: () => store.value, set: (f: (s: unknown) => typeof store.value) => { store.value = f(store.value); } },
  runMaintenance: vi.fn(), rollbackChange: vi.fn(), linkSkill: vi.fn(), refreshBrainModel: vi.fn(),
}));
vi.mock('../../../src/renderer/brain/api', () => ({ useBrain: () => ({ data: null, loading: true, refreshing: false, error: null, at: null, reload: () => {} }) }));
import { brainModel } from '../../../src/renderer/store/brain-model';
import { RulesPage } from '../../../src/renderer/components/brain-model/RulesPage';
import { MemoryPage } from '../../../src/renderer/components/brain-model/MemoryPage';
import { MaintenancePanel } from '../../../src/renderer/components/brain-model/MaintenancePanel';
import { setLang } from '../../../src/renderer/i18n';

const state: BrainModelState = {
  root: '/b',
  agents: [{ id: 'a1', name: 'Revisione', role: 'reviewer', skills: ['code-review'], memory: 'agents/a1/memory.md' }, { id: 'a2', name: 'Indagine', role: 'bug', skills: ['code-review', 'triage'], memory: null }],
  skills: [
    { name: 'code-review', description: 'Review a diff', file: '/b/.claude/skills/code-review/SKILL.md', rel: '.claude/skills/code-review/SKILL.md', home: 'brain', usedBy: ['a1', 'a2'], tools: ['Bash'], lines: 10, changedAt: 1, madeBy: 'migration' },
    { name: 'deploy-check', description: 'Check a deploy', file: '/b/.claude/skills/deploy-check/SKILL.md', rel: '.claude/skills/deploy-check/SKILL.md', home: 'brain', usedBy: [], tools: [], lines: 4, changedAt: null, madeBy: null },
  ],
  rules: [
    { file: 'code.md', title: 'Codice', summary: 'Small diffs.', when: { prompt: ['diff'], tools: [], paths: [] }, loaded: 'topic', lines: 5, changedAt: null },
    { file: 'rules/old.md', title: 'Vecchia', summary: '', when: null, loaded: 'none', lines: 2, changedAt: null },
  ],
  memory: [
    { kind: 'knowledge', group: 'Clienti', title: 'Acme', file: 'areas/clienti/acme.md', entries: 2, preview: ['contratto'], changedAt: null },
    { kind: 'journal', group: '', title: 'Diario', file: 'journal.md', entries: 4, preview: [], changedAt: null },
    { kind: 'agent', group: 'Revisione', title: 'Memoria: Revisione', file: 'agents/a1/memory.md', agentId: 'a1', entries: 1, preview: ['- usa pnpm'], changedAt: null },
    { kind: 'shared', group: '', title: 'Condivisa', file: 'memory/shared.md', entries: 1, preview: [], changedAt: null },
  ],
  changes: [
    { id: 'c1', at: 2, job: 'merge-memory', kind: 'memory', action: 'merge', target: 'memory/shared.md', summary: 'Merged one line', reason: 'two agents', evidence: [], canRollback: true },
    { id: 'c2', at: 1, job: 'migration', kind: 'skill', action: 'create', target: 'code-review', summary: 'From runbook', reason: 'migration', evidence: ['ops/runbook.md'], canRollback: false, rolledBackAt: 3 },
  ],
  migration: null, lastRun: null,
};
const entry = (name: string, path: string, harness: 'claude' | 'cursor' = 'claude'): SkillEntry => ({ id: path, kind: 'skill', harness, scope: 'project', root: '/b', name, description: `${name} desc`, path, mtime: 5, errors: 0 });

afterEach(() => { setLang('it'); brainModel.set(() => ({ state: null, error: null, busy: false })); });

describe('skill rows', () => {
  it('joins the editor entries to the model skills by path and adds the Cursor-only ones', () => {
    const cat: SkillCatalog = { places: [], entries: [entry('code-review', '/B/.claude/skills/code-review/SKILL.md'), entry('cursor-only', '/b/.cursor/skills/x/SKILL.md', 'cursor'), { ...entry('agent-x', '/b/.claude/agents/x.md'), kind: 'agent' }] };
    const rows = skillRows(state, cat);
    expect(rows.map(r => r.name)).toEqual(['code-review', 'cursor-only', 'deploy-check']);
    expect(rows[0]!.entry?.name).toBe('code-review');
    expect(rows[1]!.home).toBe('cursor');
    expect(rows[2]!.entry).toBeNull();
    expect(rows.map(r => r.linkable)).toEqual([true, false, true]);
    expect(filterSkills(rows, '', 'unused').map(r => r.name)).toEqual(['deploy-check']);
    expect(filterSkills(rows, 'review bash', 'used').map(r => r.name)).toEqual(['code-review']);
    expect(skillRows(null, null)).toEqual([]);
  });
});

describe('links and sections', () => {
  it('draws agent → skills, its memory, the shared memory and the loaded rules only', () => {
    const g = linkGraph(state);
    expect(g.nodes.filter(n => n.kind === 'skill').map(n => n.id)).toEqual(['skill:code-review', 'skill:deploy-check', 'skill:triage']);
    expect(g.nodes.some(n => n.id === 'rule:rules/old.md')).toBe(false);
    expect(g.edges).toContainEqual({ from: 'agent:a1', to: 'memory:agents/a1/memory.md' });
    expect(g.edges).toContainEqual({ from: 'agent:a2', to: 'memory:memory/shared.md' });
    expect(g.edges).toContainEqual({ from: 'agent:a2', to: 'rule:code.md' });
    expect(linkGraph(null)).toEqual({ nodes: [], edges: [] });
    const s = memorySections(state.memory);
    expect([s.knowledge.length, s.happened.length, s.agents.length]).toEqual([1, 1, 2]);
    expect(changesOf(state.changes, ['skill']).map(c => c.id)).toEqual(['c2']);
  });
  it('says no data instead of zero and matches agent choices', () => {
    expect(pct(null)).toBeNull(); expect(usd(null)).toBeNull();
    expect(pct(0.5, 'en-US')).toBe('50%');
    expect(noData([{ runs: 0, success: null, avgCostUsd: null }])).toBe(true);
    expect(noData([{ runs: 1, success: null, avgCostUsd: null }])).toBe(false);
    const c = (suggested: string | null, used: string): ClassifierChoice => ({ at: 1, chatId: 'c', goal: 'g', suggested: suggested ? { id: suggested, name: suggested, score: 9 } : null, used: { id: used, name: used, score: null, rank: null, mode: null } });
    expect([choiceMatch(c('a', 'a')), choiceMatch(c('a', 'b')), choiceMatch(c(null, 'b'))]).toEqual(['same', 'differ', 'none']);
  });
});

describe('pages', () => {
  it('renders Regole and Memoria from the model, in both languages, with the maintenance log', () => {
    brainModel.set(() => ({ state, error: null, busy: false }));
    setLang('it');
    const rules = renderToStaticMarkup(createElement(RulesPage));
    expect(rules).toContain('Quando serve');
    expect(rules).toContain('Non caricata');
    expect(rules).toContain('Vecchia');
    const mem = renderToStaticMarkup(createElement(MemoryPage));
    expect(mem).toContain('Clienti');
    expect(mem).toContain('Memoria: Revisione');
    expect(mem).toContain('Unisci i doppioni');
    expect(mem).toContain('Merged one line');
    setLang('en');
    expect(renderToStaticMarkup(createElement(RulesPage))).toContain('When relevant');
    expect(renderToStaticMarkup(createElement(MemoryPage))).toContain('Customers');
  });
  it('lists only the given kinds, with Annulla only where it can still undo', () => {
    brainModel.set(() => ({ state, error: null, busy: false }));
    setLang('it');
    const html = renderToStaticMarkup(createElement(MaintenancePanel, { kinds: ['skill', 'memory'] }));
    expect(html.match(/data-testid="bm-change"/g)).toHaveLength(2);
    expect(html.match(/data-testid="bm-undo"/g)).toHaveLength(1);
    expect(html).toContain('Annullata');
  });
});
