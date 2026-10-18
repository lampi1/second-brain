// Overview regression coverage: deterministic filters, truthful metric samples and safe bilingual cards.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import type { AgentProfile, AgentRun } from '../../src/shared/agents';
import { runMetrics } from '../../src/main/agents/run-metrics';
import { AgentCatalogCard } from '../../src/renderer/components/AgentCatalogCard';
import { selectCatalog } from '../../src/renderer/lib/agent-catalog';
import { setLang } from '../../src/renderer/i18n';

const profile = (id: string, role: string, engine = 'claude'): AgentProfile => ({
  id, name: id, role, engine, model: null, category: 'other', tools: null, permissionCeiling: null, purpose: 'Review changes', instructions: '', avatar: { kind: 'symbol', value: 'eye' },
  createdAt: 1, updatedAt: 1, origin: { kind: 'user' }, version: 1, activeVersion: 1, lastEditedBy: 'user', userLocked: true, status: 'active',
});
const run = (id: string, basis: 'human' | 'self-report', costUsd: number | null): AgentRun => ({
  runId: id, chatId: id, agentId: 'Reviewer', version: 1, goal: 'Review', startedBy: 'user', startedAt: 1, endedAt: 2,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd, tokens: null,
  outcome: { verdict: 'success', basis, at: 2, by: 'user' },
});
afterEach(() => setLang('it'));
it('combines role and engine filters, sorts deterministically and leaves source order unchanged', () => {
  const profiles = [profile('Z', 'Review'), profile('A', 'Build', 'codex'), profile('B', 'Review', 'codex')];
  expect(selectCatalog(profiles, 'Review', 'codex', 'name').map(p => p.id)).toEqual(['B']);
  expect(selectCatalog(profiles, '', '', 'role').map(p => p.id)).toEqual(['A', 'B', 'Z']);
  expect(selectCatalog(profiles, '', '', 'engine').map(p => p.id)).toEqual(['Z', 'A', 'B']);
  expect(selectCatalog(profiles, 'Missing', '', 'name')).toEqual([]);
  expect(profiles.map(p => p.id)).toEqual(['Z', 'A', 'B']);
});
it('keeps unknown metrics distinct from a successful empty response, in both languages', () => {
  for (const language of ['it', 'en'] as const) {
    setLang(language);
    const props = { profile: profile('<Reviewer>', 'Review'), engine: 'Claude', lastStart: null, onOpen: () => {} };
    const unavailable = renderToStaticMarkup(createElement(AgentCatalogCard, { ...props, loaded: false }));
    expect(unavailable).toContain('&lt;Reviewer&gt;');
    expect(unavailable).toContain(language === 'it' ? 'Non disponibile' : 'Unavailable');
    expect(unavailable).not.toContain('<dd>0</dd>');
    expect(unavailable).not.toContain(language === 'it' ? '0 su 0' : '0 of 0');
    const empty = renderToStaticMarkup(createElement(AgentCatalogCard, { ...props, loaded: true }));
    expect(empty).toContain('<dd>0</dd>');
    expect(empty).not.toContain('0%');
  }
});
it('renders verified successes and cost sample coverage without using self-reports as evidence', () => {
  setLang('en');
  const metrics = runMetrics([run('a', 'human', 0.25), run('b', 'self-report', null)])[0]!;
  const p = { ...profile('Reviewer', 'Review'), probation: { since: 1, requestItemId: 'request' } };
  const html = renderToStaticMarkup(createElement(AgentCatalogCard, { profile: p, metrics, loaded: true, engine: 'Claude', lastStart: 1, onOpen: () => {} }));
  expect(html).toContain('100%');
  expect(html.match(/1 of 2 runs/g)).toHaveLength(2);
  expect(html).toContain('On probation');
  expect(html).toContain('0.25');
});
