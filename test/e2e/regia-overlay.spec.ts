// The Regia widget and several Regie on the demo (ADR 0021, 0027): docked bottom-right, collapsed by default to its bar
// (the questions of every Regia counted, no Regia button in the top bar), expanded in place with a tab per Regia ("Lavoro", and "App" = the one app Regia of
// "Migliora l'app", ADR 0020) and a badge for the questions waiting there, arrow keys between the tabs; reduced again (button, Ctrl+R, Esc on an empty input) with
// the keyboard on the bar; resized from its top-left corner, the size and state surviving a restart, double-click back
// to the default; never over the chats or a page (collapsed and expanded, 1366 and 1920 wide); the opacity from its ⋯ menu and from Impostazioni; "Pulisci" with its confirm; "+" for a
// new named Regia. Screenshots in test-results/shots/regia-ov-*.png.
import { expect, test, type Page } from '@playwright/test';
import type { ChatSummary } from '../../src/shared/contract';
import { launchDemo, openRegia, shot } from './helpers';

const box = async (page: Page) => (await page.getByTestId('regia-overlay').boundingBox())!;
const activeId = (page: Page) => page.getByTestId('tile-regia').getAttribute('data-chat-id');
/** the app's own Regia ("Migliora l'app"), as its section makes it: space 'app', appRegia */
const appRegia = (page: Page) => page.evaluate(() => window.sb.invoke('chat:create', { harness: 'claude', cwd: 'C:\progetti\second-brain-app', title: "Regia dell'app", space: 'app', appRegia: true })) as Promise<ChatSummary>;

