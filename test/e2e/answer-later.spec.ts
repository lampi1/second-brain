// E2E of "Rispondi dopo" and the "Da rispondere" queue (ADR 0035; the user, 2026-10-13): "Rispondi dopo" on a tile's
// card puts every open request in the queue (the tiles say "Da rispondere", no popup anywhere, the chats stay blocked); a new
// request then opens nothing: the top bar's "Da rispondere" counter grows (no strip over the pages any more: the user,
// 2026-10-14, "c'è già in alto il «da rispondere»") and it rings (counted on <html data-chimes>: a hidden run is
// muted); the queue survives a restart; Ctrl+J opens it as the questions window, any of them can go first, and quiet
// mode ends. Screenshots: test-results/shots/answer-later-*.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expandChats, launchDemo, layerState, shot, windowShot } from './helpers';

type Demo = { __sbDemo: { ask(id: string, r: object): void; answers(): unknown[] } };
const ask = (app: ElectronApplication, chatId: string, q: string) => app.evaluate((_e, [c, q]) => (globalThis as unknown as Demo).__sbDemo.ask(c, {
  type: 'question', tool: 'AskUserQuestion', title: q, detail: '', input: {},
  questions: [{ question: q, header: 'Ok', multiSelect: false, options: [{ label: 'Sì' }, { label: 'No' }] }],
}), [chatId, q] as const);
const chimes = (page: Page) => page.evaluate(() => Number(document.documentElement.dataset.chimes ?? 0));

test('Rispondi dopo: the queue fills silently, rings, survives a restart, Ctrl+J answers it one at a time', async () => {
  test.setTimeout(120_000); // two launches: 47 s alone, over the default 60 s under the parallel e2e
  const first = await launchDemo();
  let { app, page } = first;
  const { userData } = first;
  await expandChats(page, 'qa', 'feedback'); // a request's card is on its expanded strip
  await page.getByTestId('request-qa-qa-q1-later').click(); // "Rispondi dopo" on QA's card, in its tile
  await expect(page.getByTestId('chat-queued-qa')).toContainText('Da rispondere: una richiesta');
  await expect(page.getByTestId('chat-queued-feedback')).toBeVisible(); // every open request, not only that one
  await expect(page.getByTestId('request-qa-qa-q1')).toHaveCount(0);
  await expect(page.getByTestId('topbar-next')).toContainText('Da rispondere');
  await expect(page.getByTestId('topbar-next-count')).toHaveText('3');
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);

  // on a page (Task): nothing floats; a new question opens nothing, the counter grows and it rings
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('task');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('brain-page-task')).toBeVisible();
  const rang = await chimes(page);
  await ask(app, 'fix', 'Procedo con il commit?');
  await expect(page.getByTestId('topbar-next-count')).toHaveText('4');
  await expect.poll(() => chimes(page)).toBe(rang + 1);
  expect((await layerState(app)).cards).toBe(0);
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect(page.getByTestId('qwin-pill')).toHaveCount(0);
  await page.mouse.move(2, 2);
  await windowShot(app, 'answer-later-page');
  expect(await app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.answers().length)).toBe(0);

  // a restart: still on, still quiet (the demo's chats ask their open requests again; the new one is gone with its run)
  await app.close();
  ({ app, page } = await launchDemo({ userData }));
  await expect(page.getByTestId('topbar-next')).toContainText('Da rispondere');
  await expect(page.getByTestId('chat-queued-qa')).toBeVisible();
  await expect(page.getByTestId('topbar-next-count')).toHaveText('3');
  expect((await layerState(app)).cards).toBe(0);

  // Ctrl+J: the queue, the oldest first, with the keyboard; quiet mode over
  await page.keyboard.press('Control+J');
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await expect(page.getByTestId('qwin-chat')).toHaveText('Orchestrator');
  await expect(page.getByTestId('qwin-count')).toHaveText('3');
  await expect(page.getByTestId('qwin-off')).toHaveCount(0); // "Domande in finestra" is off: this is only the queue
  await expect(page.getByTestId('topbar-next')).not.toContainText('Da rispondere');
  // any of them first: Feedback now, the Orchestrator's stays
  await page.getByTestId('qwin-pick').filter({ hasText: 'App · Feedback' }).click();
  await expect(page.getByTestId('qwin-chat')).toHaveText('App · Feedback');
  await expect(page.getByTestId('qwin-pick').filter({ hasText: 'Orchestrator' })).toBeVisible();
  await page.mouse.move(2, 2);
  await shot(page, 'answer-later-open');
  // Esc: back in the queue
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect(page.getByTestId('topbar-next')).toContainText('Da rispondere');
  await app.close();
});
