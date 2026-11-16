// Single entry (ADR 0239): a work chat's Sì/No question reaches the user through the Orchestrator's conversation; the
// user's own «sì» / «no» there answers it, never anything else. Fake deps, fake clock.
import { expect, it } from 'vitest';
import type { Answer, ChatItem, ChatSummary, PendingRequest } from '../../../src/shared/contract';
import { pickOf, QuestionRelay, RELAY_MS } from '../../../src/main/chats/relay';

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

it('relays a Sì/No question, production ones too (ADR 0275); the rest the Orchestrator answers itself', () => {
  const perm = { ...yesNo('p1', 'dev'), type: 'permission', tool: 'Bash', questions: undefined } as PendingRequest;
  expect(() => world([perm]).r.relay('orch', 'dev')).toThrow(/app_resolve_question/);
  expect(world([yesNo('q1', 'dev', 'Faccio il deploy in produzione?')]).r.relay('orch', 'dev').question).toBe('Faccio il deploy in produzione?');
  expect(() => world([yesNo('q1', 'dev', 'Procedo?', 'mcp__x__form')]).r.relay('orch', 'dev')).toThrow(/app_resolve_question/);
  const three = yesNo('q1', 'dev');
  three.questions![0]!.options.push({ label: 'Forse', description: '' });
  expect(() => world([three]).r.relay('orch', 'dev')).toThrow(/Sì\/No/);
  expect(() => world([yesNo('q1', 'dev')]).r.relay('dev', 'dev')).toThrow(/Orchestrator/);  // only the Orchestrator relays
  expect(() => world([]).r.relay('orch', 'dev')).toThrow(/waits for no answer/);
});