test('collapsed to its bar by default; expanded in place, a tab per Regia; collapsed again (button, Ctrl+R, Esc)', async () => {
  const { app, page } = await launchDemo();
  const ov = page.getByTestId('regia-overlay');
  await expect(ov).toHaveCount(0); // nothing covers the chats
  await expect(page.getByTestId('regia-pill-count')).toHaveText('1');
  await expect(page.getByTestId('regia-pill')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('topbar').getByTestId('regia-pill')).toHaveCount(0); // not in the top bar any more
  await shot(page, 'regia-ov-reduced');
  await page.getByTestId('regia-pill').click();
  await expect(ov).toBeVisible();
  await expect(page.getByTestId('regia-input')).toBeFocused();
  await expect(ov.getByRole('tab')).toHaveCount(1); // no app Regia yet: one tab
  const appR = await appRegia(page);
  await expect(page.getByTestId('regia-tab-regia')).toContainText('Lavoro');
  await expect(page.getByTestId(`regia-tab-${appR.id}`)).toContainText('App');
  await expect(ov.getByRole('tab')).toHaveCount(2);
  await expect(page.getByTestId('regia-tab-regia')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('regia-tab-regia').locator('.regia-badge')).toHaveText('1'); // its own decision waits
  await expect(page.getByTestId('splitter-regia')).toHaveCount(0); // no Regia column: the chats get the whole width
  await shot(page, 'regia-ov-open');

  await page.getByTestId(`regia-tab-${appR.id}`).click();
  await expect.poll(() => activeId(page)).toBe(appR.id);
  await expect(page.getByTestId(`regia-tab-${appR.id}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tile-regia')).toContainText('Regia dell’app');
  // its menu: Pulisci and the opacity; the work Regia's routing and engine switch are not hers
  await page.getByTestId('regia-menu').click();
  await expect(page.getByTestId(`chat-clear-${appR.id}`)).toBeVisible();
  await expect(page.getByTestId(`chat-renew-${appR.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`chat-close-${appR.id}`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2);
  await shot(page, 'regia-ov-tab-app');
  // the shortcuts on the selected Regia act on the tab shown: Ctrl+. is about the app's Regia, not the work one
  await page.getByTestId('regia-input').click();
  await page.keyboard.press('Control+.');
  await expect(page.getByTestId('toasts')).toContainText("«Regia dell'app» non sta lavorando");
  // the tab pattern: arrows move between the Regie
  await page.getByTestId(`regia-tab-${appR.id}`).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('regia-tab-regia')).toBeFocused();
  await expect.poll(() => activeId(page)).toBe('regia');

  await page.getByTestId('regia-collapse').click();
  await expect(ov).toHaveCount(0);
  await expect(page.getByTestId('regia-pill')).toBeFocused(); // the keyboard is never lost on the page
  await page.getByTestId('regia-pill').click();
  await expect(ov).toBeVisible();
  await expect(page.getByTestId('regia-input')).toBeFocused();
  await page.keyboard.press('Control+R'); // the focus is inside: Ctrl+R reduces it
  await expect(ov).toHaveCount(0);
  await page.keyboard.press('Control+R');
  await expect(page.getByTestId('regia-input')).toBeFocused();
  await page.keyboard.type('bozza');
  await page.keyboard.press('Escape'); // a draft: Esc never closes it under the text
  await expect(ov).toBeVisible();
  await page.getByTestId('regia-input').fill('');
  await page.keyboard.press('Escape');
  await expect(ov).toHaveCount(0);
  await app.close();
});

test('resized from its top-left corner, docked bottom-right; size and state survive a restart; double-click resets', async () => {
  test.setTimeout(120_000); // three launches: 55-60 s on a loaded machine, over the default 60 s at times
  const first = await launchDemo({ regia: true });
  let page = first.page;
  const start = await box(page);
  // the default: wide and low (42% of 1600 = 672 px wide, 42% of the height under the top bar)
  expect(Math.round(start.width)).toBe(672);
  expect(start.height).toBeLessThan(start.width);
  expect(Math.round(start.x + start.width)).toBe(1600 - 8); // docked in the corner
  expect(Math.round(start.y + start.height)).toBe(1000 - 8);
  const corner = (await page.getByTestId('regia-resize').boundingBox())!;
  await page.mouse.move(corner.x + 6, corner.y + 6);
  await page.mouse.down();
  await page.mouse.move(corner.x - 94, corner.y + 106, { steps: 5 });
  await page.mouse.up();
  const sized = await box(page);
  expect(Math.round(sized.width - start.width)).toBe(100);
  expect(Math.round(sized.height - start.height)).toBe(-100);
  expect(Math.round(sized.x + sized.width)).toBe(1600 - 8); // still in the corner
  expect(Math.round(sized.y + sized.height)).toBe(1000 - 8);
  await page.mouse.move(2, 2);
  await shot(page, 'regia-ov-resized');
  await first.app.close();

  const again = await launchDemo({ userData: first.userData });
  await expect(again.page.getByTestId('regia-overlay')).toBeVisible(); // left expanded: still expanded
  page = again.page;
  const kept = await box(page);
  expect([kept.x, kept.y, kept.width, kept.height].map(Math.round)).toEqual([sized.x, sized.y, sized.width, sized.height].map(Math.round));
  await page.getByTestId('regia-bar').locator('.regia-grip').dblclick();
  await expect.poll(async () => Math.round((await box(page)).width)).toBe(Math.round(start.width));
  await page.getByTestId('regia-collapse').click();
  // remembered (written 150 ms after the change)
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('sb.prefs.v1') ?? '{}') as { regiaOpen?: boolean }).regiaOpen)).toBe(false);
  await again.app.close();
  const third = await launchDemo({ userData: first.userData });
  await expect(third.page.getByTestId('regia-overlay')).toHaveCount(0); // left collapsed: still collapsed
  await expect(third.page.getByTestId('regia-pill')).toBeVisible();
  await third.app.close();
});

/** The widget never lies over the view area (chat tiles with their inputs and Esegui/Copia, a page). */
async function apart(page: Page, sel: string): Promise<void> {
  const w = (await page.locator('[data-regia-overlay]').boundingBox())!;
  const v = (await page.locator(sel).first().boundingBox())!;
  const overlap = w.x < v.x + v.width && v.x < w.x + w.width && w.y < v.y + v.height && v.y < w.y + w.height;
  expect(overlap, `${sel} under the Regia widget`).toBe(false);
}

