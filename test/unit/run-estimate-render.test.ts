// Render the strip's estimate chip (components/RunEstimate.tsx, ADR 0087): open run «stima ~4 min · ~0,12 $ · su 12 task
// simili» with the time left and a "?", an ended one «~4 min → 6 min ✓», nothing without an estimate; IT/EN.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn(), app: { get: () => ({ chats: {} }), subscribe: () => () => {} } }));
vi.mock('../../src/renderer/store/agents', () => ({ useAgents: () => ({ catalog: { profiles: [] } }) }));
import type { ChatSummary } from '../../src/shared/contract';
import type { RunEstimateView } from '../../src/shared/task-estimate';
import { AccuracyNote, EstimateChip } from '../../src/renderer/components/RunEstimate';
import { it as itDict } from '../../src/renderer/i18n/it';
import { setLang } from '../../src/renderer/i18n';

afterEach(() => setLang('it'));
const MIN = 60_000;
const run = { runId: 'r_000000000001', chatId: 'c', agentId: 'artisan', version: 1, goal: 'g', startedBy: 'orchestrator' as const, startedAt: 0, costUsd: null, tokens: null,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null } };
const chat = (endedAt?: number) => ({ id: 'c', title: 'Fix', agent: { name: 'Artisan' }, run: { ...run, ...(endedAt ? { endedAt } : {}) } }) as unknown as ChatSummary;
const view = (p: Partial<RunEstimateView> = {}): RunEstimateView => ({ runId: run.runId, actual: null, hit: null, estimate: { kind: 'bug-fix', basis: 'agent-kind', n: 12, timeMs: 4 * MIN, timeLowMs: 3 * MIN, timeHighMs: 6 * MIN,
  costUsd: 0.12, costLowUsd: null, costHighUsd: null, confidence: 'high', parts: 1, quick: true, path: 'one-agent', why: '' }, ...p });
const summary = { pct: 68, k: 27, n: 40, weeks: 6, specificPct: 80, bars: [{ weekStart: 1, pct: 40, n: 5 }, { weekStart: 2, pct: 68, n: 9 }] };
const render = (c: ChatSummary, v: RunEstimateView | undefined, busy = true) => renderToStaticMarkup(createElement(EstimateChip, { chat: c, view: v, summary, busy, workMs: MIN }));

describe('estimate chip', () => {
  it('shows the estimate of an open run with the similar tasks, the time left and the explanation', () => {
    const html = render(chat(), view());
    expect(html).toContain('stima');
    expect(html).toMatch(/~4 min · ~0,12\s\$ · su 12 lavori simili/);
    expect(html).toContain('ne restano ~3 min');
    expect(html).toContain('data-testid="estimate-help-r_000000000001"');
    expect(html).toContain('Come si calcola la stima');
    expect(html).not.toContain('precisione');
  });
  it('shows estimate → actual with a mark once ended', () => {
    const html = render(chat(7 * MIN), view({ actual: { timeMs: 6 * MIN, costUsd: 0.1 }, hit: true }), false);
    expect(html).toContain('~4 min → 6 min');
    expect(html).toContain('✓');
    expect(html).toContain('th-estimate est-held');
    expect(html).not.toContain('ne restano');
    expect(render(chat(7 * MIN), view({ actual: { timeMs: 30 * MIN, costUsd: 0.1 }, hit: false }), false)).toContain('✗');
  });
  it('says how many estimates held as k/n within ×2, without "precisione" or a trend (ADR 0101)', () => {
    const html = renderToStaticMarkup(createElement(AccuracyNote, { summary }));
    expect(html).toContain('entro ×2: 27/40');
    expect(html).not.toMatch(/precisione|pt in/);
    // the "?" adds «Esempio:» itself: the example text does not repeat it
    expect(itDict['estimate.example']).not.toMatch(/^Esempio/);
  });
  it('says nothing without an estimate, and speaks English', () => {
    expect(render(chat(), view({ estimate: null }))).toBe('');
    expect(render(chat(), undefined)).toBe('');
    setLang('en');
    expect(render(chat(), view())).toContain('from 12 similar tasks');
  });
});
