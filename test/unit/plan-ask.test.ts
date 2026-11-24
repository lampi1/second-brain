// A Strategist's plan to approve among the questions (ADR 0121, 0343): which plans wait (proposed, open chats, oldest first;
// put in among the requests where they came), the key's shape (`${chatId}/plan@${at}`, as reqKey builds keys) and back, and
// the card's markup in every language: the job, one line and «Apri la mappa», no step and no Sì / No, since the plan is read and
// approved on its map; nothing for a plan that no longer waits or a newer proposal than the one asked. Its key is what the
// Orchestrator's field answers while it is open, so a typed ok still counts. Rendered without a browser.
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';
import type { StrategyPlan } from '../../src/shared/strategy';
vi.mock('../../src/renderer/sb', () => ({ sb: {} }));
vi.mock('../../src/renderer/actions', () => ({ claimFocus: () => false, openWorkMapOf: async () => {} }));
let chats: Record<string, Partial<ChatSummary>> = {};
vi.mock('../../src/renderer/store/store', () => ({ useApp: <T,>(pick: (s: { chats: typeof chats }) => T) => pick({ chats }) }));
import { renderToStaticMarkup } from 'react-dom/server';
import { planCards, planQuestion, planAskKey, planAskKeys, planAskOf, planWaits, withPlans } from '../../src/renderer/lib/plan-ask';
import { PlanAskCard } from '../../src/renderer/components/PlanAskCard';
import { fieldRoute } from '../../src/renderer/lib/field-answer';
import { setLang } from '../../src/renderer/i18n';

afterEach(() => setLang('it'));
const plan = (p: Partial<StrategyPlan> = {}): StrategyPlan => ({ phase: 'proposed', at: 42, clarified: [{ q: 'Offerte', a: 'No' }], doneWhen: 'I test passano',
  steps: [{ title: 'Trovo dove', detail: 'carrello e reso', role: 'scout', state: 'todo' }, { title: 'Applico lo sconto', role: 'artisan', state: 'todo' }, { title: 'Riassumo', state: 'todo' }], ...p });
const html = (at = 42) => renderToStaticMarkup(createElement(PlanAskCard, { ask: { type: 'plan', id: `plan@${at}`, chatId: 's/1', at }, onEscape: () => {}, testid: 'qp' }));

describe('lib/plan-ask.ts', () => {
  it('targets only the native single Plan question when a connector form also waits', () => {
    const chat = { plan: plan({ phase: 'asking' }) };
    const ask = (tool: string, n: number) => ({ type: 'question', tool, questions: Array.from({ length: n }, () => ({ question: 'Test?' })) }) as PendingRequest;
    const form = ask('mcp__connector', 1), group = ask('AskQuestion', 2), native = ask('AskUserQuestion', 1);
    expect(planQuestion(chat, [form, group], false)).toBeUndefined();
    expect(planQuestion(chat, [form, group, native], false)).toBe(native);
  });
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

describe('planCards: the Orchestrator\'s plan cards (#351)', () => {
  const native = { type: 'question', tool: 'AskUserQuestion', chatId: 's/1', questions: [{ question: 'Offerte?' }] } as PendingRequest;
  const c = (id: string, p: Partial<StrategyPlan>, extra: Partial<ChatSummary> = {}) => ({ id, plan: plan(p), ...extra }) as ChatSummary;
  it('shows «Prima di partire» only while an interview question is open', () => {
    expect(planCards([c('s/1', { phase: 'asking' })], [])).toEqual([]);
    const [card] = planCards([c('s/1', { phase: 'asking' })], [native]);
    expect(card?.question).toBe(native);
    expect(planCards([c('s/1', { phase: 'asking' })], [{ ...native, chatId: 's/2' }])).toEqual([]);
    // a group of questions is open too: the card stays (the questions window answers it)
    const group = { ...native, questions: [{ question: 'A?' }, { question: 'B?' }] } as PendingRequest;
    const [g] = planCards([c('s/1', { phase: 'asking' })], [group]);
    expect(g?.chat.id).toBe('s/1');
    expect(g?.question).toBeUndefined();
  });
  it('never twice for one chat, never for a closed chat, always for a plan to approve', () => {
    const a = c('s/1', { phase: 'asking' });
    expect(planCards([a, a], [native])).toHaveLength(1);
    expect(planCards([c('s/1', { phase: 'asking' }, { closedAt: 5 })], [native])).toEqual([]);
    expect(planCards([c('s/1', { phase: 'proposed' })], [])).toHaveLength(1);
    expect(planCards([c('s/1', { phase: 'running' })], [native])).toEqual([]);
  });
});

describe('PlanAskCard.tsx', () => {
  it('keeps the pending card after user chat activity and presents only the latest proposal key', () => {
    chats = { 's/1': { id: 's/1', plan: plan(), state: 'running', updatedAt: 100 } };
    const state = { chats } as { chats: Record<string, ChatSummary> };
    expect(planAskKeys(state)).toEqual(['s/1/plan@42']);
    expect(html()).toContain('data-testid="qp-map"');
    chats['s/1']!.plan = plan({ at: 101 });
    expect(planAskKeys(state)).toEqual(['s/1/plan@101']);
    expect(html()).toBe('');
    expect(html(101)).toContain('data-testid="qp-map"');
  });
  it('is one line and «Apri la mappa»: no step, no Sì / No', () => {
    chats = { 's/1': { id: 's/1', plan: plan() } };
    const out = html();
    expect(out).toContain('data-request-key="s/1/plan@42"');
    expect(out).toContain('3 step');
    expect(out).toContain('Si legge e si approva sulla sua mappa.');
    expect(out).toContain('Apri la mappa');
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).not.toContain('Trovo dove');
    expect(out).not.toContain('<li');
    expect(out).not.toContain('Sì');
  });
  it('a typed ok still approves the plan whose card is open, at its revision', () => {
    chats = { 's/1': { id: 's/1', plan: plan() } };
    const ask = planAskOf(html().match(/data-request-key="([^"]+)"/)![1]!)!;
    const typed = (text: string) => fieldRoute(text, { chatId: 'orch', card: { kind: 'plan', chatId: ask.chatId, at: ask.at }, plain: true });
    for (const text of ['Approvo', 'ok', 'sì']) expect(typed(text)).toEqual({ to: 'plan', chatId: 's/1', at: 42, decision: 'approve', text });
    expect(typed('ok ma prima i test')).toMatchObject({ to: 'plan', at: 42, decision: 'change' });
  });
  it('speaks the user\'s language', () => {
    chats = { 's/1': { id: 's/1', plan: plan() } };
    setLang('en');
    expect(html()).toContain('Read it and approve it on its map.');
    setLang('de');
    expect(html()).toContain('Auf seiner Karte lesen und freigeben.');
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