for (const [W, H] of [[1366, 728], [1920, 1040]] as const) {
  test(`never over the chats or a page, collapsed and expanded, at ${W} px`, async () => {
    const { app, page } = await launchDemo({ width: W, height: H });
    await apart(page, '.view-area');
    await shot(page, `regia-dock-${W}-chat-collapsed`);
    await openRegia(page);
    await apart(page, '.view-area');
    await page.mouse.move(2, 2);
    await shot(page, `regia-dock-${W}-chat-expanded`);
    await page.keyboard.press('Control+K');
    await page.getByTestId('palette-input').fill('devops');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('brain-page-devops')).toBeVisible();
    await expect(page.getByTestId('regia-overlay')).toBeVisible(); // the same widget on every place
    await apart(page, '.page-frame');
    await page.mouse.move(2, 2);
    await shot(page, `regia-dock-${W}-page-expanded`);
    await page.getByTestId('regia-collapse').click();
    await apart(page, '.page-frame');
    await shot(page, `regia-dock-${W}-page-collapsed`);
    await app.close();
  });
}

test('opacity from the ⋯ menu and from Impostazioni; opaque again under the pointer', async () => {
  const { app, page } = await launchDemo({ regia: true });
  const ov = page.getByTestId('regia-overlay');
  await page.getByTestId('regia-menu').click();
  await expect(page.getByTestId('regia-opacity')).toBeVisible();
  await page.getByTestId('regia-opacity-range').fill('60');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // focus inside keeps it opaque
  await page.mouse.move(400, 200); // away from the panel
  await expect.poll(() => ov.evaluate(el => getComputedStyle(el).opacity)).toBe('0.6');
  await shot(page, 'regia-ov-opacity');
  const b = await box(page);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(() => ov.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  await page.mouse.move(400, 200);
  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('st-regia-opacity-range')).toHaveValue('60');
  await page.getByTestId('st-regia-opacity-range').fill('80');
  await page.mouse.move(400, 200);
  await expect.poll(() => ov.evaluate(el => getComputedStyle(el).opacity)).toBe('0.8');
  await shot(page, 'regia-ov-settings');
  await app.close();
});

test('Pulisci asks first, then a new empty Regia takes the tab; the old one is among the closed chats', async () => {
  const { app, page } = await launchDemo({ regia: true });
  await page.getByTestId('regia-menu').click();
  await page.getByTestId('chat-clear-regia').click();
  await expect(page.getByTestId('confirm')).toContainText('Pulire la Regia «Regia»?');
  await shot(page, 'regia-ov-clear-confirm');
  await page.getByTestId('confirm-cancel').click();
  expect(await activeId(page)).toBe('regia');
  await page.getByTestId('regia-menu').click();
  await page.getByTestId('chat-clear-regia').click();
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => activeId(page)).not.toBe('regia');
  await expect(page.getByTestId('tile-regia')).not.toContainText('Che si fa adesso?'); // starts empty
  await expect(page.getByTestId('regia-overlay').getByRole('tab').first()).toContainText('Lavoro'); // same tab name
  await expect(page.getByTestId('tile-chat-regia')).toHaveCount(0); // closed, not on the grid
  await expect(page.getByTestId('toasts')).toContainText('Chiusa: Regia precedente · Claude');
  await page.mouse.move(2, 2);
  await shot(page, 'regia-ov-cleared');
  await app.close();
});

test('"+" opens Nuova Regia: a name is its tab, chats created from that tab answer to it', async () => {
  const { app, page } = await launchDemo();
  await openRegia(page);
  await page.getByTestId('regia-tab-new').click();
  await expect(page.getByTestId('newchat')).toBeVisible();
  await expect(page.getByTestId('newchat-regia')).toBeChecked();
  await expect(page.getByTestId('newchat-regia-name')).toBeFocused();
  await page.keyboard.type('Ricerca');
  await shot(page, 'regia-ov-new');
  await page.getByTestId('newchat-create').click();
  await expect(page.getByTestId('newchat')).toHaveCount(0);
  const tab = page.getByTestId('regia-overlay').getByRole('tab', { name: /Ricerca/ });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tile-regia')).toHaveAttribute('aria-label', /Regia · Ricerca/);
  await page.mouse.move(2, 2);
  await shot(page, 'regia-ov-three-tabs');
  await app.close();
});
