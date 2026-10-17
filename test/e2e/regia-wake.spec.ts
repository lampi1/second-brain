// End-to-end: "Eventi alla Regia" (main/chats/regia-wake.ts) on the demo. A work chat ends its turn: once the Regia is
// free (here after the user answered its open question) the app writes it one message labelled as the app's, with the
// chat's title and what it left (here a command for the user, through the real wiring), and the Regia answers it (a
// turn of its own). While the Regia waits for the user nothing is sent. The demo turns the news on only with SB_REGIA_EVENTS=1; SB_REGIA_EVENTS_MS shortens the grouping window.
// Screenshot: test-results/shots/regia-wake.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { turn(c: string, t: string): void; wake(): { queued: string[]; held: number } };

test('a work chat that finishes wakes the Regia with an app message, never while the Regia waits for the user', async () => {
  const { app, page } = await launchDemo({ regia: true, env: { SB_REGIA_EVENTS: '1', SB_REGIA_EVENTS_MS: '500' } });
  const regiaItems = () => page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'regia' }));
  const appNews = async () => (await regiaItems()).filter(i => i.kind === 'user' && i.text.startsWith('[evento app'));

  const text = ['Fatto: la mappa carica in 2 secondi. Ora lancia:', '', '```powershell', "Write-Output 'ok'", '```'].join('\n');
  await app.evaluate((_e, t) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.turn('mappa', t); }, text);
  // the Regia waits for the user (its open question): the news waits too (held by its gate),
  // once the command (asks.ts settles it after the turn end) has replaced the bare 'done'
  const wake = () => app.evaluate(() => (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.wake());
  await expect.poll(async () => { const w = await wake(); return w.held > 0 && w.queued.includes('mappa:command'); }).toBe(true);
  expect(await appNews()).toHaveLength(0);

  const pending = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  const q = pending.find(p => p.chatId === 'regia')!;
  await page.evaluate(([rid, question]) => window.sb.invoke('chat:answer', { chatId: 'regia', requestId: rid, answer: { kind: 'question', answers: { [question]: 'QA rimborsi' } } }), [q.id, q.questions?.[0]?.question ?? q.title] as const);

  await expect.poll(async () => (await appNews()).length, { timeout: 20_000 }).toBe(1);
  const news = (await appNews())[0]!;
  expect(news.kind === 'user' && news.text).toContain('non scritto dall\'utente');
  expect(news.kind === 'user' && news.text).toContain("«App · Mappa 3D» (Claude): ha lasciato all'utente un comando da eseguire: Write-Output 'ok'");
  // shown folded as the app's (lib/foreign.ts, collapsed agent messages): one muted line, never the raw label
  const line = page.getByTestId('tile-regia').getByTestId(`item-${news.id}`);
  await expect(line).toHaveAttribute('data-foreign', 'event');
  await expect(line.locator('.foreign-who')).toHaveText('Evento app');
  await expect(line).toContainText("«App · Mappa 3D» (Claude): ha lasciato all'utente un comando da eseguire");
  await expect(page.getByTestId('tile-regia')).not.toContainText('[evento app');
  await page.mouse.move(2, 2);
  await shot(page, 'regia-wake');
  await app.close();
});
