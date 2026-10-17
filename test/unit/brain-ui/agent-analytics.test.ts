// Agent analytics presentation checks: unavailable totals cannot become zero, complete/partial timing stays apart,
// and comparable cohorts retain their evidence conditions in both UI languages.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { aggregateAgentUsage, type AgentSessionObservation } from '../../../src/main/agents/analytics';
import type { AgentAnalyticsData } from '../../../src/shared/agent-analytics';
import { AgentAnalyticsView } from '../../../src/renderer/brain/components/AgentAnalytics';
import { setLang } from '../../../src/renderer/i18n';

afterEach(() => setLang('it'));
const observation = (sessionKey: string, partial = false): AgentSessionObservation => ({
  sessionKey, owner: { id: 'reviewer', name: 'Reviewer', revision: 2 }, observedAt: 10000, source: 'chat-events',
  parentSessionKey: null, childTotals: 'excluded', actualUsd: partial ? null : 0, listPriceUsd: 2,
  estimatedUsd: null, tokens: { input: null, output: null, cacheRead: null, cacheWrite: null },
  startedAt: 1000, endedAt: partial ? null : 3000, spans: [{ kind: 'execution', start: 1000, end: 3000 }],
  completed: !partial, taskType: 'review', model: null, effort: null, modelAttribution: 'single-model-observed',
  provenance: { engine: 'claude', modelObserved: 'observed-model', effortObserved: 'high' },
});
const render = (data: AgentAnalyticsData) => renderToStaticMarkup(createElement(AgentAnalyticsView, { data }));

describe('agent analytics evidence presentation', () => {
  it('retains unavailable total and known zero subtotal while keeping cost measures separate', () => {
    setLang('en');
    // Structural assignment proves the renderer's shared projection accepts the actual main read model.
    const data: AgentAnalyticsData = aggregateAgentUsage([observation('one'), observation('two', true)]);
    const html = render(data);
    expect(html).toContain('Reported cost (USD)');
    expect(html).toContain('List-price equivalent (USD)');
    expect(html).toContain('Calibrated estimate (USD)');
    expect(html).toContain('<b>unavailable</b>');
    expect(html).toContain('known subtotal: US$0.00');
    expect(html).toContain('1 known / 1 unavailable');
    expect(html).toContain('0 known / 2 unavailable');
    expect(html).toContain('<b>US$4.00</b>');
    expect(html).toContain('reviewer');
    expect(html).toContain('revisions: 2 · 2 sessions');
  });
  it('labels incomplete timing separately and preserves comparable sample conditions and counts', () => {
    setLang('en');
    const html = render(aggregateAgentUsage([observation('one'), observation('two', true)]));
    expect(html).toContain('1 sessions with complete timing · 1 sessions with incomplete timing');
    expect(html).toContain('Execution: total unavailable · median 2 s · observed in incomplete sessions: 2 s');
    expect(html).toContain('claude / observed-model / high');
    expect(html).toContain('<td>review</td>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('no speed ranking');
  });
  it('shows honest empty history and no cohorts in both languages', () => {
    const data = aggregateAgentUsage([]);
    expect(render(data)).toContain('Nessuna sessione attribuita a un agente');
    expect(render(data)).toContain('Campioni confrontabili non disponibili.');
    setLang('en');
    expect(render(data)).toContain('No sessions attributed to an agent');
    expect(render(data)).toContain('Comparable samples unavailable.');
  });
  it('does not turn an empty partial timing history into observed zero', () => {
    setLang('en');
    const html = render(aggregateAgentUsage([{ ...observation('old', true), spans: [] }]));
    expect(html).toContain('Execution: total unavailable · median unavailable · observed in incomplete sessions: unavailable');
  });
});
