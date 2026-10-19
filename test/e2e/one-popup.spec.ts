// E2E of the "one question popup at a time" rule (the user, 2026-10-13: two popups at once, one "appeso" on the Orchestrator,
// letters typed only to get rid of it). The Orchestrator widget shows ONE card of its own requests (the oldest; "Poi:" names
// the next) and never a work chat's; the global layer shows none beside it; Ctrl+J moves the popup instead of adding
// one (to the Orchestrator's next question it stays in the Orchestrator; to a work chat's it goes to the layer, the Orchestrator's card
// waits); Esc / "Rispondi dopo" closes it without answering ("Rispondi dopo" on: every popup goes, "Da rispondere" lines
// stay); the queue window is then the one popup; a card goes the moment its request leaves (the chat stopped).
// Screenshot: test-results/shots/one-popup-regia.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, layerState, shot, goPage } from './helpers';

type Demo = { __sbDemo: { ask(id: string, r: object): void; stop(id: string): Promise<void>; answers(): unknown[] } };
const answers = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.answers().length);
const focusOf = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]!;
  const layer = win.contentView.children.map(v => (v as { webContents?: Electron.WebContents }).webContents).find(w => w?.getURL().includes('#overlay'));
  return { app: win.webContents.isFocused(), layer: !!layer?.isFocused() };
});
const askRegia = (app: ElectronApplication, q: string, a: string, b: string) => app.evaluate((_e, [q, a, b]) => (globalThis as unknown as Demo).__sbDemo.ask('regia', {
  type: 'question', tool: 'AskUserQuestion', title: q, detail: '', input: {},
  questions: [{ question: q, header: 'Regia', multiSelect: false, options: [{ label: a }, { label: b }] }],
}), [q, a, b] as const);

test('one popup at a time: the Regia shows one card of her own, Esc puts it in the queue, a request that leaves takes its card away', async () => {
  const { app, page } = await launchDemo();
  await goPage(page, 'costi'); // a page: the work chats' requests are on no tile, they would float
  await page.keyboard.press('Control+R'); // the Regia overlay
  const regia = page.getByTestId('tile-regia');
  const cards = page.locator('[data-request-key]');
  // a second question of the Orchestrator's own: still one card, the next named on "Poi:"
  await askRegia(app, 'Quale tema?', 'Scuro', 'Chiaro');
  await expect(regia.getByTestId('request-regia-regia-q1')).toBeVisible();
  await expect(cards).toHaveCount(1);
  await expect(regia.getByTestId('regia-next')).toContainText('Quale tema?');
  // a work chat's request never in the Orchestrator; nothing floats in the layer beside her card
  await expect(regia.locator('[data-request-key^="qa/"], [data-request-key^="feedback/"]')).toHaveCount(0);
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  await page.mouse.move(2, 2);
  await shot(page, 'one-popup-regia');

  // Ctrl+J: the oldest is the Orchestrator's card; asking for her next question (Ctrl+K "Rispondi: …") it takes the card, in
  // the Orchestrator, with the keyboard
  await page.keyboard.press('Control+J');
  await expect(regia.getByTestId('request-regia-regia-q1')).toBeFocused();
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('Quale tema');
  await page.keyboard.press('Enter');
  await expect(regia.locator('[data-request-key^="regia/"]').filter({ hasText: 'Quale tema?' })).toBeFocused();
  await expect(cards).toHaveCount(1);
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);

  // Esc on the Orchestrator's popup: "Rispondi dopo", it goes away unanswered and nothing else pops up (all in the queue)
  await page.keyboard.press('Escape');
  await expect(cards).toHaveCount(0);
  await expect(regia.getByTestId('regia-queued')).toContainText('2 richieste');
  await expect(regia.getByTestId('regia-input')).toBeFocused(); // the keyboard goes back to her input
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  await expect(page.getByTestId('topbar-next')).toContainText('Da rispondere');
  expect(await answers(app)).toBe(0);

  // the queue (Ctrl+J): the questions window is the one popup, the Orchestrator shows no card beside it
  await page.keyboard.press('Control+J');
  await expect(page.getByTestId('qwin')).toBeVisible();
  await expect(page.getByTestId('qwin-chat')).toHaveText('Orchestrator');
  await expect(regia.locator('[data-request-key]')).toHaveCount(0);
  await expect(regia.getByTestId('regia-next')).toContainText('Quale tema?');
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  // "Rispondi dopo" in the window: closed, back in the queue
  await page.getByTestId('qwin-later').click();
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect(regia.getByTestId('regia-queued')).toBeVisible();

  // the request leaves elsewhere (the Orchestrator stops): her line goes at once, nothing stays on screen
  await app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.stop('regia'));
  await expect(regia.getByTestId('regia-queued')).toHaveCount(0);
  await expect(cards).toHaveCount(0);
  expect(await answers(app)).toBe(0);
  await app.close();
});

test('Ctrl+J to a work chat\'s request moves the popup to the layer; the Regia asking meanwhile waits on "Poi:"', async () => {
  const { app, page } = await launchDemo();
  await goPage(page, 'costi');
  await page.keyboard.press('Control+R');
  const regia = page.getByTestId('tile-regia');
  const cards = page.locator('[data-request-key]');
  await expect(regia.getByTestId('request-regia-regia-q1')).toBeVisible();
  await expect.poll(async () => (await layerState(app)).cards).toBe(0); // her card is the one popup
  await page.keyboard.press('Control+J'); // the Regia's oldest
  await expect(regia.getByTestId('request-regia-regia-q1')).toBeFocused();
  await page.keyboard.press('Control+J'); // QA: it floats, the Regia's card steps aside
  await expect.poll(async () => (await focusOf(app)).layer).toBe(true);
  await expect(cards).toHaveCount(0);
  // the Orchestrator asks again while the user answers in the layer: the layer card stays, hers wait on "Poi:"
  await askRegia(app, 'Apro la PR?', 'Sì', 'No');
  await expect(regia.getByTestId('regia-next')).toContainText('Apro la PR?');
  await expect(cards).toHaveCount(0);
  await expect.poll(async () => (await layerState(app)).cards).toBeGreaterThan(0);
  expect((await focusOf(app)).layer).toBe(true);
  expect(await answers(app)).toBe(0);
  await app.close();
});
