// E2E of the global request layer (main/overlay.ts + OverlayApp.tsx): questions and permissions that are not visible
// anywhere on screen float in a small top-most view, above pages and browser tiles; they never take the keyboard while
// the user types; Ctrl+J or a click moves the keyboard there; 1-9 / Enter answer, Esc postpones to "Ti aspettano".
import { expect, test, type ElectronApplication } from '@playwright/test';
import { demoLayout, launchDemo, layerPage, layerState, windowShot } from './helpers';

const focusOf = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]!;
  const layer = win.contentView.children.map(v => (v as { webContents?: Electron.WebContents }).webContents).find(w => w?.getURL().includes('#overlay'));
  return { app: win.webContents.isFocused(), layer: !!layer?.isFocused() };
});

test('requests not on screen float above a page, without taking the keyboard', async () => {
  const { app, page } = await launchDemo();
  await expect.poll(async () => (await layerState(app)).attached).toBe(false); // Mosaico: the lane shows them all
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('oggi');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('brain-page-home')).toBeVisible();
  await expect.poll(async () => (await layerState(app)).cards).toBe(3); // on a page all three float, the Regia's too
  await page.keyboard.press('Control+R'); // the Regia docked on the page: its decision is on screen there
  await page.getByTestId('regia-dock-input').click();
  await expect.poll(async () => (await layerState(app)).cards).toBe(2); // QA + Feedback
  const st = await layerState(app);
  expect(st.attached).toBe(true);
  expect(st.bounds!.x + st.bounds!.width).toBe(1600 - 16);
  await expect.poll(async () => { const b = (await layerState(app)).bounds!; return b.y + b.height; }).toBe(1000 - 16);
  const layer = await layerPage(app);
  await expect(layer.getByTestId('layer-card')).toContainText('QA · Rimborsi');
  await expect(layer.getByTestId('layer-badge')).toHaveText('3');
  await expect(layer.getByTestId('layer-queue')).toContainText('App · Feedback');
  // typing goes on in the app: the layer did not take the keyboard
  await page.keyboard.type('ciao');
  await expect(page.getByTestId('regia-dock-input')).toHaveValue('ciao');
  expect(await focusOf(app)).toEqual({ app: true, layer: false });
  // a new request while typing: it shows up, the keyboard stays where it is
  await app.evaluate(() => (globalThis as unknown as { __sbDemo: { ask(id: string, r: object): void } }).__sbDemo.ask('mappa', {
    type: 'permission', tool: 'Bash', title: 'Bash · npm run build', detail: 'npm run build', input: {},
  }));
  await expect.poll(async () => (await layerState(app)).cards).toBe(3);
  await page.keyboard.type(' a tutti');
  await expect(page.getByTestId('regia-dock-input')).toHaveValue('ciao a tutti');
  expect(await focusOf(app)).toEqual({ app: true, layer: false });
  await windowShot(app, 'layer-over-page');
  await app.close();
});

test('Ctrl+J moves the keyboard to the layer: 1 answers, Esc postpones to "Ti aspettano"', async () => {
  const { app, page } = await launchDemo();
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('costi');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('brain-page-costi')).toBeVisible();
  await page.keyboard.press('Control+R'); // the Regia docked here
  await expect.poll(async () => (await layerState(app)).cards).toBe(2);
  await page.keyboard.press('Control+J'); // the oldest is the Regia's, on screen in the dock: focused there, nothing moves
  await expect(page.locator('[data-request-key="regia/regia-q1"]')).toBeFocused();
  await expect(page.getByTestId('brain-page-costi')).toBeVisible();
  await page.keyboard.press('Control+J'); // the next one floats in the layer: the keyboard goes there
  await expect.poll(async () => (await focusOf(app)).layer).toBe(true);
  const layer = await layerPage(app);
  await expect(layer.locator('[data-request-key="qa/qa-q1"]')).toBeFocused();
  await layer.keyboard.press('1');
  await expect(layer.locator('[data-request-key="feedback/feedback-p1"]')).toBeVisible(); // the next one, in full
  await expect(page.getByTestId('brain-page-costi')).toBeVisible(); // answered without leaving the page
  await layer.keyboard.press('Escape'); // postpone: off the layer, still waiting
  await expect.poll(async () => (await layerState(app)).cards).toBe(0); // (a "chat finita" toast may stay: the QA chat just ended)
  await expect.poll(async () => (await focusOf(app)).app).toBe(true);
  await page.getByTestId('page-back').click(); // back to the workspace
  await expect(page.getByTestId('lane-card-feedback-feedback-p1')).toBeVisible();
  await expect(page.getByTestId('lane-card-qa-qa-q1')).toHaveCount(0);
  await app.close();
});

test('the layer stays above browser tiles (focus mode, the chat browser beside it)', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('chat-input-qa').click();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('focus-view')).toBeVisible();
  await expect.poll(async () => (await layerState(app)).cards).toBe(2); // the Regia's and the Feedback's
  await expect.poll(async () => (await demoLayout(app)).find(l => l.tabId === 'tab-qa')?.rect?.width ?? 0).toBeGreaterThan(500);
  const tab = (await demoLayout(app)).find(l => l.tabId === 'tab-qa')!.rect!;
  const b = (await layerState(app)).bounds!;
  expect(b.x < tab.x + tab.width && tab.x < b.x + b.width && b.y < tab.y + tab.height && tab.y < b.y + b.height).toBe(true); // over the browser
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
    const kids = BrowserWindow.getAllWindows()[0]!.contentView.children;
    return (kids[kids.length - 1] as { webContents?: Electron.WebContents }).webContents?.getURL() ?? '';
  })).toContain('#overlay'); // drawn last = on top of the browser views
  await page.waitForTimeout(400);
  await windowShot(app, 'layer-over-browser');
  await app.close();
});
