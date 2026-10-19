// End-to-end: "N novità in attesa" on the Orchestrator (#88; renderer HeldNews.tsx, main/chats/held-news.ts) on the
// demo. The demo's Orchestrator has a question open, so the delivery rule holds a worker's "finished": the tile shows
// "1 novità in attesa" where the old "Novità" feed was (gone), the list names the chat, the kind and why it waits; a
// quiet permission request of another worker is counted too; once the user answers the Orchestrator the news goes
// (one app message, nothing else) and the counter disappears. SB_REGIA_EVENTS=1 turns the news on in the demo,
// SB_REGIA_EVENTS_MS shortens the grouping window. Screenshots: test-results/shots/regia-held.png (dark), regia-held-light.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { turn(c: string, t: string): void; ask(c: string, r: Record<string, unknown>): void };

test('held news for the Orchestrator: counted on its tile, listed on click, cleared on delivery', async () => {
  const { app, page } = await launchDemo({ regia: true, env: { SB_REGIA_EVENTS: '1', SB_REGIA_EVENTS_MS: '500' } });
  const tile = page.getByTestId('tile-regia');
  const appNews = async () => (await page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'regia' }))).filter(i => i.kind === 'user' && i.text.startsWith('[evento app'));
  await expect(tile).toBeVisible();
  // the "Novità" feed is gone from the Orchestrator; nothing is held yet
  await expect(tile.getByTestId('regia-feed')).toHaveCount(0);
  await expect(tile.getByTestId('regia-held')).toHaveCount(0);

  // a worker finishes while the Orchestrator waits for the user: held, counted
  await app.evaluate(() => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.turn('mappa', 'Fatto: la mappa carica in 2 secondi.'); });
  await expect(tile.getByTestId('regia-held-count')).toHaveText('1 novità in attesa');
  const toggle = tile.getByTestId('regia-held-toggle');
  await expect(toggle).toHaveAttribute('data-tip', 'App · Mappa 3D: Finita');
  await toggle.click();
  const done = tile.getByTestId('regia-held-done');
  await expect(done).toContainText('App · Mappa 3D');
  await expect(done).toContainText('aspetta la tua risposta all’Orchestrator');

  // a quiet permission request of another worker is counted too
  await app.evaluate(() => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.ask('fix', { type: 'permission', tool: 'Bash', title: 'Bash · npm test', detail: 'npm test', input: { command: 'npm test' } }); });
  await expect(tile.getByTestId('regia-held-count')).toHaveText('2 novità in attesa');
  await expect(tile.getByTestId('regia-held-permission')).toContainText('Fix totale ordine');
  expect(await appNews()).toHaveLength(0); // the counter costs no Orchestrator turn
  await page.mouse.move(2, 2);
  await shot(page, 'regia-held');
  await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(250);
  await shot(page, 'regia-held-light');

  // the user answers the Orchestrator: the news goes in one app message and the counter clears
  const pending = await page.evaluate(() => window.sb.invoke('chat:pending', undefined));
  const q = pending.find(p => p.chatId === 'regia')!;
  await page.evaluate(([rid, question]) => window.sb.invoke('chat:answer', { chatId: 'regia', requestId: rid, answer: { kind: 'question', answers: { [question]: 'QA rimborsi' } } }), [q.id, q.questions?.[0]?.question ?? q.title] as const);
  await expect(tile.getByTestId('regia-held')).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => (await appNews()).length, { timeout: 20_000 }).toBe(1);
  const news = (await appNews())[0]!;
  expect(news.kind === 'user' && news.text).toContain('«App · Mappa 3D» (Claude): ha finito il turno');
  expect(news.kind === 'user' && news.text).toContain('«Fix totale ordine» (Claude): aspetta un permesso dell\'utente');
  await app.close();
});
