// The parts of a Grindhouse strip (src/renderer/components/GrindStrip.tsx, ADR 0366): the ⓘ's lines (model and effort,
// the estimate, the skills, the project) and its card, the plan's dots with «n/m»; and the strip's figures
// (StripMeta.tsx `figures`: time · cost only, the model and the estimate left to the ⓘ, amber once past the estimate).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
vi.mock('../../src/renderer/store/store', () => ({ useApp: vi.fn(), app: { get: () => ({ chats: {} }), subscribe: () => () => {} } }));
const estimate = vi.hoisted(() => ({ value: null as null | { timeMs: number | null; costUsd: number | null } }));
vi.mock('../../src/renderer/lib/run-estimates', async orig => ({ ...(await orig<object>()), useRunEstimates: () => (estimate.value ? { runs: { r1: { estimate: estimate.value } } } : null) }));
import type { ChatSummary } from '../../src/shared/contract';
import type { StrategyPlan } from '../../src/shared/strategy';
import { GrindInfoView, infoLines, PlanDots } from '../../src/renderer/components/GrindStrip';
import { StripMeta } from '../../src/renderer/components/StripMeta';
import { setLang } from '../../src/renderer/i18n';

afterEach(() => { setLang('it'); estimate.value = null; });
const MIN = 60_000;
const run = (skills: string[] = []) => ({ runId: 'r1', tags: { skills, app: null, repo: null } }) as unknown as ChatSummary['run'];
const chat = (p: Partial<ChatSummary> = {}) => ({ id: 'c1', title: 'Fix', model: 'claude-opus-4-5', harness: 'claude', cwd: 'C:\\progetti\\alfa-shop', costUsd: 1.2, ...p }) as ChatSummary;

describe('infoLines', () => {
  it('says the model, the estimate, the skills used and the project, one line each', () => {
    const { model, lines } = infoLines(chat({ run: run(['oris-ops', 'review']) }), { time: '~40 min', cost: '~3 $' });
    expect(model).toMatch(/Opus/);
    expect(lines).toEqual(['stima ~40 min · ~3 $', 'skill: oris-ops · review', 'progetto: alfa-shop']);
  });
  it('leaves out what it does not know: no estimate, no skill, no project', () => {
    expect(infoLines(chat({ cwd: '' }), null).lines).toEqual([]);
    expect(infoLines(chat(), { time: null, cost: '~1 $' }).lines[0]).toBe('stima ~1 $');
  });
  it('speaks the UI language', () => {
    setLang('en');
    expect(infoLines(chat({ run: run(['a']) }), { time: '~5 min', cost: null }).lines).toEqual(['estimate ~5 min', 'skills: a', 'project: alfa-shop']);
  });
});

describe('GrindInfoView', () => {
  it('is a tab stop whose card holds the model in bold and the lines; its label says them all', () => {
    const html = renderToStaticMarkup(createElement(GrindInfoView, { id: 'c1', model: 'Opus 5.5 · high', lines: ['stima ~1 h', 'skill: x'] }));
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-testid="strip-info-c1"');
    expect(html).toContain('<b data-testid="strip-model-c1">Opus 5.5 · high</b><span>stima ~1 h</span><span>skill: x</span>');
    expect(html).toContain('aria-label="Dettagli: modello, stima, skill. Opus 5.5 · high. stima ~1 h. skill: x"');
  });
});

describe('PlanDots', () => {
  const plan = (phase: StrategyPlan['phase'], states: string[]) => ({ phase, at: 0, clarified: [], steps: states.map((state, i) => ({ id: `s${i}`, title: `t${i}`, role: 'artisan', state })) }) as unknown as StrategyPlan;
  it('draws one dot per step by its state and «done/total»', () => {
    const html = renderToStaticMarkup(createElement(PlanDots, { id: 'p', plan: plan('running', ['done', 'done', 'now', 'blocked', 'todo']) }));
    expect(html.match(/<i class="is-[a-z]+"><\/i>/g)).toEqual(['<i class="is-done"></i>', '<i class="is-done"></i>', '<i class="is-now"></i>', '<i class="is-blocked"></i>', '<i class="is-todo"></i>']);
    expect(html).toContain('<small data-testid="plan-percent-p">2/5</small>');
    expect(html).toContain('aria-label="2 di 5 passaggi conclusi"');
  });
  it('shows nothing without a plan, without steps, or while the Strategist still asks', () => {
    for (const p of [undefined, plan('running', []), plan('asking', ['todo']), plan('revising', ['todo'])]) expect(renderToStaticMarkup(createElement(PlanDots, { id: 'p', plan: p }))).toBe('');
  });
});

describe('StripMeta figures', () => {
  const render = (c: ChatSummary, workMs: number | null, figures = true) => renderToStaticMarkup(createElement(StripMeta, { chat: c, workMs, figures }));
  it('shows time · cost only: no model, no estimate', () => {
    estimate.value = { timeMs: 40 * MIN, costUsd: 3 };
    const html = render(chat({ run: run() }), 12 * MIN);
    expect(html).not.toContain('strip-model');
    expect(html).not.toContain('/ ~');
    expect(html).toContain('12 min');
    expect(html).toContain('1,20');
  });
  it('turns amber once past the estimate, and keeps the model and estimate without `figures`', () => {
    estimate.value = { timeMs: 10 * MIN, costUsd: 0.5 };
    expect(render(chat({ run: run() }), 12 * MIN)).toMatch(/class="over">12 min/);
    const full = render(chat({ run: run() }), 12 * MIN, false);
    expect(full).toContain('strip-model');
    expect(full).toContain('/ ~10 min');
  });
});
