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
  const answered: { chatId: string; requestId: string; answer: Answer; by: string }[] = [], told: string[] = [];
  let now = 1000, fail = false;
  const chats = [chat({ id: 'orch', isOrchestrator: true, title: 'Orchestrator' }), chat({ id: 'dev', title: 'Dev · migrazione' }), chat({ id: 'qa', title: 'QA' })];
  const r = new QuestionRelay({
    chats: () => chats, pending: () => pending, items: () => items, now: () => now, notify: (_o, text) => { told.push(text); },
    answer: async (chatId, requestId, answer, by) => {
      if (fail) throw new Error('engine gone');
      answered.push({ chatId, requestId, answer, by }); pending.splice(pending.findIndex(p => p.id === requestId), 1);
    },
  });
  return { r, answered, told, pending, items, at: (t: number) => { now = t; }, failing: () => { fail = true; } };
}

it('relays the question and answers it with the user\'s own «sì» in the Orchestrator chat', async () => {
  const w = world([yesNo('q1', 'dev')]);
  const out = w.r.relay('orch', 'dev');
  expect(out.write).toContain('Dev · migrazione chiede: Applico la migrazione al DB locale? Rispondi sì o no.');
  expect(out.write).toContain('ask nothing else');
  expect(await w.r.userSaid('orch', 'Sì.', 'phone')).toBe(true);
  expect(w.answered).toEqual([{ chatId: 'dev', requestId: 'q1', answer: { kind: 'question', answers: { 'Applico la migrazione al DB locale?': 'Sì (consigliato)' } }, by: 'phone' }]);
  expect(await w.r.userSaid('orch', 'no')).toBe(false);                                // used once
});

it('any other reply ends the relay: a later bare «no» is not taken as the answer', async () => {
  const w = world([yesNo('q1', 'dev')]);
  w.r.relay('orch', 'dev');
  expect(await w.r.userSaid('orch', 'aspetta, prima dimmi una cosa')).toBe(false);
  expect(w.told).toEqual([]);
  // the other message may have crossed the question: the bare «no» after it is not delivered, but it is told
  expect(await w.r.userSaid('orch', 'no')).toBe(false);
  expect(w.answered).toEqual([]);
  expect(w.told).toEqual([expect.stringContaining('chiuso l\'inoltro')]);
  expect(await w.r.userSaid('orch', 'sì')).toBe(false);       // told once
  expect(w.told).toHaveLength(1);
});

