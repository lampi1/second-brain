// Render a strip's figures (components/StripMeta.tsx, ADR 0292): time and cost so far, each next to its estimate, the
// "past the estimate" marks, the cost of an engine that reports none read from the ledger, nothing without figures.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
const MIN = 60_000;
const estimates = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
vi.mock('../../src/renderer/lib/run-estimates', async orig => ({ ...(await orig<Record<string, unknown>>()), useRunEstimates: () => estimates.value }));
import { StripMeta } from '../../src/renderer/components/StripMeta';

const run = { runId: 'r_000000000001', chatId: 'c', agentId: 'artisan', version: 1, goal: 'g', startedBy: 'orchestrator' as const, startedAt: 0, costUsd: null, tokens: null,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null } };
const chat = (p: Partial<ChatSummary> = {}) => ({ id: 'c', title: 'Fix', harness: 'claude', costUsd: 0.5, run, ...p }) as unknown as ChatSummary;
const withEstimate = (timeMs: number | null, costUsd: number | null) => { estimates.value = { runs: { [run.runId]: { runId: run.runId, actual: null, hit: null, estimate: { timeMs, costUsd } } }, accuracy: [] }; };
const render = (c: ChatSummary, workMs: number | null) => renderToStaticMarkup(createElement(StripMeta, { chat: c, workMs }));

describe('strip figures', () => {
  it('shows time and cost so far, alone when there is no estimate', () => {
    estimates.value = null;
    const html = render(chat(), 8 * MIN);
    expect(html).toContain('data-testid="chat-meta-c"');
    expect(html).toMatch(/8 min<\/span><span>0,50\s\$/);
    expect(html).not.toContain(' / ~');
    expect(html).not.toContain('chat-over-c');
  });
  it('puts each figure next to its estimate and marks the ones past it', () => {
    withEstimate(19 * MIN, 0.6);
    const under = render(chat(), 8 * MIN);
    expect(under).toMatch(/8 min<i> \/ ~19 min<\/i>/);
    expect(under).toMatch(/0,50\s\$<i> \/ ~0,60\s\$<\/i>/);
    expect(under).not.toContain('class="over"');
    const over = render(chat({ costUsd: 1 }), 22 * MIN);
    expect(over.match(/class="over"/g)).toHaveLength(2); // time past it, cost past 1.5 times
    expect(over).toContain('data-testid="chat-over-c"');
    expect(render(chat({ costUsd: 0.8 }), 8 * MIN)).not.toContain('class="over"'); // 0.8 is under 1.5 × 0.6
  });
  it('reads the cost as the strip does: the ledger for an engine that reports none, nothing when unknown or zero', () => {
    estimates.value = null;
    expect(render(chat({ harness: 'cursor', costUsd: 0, costLedgerUsd: 0.3 } as Partial<ChatSummary>), 2 * MIN)).toMatch(/≈ 0,30\s\$/);
    expect(render(chat({ costUsd: 0.4, costKnown: false } as Partial<ChatSummary>), 2 * MIN)).not.toContain('$');
    expect(render(chat({ costUsd: 0 }), null)).toBe('');
  });
});
