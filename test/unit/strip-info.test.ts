// The rest of a strip behind one mark (components/StripInfo.tsx, ADR 0307): what its tip says (model and effort, work
// time and cost next to their estimate, the context), when the mark asks for a look, how the tip's lines reach the
// TooltipLayer (lib/tips.ts splitTip), and the mark itself.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
const MIN = 60_000;
const estimates = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
vi.mock('../../src/renderer/lib/run-estimates', async orig => ({ ...(await orig<Record<string, unknown>>()), useRunEstimates: () => estimates.value }));
import { StripInfo, stripInfo, useStripInfo } from '../../src/renderer/components/StripInfo';
import { splitTip, tipOf } from '../../src/renderer/lib/tips';

const run = { runId: 'r_000000000001', chatId: 'c', agentId: 'artisan', version: 1, goal: 'g', startedBy: 'orchestrator' as const, startedAt: 0, costUsd: null, tokens: null,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null } };
const chat = (p: Partial<ChatSummary> = {}) => ({ id: 'c', title: 'Fix totale ordine', harness: 'claude', model: 'claude-opus-5-5', effortStatus: { effective: 'high' }, costUsd: 0.5, run, ...p }) as unknown as ChatSummary;
function Mark({ c, workMs, long }: { c: ChatSummary; workMs: number | null; long?: boolean }) { return createElement(StripInfo, { chatId: c.id, info: useStripInfo(c, workMs, long) }); }
const render = (c: ChatSummary, workMs: number | null, long = false) => renderToStaticMarkup(createElement(Mark, { c, workMs, long }));

describe('what a strip keeps behind its mark', () => {
  it('says the model and effort, the work time and the cost, one per line, and asks for no look', () => {
    const info = stripInfo(chat(), 8 * MIN, null);
    expect(info.title).toBe('Fix totale ordine');
    expect(info.lines).toHaveLength(3);
    expect(info.lines[0]).toContain('Opus 5.5 · high');
    expect(info.lines[1]).toContain('8 min');
    expect(info.lines[2]).toMatch(/0,50\s\$/);
    expect(info.lines.join(' ')).not.toContain('~');
    expect(info.over).toBe(false);
  });
  it('puts each figure next to its estimate and says which one is past it', () => {
    const under = stripInfo(chat(), 8 * MIN, { timeMs: 19 * MIN, costUsd: 0.6 });
    expect(under.lines[1]).toMatch(/8 min · .*~19 min$/);
    expect(under.lines[2]).toMatch(/0,50\s\$ · .*~0,60\s\$$/);
    expect(under.over).toBe(false);
    const over = stripInfo(chat({ costUsd: 1 }), 22 * MIN, { timeMs: 19 * MIN, costUsd: 0.6 });
    expect(over.over).toBe(true);
    expect(over.lines[1]!.length).toBeGreaterThan(under.lines[1]!.length); // «oltre la stima» is added to the line
    expect(over.lines[2]!.split(' · ')).toHaveLength(3);
    // the cost is past its estimate only beyond 1.5 times, as on the full screen's figures (StripMeta.tsx)
    expect(stripInfo(chat({ costUsd: 0.8 }), 8 * MIN, { timeMs: 19 * MIN, costUsd: 0.6 }).over).toBe(false);
  });
  it('reads the cost as the strip does: the ledger for an engine that reports none, no line when unknown or zero', () => {
    expect(stripInfo(chat({ harness: 'cursor', costUsd: 0, costLedgerUsd: 0.3 } as Partial<ChatSummary>), 2 * MIN, null).lines.join('\n')).toMatch(/≈ 0,30\s\$/);
    expect(stripInfo(chat({ costUsd: 0.4, costKnown: false } as Partial<ChatSummary>), 2 * MIN, null).lines.join('\n')).not.toContain('$');
    expect(stripInfo(chat({ costUsd: 0 }), null, null).lines).toHaveLength(1); // the model alone
  });
  it('adds the context and asks for a look when it is long', () => {
    const c = chat({ contextTokens: 172_000, contextMaxTokens: 200_000 } as Partial<ChatSummary>);
    const calm = stripInfo(c, null, null), long = stripInfo(c, null, null, true);
    expect(calm.lines).toHaveLength(3);
    expect(calm.lines[2]).toMatch(/172.*200/);
    expect(calm.over).toBe(false);
    expect(long.over).toBe(true);
    expect(long.lines[2]!.length).toBeGreaterThan(calm.lines[2]!.length);
  });
});

describe('the tip of several lines', () => {
  it('is the title, then the lines under it: the TooltipLayer shows one line each', () => {
    const tip = tipOf('Fix totale ordine', ['Modello: Opus 5.5 · high', 'Costo: 0,50 $']);
    expect(splitTip(tip)).toEqual({ text: 'Fix totale ordine', more: 'Modello: Opus 5.5 · high\nCosto: 0,50 $' });
  });
  it('never lets a title or a line break the tip apart, and keeps a command readable', () => {
    const tip = tipOf('rg -n foo src | head -5\nc', ['x | y', 'z\nw']);
    expect(splitTip(tip).text).toBe('rg -n foo src │ head -5 c'); // the title's pipe is written with a look-alike
    expect(splitTip(tip).more!.split('\n')).toEqual(['x | y', 'z w']); // the lines under it keep theirs
  });
  it('is the title alone when there is nothing under it, and the first line when there is no title', () => {
    expect(tipOf('Solo', [])).toBe('Solo');
    expect(splitTip(tipOf('', ['uno', 'due']))).toEqual({ text: 'uno', more: 'due' });
    expect(tipOf('', [])).toBe('');
  });
});

describe('the mark on a strip', () => {
  it('carries the tip, a label for screen readers and the keyboard focus', () => {
    estimates.value = null;
    const html = render(chat(), 8 * MIN);
    expect(html).toContain('data-testid="chat-info-c"');
    expect(html).toContain('tabindex="0"');
    expect(html).toMatch(/data-tip="Fix totale ordine\|[^"]*Opus 5\.5 · high/);
    expect(html).toMatch(/aria-label="Fix totale ordine\. [^"]*8 min/);
    expect(html).not.toContain('strip-info over');
  });
  it('is amber once the work is past the estimate of its run', () => {
    estimates.value = { runs: { [run.runId]: { runId: run.runId, actual: null, hit: null, estimate: { timeMs: 19 * MIN, costUsd: 0.6 } } }, accuracy: [] };
    expect(render(chat(), 22 * MIN)).toContain('class="strip-info over"');
    expect(render(chat(), 8 * MIN)).toContain('class="strip-info"');
    estimates.value = null;
    expect(render(chat(), 8 * MIN, true)).toContain('class="strip-info over"');
  });
  it('says the model alone while the chat has no figures yet', () => {
    estimates.value = null;
    const html = render(chat({ costUsd: 0 }), null);
    expect(html).toMatch(/data-tip="Fix totale ordine\|[^"\n]*Opus 5\.5 · high"/);
  });
});
