// E2E of the "one question popup at a time" rule (the user, 2026-10-13: two popups at once, one "appeso" on the Orchestrator,
// letters typed only to get rid of it). The Orchestrator widget shows ONE card of its own requests (the oldest; "Poi:" names
// the next) and never a work chat's; the global layer shows none beside it; Ctrl+J moves the popup instead of adding
// one (to the Orchestrator's next question it stays in the Orchestrator; to a work chat's it goes to the layer, the Orchestrator's card
// waits); Esc / "Rispondi dopo" closes it without answering ("Rispondi dopo" on: every popup goes, "Da rispondere" lines
// stay); the queue window is then the one popup; a card goes the moment its request leaves (the chat stopped).
// Screenshot: test-results/shots/one-popup-orchestrator.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, layerState, goPage } from './helpers';

type Demo = { __sbDemo: { ask(id: string, r: object): void; stop(id: string): Promise<void>; answers(): unknown[] } };
const answers = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.answers().length);
const focusOf = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]!;
  const layer = win.contentView.children.map(v => (v as { webContents?: Electron.WebContents }).webContents).find(w => w?.getURL().includes('#overlay'));
  return { app: win.webContents.isFocused(), layer: !!layer?.isFocused() };
});
const askOrchestrator = (app: ElectronApplication, q: string, a: string, b: string) => app.evaluate((_e, [q, a, b]) => (globalThis as unknown as Demo).__sbDemo.ask('orchestrator', {
  type: 'question', tool: 'AskUserQuestion', title: q, detail: '', input: {},
  questions: [{ question: q, header: 'Orchestrator', multiSelect: false, options: [{ label: a }, { label: b }] }],
}), [q, a, b] as const);

test('Ctrl+J to a work chat\'s request moves the popup to the layer; the Orchestrator asking meanwhile waits on "Poi:"', async () => {
  const { app, page } = await launchDemo();
  await goPage(page, 'costi');
  await page.keyboard.press('Control+R');
  const orchestrator = page.getByTestId('tile-orchestrator');
  const cards = page.locator('[data-request-key]');
  await expect(orchestrator.getByTestId('request-orchestrator-orchestrator-q1')).toBeVisible();
  await expect.poll(async () => (await layerState(app)).cards).toBe(0); // her card is the one popup
  await page.keyboard.press('Control+J'); // the Orchestrator's oldest
  await expect(orchestrator.getByTestId('request-orchestrator-orchestrator-q1')).toBeFocused();
  await page.keyboard.press('Control+J'); // QA: it floats, the Orchestrator's card steps aside
  await expect.poll(async () => (await focusOf(app)).layer).toBe(true);
  await expect(cards).toHaveCount(0);
  // the Orchestrator asks again while the user answers in the layer: the layer card stays, hers wait on "Poi:"
  await askOrchestrator(app, 'Apro la PR?', 'Sì', 'No');
  await expect(orchestrator.getByTestId('orchestrator-next')).toContainText('Apro la PR?');
  await expect(cards).toHaveCount(0);
  await expect.poll(async () => (await layerState(app)).cards).toBeGreaterThan(0);
  expect((await focusOf(app)).layer).toBe(true);
  expect(await answers(app)).toBe(0);
  await app.close();
});
