// E2E of "Rispondi dopo" and the "Da rispondere" queue (ADR 0035; the user, 2026-10-13): "Rispondi dopo" on a tile's
// card puts every open request in the queue (the tiles say "Da rispondere", no popup anywhere, the chats stay blocked); a new
// request then opens nothing: the top bar's counter and the always-on strip over every page grow, and it rings
// (counted on <html data-chimes>: a hidden run is muted); the queue survives a restart; Ctrl+J opens it as the
// questions window, one at a time, and quiet mode ends. Screenshots: test-results/shots/answer-later-*.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, layerPage, layerState, shot, windowShot } from './helpers';

type Demo = { __sbDemo: { ask(id: string, r: object): void; answers(): unknown[] } };
const ask = (app: ElectronApplication, chatId: string, q: string) => app.evaluate((_e, [c, q]) => (globalThis as unknown as Demo).__sbDemo.ask(c, {
  type: 'question', tool: 'AskUserQuestion', title: q, detail: '', input: {},
  questions: [{ question: q, header: 'Ok', multiSelect: false, options: [{ label: 'Sì' }, { label: 'No' }] }],
}), [chatId, q] as const);
const chimes = (page: Page) => page.evaluate(() => Number(document.documentElement.dataset.chimes ?? 0));

test('Rispondi dopo: the queue fills silently, rings, survives a restart, Ctrl+J answers it one at a time', async () => {
  const first = await launchDemo();
  let { app, page } = first;
  const { userData } = first;
  await page.getByTestId('request-qa-qa-q1-later').click(); // "Rispondi dopo" on QA's card, in its tile
  await expect(page.getByTestId('chat-queued-qa')).toContainText('Da rispondere: una richiesta');
  await expect(page.getByTestId('chat-queued-feedback')).toBeVisible(); // every open request, not only that one
  await expect(page.getByTestId('request-qa-qa-q1')).toHaveCount(0);
  await expect(page.getByTestId('topbar-next')).toContainText('Da rispondere');
  await expect(page.getByTestId('topbar-next-count')).toHaveText('3');
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  await expect.poll(async () => (await layerState(app)).strip).toBe(3);

  // on a page (DevOps), over everything: the strip; a new question opens nothing, the counts grow and it rings
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('devops');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('brain-page-devops')).toBeVisible();
  const rang = await chimes(page);
  await ask(app, 'fix', 'Procedo con il commit?');
  await expect(page.getByTestId('topbar-next-count')).toHaveText('4');
  await expect.poll(() => chimes(page)).toBe(rang + 1);
  await expect.poll(async () => (await layerState(app)).strip).toBe(4);
  expect((await layerState(app)).cards).toBe(0);
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  const layer = await layerPage(app);
  await expect(layer.getByTestId('layer-strip')).toContainText('4 richieste da rispondere');
  await page.mouse.move(2, 2);
  await windowShot(app, 'answer-later-strip');
  expect(await app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.answers().length)).toBe(0);

  // a restart: still on, still quiet (the demo's chats ask their open requests again; the new one is gone with its run)
  await app.close();
  ({ app, page } = await launchDemo({ userData }));
  await expect(page.getByTestId('topbar-next')).toContainText('Da rispondere');
  await expect(page.getByTestId('chat-queued-qa')).toBeVisible();
  await expect.poll(async () => (await layerState(app)).strip).toBe(3);
  expect((await layerState(app)).cards).toBe(0);

  // Ctrl+J: the queue, the oldest first, with the keyboard; quiet mode over, no strip over the window
  await page.keyboard.press('Control+J');
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await expect(page.getByTestId('qwin-chat')).toHaveText('Regia');
  await expect(page.getByTestId('qwin-count')).toHaveText('poi altre 2');
  await expect(page.getByTestId('qwin-off')).toHaveCount(0); // "Domande in finestra" is off: this is only the queue
  await expect(page.getByTestId('topbar-next')).not.toContainText('Da rispondere');
  await expect.poll(async () => (await layerState(app)).strip).toBe(0);
  await page.mouse.move(2, 2);
  await shot(page, 'answer-later-open');
  // Esc: back in the queue
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect(page.getByTestId('topbar-next')).toContainText('Da rispondere');
  await app.close();
});
