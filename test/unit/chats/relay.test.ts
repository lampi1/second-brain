// Single entry (ADR 0239): a work chat's Sì/No question reaches the user through the Orchestrator's conversation; the
// user's own «sì» / «no» there answers it, never anything else. Fake deps, fake clock.
import { expect, it } from 'vitest';
import type { Answer, ChatItem, ChatSummary, PendingRequest } from '../../../src/shared/contract';
import { QuestionRelay, RELAY_MS } from '../../../src/main/chats/relay';

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({ title: p.id, state: 'waiting', pending: 1, isOrchestrator: false, ...p }) as ChatSummary;
const yesNo = (id: string, chatId: string, question = 'Applico la migrazione al DB locale?', tool = 'AskUserQuestion'): PendingRequest => ({
  id, chatId, type: 'question', tool, title: 'Domanda', detail: '', input: {}, at: 1,
  questions: [{ question, header: 'Migrazione', multiSelect: false, options: [{ label: 'Sì (consigliato)', description: '' }, { label: 'No', description: '' }] }],
} as PendingRequest);

function world(pending: PendingRequest[], items: ChatItem[] = []) {
  const answered: { chatId: string; requestId: string; answer: Answer; by: string }[] = [];
  let now = 1000;
  const chats = [chat({ id: 'orch', isOrchestrator: true, title: 'Orchestrator' }), chat({ id: 'dev', title: 'Dev · migrazione' })];
  const r = new QuestionRelay({
    chats: () => chats, pending: () => pending, items: () => items, now: () => now,
    answer: async (chatId, requestId, answer, by) => { answered.push({ chatId, requestId, answer, by }); pending.splice(pending.findIndex(p => p.id === requestId), 1); },
  });
  return { r, answered, pending, at: (t: number) => { now = t; } };
}

it('relays the question and answers it with the user\'s own «sì» in the Orchestrator chat', async () => {
  const w = world([yesNo('q1', 'dev')]);
  const out = w.r.relay('orch', 'dev');
  expect(out.write).toContain('Dev · migrazione chiede: Applico la migrazione al DB locale? Rispondi sì o no.');
  expect(await w.r.userSaid('orch', 'ok, ma prima dimmi una cosa')).toBe(false);      // not an answer: the relay stays
  expect(w.answered).toEqual([]);
  expect(await w.r.userSaid('orch', 'Sì.', 'phone')).toBe(true);
  expect(w.answered).toEqual([{ chatId: 'dev', requestId: 'q1', answer: { kind: 'question', answers: { 'Applico la migrazione al DB locale?': 'Sì (consigliato)' } }, by: 'phone' }]);
  expect(await w.r.userSaid('orch', 'no')).toBe(false);                                // used once
});

it('«no» picks the No option, from the PC', async () => {
  const w = world([yesNo('q1', 'dev')]);
  w.r.relay('orch', 'dev');
  await w.r.userSaid('orch', 'no');
  expect(w.answered[0]).toMatchObject({ answer: { answers: { 'Applico la migrazione al DB locale?': 'No' } }, by: 'pc' });
});

it('refuses what stays for the user\'s click: permissions, commands, reserved or non-native questions, not Sì/No', () => {
  const perm = { ...yesNo('p1', 'dev'), type: 'permission', tool: 'Bash', questions: undefined } as PendingRequest;
  expect(() => world([perm]).r.relay('orch', 'dev')).toThrow(/click/);
  expect(() => world([yesNo('q1', 'dev', 'Faccio il deploy in produzione?')]).r.relay('orch', 'dev')).toThrow(/reserved/);
  expect(() => world([yesNo('q1', 'dev', 'Procedo?', 'mcp__x__form')]).r.relay('orch', 'dev')).toThrow(/reserved/);
  const three = yesNo('q1', 'dev');
  three.questions![0]!.options.push({ label: 'Forse', description: '' });
  expect(() => world([three]).r.relay('orch', 'dev')).toThrow(/Sì\/No/);
  expect(() => world([yesNo('q1', 'dev')]).r.relay('dev', 'dev')).toThrow(/Orchestrator/);  // only the Orchestrator relays
  expect(() => world([]).r.relay('orch', 'dev')).toThrow(/waits for no answer/);
});

it('a question answered elsewhere first, or an old relay, takes no later «sì»', async () => {
  const w = world([yesNo('q1', 'dev')]);
  w.r.relay('orch', 'dev');
  w.pending.splice(0, 1);                                    // answered on the PC panel
  expect(await w.r.userSaid('orch', 'sì')).toBe(false);
  expect(w.r.current('orch')).toBeUndefined();
  const o = world([yesNo('q1', 'dev')]);
  o.r.relay('orch', 'dev');
  o.at(1000 + RELAY_MS + 1);
  expect(await o.r.userSaid('orch', 'sì')).toBe(false);
  expect(o.answered).toEqual([]);
});
