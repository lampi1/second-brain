// E2E of the global request layer (main/overlay.ts + OverlayApp.tsx): questions and permissions that are not visible
// anywhere on screen float in a small top-most view, above pages and browser tiles; they never take the keyboard while
// the user types; Ctrl+J or a click moves the keyboard there; 1-9 / Enter answer, Esc is "Rispondi dopo" (all of them
// wait in "Da rispondere", the tiles say "Da rispondere").
// None while the Orchestrator column shows a request card: one popup at a time (the user, 2026-10-13).
import { expect, test, type ElectronApplication } from '@playwright/test';
import { demoLayout, expandChats, launchDemo, layerPage, layerState, windowShot } from './helpers';

type Demo = { __sbDemo: { stop(id: string): Promise<void> } };

// app: the page has the keyboard. A hidden run's window may lose the OS focus to any other window on the machine (then no
// view of it is focused, whatever the app did): there only the layer's side is measurable, the page counts as keeping it
const focusOf = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]!;
  const layer = win.contentView.children.map(v => (v as { webContents?: Electron.WebContents }).webContents).find(w => w?.getURL().includes('#overlay'));
  return { app: !win.isFocused() || win.webContents.isFocused(), layer: !!layer?.isFocused() };
});

test('requests not on screen float above a page, without taking the keyboard', async () => {
  const { app, page } = await launchDemo();
  await expect.poll(async () => (await layerState(app)).attached).toBe(false); // the strips + the Orchestrator column: they show them all (nothing waits off screen)
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('task');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('brain-page-task')).toBeVisible(); // a page (Oggi is now Task)
  // the Orchestrator column stays on the page (ADR 0068): its decision is the one popup on screen
  await expect(page.locator('[data-regia-overlay] [data-request-key]')).toHaveCount(1);
  await expect.poll(async () => (await layerState(app)).cards).toBe(0); // never two popups at once (the user, 2026-10-13)
  await app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.stop('regia')); // her request leaves
  await expect(page.locator('[data-regia-overlay] [data-request-key]')).toHaveCount(0);
  await expect.poll(async () => (await layerState(app)).cards).toBe(2); // now the layer shows the others: QA + Feedback
  await page.getByTestId('regia-input').click();
  const st = await layerState(app);
  expect(st.attached).toBe(true);
  const ov = (await page.getByTestId('regia-overlay').boundingBox())!;
  expect(st.bounds!.x + st.bounds!.width).toBe(Math.round(ov.x) - 16); // left of the Orchestrator column, never over it
  await expect.poll(async () => { const b = (await layerState(app)).bounds!; return b.y + b.height; }).toBe(1000 - 16);
  const layer = await layerPage(app);
  await expect(layer.getByTestId('layer-card')).toContainText('QA · Rimborsi');
  await expect(layer.getByTestId('layer-badge')).toHaveText('2');
  await expect(layer.getByTestId('layer-queue')).toContainText('App · Feedback');
  // typing goes on in the app: the layer did not take the keyboard
  await page.keyboard.type('ciao');
  await expect(page.getByTestId('regia-input')).toHaveValue('ciao');
  expect(await focusOf(app)).toEqual({ app: true, layer: false });
  // a new request while typing: it shows up, the keyboard stays where it is
  await app.evaluate(() => (globalThis as unknown as { __sbDemo: { ask(id: string, r: object): void } }).__sbDemo.ask('mappa', {
    type: 'permission', tool: 'Bash', title: 'Bash · npm run build', detail: 'npm run build', input: {},
  }));
  await expect.poll(async () => (await layerState(app)).cards).toBe(3);
  await page.keyboard.type(' a tutti');
  await expect(page.getByTestId('regia-input')).toHaveValue('ciao a tutti');
  expect(await focusOf(app)).toEqual({ app: true, layer: false });
  await windowShot(app, 'layer-over-page');
  await app.close();
});

test('Ctrl+J moves the keyboard to the layer: 1 answers, Esc is "Rispondi dopo"', async () => {
  const { app, page } = await launchDemo();
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('costi');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('brain-page-costi')).toBeVisible();
  await page.keyboard.press('Control+R'); // the Orchestrator column here too: its card is the one popup, the layer waits
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  await page.keyboard.press('Control+J'); // the oldest is the Orchestrator's, on screen in its column: focused there, nothing moves
  await expect(page.locator('[data-request-key="regia/regia-q1"]')).toBeFocused();
  await expect(page.getByTestId('brain-page-costi')).toBeVisible();
  await app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.stop('regia')); // her request leaves: the next one floats
  await expect(page.locator('[data-regia-overlay] [data-request-key]')).toHaveCount(0);
  await expect.poll(async () => (await layerState(app)).cards).toBe(2);
  await page.keyboard.press('Control+J'); // the next one floats in the layer: the keyboard goes there
  await expect.poll(async () => (await focusOf(app)).layer).toBe(true);
  const layer = await layerPage(app);
  await expect(layer.locator('[data-request-key="qa/qa-q1"]')).toBeFocused();
  await layer.keyboard.press('1');
  await expect(layer.locator('[data-request-key="feedback/feedback-p1"]')).toBeVisible(); // the next one, in full
  await expect(page.getByTestId('brain-page-costi')).toBeVisible(); // answered without leaving the page
  await layer.keyboard.press('Escape'); // "Rispondi dopo": off the layer, still waiting, in "Da rispondere"
  await expect.poll(async () => (await layerState(app)).cards).toBe(0); // (a "chat finita" toast may stay: the QA chat just ended)
  await expect(layer.getByText(/da rispondere|in attesa/)).toHaveCount(0); // no waiting strip: the top bar counts them
  await expect.poll(async () => (await focusOf(app)).app).toBe(true);
  await page.getByTestId('page-back').click(); // back to the Grindhouse: the tile says "Da rispondere", no panel, no layer card
  await expect(page.getByTestId('chat-wait-feedback')).toBeVisible(); // collapsed: the strip's pill
  await expect(page.getByTestId('request-feedback-feedback-p1')).toHaveCount(0);
  await expect(page.getByTestId('request-qa-qa-q1')).toHaveCount(0);
  await expect(page.getByTestId('topbar-next')).toContainText('Da rispondere');
  await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  await app.close();
});

test('the layer stays above browser tiles (focus mode, the chat browser beside it)', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'qa'); // its input: the strips start collapsed
  await page.getByTestId('chat-input-qa').click();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('focus-view')).toBeVisible();
  await app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.stop('regia')); // the column's card is the one popup: let it go
  await expect.poll(async () => (await layerState(app)).cards).toBe(1); // the Feedback's
  await expect.poll(async () => (await demoLayout(app)).find(l => l.tabId === 'tab-qa')?.rect?.width ?? 0).toBeGreaterThan(300); // beside the chat, left of the Orchestrator column
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
