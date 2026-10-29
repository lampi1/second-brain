// The Brain section's view helpers and pages (ADR 0077): one skill list from the brain model and the skill editor,
// filters, the Mappa links graph, the agent-choice match, "no data yet" instead of zero, and the Regole / Memoria /
// Classificatori pages rendered from a fixed state in both languages.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrainModelState } from '../../../src/shared/brain-model';
import type { SkillCatalog, SkillEntry } from '../../../src/shared/contract';
vi.mock('../../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(() => new Promise(() => {})), on: () => () => {} } }));
import { changesOf, filterSkills, linkGraph, memorySections, noData, pct, skillRows, usd } from '../../../src/renderer/lib/brain-model-view';
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
import { ui } from '../../../src/renderer/store/ui';
/** Memoria is a hub of tabs (ADR 0122): the page arg picks the tab rendered */
const tab = (arg: string) => ui.set(s => ({ ...s, pageArg: arg }));

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
  it('says no data instead of zero', () => {
    expect(pct(null)).toBeNull(); expect(usd(null)).toBeNull();
    expect(pct(0.5, 'en-US')).toBe('50%');
    expect(noData([{ runs: 0, success: null, avgCostUsd: null }])).toBe(true);
    expect(noData([{ runs: 1, success: null, avgCostUsd: null }])).toBe(false);
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
    tab('file');
    const mem = renderToStaticMarkup(createElement(MemoryPage));
    expect(mem).toContain('Clienti');
    expect(mem).toContain('Memoria: Revisione');
    expect(mem).toContain('Merged one line');
    setLang('en');
    expect(renderToStaticMarkup(createElement(RulesPage))).toContain('When relevant');
    expect(renderToStaticMarkup(createElement(MemoryPage))).toContain('Customers');
  });
  it('renders the Memoria statistics with their explanations, and a clean brain says what will appear', () => {
    const stats: NonNullable<BrainModelState['memoryStats']> = {
      at: 0, weeks: ['2026-10-12', '2026-10-19'], totals: { files: 4, entries: 8, agents: 2, agentsWithMemory: 1, shared: 1, runs: 3 },
      perAgent: [{ agentId: 'a1', name: 'Revisione', file: 'agents/a1/memory.md', exists: true, entries: 3, recalls: 3, lastAt: 1 }, { agentId: 'a2', name: 'Indagine', file: 'agents/a2/memory.md', exists: false, entries: 0, recalls: 0, lastAt: null }],
      growth: [{ kind: 'agent', values: [1, 2] }, { kind: 'errors', values: [0, 2] }], topRecalled: [{ text: 'usa pnpm', owner: 'Revisione', file: 'agents/a1/memory.md', date: '2026-10-12', recalls: 3 }],
      stale: [{ file: 'areas/clienti/acme.md', title: 'Acme', kind: 'knowledge', days: 40 }], staleDays: 30, duplicates: 0, oldest: null, busiestDay: null,
      errors: { total: 2, last30: 2, prev30: 0, weekly: [0, 2], weekday: [2, 0, 0, 0, 0, 0, 0], topWord: null, byAgent: [{ agent: 'Revisione', count: 2 }],
        groups: [{ key: 'w:0', label: 'Diff troppo grande', count: 2, agents: ['Revisione'], first: '2026-10-13', last: '2026-10-19', trend: [0, 2], sample: 'diff di 900 righe', rule: 'diff piccoli' }],
        items: [{ date: '2026-10-19', time: null, agent: 'Revisione', area: null, type: null, text: 'diff di 900 righe', rule: 'diff piccoli', group: 'w:0' }] },
      skills: [{ name: 'code-review', rel: '.claude/skills/code-review/SKILL.md', uses: 3, known: 3, ok: 3, success: 1, lastUse: 1, usedBy: 2, verdict: 'useful' },
        { name: 'deploy-check', rel: null, uses: 0, known: 0, ok: 0, success: null, lastUse: null, usedBy: 0, verdict: 'unused' }],
    };
    brainModel.set(() => ({ state: { ...state, memoryStats: stats }, error: null, busy: false }));
    setLang('it');
    tab('statistiche');
    const it = renderToStaticMarkup(createElement(MemoryPage));
    for (const s of ['Manutenzione', 'Lo sapevi?', 'Come cresce la memoria', 'Skill utili e inutili', 'Mai usata', 'File fermi']) expect(it).toContain(s);
    // the duplicates left (ADR 0122): no key-number row, no recurring-errors block (Qualità and the File tab have them)
    for (const s of ['mm-kpis', 'data-testid="mm-errors"']) expect(it).not.toContain(s);
    tab('file');
    expect(renderToStaticMarkup(createElement(MemoryPage))).toContain('ricorrente ×2');
    tab('statistiche');
    // no "richiami" (ADR 0101): a line counted once per run started after it is not a use
    for (const s of ['I ricordi più richiamati', 'Memoria richiamata', 'mm-card-recalls']) expect(it).not.toContain(s);
    expect(it.match(/class="help-tip/g)!.length).toBeGreaterThan(15); // a "?" on every number
    setLang('en');
    const en = renderToStaticMarkup(createElement(MemoryPage));
    for (const s of ['Maintenance', 'Did you know?', 'Never used']) expect(en).toContain(s);
    setLang('it');
    const clean = { ...stats, totals: { ...stats.totals, entries: 0, runs: 0 }, errors: { ...stats.errors, total: 0 } };
    brainModel.set(() => ({ state: { ...state, memoryStats: clean }, error: null, busy: false }));
    expect(renderToStaticMarkup(createElement(MemoryPage))).toContain('La memoria è ancora vuota');
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
