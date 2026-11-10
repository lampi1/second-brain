// ADR 0259 §4: away from the PC a question shows the same parts as the PC's «Bivio» card (chats/ask-text.ts), and a
// command a chat left is decided from Telegram: Sì runs it on the PC, No puts it aside; production, databases, Azure
// and reserved words stay for the PC. Pins chats/ask-text.ts and the command path of chats/phone-port.ts, on fakes.
import { expect, it } from 'vitest';
import type { ChatItem, ChatSummary, EventChannel, EventMap, PendingRequest } from '../../../src/shared/contract';
import { createPhonePort, type PhoneChats } from '../../../src/main/chats/phone-port';
import { commandReserved, questionLines } from '../../../src/main/chats/ask-text';

type Tap = <K extends EventChannel>(channel: K, payload: EventMap[K]) => void;
const chat = { id: 'dev', title: 'Fix totale', state: 'waiting', pending: 1, isOrchestrator: false, agent: { name: 'Artisan' } } as unknown as ChatSummary;
const cmd = (id: string, code: string, prod?: string): PendingRequest => ({
  id, chatId: 'dev', type: 'command', tool: 'Esegui', title: 'Comando da eseguire', detail: code, input: {}, at: 1,
  command: { itemId: 'a1', code, lang: 'powershell', lead: 'Lancia i test del modulo Ordini:', ...(prod ? { prod } : {}) } } as PendingRequest);
const question: PendingRequest = { id: 'q1', chatId: 'dev', type: 'question', tool: 'AskUserQuestion', title: 'Faccio il commit del fix?', detail: '', input: {}, at: 2,
  questions: [{ question: 'Faccio il commit del fix?', header: 'Fix', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] } as PendingRequest;
const brief: ChatItem = { kind: 'artifact', id: 'b1', at: 1, askId: 'q1', title: 'Brief', summary: '', ui: { component: 'brief', props: {
  why: 'Il totale ordine sbagliava lo sconto.', done: ['Fix scritto', 'Test verdi'], todo: ['Apri il carrello di prova'], ifYes: 'faccio il commit', ifNo: 'lascio le modifiche',
  noSteps: ['Lascio le modifiche', 'Aspetto te'], change: { what: 'Totale', before: '90 €', after: '81 €' } } } } as unknown as ChatItem;

function world(cmds: PendingRequest[], pending: PendingRequest[] = []) {
  const ran: string[] = [], dismissed: string[] = [], taps: Tap[] = [];
  const chats = { list: () => [chat], pending: () => pending, items: () => [brief], sendFromPhone: async () => {}, answer: async () => {}, planDecide: async () => {}, onTurnEnded: () => () => {} } as unknown as PhoneChats;
  const port = createPhonePort(chats, { tap: fn => { taps.push(fn as Tap); } }, {
    pending: () => cmds,
    run: (_c, id) => { ran.push(id); cmds.splice(cmds.findIndex(x => x.id === id), 1); },
    dismiss: (_c, id) => { dismissed.push(id); cmds.splice(cmds.findIndex(x => x.id === id), 1); },
  });
  return { port, ran, dismissed };
}

it('a question carries the brief: context, before → after, what is up to the user, what was done, the two roads', () => {
  const lines = questionLines('Faccio il commit del fix?', (brief as unknown as { ui: { props: never } }).ui.props);
  expect(lines).toEqual(['Faccio il commit del fix?', 'Il totale ordine sbagliava lo sconto.', 'Totale: 90 € → 81 €', 'Tocca a te:', '1. Apri il carrello di prova',
    'Fatto:', '• Fix scritto', '• Test verdi', 'Se Sì: faccio il commit', 'Se No: Lascio le modifiche → Aspetto te']);
  const d = world([], [question]).port.listDecidable().find(x => x.ref.kind === 'question')!;
  expect(d.text).toBe(lines.join('\n'));
  expect(d.short).toBe('Faccio il commit del fix?');
});

it('a command is a simple Sì/No on the phone when it shows whole; Sì runs it on the PC, No puts it aside', async () => {
  const w = world([cmd('c1', 'pytest -q'), cmd('c2', 'make test')]);
  const list = w.port.listDecidable();
  expect(list.map(d => [d.simple, d.reserved])).toEqual([[true, false], [true, false]]);
  expect(list[0]!.text).toContain('Eseguo questo comando sul tuo PC?\nLancia i test del modulo Ordini:\npytest -q');
  expect(await w.port.answerFromPhone('dev', 'c1', true)).toBe('ok');
  expect(await w.port.answerFromPhone('dev', 'c2', false)).toBe('ok');
  expect([w.ran, w.dismissed]).toEqual([['c1'], ['c2']]);
  expect(await w.port.answerFromPhone('dev', 'c1', true)).toBe('gone');
});

it('a command Telegram\'s filter would hide («[comando: eseguilo dal PC]») gets no buttons and never runs from there', async () => {
  const w = world([cmd('c1', 'npm test')]);
  expect(w.port.listDecidable()[0]!.simple).toBe(false);
  expect(await w.port.answerFromPhone('dev', 'c1', true)).toBe('gone');
  expect(w.ran).toEqual([]);
});

it('production, database, Azure and reserved commands stay for the PC', async () => {
  const reserved = [cmd('p', 'npm run build', 'prod'), cmd('a', 'az webapp restart -n shop'), cmd('d', 'dotnet ef database update'), cmd('m', 'npm run db:migrate'),
    cmd('g', 'git push origin main'), cmd('s', 'sqlcmd -S . -Q "select 1"')];
  for (const c of reserved) expect(commandReserved(c)).toBe(true);
  expect(commandReserved(cmd('ok', 'npm test -- --grep ordini'))).toBe(false);
  // a path before the tool, other databases and clouds, recursive deletes in any spelling (review of ADR 0259 §4)
  const bad = ["& 'C:\\Program Files\\x\\az.cmd' group delete -n rg --yes", '/usr/bin/az group delete', 'sqlite3 app.db "UPDATE users SET admin=1"', 'mongo shop --eval "db.orders.drop()"',
    'rm -fr build', 'rm -r -Force x', 'Remove-Item x -R -Force', 'rd /s /q x', 'Remove-Item x `\n -Recurse', 'aws s3 rm s3://b --recursive', 'gcloud sql instances delete x',
    'New-AzResourceGroup -Name x', 'Invoke-Sqlcmd -Query "x"', 'npx prisma migrate deploy', 'AZ login'];
  expect(bad.filter(b => !commandReserved(cmd('x', b)))).toEqual([]);
  const fine = ['npm test', 'npm run lint', 'git status', 'dotnet test test/Shop.Tests', "echo 'test verdi'", 'node scripts/check.js'];
  expect(fine.filter(b => commandReserved(cmd('x', b)))).toEqual([]);
  const w = world([cmd('a', 'az webapp restart -n shop')]);
  expect(w.port.listDecidable()[0]!.reserved).toBe(true);
  expect(await w.port.answerFromPhone('dev', 'a', true)).toBe('gone');
  expect(w.ran).toEqual([]);
});

it('without the commands hook a command stays on the PC (not simple)', () => {
  const chats = { list: () => [chat], pending: () => [], items: () => [], onTurnEnded: () => () => {} } as unknown as PhoneChats;
  const port = createPhonePort(chats, { tap: () => {} });
  expect(port.listDecidable()).toEqual([]);
});