it('one relayed question at a time: a second one waits for the first answer', async () => {
  const w = world([yesNo('q1', 'dev'), yesNo('q2', 'qa', 'Aggiungo anche i test?')]);
  w.r.relay('orch', 'dev');
  expect(() => w.r.relay('orch', 'qa')).toThrow(/one relayed question at a time/);
  await w.r.userSaid('orch', 'sì');
  expect(w.r.relay('orch', 'qa').question).toBe('Aggiungo anche i test?');
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

it('a «sì» that cannot land is told to the Orchestrator: expired, failed delivery, or the brief turned reserved', async () => {
  const e = world([yesNo('q1', 'dev')]);
  e.r.relay('orch', 'dev');
  e.at(1000 + RELAY_MS + 1);
  expect(await e.r.userSaid('orch', 'sì')).toBe(false);
  expect(e.answered).toEqual([]);
  expect(e.told).toEqual([expect.stringContaining('NON è arrivata a «Dev · migrazione»: l\'inoltro era scaduto')]);
  const f = world([yesNo('q1', 'dev')]);
  f.r.relay('orch', 'dev');
  f.failing();
  expect(await f.r.userSaid('orch', 'sì')).toBe(false);
  expect(f.told).toEqual([expect.stringContaining('la consegna alla chat non è riuscita')]);
  const b = world([yesNo('q1', 'dev')]);
  b.r.relay('orch', 'dev');
  b.items.push({ kind: 'artifact', id: 'x', at: 2, askId: 'q1', title: 'Brief', summary: '', ui: { component: 'brief', props: { done: ['fatto'], ifYes: 'faccio il push in produzione', ifNo: 'mi fermo' } } } as unknown as ChatItem);
  expect(await b.r.userSaid('orch', 'sì')).toBe(false);
  expect(b.answered).toEqual([]);
  expect(b.told).toEqual([expect.stringContaining('riservato')]);
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
  expect(w.told).toEqual([]);                                // answered on the PC: nothing was lost
});

// ADR 0259 §4: the same parts as the PC's card, and a command the chat left is relayed as «Eseguo sul PC?»
const brief = (askId: string): ChatItem => ({ kind: 'artifact', id: 'b1', at: 1, askId, title: 'Brief', summary: '', ui: { component: 'brief', props: {
  why: 'Il totale ordine sbaglia lo sconto.', done: ['Fix scritto'], todo: ['Apri il carrello di prova'], ifYes: 'faccio il commit', ifNo: 'lascio le modifiche', yesSteps: ['Commit', 'PR'] } } } as unknown as ChatItem);
const cmd = (id: string, chatId: string, code: string, prod?: string): PendingRequest => ({
  id, chatId, type: 'command', tool: 'Esegui', title: 'Comando da eseguire', detail: code, input: {}, at: 0,
  command: { itemId: 'a1', code, lang: 'powershell', lead: 'Lancia i test:', ...(prod ? { prod } : {}) } } as PendingRequest);

function withCommands(cmds: PendingRequest[], pending: PendingRequest[] = []) {
  const ran: string[] = [], dismissed: string[] = [];
  const chats = [chat({ id: 'orch', isOrchestrator: true, title: 'Orchestrator' }), chat({ id: 'dev', title: 'Dev' })];
  const r = new QuestionRelay({ chats: () => chats, pending: () => pending, items: () => [], answer: async () => {},
    commands: { pending: () => cmds, run: (_c, id) => { ran.push(id); cmds.splice(cmds.findIndex(x => x.id === id), 1); }, dismiss: (_c, id) => { dismissed.push(id); cmds.splice(cmds.findIndex(x => x.id === id), 1); } } });
  return { r, ran, dismissed };
}

it('relays the brief\'s parts with the question', () => {
  const w = world([yesNo('q1', 'dev', 'Faccio il commit del fix?')], [brief('q1')]);
  const out = w.r.relay('orch', 'dev').write;
  for (const part of ['Faccio il commit del fix?', 'Il totale ordine sbaglia lo sconto.', 'Tocca a te:', '1. Apri il carrello di prova', '• Fix scritto', 'Se Sì: Commit → PR', 'Se No: lascio le modifiche', 'Rispondi sì o no.']) expect(out).toContain(part);
});

it('a command is relayed first; «sì» runs it on the PC, «no» puts it aside', async () => {
  const w = withCommands([cmd('c1', 'dev', 'npm test')], [yesNo('q1', 'dev')]);
  const out = w.r.relay('orch', 'dev');
  expect(out.question).toBe('Eseguo questo comando sul tuo PC?');
  expect(out.write).toContain('npm test');
  expect(await w.r.userSaid('orch', 'sì')).toBe(true);
  expect(w.ran).toEqual(['c1']);
  const n = withCommands([cmd('c2', 'dev', 'npm run lint')]);
  n.r.relay('orch', 'dev');
  expect(await n.r.userSaid('orch', 'no')).toBe(true);
  expect(n.dismissed).toEqual(['c2']);
});

it('production, database and Azure commands are never relayed', () => {
  for (const c of [cmd('c1', 'dev', 'npm run build', 'prod'), cmd('c2', 'dev', 'az webapp restart -n shop'), cmd('c3', 'dev', 'dotnet ef database update'), cmd('c4', 'dev', 'git push origin main')]) {
    expect(() => withCommands([c]).r.relay('orch', 'dev')).toThrow(/stays on the PC/);
  }
});

it('a reserved command does not block the chat\'s question; a «sì» from the phone never runs a command it could not show', async () => {
  const w = withCommands([cmd('c1', 'dev', 'az group delete -n rg')], [yesNo('q1', 'dev')]);
  expect(w.r.relay('orch', 'dev').question).toBe('Applico la migrazione al DB locale?');
  const p = withCommands([cmd('c2', 'dev', 'npm test')]);
  p.r.relay('orch', 'dev');
  expect(await p.r.userSaid('orch', 'sì', 'phone')).toBe(false);
  expect(p.ran).toEqual([]);
});
