// The persistent Orchestrator column on the demo (ADR 0068, superseding the collapsible widget of ADR 0021): always open
// on the right, from under the top bar to the bottom edge, never over the chats or a page (1366 and 1920 wide); Ctrl+R
// puts the keyboard in its input, Esc never hides it; resized from its left edge (pointer and arrow keys), the width
// surviving a restart, double-click back to the default; "Pulisci" with its confirm. Screenshots in test-results/shots/orchestrator-ov-*.png.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, openOrchestrator, shot } from './helpers';

const box = async (page: Page) => (await page.getByTestId('orchestrator-overlay').boundingBox())!;
const activeId = (page: Page) => page.getByTestId('tile-orchestrator').getAttribute('data-chat-id');

test('always open on the right, no collapse and no tabs; Ctrl+R focuses its input, Esc keeps it open', async () => {
  const { app, page } = await launchDemo();
  const ov = page.getByTestId('orchestrator-overlay');
  await expect(ov).toBeVisible();
  await expect(page.getByTestId('tile-orchestrator')).toBeVisible();
  await expect(ov.getByRole('tab')).toHaveCount(0);
  for (const gone of ['orchestrator-pill', 'orchestrator-collapse', 'orchestrator-tab-new']) await expect(page.getByTestId(gone)).toHaveCount(0);
  const b = await box(page);
  const top = (await page.getByTestId('topbar').boundingBox())!;
  expect(Math.round(b.x + b.width)).toBe(1600); // flush with the right edge
  expect(Math.round(b.y)).toBe(Math.round(top.y + top.height)); // from under the top bar
  expect(Math.round(b.y + b.height)).toBe(1000); // to the bottom edge
  await shot(page, 'orchestrator-ov-open');

  await page.getByTestId('view-agents').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+R');
  await expect(page.getByTestId('orchestrator-input')).toBeFocused();
  await page.keyboard.type('bozza');
  await page.keyboard.press('Escape');
  await expect(ov).toBeVisible();
  await page.getByTestId('orchestrator-input').fill('');
  await page.keyboard.press('Escape');
  await expect(ov).toBeVisible(); // nothing hides it

  // its menu: Pulisci; the engine switch is in the menu too
  await page.getByTestId('orchestrator-menu').click();
  await expect(page.getByTestId('chat-clear-orchestrator')).toBeVisible();
  await page.keyboard.press('Escape');
  await app.close();
});

test('resized from its left edge; the width survives a restart; double-click resets', async () => {
  test.setTimeout(120_000); // two launches on a loaded machine
  const first = await launchDemo({ orchestrator: true });
  let page = first.page;
  const start = await box(page);
  expect(Math.round(start.width)).toBe(672); // the default on the Grindhouse: 42% of 1600 (440-680 px)
  const edge = (await page.getByTestId('orchestrator-resize').boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 - 100, edge.y + edge.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await box(page)).width)).toBe(772);
  expect(Math.round((await box(page)).x + (await box(page)).width)).toBe(1600); // still flush right
  await page.getByTestId('orchestrator-resize').focus();
  await page.keyboard.press('ArrowRight'); // the keyboard narrows it by 24 px
  await expect.poll(async () => Math.round((await box(page)).width)).toBe(748);
  await expect(page.getByTestId('orchestrator-resize')).toHaveAttribute('aria-valuenow', '748');
  await page.mouse.move(2, 2);
  await shot(page, 'orchestrator-ov-resized');
  // remembered (written 150 ms after the change)
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('sb.prefs.v1') ?? '{}') as { orchestratorSize?: { w: number } }).orchestratorSize?.w)).toBe(748);
  await first.app.close();

  const again = await launchDemo({ userData: first.userData });
  page = again.page;
  await expect.poll(async () => Math.round((await box(page)).width)).toBe(748);
  await page.getByTestId('orchestrator-resize').dblclick();
  await expect.poll(async () => Math.round((await box(page)).width)).toBe(Math.round(start.width));
  await again.app.close();
});

/** The column never lies over the view area (chat strips with their inputs and Esegui/Copia, a page). */
async function apart(page: Page, sel: string): Promise<void> {
  const w = (await page.locator('[data-orchestrator-overlay]').boundingBox())!;
  const v = (await page.locator(sel).first().boundingBox())!;
  const overlap = w.x < v.x + v.width && v.x < w.x + w.width && w.y < v.y + v.height && v.y < w.y + w.height;
  expect(overlap, `${sel} under the Orchestrator column`).toBe(false);
}

for (const [W, H] of [[1366, 728], [1920, 1040]] as const) {
  test(`never over the chats or a page at ${W} px`, async () => {
    const { app, page } = await launchDemo({ width: W, height: H });
    await openOrchestrator(page);
    await apart(page, '.view-area');
    await page.mouse.move(2, 2);
    await shot(page, `orchestrator-dock-${W}-chat`);
    await page.keyboard.press('Control+K');
    await page.getByTestId('palette-input').fill('task');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('brain-page-task')).toBeVisible();
    await expect(page.getByTestId('orchestrator-overlay')).toBeVisible(); // the same column on every place
    await apart(page, '.page-frame');
    await page.mouse.move(2, 2);
    await shot(page, `orchestrator-dock-${W}-page`);
    await app.close();
  });
}

test('Pulisci asks first, then a new empty Orchestrator takes the column; the old one is among the closed chats', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  await page.getByTestId('orchestrator-menu').click();
  await page.getByTestId('chat-clear-orchestrator').click();
  await expect(page.getByTestId('confirm')).toContainText('Pulire l’Orchestrator «Orchestrator»?');
  await shot(page, 'orchestrator-ov-clear-confirm');
  await page.getByTestId('confirm-cancel').click();
  expect(await activeId(page)).toBe('orchestrator');
  await page.getByTestId('orchestrator-menu').click();
  await page.getByTestId('chat-clear-orchestrator').click();
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => activeId(page)).not.toBe('orchestrator');
  await expect(page.getByTestId('tile-orchestrator')).not.toContainText('Che si fa adesso?'); // starts empty
  await expect(page.getByTestId('toasts')).toContainText('Chiusa: Orchestrator precedente · Claude');
  await expect(page.getByTestId('tile-chat-orchestrator')).toHaveCount(0); // closed, not among the strips
  await page.mouse.move(2, 2);
  await shot(page, 'orchestrator-ov-cleared');
  await app.close();
});
