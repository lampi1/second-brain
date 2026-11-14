// A delegated chat's row (components/DelegationCard.tsx DelegationHead, ADR 0293 and 0307): closed, it says the task,
// who runs it, what it does now and the state; model, time, cost and context are the tip of its ⓘ mark and of the
// «who · now» text, amber with a long context; open, the text carries no tip.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn(), loadItems: vi.fn(), answer: vi.fn(), send: vi.fn(), stop: vi.fn() }));
vi.mock('../../src/renderer/store/ui', () => ({ setChatExpanded: vi.fn(), setFocusMode: vi.fn(), setTreeCollapsed: vi.fn(), ui: { use: () => null } }));
vi.mock('../../src/renderer/lib/clock', () => ({ useNow: () => 1000 }));
vi.mock('../../src/renderer/lib/run-estimates', () => ({ useRunEstimates: () => null, estimateText: () => null }));
vi.mock('../../src/renderer/lib/later', () => ({ openQueue: vi.fn() }));
vi.mock('../../src/renderer/actions', () => ({ reqKey: vi.fn() }));
vi.mock('../../src/renderer/components/ChatTile', () => ({ ChatTile: () => null, useFlash: () => false }));
vi.mock('../../src/renderer/components/StripActivity', () => ({ StripActivity: () => null }));
vi.mock('../../src/renderer/components/StripFace', () => ({ StripFace: () => null }));
import { useApp } from '../../src/renderer/store/store';
import { DelegationHead } from '../../src/renderer/components/DelegationCard';

const chat = (p: Partial<ChatSummary> = {}) => ({ id: 'k', title: 'Trova gli usi di Recalculate', harness: 'claude', model: 'claude-opus-5-5', state: 'idle', costUsd: 0.5, lastText: 'Trovati 3 punti',
  agent: { id: 'scout', name: 'Scout' }, delegation: { role: 'scout', goal: 'Trova gli usi' }, ...p }) as unknown as ChatSummary;
const render = (c: ChatSummary, open = false) => renderToStaticMarkup(createElement(DelegationHead, { chat: c, state: 'done', open }));
beforeEach(() => { vi.mocked(useApp).mockImplementation(selector => selector({ settings: { contextWarnTokens: 200_000 } } as unknown as Parameters<typeof selector>[0])); });

describe('a delegated chat\'s row', () => {
  it('closed, keeps the figures in the tip of its mark and of its text, not on the row', () => {
    const html = render(chat());
    const tip = /data-tip="(Trova gli usi di Recalculate\|[^"]*Opus 5\.5[^"]*)"/.exec(html)?.[1];
    expect(tip).toBeDefined();
    expect(tip).toMatch(/0,50\s\$/);
    expect(html).toContain(`<span class="dc-who" data-tip="${tip}">`);
    expect(html).toContain(`data-tip="${tip}" data-testid="chat-info-k"`);
    expect(html).toContain('class="strip-info"');
    expect(html).not.toContain('chat-meta-k'); expect(html).not.toContain('strip-model-k');
    expect(html).toContain('Trovati 3 punti'); // what it said, on the row
  });
  it('turns the mark amber and says so when the context is long', () => {
    const html = render(chat({ contextTokens: 250_000, contextMaxTokens: 200_000 } as Partial<ChatSummary>));
    expect(html).toContain('class="strip-info over"');
    expect(/data-testid="chat-info-k"/.test(html) && /data-tip="[^"]*250k[^"]*200k[^"]*"/.test(html)).toBe(true);
    expect(render(chat({ contextTokens: 20_000, contextMaxTokens: 200_000 } as Partial<ChatSummary>))).toContain('class="strip-info"');
  });
  it('open, the text carries no tip (the window is under it)', () => {
    expect(render(chat(), true)).toContain('<span class="dc-who">');
  });
});
