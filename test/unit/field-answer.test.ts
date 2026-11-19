// Where a text typed in the Orchestrator's field goes (src/renderer/lib/field-answer.ts, ADR 0328): with a row's card
// open the field is that row's answer box, so the words reach the row at once and never depend on the Orchestrator's
// engine; a request to explain, a mode, images or a draft from another page stay the Orchestrator's.
import { describe, expect, it } from 'vitest';
import { answeredInField, fieldRoute, type FieldCard } from '../../src/renderer/lib/field-answer';
import type { PendingRequest } from '../../src/shared/contract';

const ask = (chatId: string, id: string, question: string, tool = 'AskUserQuestion', multiSelect = false): PendingRequest => ({
  id, chatId, type: 'question', tool, title: question, detail: '', at: 1,
  questions: [{ question, multiSelect, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }],
} as unknown as PendingRequest);
const O = 'c_orch';
const stratega = ask('c_str', 'q1', 'Il report valuta anche «Q web costruito sopra Air»?');
const card: FieldCard = { kind: 'question', req: stratega };
const plan: FieldCard = { kind: 'plan', chatId: 'c_str', at: 42 };
const route = (text: string, o: Partial<Parameters<typeof fieldRoute>[1]> = {}) => fieldRoute(text, { chatId: O, card: null, plain: true, ...o });

describe('answeredInField: the rows whose card has no answer box', () => {
  it('a plan and an engine question are written in the Orchestrator\'s field', () => {
    expect(answeredInField({ type: 'plan' })).toBe(true);
    expect(answeredInField(stratega)).toBe(true);
  });
  it('a permission, a command, an MCP form and a work proposal keep their own box or buttons', () => {
    expect(answeredInField({ type: 'permission', tool: 'Bash' })).toBe(false);
    expect(answeredInField({ type: 'command', tool: '' })).toBe(false);
    expect(answeredInField(ask('c', 'f', 'Token?', 'mcp__jira'))).toBe(false);
    expect(answeredInField({ type: 'work' })).toBe(false);
  });
});

describe('fieldRoute: an open card takes what he writes in the Orchestrator\'s field', () => {
  it('his words answer the open question of another chat, each of its questions', () => {
    const r = route('solo da zero però valuta anche lo stack modulare', { card });
    expect(r).toEqual({ to: 'question', req: stratega, answer: { kind: 'question', answers: { [stratega.questions![0]!.question]: 'solo da zero però valuta anche lo stack modulare' } } });
  });
  it('the owner\'s message of 2026-11-19 19:03 is what to change in the open plan, not a message the Orchestrator may keep', () => {
    expect(route('vorrei fosse chiaro anche lo sdoppiamento della tab cartella l\'hai compreso?', { card: plan }))
      .toEqual({ to: 'plan', chatId: 'c_str', at: 42, decision: 'change', text: 'vorrei fosse chiaro anche lo sdoppiamento della tab cartella l\'hai compreso?' });
  });
  it('a plan is approved only by a whole approval; a yes with a condition is a change', () => {
    expect(route('ok vai', { card: plan })).toMatchObject({ to: 'plan', decision: 'approve' });
    expect(route('Approvo e parti.', { card: plan })).toMatchObject({ to: 'plan', decision: 'approve' });
    expect(route('SI procedi considera che voglio un\'unica pull finale', { card: plan })).toMatchObject({ to: 'plan', decision: 'change' });
  });
  it('a bare yes under the open card of a plan is its ok; a yes with more, or a no, is a change', () => {
    for (const text of ['sì', 'Si.', 'ok', 'Va bene!', 'procedi', 'ok, procedi', 'yes'])
      expect(route(text, { card: plan })).toMatchObject({ to: 'plan', decision: 'approve', text });
    for (const text of ['sì ma senza la fase 3', 'ok però prima i test', 'no', 'va bene il primo passo', 'sì?', 'ok?', 'Sì: ma'])
      expect(route(text, { card: plan })).toMatchObject({ to: 'plan', decision: 'change' });
    // a question's «sì» is its answer, as always
    expect(route('sì', { card })).toMatchObject({ to: 'question' });
  });
  it('a request to explain goes to the Orchestrator and the row stays open (ADR 0327)', () => {
    for (const text of ['in che senso?', 'Non ho capito, spiegami', 'perché?', 'cosa cambia se dico no?']) {
      expect(route(text, { card })).toBeNull();
      expect(route(text, { card: plan })).toBeNull();
    }
  });
  it('a mode, images, a «/» command or a draft another page put there are for the Orchestrator', () => {
    expect(route('fai tu', { card, plain: false })).toBeNull();
    expect(route('/compact', { card })).toBeNull();
    expect(route('Cambia il piano «Air refactoring»: i job servono?', { card, drafted: true })).toBeNull();
    expect(route('   ', { card })).toBeNull();
  });
  it('with no card open the text is a message for the Orchestrator, as always', () => {
    expect(route('sì procedi')).toBeNull();
  });
});

describe('fieldRoute: the chat\'s own question (ADR 0274)', () => {
  const own = ask(O, 'own', 'Lancio 6 Scout in parallelo?');
  it('what he writes in the asking chat is its answer, a request to explain too (the chat reads it with the app\'s note)', () => {
    expect(route('sì ma solo 3', { own })).toMatchObject({ to: 'question', req: own });
    expect(route('in che senso?', { own })).toMatchObject({ to: 'question', req: own });
    expect(route('sì', { chatId: 'c_work', own: ask('c_work', 'w', 'Procedo?') })).toMatchObject({ to: 'question' });
  });
  it('another chat\'s open card comes first: he is reading that one', () => {
    expect(route('usa dev', { card, own })).toMatchObject({ to: 'question', req: stratega });
    expect(route('ok vai', { card: plan, own })).toMatchObject({ to: 'plan', decision: 'approve' });
    // and his question about it is a message for the Orchestrator, never the answer to the Orchestrator's own question
    expect(route('in che senso?', { card, own })).toBeNull();
    expect(route('perché 3 fasi?', { card: plan, own })).toBeNull();
  });
  it('the Orchestrator\'s own card open is its own question', () => {
    expect(route('usa dev', { card: { kind: 'question', req: own }, own })).toMatchObject({ to: 'question', req: own });
  });
  it('a draft from another page still answers the chat\'s own question, as before; a mode or images do not', () => {
    expect(route('usa dev', { own, drafted: true })).toMatchObject({ to: 'question', req: own });
    expect(route('usa dev', { own, plain: false })).toBeNull();
  });
  it('a multi-select question takes the words as its one pick', () => {
    const multi = ask('c_str', 'm', 'Quali sezioni?', 'AskUserQuestion', true);
    expect(route('tutte tranne la 3', { card: { kind: 'question', req: multi } })).toMatchObject({ answer: { answers: { 'Quali sezioni?': ['tutte tranne la 3'] } } });
  });
});
