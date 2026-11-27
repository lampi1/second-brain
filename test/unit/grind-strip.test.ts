// The parts of a Grindhouse strip (src/renderer/components/GrindStrip.tsx, ADR 0366): the ⓘ's lines (model and effort,
// the estimate, the skills, the project, the sub-agents) and its card with its open/shut states, the sub-agents' count,
// the plan's dots with «n/m»; and the strip's figures
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
import { GrindInfoView, infoLines, infoNext, PlanDots, planOutcome, SubCount, subLines } from '../../src/renderer/components/GrindStrip';
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

const kids = (...states: string[]) => ({ active: states.length, observedActive: states.length,
  children: states.map((state, i) => ({ key: `k${i}`, kind: 'agent', agentType: i === 0 ? 'Explore' : 'reviewer', state, task: `compito ${i}`, startedAt: i + 1, observedAt: i + 1 })) }) as unknown as ChatSummary['agentChildren'];

describe('the engine\'s sub-agents', () => {
  it('one ⓘ line each still on the job, with its type and task; the ended ones left out', () => {
    expect(subLines(kids('running', 'completed'))).toEqual(['↳ sottoagente · Explore · sola lettura: compito 0']);
    expect(subLines(undefined)).toEqual([]);
    expect(infoLines(chat({ cwd: '', agentChildren: kids('running', 'running') }), null).lines).toEqual(['↳ sottoagente · Explore · sola lettura: compito 0', '↳ sottoagente · reviewer: compito 1']);
  });
  it('the row shows only a small «↳ n», nothing without one', () => {
    const html = renderToStaticMarkup(createElement(SubCount, { id: 'c1', agents: kids('running', 'running') }));
    expect(html).toContain('data-testid="strip-subs-c1"');
    expect(html).toContain('>↳ 2</span>');
    expect(html).toContain('aria-label="2 sottoagenti al lavoro"');
    expect(renderToStaticMarkup(createElement(SubCount, { id: 'c1', agents: kids('stopped') }))).toBe('');
  });
});

describe('the ⓘ states (infoNext)', () => {
  const closed = { open: false, shut: false };
  it('a click, Enter or Space pins it open and closes it again', () => {
    for (const ev of ['click', 'Enter', ' '] as const) {
      expect(infoNext(closed, ev)).toEqual({ open: true, shut: false });
      expect(infoNext({ open: true, shut: false }, ev)).toEqual({ open: false, shut: false });
    }
  });
  it('Esc closes it even under the pointer; a second Esc goes on to the page', () => {
    expect(infoNext({ open: true, shut: false }, 'Escape')).toEqual({ open: false, shut: true });
    expect(infoNext(closed, 'Escape')).toEqual({ open: false, shut: true });
    expect(infoNext({ open: false, shut: true }, 'Escape')).toBeNull();
  });
  it('leaving the focus resets it, leaving the pointer lifts only the Esc', () => {
    expect(infoNext({ open: true, shut: true }, 'blur')).toEqual(closed);
    expect(infoNext({ open: true, shut: true }, 'leave')).toEqual({ open: true, shut: false });
    expect(infoNext(closed, 'a')).toBeNull(); // other keys are the strip's
  });
});

describe('GrindInfoView', () => {
  it('is a tab stop whose card holds the model in bold and the lines; its label says them all', () => {
    const html = renderToStaticMarkup(createElement(GrindInfoView, { id: 'c1', model: 'Opus 5.5 · high', lines: ['stima ~1 h', 'skill: x'] }));
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-expanded="false"');
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
    expect(html).toContain('<small data-testid="plan-percent-p" aria-hidden="true">2/5</small>');
    expect(html).toContain('aria-label="2 di 5 passaggi conclusi"');
  });
  it('says a blocked outcome over a partial one, nothing when the steps go as planned', () => {
    expect(planOutcome(undefined)).toBeNull();
    expect(planOutcome(plan('running', ['done', 'now', 'todo']))).toBeNull();
    expect(planOutcome(plan('done', ['partial', 'done']))).toBe('tree.plan.partial');
    expect(planOutcome(plan('done', ['partial', 'blocked']))).toBe('tree.plan.blocked');
    const html = renderToStaticMarkup(createElement(PlanDots, { id: 'p', plan: plan('done', ['partial', 'partial', 'done']) }));
    expect(html).toContain('<small class="gs-plan-note" data-testid="plan-note-p">risultato parziale</small>');
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuemax="3" aria-valuenow="\d"/);
    expect(renderToStaticMarkup(createElement(PlanDots, { id: 'p', plan: plan('running', ['done', 'todo']) }))).not.toContain('plan-note-p');
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
