// E2E of the "one question popup at a time" rule (the user, 2026-10-13: two popups at once, one "appeso" on the
// Orchestrator, letters typed only to get rid of it). Since 2026-10-22 the questions window is that one popup: the
// Orchestrator column shows no request card of its own, the global layer holds toasts only, and a request that comes
// while the user answers another waits in the window's rail instead of opening a second popup or taking the keyboard.
// Screenshot: test-results/shots/one-popup-window.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, layerState, shot } from './helpers';

type Demo = { __sbDemo: { ask(id: string, r: object): void; answers(): unknown[] } };
const answers = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.answers().length);
const askOrchestrator = (app: ElectronApplication, q: string, a: string, b: string) => app.evaluate((_e, [q, a, b]) => (globalThis as unknown as Demo).__sbDemo.ask('orchestrator', {
  type: 'question', tool: 'AskUserQuestion', title: q, detail: '', input: {},
  questions: [{ question: q, header: 'Orchestrator', multiSelect: false, options: [{ label: a }, { label: b }] }],
}), [q, a, b] as const);

test('one popup: a work chat\'s request answered in the questions window; the Orchestrator asking meanwhile waits in its rail', async () => {
  const { app, page } = await launchDemo({ orchestrator: true, questions: true });
  const win = page.getByTestId('qwin');
  const cards = page.locator('[data-request-key]');
  await expect(win).toBeVisible();
  await expect(page.getByTestId('qwin-chat')).toHaveText('Orchestrator'); // the oldest first
  await expect(cards).toHaveCount(1); // the window's card, nowhere else
  await expect(page.getByTestId('tile-orchestrator').locator('[data-request-key]')).toHaveCount(0);
  expect((await layerState(app)).attached).toBe(false); // the layer holds toasts only: none here
  // a work chat's request now: the window shows it, the Orchestrator's waits in the rail
  await page.locator('[data-testid="qwin-pick"][data-key="qa/qa-q1"]').click();
  await expect(page.getByTestId('qwin-chat')).toHaveText('QA · Rimborsi');
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  // the Orchestrator asks again while the user is on QA's: one more line in the rail, the card and the keyboard stay
  await askOrchestrator(app, 'Apro la PR?', 'Sì', 'No');
  await expect(page.getByTestId('qwin-pick').filter({ hasText: 'Apro la PR?' })).toHaveCount(1);
  await expect(page.getByTestId('qwin-chat')).toHaveText('QA · Rimborsi');
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await expect(cards).toHaveCount(1);
  expect((await layerState(app)).attached).toBe(false);
  expect(await answers(app)).toBe(0);
  await page.mouse.move(2, 2);
  await shot(page, 'one-popup-window');
  await app.close();
});
