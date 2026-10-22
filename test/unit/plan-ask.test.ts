// A Strategist's plan to approve as a card of the questions window (ADR 0121): which plans wait (proposed, open chats,
// oldest first; put in among the requests where they came), the key's shape (`${chatId}/plan@${at}`, as reqKey builds keys) and back, and the card's markup in
// every language: the steps numbered with their role and detail, when it is finished, what is clear, the two actions;
// nothing for a plan that no longer waits or a newer proposal than the one asked. Rendered without a browser.
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
import type { StrategyPlan } from '../../src/shared/strategy';
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
vi.mock('../../src/renderer/actions', () => ({ claimFocus: () => false }));
let chats: Record<string, Partial<ChatSummary>> = {};
vi.mock('../../src/renderer/store/store', () => ({ useApp: <T,>(pick: (s: { chats: typeof chats }) => T) => pick({ chats }), planDecide: async () => true }));
import { renderToStaticMarkup } from 'react-dom/server';
import { planAskKey, planAskKeys, planAskOf, planWaits, withPlans } from '../../src/renderer/lib/plan-ask';
import { PlanApproval } from '../../src/renderer/components/PlanApproval';
import { setLang } from '../../src/renderer/i18n';

afterEach(() => setLang('it'));
const plan = (p: Partial<StrategyPlan> = {}): StrategyPlan => ({ phase: 'proposed', at: 42, clarified: [{ q: 'Offerte', a: 'No' }], doneWhen: 'I test passano',
  steps: [{ title: 'Trovo dove', detail: 'carrello e reso', role: 'scout', state: 'todo' }, { title: 'Applico lo sconto', role: 'artisan', state: 'todo' }, { title: 'Riassumo', state: 'todo' }], ...p });
const html = (at = 42) => renderToStaticMarkup(createElement(PlanApproval, { ask: { type: 'plan', id: `plan@${at}`, chatId: 's/1', at }, chatTitle: 'Sconti', onEscape: () => {}, testid: 'qp' }));

describe('lib/plan-ask.ts', () => {
  it('lists the plans waiting for the user, oldest first, as keys that read back', () => {
    const s = { chats: {
      b: { id: 'b', plan: plan({ at: 20 }) }, a: { id: 'a', plan: plan({ at: 10 }) },
      run: { id: 'run', plan: plan({ phase: 'running' }) }, gone: { id: 'gone', closedAt: 5, plan: plan() }, none: { id: 'none' },
    } } as unknown as { chats: Record<string, ChatSummary> };
    expect(planAskKeys(s)).toEqual(['a/plan@10', 'b/plan@20']);
    expect(planAskKey('a', 10)).toBe('a/plan@10');
    expect(planAskOf('a/plan@10')).toEqual({ type: 'plan', id: 'plan@10', chatId: 'a', at: 10 });
    expect(planAskOf('c/x/plan@7')).toMatchObject({ chatId: 'c/x', at: 7 });
    expect(planAskOf('a/q1')).toBeNull();
    expect(planAskOf('a/plan@x')).toBeNull();
    expect(planWaits(undefined)).toBe(false);
    expect(planWaits({ plan: plan({ phase: 'revising' }) })).toBe(false);
  });
  it('puts the plans in where they came, the requests keeping their own order', () => {
    const r = (id: string, at: number) => ({ type: 'question', id, at });
    const p = (at: number) => planAskOf(`s/plan@${at}`)!;
    expect(withPlans([r('a', 30), r('b', 10), r('c', 50)], [p(40), p(60)]).map(x => x.id)).toEqual(['a', 'b', 'plan@40', 'c', 'plan@60']);
    expect(withPlans([r('a', 30)], [p(5)]).map(x => x.id)).toEqual(['plan@5', 'a']);
    expect(withPlans([], [])).toEqual([]);
  });
});

describe('PlanApproval.tsx', () => {
  it('shows the steps numbered with their role and detail, when it is finished, what is clear, the two actions', () => {
    chats = { 's/1': { id: 's/1', plan: plan() } };
    const out = html();
    expect(out).toContain('data-request-key="s/1/plan@42"');
    expect(out).toContain('Piano da approvare');
    expect(out).toContain('Approvi questo piano?');
    expect(out).toContain('Lo Strategist propone 3 passi');
    expect(out.match(/class="pa-step"/g)).toHaveLength(3);
    expect(out).toMatch(/pa-n[^>]*>1<.*Trovo dove.*carrello e reso.*Scout/s);
    expect(out).toMatch(/data-testid="qp-step-2" data-role="artisan".*Artisan/s);
    expect(out).toMatch(/data-testid="qp-step-3" data-role="strategist".*Strategist/s);
    expect(out).toContain('I test passano');
    expect(out).toContain('Offerte');
    expect(out).toContain('Approva e parti');
    expect(out).toContain('Cambia qualcosa');
  });
  it('speaks the user\'s language', () => {
    chats = { 's/1': { id: 's/1', plan: plan() } };
    setLang('en');
    expect(html()).toContain('Do you approve this plan?');
    setLang('de');
    expect(html()).toContain('Gibst du diesen Plan frei?');
    expect(html()).toContain('Freigeben und starten');
  });
  it('renders nothing once the plan no longer waits, or for an older proposal than the one shown', () => {
    chats = { 's/1': { id: 's/1', plan: plan({ phase: 'running' }) } };
    expect(html()).toBe('');
    chats = { 's/1': { id: 's/1', plan: plan({ at: 43 }) } };
    expect(html(42)).toBe('');
    chats = {};
    expect(html()).toBe('');
  });
});
