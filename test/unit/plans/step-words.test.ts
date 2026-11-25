// A plan's steps in words (renderer/lib/plans.ts, ADR 0363), rewritten from the tests of the old map's step words (whoOf,
// groupLabel, whenOf, stateOf): who does a step («Artisan · Base», never a model), when it starts, how far it is, what a turn
// of steps that run together is doing, and the step rows as the page draws them.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/renderer/actions', () => ({ openChatRef: () => {} }));
vi.mock('../../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import { setLang } from '../../../src/renderer/i18n';
import { startsText, stateWords, turnLabel, whoOf } from '../../../src/renderer/lib/plans';
import { PlanSteps } from '../../../src/renderer/components/plans/PlanSteps';
import type { PlanFull, PlanStepView } from '../../../src/shared/plan';

const step = (n: number, state: PlanStepView['state'], turn: number, more: Partial<PlanStepView> = {}): PlanStepView =>
  ({ n, id: `s${n}`, title: `Passo ${n}`, turn, state, after: [], waitsFor: [], opens: [], touches: [], chatIds: [], ...more });
const MIN = 60_000;

beforeAll(() => setLang('it'));

describe('who does a step', () => {
  it('tells role · preset and never a model (ADR 0346), started or not', () => {
    expect(whoOf({ role: 'artisan', preset: 'base' })).toBe('Artisan · Base');
    expect(whoOf({ role: 'scout', preset: 'min' })).toBe('Scout · Minimo');
    expect(whoOf({ role: 'scout' })).toBe('Scout');
    // a model that reached the words by mistake is not shown
    expect(whoOf({ role: 'artisan', preset: 'max', model: 'claude-sonnet-5-5' } as never)).toBe('Artisan · Massimo');
  });
  it('is nothing for a step the Strategist does itself', () => {
    expect(whoOf({})).toBeNull();
  });
});

describe('when a step starts and how far it is', () => {
  it('says when it starts: right away, or after which steps; nothing once it is under way', () => {
    expect(startsText(step(1, 'todo', 1))).toBe('Parte subito');
    expect(startsText(step(3, 'todo', 2, { waitsFor: [1, 2] }))).toBe('Aspetta il passo 1, 2');
    expect(startsText(step(2, 'now', 2))).toBe('');
    expect(startsText(step(1, 'done', 1))).toBe('');
  });
  it('says how far it is: under way since, done in so long, blocked, to do', () => {
    expect(stateWords(step(1, 'done', 1, { startedAt: MIN, endedAt: 6 * MIN }), 10 * MIN)).toBe('fatto in 5 min');
    expect(stateWords(step(1, 'done', 1), 0)).toBe('fatto');
    expect(stateWords(step(2, 'now', 2, { startedAt: 6 * MIN }), 16 * MIN)).toBe('in corso da 10 min');
    expect(stateWords(step(2, 'now', 2), 0)).toBe('in corso');
    expect(stateWords(step(3, 'todo', 2), 0)).toBe('da fare');
    expect(stateWords(step(5, 'blocked', 3), 0)).toBe('bloccato');
    expect(stateWords(step(6, 'partial', 3), 0)).toBe('fatto in parte');
    expect(stateWords(step(7, 'check', 3), 0)).toBe('da verificare');
  });
});

describe('steps that run together', () => {
  it('a turn of one step is just «Turno N»; steps together say how many, counted live', () => {
    expect(turnLabel({ turn: 1, together: false, steps: [step(1, 'done', 1)] })).toBe('Turno 1');
    const group = [step(2, 'now', 2), step(3, 'now', 2), step(4, 'done', 2), step(5, 'todo', 2), step(6, 'blocked', 2)];
    expect(turnLabel({ turn: 2, together: true, steps: group })).toBe('Turno 2 · 5 insieme · 2 al lavoro, 1 fatto, 1 bloccato, 1 da fare');
    expect(turnLabel({ turn: 2, together: true, steps: [step(2, 'todo', 2), step(3, 'todo', 2)] })).toBe('Turno 2 · 2 insieme · 2 da fare');
  });
});

describe('the step list as the page draws it', () => {
  const view = (steps: PlanStepView[]) => ({ record: { id: 'pl_1' }, info: {}, steps, history: [], questions: [] }) as unknown as PlanFull;
  const render = (steps: PlanStepView[]) => renderToStaticMarkup(createElement(PlanSteps, { view: view(steps), now: 20 * MIN, edit: false, ops: [], onOp: () => {} }));
  it('draws the steps of one turn side by side in one framed block, each with who, what it waits for and its proof', () => {
    const html = render([
      step(1, 'done', 1, { role: 'scout', preset: 'min', proof: { at: 1, by: 'report', text: 'trovato dove si calcola' }, opens: [2, 3] }),
      step(2, 'now', 2, { role: 'artisan', preset: 'base', startedAt: 10 * MIN, waitsFor: [], touches: ['src/a.ts'] }),
      step(3, 'todo', 2, { role: 'artisan', waitsFor: [], touches: ['src/b.ts'] }),
      step(4, 'todo', 3, { waitsFor: [2, 3], minutes: 90 }),
    ]);
    expect(html.match(/data-testid="pl-turn-\d"/g)).toHaveLength(3);
    expect(html).toContain('Turno 2 · 2 insieme · 1 al lavoro, 1 da fare');
    expect(html).toMatch(/data-together=""[^>]*data-testid="pl-turn-2"/);
    expect(html).toContain('Scout · Minimo');
    expect(html).toContain('Artisan · Base');
    expect(html).toContain('in corso da 10 min');
    expect(html).toContain('Aspetta il passo 2, 3');
    expect(html).toContain('trovato dove si calcola');
    expect(html).toContain('1 h 30');
    expect(html).not.toMatch(/claude|sonnet|opus/i);
  });
  it('a plan with no steps says so', () => {
    expect(render([])).toContain('pl-steps-empty');
  });
});
