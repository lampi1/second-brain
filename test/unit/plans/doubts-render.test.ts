// Server-rendered doubts and questions of a work map (components/plans/PlanDoubts.tsx, ADR 0343 and 0344): every doubt
// with its state, what closed it and the source; every question with its way up and who answered and why; a question an
// agent holds never says that it waits for the user. And the live words of a row (LiveBits.tsx).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/renderer/actions', () => ({ openChatRef: () => {} }));
import { PlanDoubts } from '../../../src/renderer/components/plans/PlanDoubts';
import { sayLabel } from '../../../src/renderer/components/plans/LiveBits';
import { setLang } from '../../../src/renderer/i18n';
import type { PlanDoubt } from '../../../src/shared/plan-doubts';
import type { LadderQuestion, LadderStep } from '../../../src/shared/question-ladder';
import type { PlanFull } from '../../../src/shared/plan';

const view = (doubts: PlanDoubt[], questions: LadderQuestion[] = [], state = 'toApprove'): PlanFull =>
  ({ map: { id: 'wm_1', state, plan: { doubts } }, questions: questions.map(question => ({ chatId: 'k', title: 'Prova', n: 2, question })) }) as unknown as PlanFull;
const render = (v: PlanFull) => renderToStaticMarkup(createElement(PlanDoubts, { view: v, now: 100_000 }));
const step = (level: LadderStep['level'], name: string, action: LadderStep['action'], why?: string): LadderStep => ({ level, name, at: 1, action, ...(why ? { why } : {}) });
const ask = (p: Partial<LadderQuestion>): LadderQuestion => ({ id: 'q', asks: [{ question: 'Anche i resi?', options: [] }], level: 'strategist', at: 1, levelAt: 1, trail: [], via: 'message', ...p });

beforeAll(() => setLang('it'));

describe('the doubts of a map', () => {
  it('an open one says it holds the ok; a closed one says what closed it and the source', () => {
    const html = render(view([{ text: 'Scadono?', state: 'open' }, { text: 'Uno solo?', state: 'closed', by: 'user', answer: 'Sì', source: 'Uno solo?' },
      { text: 'Offerte?', state: 'closed', by: 'code', answer: 'No', source: 'src/offers.ts:4' }, { text: 'Mobile?', state: 'closed', by: 'brain', answer: 'Sì', source: 'decisions.md' }, { text: 'Log?', state: 'closed', by: 'choice', answer: 'No', source: 'più prudente' }]));
    expect(html.match(/data-s="open"/g)).toHaveLength(1);
    expect(html.match(/data-s="closed"/g)).toHaveLength(4);
    expect(html).toContain('aperto: blocca l’ok');
    for (const t of ['risposta tua', 'dal codice · src/offers.ts:4', 'dal cervello · decisions.md', 'scelta dello Stratega · più prudente']) expect(html).toContain(t);
    // the source of his own answer is the question itself: not said twice
    expect(html.match(/Uno solo\?/g)).toHaveLength(1);
  });
  it('nothing to say, nothing drawn', () => expect(render(view([]))).toBe(''));
  it('once the job is over the list is folded and an open doubt is not a block any more', () => {
    const html = render(view([{ text: 'Scadono?', state: 'open' }], [], 'finished'));
    expect(html).not.toContain('<details open');
    expect(html).not.toContain('data-open');
  });
});

describe('the questions of its chats', () => {
  it('held by an agent: its holder, never the user', () => {
    const html = render(view([], [ask({ level: 'orchestrator', holder: 'o', trail: [step('strategist', 'Strategist «Resi»', 'asked'), step('strategist', 'Strategist «Resi»', 'passed', 'non è scritto'), step('orchestrator', 'Orchestrator', 'asked')] })]));
    expect(html).toContain('data-s="held"');
    expect(html).toContain('ce l’ha Orchestrator');
    expect(html).toContain('Strategist «Resi» la passa su: non è scritto');
    expect(html).not.toContain('aspetta te');
  });
  it('with the user, then who answered and why', () => {
    expect(render(view([], [ask({ level: 'user', trail: [step('user', 'utente', 'asked')] })]))).toContain('aspetta te');
    const html = render(view([], [ask({ answered: { by: 'strategist', name: 'Strategist «Resi»', answer: 'No', why: 'lo dice la richiesta', at: 5 } as LadderQuestion['answered'] })]));
    expect(html).toContain('Strategist «Resi» ha risposto: «No»');
    expect(html).toContain('perché: lo dice la richiesta');
    expect(render(view([], [ask({ answered: { by: 'user', name: 'utente', answer: 'Sì', why: '', at: 5 } as LadderQuestion['answered'] })]))).toContain('Hai risposto: «Sì»');
  });
});

it('the live words name the holder, and the user only when it is his', () => {
  expect((['user', 'parent', 'orchestrator'] as const).map(waits => sayLabel({ say: 'waiting', waits }))).toEqual(['aspetta te', 'aspetta chi l’ha avviata', 'aspetta l’Orchestrator']);
});