it('a «sì» that cannot land is told to the Orchestrator: expired or failed delivery; a brief naming production still lands', async () => {
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
  expect(await b.r.userSaid('orch', 'sì')).toBe(true);
  expect(b.told).toEqual([]);
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
  const ran: string[] = [], dismissed: string[] = [], told: string[] = [];
  const chats = [chat({ id: 'orch', isOrchestrator: true, title: 'Orchestrator' }), chat({ id: 'dev', title: 'Dev' })];
  const said: ChatItem[] = [];
  const r = new QuestionRelay({ chats: () => chats, pending: () => pending, items: id => (id === 'orch' ? said : []), answer: async () => {}, notify: (_o, text) => { told.push(text); },
    commands: { pending: () => cmds, run: (_c, id, confirmed) => { ran.push(confirmed ? `${id}:confirmed` : id); cmds.splice(cmds.findIndex(x => x.id === id), 1); }, dismiss: (_c, id) => { dismissed.push(id); cmds.splice(cmds.findIndex(x => x.id === id), 1); } } });
  /** the Orchestrator writes the relayed text to the user */
  const wrote = (text: string) => { said.push({ kind: 'assistant', id: `a${said.length}`, at: Date.now(), text } as ChatItem); };
  /** relay, then write it word for word */
  const show = (chatId = 'dev') => { const out = r.relay('orch', chatId); wrote(out.write); return out; };
  /** the user's own message in the Orchestrator's chat: from the PC, Telegram ('phone') or Remote Control ('remote') */
  const userWrote = (text: string, via?: 'phone' | 'remote') => { said.push({ kind: 'user', id: `u${said.length}`, at: Date.now(), text, ...(via ? { via: 'phone' as const, ...(via === 'remote' ? { remote: true as const } : {}) } : {}) } as ChatItem); };
  return { r, ran, dismissed, told, wrote, show, userWrote };
}

it('relays the brief\'s parts with the question', () => {
  const w = world([yesNo('q1', 'dev', 'Faccio il commit del fix?')], [brief('q1')]);
  const out = w.r.relay('orch', 'dev').write;
  for (const part of ['Faccio il commit del fix?', 'Il totale ordine sbaglia lo sconto.', 'Tocca a te:', '1. Apri il carrello di prova', '• Fix scritto', 'Se Sì: Commit → PR', 'Se No: lascio le modifiche', 'Rispondi sì o no.']) expect(out).toContain(part);
});

it('a command is relayed first; «sì» runs it on the PC, «no» puts it aside', async () => {
  const w = withCommands([cmd('c1', 'dev', 'npm test')], [yesNo('q1', 'dev')]);
  const out = w.show();
  expect(out.question).toBe('Eseguo questo comando sul tuo PC?');
  expect(out.write).toContain('npm test');
  expect(await w.r.userSaid('orch', 'sì')).toBe(true);
  expect(w.ran).toEqual(['c1:confirmed']);
  const n = withCommands([cmd('c2', 'dev', 'npm run lint')]);
  n.show();
  expect(await n.r.userSaid('orch', 'no')).toBe(true);
  expect(n.dismissed).toEqual(['c2']);
});

it('production, database and Azure commands are relayed whole; his «sì» runs them, confirmed (ADR 0275)', async () => {
  for (const c of [cmd('c1', 'dev', 'npm run build', 'prod'), cmd('c2', 'dev', 'az webapp restart -n shop'), cmd('c3', 'dev', 'dotnet ef database update'), cmd('c4', 'dev', 'git push origin main')]) {
    const w = withCommands([c]);
    expect(w.show().write).toContain(c.command!.code);
    expect(await w.r.userSaid('orch', 'sì')).toBe(true);
    expect(w.ran).toEqual([`${c.id}:confirmed`]);
  }
});

it('a «sì» never runs a relayed command the Orchestrator did not write whole to the user (ADR 0275)', async () => {
  const w = withCommands([cmd('c1', 'dev', 'az webapp restart -n shop')]);
  w.r.relay('orch', 'dev');
  w.wrote('Riavvio il sito, va bene?');
  expect(await w.r.userSaid('orch', 'sì')).toBe(false);
  expect(w.ran).toEqual([]);
});

it('a «sì» from Telegram never runs a command it could not show, and the Orchestrator is told what to say (#390)', async () => {
  const p = withCommands([cmd('c2', 'dev', 'npm test')]);
  p.show();                                                  // relayed while he wrote from the PC
  expect(await p.r.userSaid('orch', 'sì', 'phone')).toBe(false);
  expect(p.ran).toEqual([]);
  expect(p.told.join('\n')).toMatch(/Telegram.*Esegui.*Controllo remoto/);
});

it('while he writes from Telegram a command it cannot show is refused up front, never asked and then dropped (#390)', async () => {
  const p = withCommands([cmd('c2', 'dev', 'npm test')]);
  p.userWrote('come va?', 'phone');
  expect(() => p.r.relay('orch', 'dev')).toThrow(/Telegram.*Do not ask him yes or no.*Esegui on the PC.*Remote Control/s);
  expect(p.r.current('orch')).toBeUndefined();               // nothing armed: a later «sì» answers nothing
  expect(await p.r.userSaid('orch', 'sì', 'phone')).toBe(false);
  expect(p.ran).toEqual([]);
  expect(p.told).toEqual([]);
  // a command Telegram shows whole is still relayed there, and his «sì» runs it
  const q = withCommands([cmd('c3', 'dev', 'riavvia il servizio')]);
  q.userWrote('come va?', 'phone');
  q.show();
  expect(await q.r.userSaid('orch', 'sì', 'phone')).toBe(true);
  expect(q.ran).toEqual(['c3:confirmed']);
});

it('on Telegram a command it cannot show waits for the PC, and the chat\'s own Sì/No question is relayed instead (#390)', async () => {
  const p = withCommands([cmd('c2', 'dev', 'npm test')], [yesNo('q1', 'dev', 'Faccio il commit del fix?')]);
  p.userWrote('come va?', 'phone');
  expect(p.r.relay('orch', 'dev').question).toBe('Faccio il commit del fix?');
  expect(p.ran).toEqual([]);
});

it('Remote Control shows the reply whole: his «sì» there runs the relayed command, as on the PC (#390)', async () => {
  const p = withCommands([cmd('c2', 'dev', 'npm test')]);
  p.userWrote('come va?', 'remote');
  p.show();
  expect(await p.r.userSaid('orch', 'sì', 'remote')).toBe(true);
  expect(p.ran).toEqual(['c2:confirmed']);
  // still only what he read: a reply without the whole command runs nothing
  const q = withCommands([cmd('c4', 'dev', 'npm test')]);
  q.r.relay('orch', 'dev');
  q.wrote('Lancio i test, va bene?');
  expect(await q.r.userSaid('orch', 'sì', 'remote')).toBe(false);
  expect(q.ran).toEqual([]);
});

// #425: on Remote Control a plain message is only text; the Orchestrator's own AskUserQuestion shows buttons, and his
// pick there is delivered by the app
const remoteUser = (text = 'come va?'): ChatItem => ({ kind: 'user', id: 'ur', at: 1, text, via: 'phone', remote: true } as ChatItem);
let panelN = 0;
const panel = (question: string, output: string, status: 'ok' | 'error' = 'ok'): ChatItem => ({ kind: 'tool', id: `t${++panelN}`, at: Date.now() + 1000, name: 'AskUserQuestion', summary: '', status, output,
  input: { questions: [{ question, header: 'Sì o no', multiSelect: false, options: [{ label: 'Sì' }, { label: 'No' }] }] } } as ChatItem);
const answeredWith = (q: string, label: string) => `User has answered your questions: "${q}"="${label}". You can now continue with the user's answers in mind.`;

it('pickOf reads the label of the asked question, else the only quoted Sì or No', () => {
  expect(pickOf(answeredWith('Va bene?', 'Sì'), 'Va bene?')).toBe('yes');
  expect(pickOf(answeredWith('Riga uno\nriga due', 'No'), 'Riga uno riga due')).toBe('no');
  expect(pickOf('answered: "Sì (consigliato)"', 'altro')).toBe('yes');
  expect(pickOf('"Sì" or "No"', 'altro')).toBeNull();
  expect(pickOf('the user closed it', 'Va bene?')).toBeNull();
  // quotes inside the question never count as his pick
  expect(pickOf('answered "Va bene il "sì" di Dev?" with other text', 'Va bene il "sì" di Dev?')).toBeNull();
});

it('from Remote Control a relayed question goes into the Orchestrator\'s panel, and his pick there answers the chat (#425)', async () => {
  const w = world([yesNo('q1', 'dev')], [remoteUser()]);
  const out = w.r.relay('orch', 'dev');
  expect(out.write).toMatch(/AskUserQuestion.*exactly «Dev · migrazione chiede: Applico la migrazione al DB locale\?».*«Sì» and «No».*never answer it yourself/s);
  // another tool of the Orchestrator, or a panel with another question, answers nothing
  expect(await w.r.toolAnswered('orch', panel('Altra domanda?', answeredWith('Altra domanda?', 'Sì')))).toBe(false);
  expect(await w.r.toolAnswered('orch', { ...panel('x', 'y'), name: 'Bash' } as ChatItem)).toBe(false);
  const ask = 'Dev · migrazione chiede: Applico la migrazione al DB locale?';
  // a connector's tool of the same name, or a panel older than the relay, answers nothing
  expect(await w.r.toolAnswered('orch', { ...panel(ask, answeredWith(ask, 'Sì')), name: 'mcp__srv__AskUserQuestion' } as ChatItem)).toBe(false);
  expect(await w.r.toolAnswered('orch', { ...panel(ask, answeredWith(ask, 'Sì')), at: 500 } as ChatItem)).toBe(false);
  expect(w.r.panelArmed('orch')).toBe(true);
  expect(await w.r.toolAnswered('orch', { ...panel(ask, answeredWith(ask, 'Sì')), at: 2000 } as ChatItem)).toBe(true);
  expect(w.r.panelArmed('orch')).toBe(false);
  expect(w.answered).toEqual([{ chatId: 'dev', requestId: 'q1', answer: { kind: 'question', answers: { 'Applico la migrazione al DB locale?': 'Sì (consigliato)' } }, by: 'phone' }]);
  expect(await w.r.toolAnswered('orch', panel(ask, answeredWith(ask, 'No')))).toBe(false);   // used once
});

it('a panel closed without a Sì or No leaves the question open and tells the Orchestrator to relay it again (#425)', async () => {
  const w = world([yesNo('q1', 'dev')], [remoteUser()]);
  w.r.relay('orch', 'dev');
  const ask = 'Dev · migrazione chiede: Applico la migrazione al DB locale?';
  expect(await w.r.toolAnswered('orch', panel(ask, 'interrupted', 'error'))).toBe(false);
  expect(w.answered).toEqual([]);
  expect(w.told).toEqual([expect.stringMatching(/non è stata letta.*relay_question/)]);
});

it('from Remote Control a command is written whole first, then asked in the panel; his Sì there runs it (#425)', async () => {
  const p = withCommands([cmd('c2', 'dev', 'Get-Date')]);
  p.userWrote('come va?', 'remote');
  const out = p.r.relay('orch', 'dev');
  expect(out.write).toMatch(/First write to the user, exactly.*Get-Date.*AskUserQuestion.*exactly «Eseguo questo comando sul tuo PC\?»/s);
  // the panel answered before the whole command was written: nothing runs
  expect(await p.r.toolAnswered('orch', panel(out.question, answeredWith(out.question, 'Sì')))).toBe(false);
  expect(p.ran).toEqual([]);
  const q = withCommands([cmd('c3', 'dev', 'Get-Date')]);
  q.userWrote('come va?', 'remote');
  const o2 = q.r.relay('orch', 'dev');
  q.wrote('Dev chiede: Lancia i test:\nGet-Date');
  expect(await q.r.toolAnswered('orch', panel(o2.question, answeredWith(o2.question, 'Sì')))).toBe(true);
  expect(q.ran).toEqual(['c3:confirmed']);
});

it('the Orchestrator\'s own command block is relayed too (Esegui is a PC button), never its own questions (#425)', async () => {
  const p = withCommands([cmd('c9', 'orch', 'Get-Date')]);
  expect(p.show('orch').question).toBe('Eseguo questo comando sul tuo PC?');
  expect(await p.r.userSaid('orch', 'sì', 'remote')).toBe(true);
  expect(p.ran).toEqual(['c9:confirmed']);
  expect(() => withCommands([]).r.relay('orch', 'orch')).toThrow(/only a command block of yours/);
});
