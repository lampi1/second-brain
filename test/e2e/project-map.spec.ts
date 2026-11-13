// Mappa → Progetti (issue #385, ADR 0271): the demo brain's project map draws its top level (people, the shop, the
// outside systems, the environments) with the parts waiting for the user marked, the agents column lists the demo chats
// bound to it, a click on the shop zooms into its parts with the outside systems it talks to around them, a card lights
// its parts, and the history slider shows the first drawing. Frozen demo; screenshots in test-results/shots/project-map-*.png.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('the project map draws the project, zooms into a system and plays its history', async () => {
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'collegamenti');
    await page.getByTestId('bm-map-page').getByRole('button', { name: 'Progetti', exact: true }).click();
    const view = page.getByTestId('pm-view');
    for (const id of ['cliente', 'operatore', 'negozio', 'pagamenti', 'gestionale', 'test', 'pipeline']) await expect(view.getByTestId(`pm-node-${id}`)).toBeVisible();
    await expect(view.getByTestId('pm-node-carrello')).toHaveCount(0);
    await expect(view.getByTestId('pm-waiting')).toHaveText('2 aspettano te');
    await expect(view.getByTestId('pm-agent')).toHaveCount(3);
    await expect(view.getByTestId('pm-agent').first()).toContainText('QA · Rimborsi');
    await shot(page, 'project-map-top');

    // into the shop: its parts, and around them the outside systems they talk to
    await view.getByTestId('pm-node-negozio').click();
    for (const id of ['carrello', 'ordini', 'rimborsi', 'notifiche', 'db', 'pagamenti', 'provider-sms']) await expect(view.getByTestId(`pm-node-${id}`)).toBeVisible();
    await expect(view.getByTestId('pm-node-rimborsi')).toHaveClass(/s-blocked/);
    await expect(view.getByTestId('pm-node-notifiche')).toHaveClass(/s-stale/); // in progress, nobody confirmed it for 3 h
    await shot(page, 'project-map-zoom');
    await view.getByTestId('pm-agent').filter({ hasText: 'Fix totale ordine' }).click();
    await expect(view.getByTestId('pm-node-ordini')).toHaveClass(/lit/);

    // the history: the first drawing, then back to now
    await view.getByTestId('pm-history').locator('input[type=range]').fill('0');
    await expect(view.getByTestId('pm-past')).toContainText('Versione 1');
    await expect(view.getByTestId('pm-node-notifiche')).toHaveCount(0);
    await view.getByRole('button', { name: 'Torna a ora' }).click();
    await expect(view.getByTestId('pm-node-notifiche')).toBeVisible();

    // breadcrumbs back to the whole project
    await view.locator('.pm-trail').getByRole('button', { name: 'Tutto il progetto' }).click();
    await expect(view.getByTestId('pm-node-carrello')).toHaveCount(0);
  } finally { await app.close(); }
});

// ADR 0275: the maps in a window, in «Stato»'s place (top bar, the Orchestrator's head, Ctrl+Shift+S, app_project_map open)
test('the project maps open in a window from the Orchestrator and step into a system', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('maps-btn').click();
    const win = page.getByTestId('maps');
    await expect(win).toBeVisible();
    const view = win.getByTestId('pm-view');
    await expect(view.getByTestId('pm-node-negozio')).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, 'project-maps-window');
    await view.getByTestId('pm-node-negozio').click();
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, 'project-maps-window-zoom');
    await page.keyboard.press('Escape');
    await expect(win).toBeHidden();
    // it reopens where the user left it (Ctrl+Shift+S), and the breadcrumbs go back up
    await page.keyboard.press('Control+Shift+KeyS');
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await view.locator('.pm-trail').getByRole('button', { name: 'Tutto il progetto' }).click();
    await expect(view.getByTestId('pm-node-carrello')).toHaveCount(0);
    // the Orchestrator opens it at a system (app_project_map open → ui:command 'maps')
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('file:')) w.webContents.send('ui:command', { action: 'maps', value: 'alfa-shop/negozio' }); });
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await win.getByTestId('maps-full').click();
    await expect(win).toBeHidden();
    await expect(page.getByTestId('pm-view').getByTestId('pm-node-rimborsi')).toBeVisible();
  } finally { await app.close(); }
});

// The owner 2026-11-13: «le voglio poter mettere a tutto schermo, tutto schermo davvero» · «ogni riquadro devo poterlo
// discutere con l'orchestrator in un click»
test('the maps go real full screen, Esc leaves it, and a box is discussed with the Orchestrator in one click', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('maps-btn').click();
    const win = page.getByTestId('maps'), view = win.getByTestId('pm-view');
    await view.getByTestId('pm-node-negozio').click();
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await view.getByTestId('pm-fullscreen').click();
    await expect(view.getByTestId('pm-fullscreen')).toHaveAttribute('aria-pressed', 'true');
    // the whole window (the OS full screen is asked too; a headless window may not get it)
    const vp = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const b = (await view.boundingBox())!;
    expect([b.x, b.y, Math.round(b.width), Math.round(b.height)]).toEqual([0, 0, vp.width, vp.height]);
    await page.waitForTimeout(500);
    await shot(page, 'project-maps-fullscreen');
    await page.keyboard.press('Escape');
    await expect(view.getByTestId('pm-fullscreen')).toHaveAttribute('aria-pressed', 'false');
    await expect(win).toBeVisible(); // Esc left the full screen, not the window
    await page.waitForTimeout(450);

    // one click on a box's corner: the window steps aside, the Orchestrator has a draft that quotes the box
    await view.getByTestId('pm-talk-rimborsi').click();
    await expect(win).toBeHidden();
    const input = page.getByTestId('orchestrator-input');
    await expect(input).toHaveValue(/Mappa «Alfa · negozio online» \(Negozio web\): Parte «Rimborsi», stato bloccato/);
    await expect(input).toHaveValue(/Voglio parlarne: $/);
    await shot(page, 'project-maps-talk');
  } finally { await app.close(); }
});

// The owner 2026-11-13: «control + rotella zummasse e il drag si potesse fare per spostare la view, non spostare i
// riquadri ma spostarsi sul workspace tipo figma e poi quando entro in un riquadro un modo veloce per tornare indietro»
test('the map moves like a design canvas: Ctrl+wheel zooms at the pointer, a drag pans, ← / Backspace go back up', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('maps-btn').click();
    const view = page.getByTestId('maps').getByTestId('pm-view'), canvas = view.getByTestId('pm-canvas');
    const shop = view.getByTestId('pm-node-negozio');
    await expect(shop).toBeVisible();
    const scale = async () => Number(await canvas.getAttribute('data-scale'));
    await view.getByTestId('pm-fit').click(); // the fitted scale, not the first frame's
    const s0 = await scale();
    // Ctrl + wheel over the shop: bigger, and the shop stays under the pointer
    const b0 = (await shop.boundingBox())!;
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect.poll(scale).toBeGreaterThan(s0 * 1.2);
    const b1 = (await shop.boundingBox())!;
    expect(Math.abs(b1.x + b1.width / 2 - (b0.x + b0.width / 2))).toBeLessThan(4);
    await expect(view.getByTestId('pm-pct')).not.toHaveText(`${Math.round(s0 * 100)}%`);
    // a drag (even starting on a box) moves the view, never the box, and does not open it
    const c = (await canvas.boundingBox())!;
    await page.mouse.move(b1.x + 20, b1.y + 20);
    await page.mouse.down();
    await page.mouse.move(b1.x + 20 - 150, b1.y + 20 - 80, { steps: 6 });
    await page.mouse.up();
    const b2 = (await shop.boundingBox())!;
    expect(Math.round(b2.x - b1.x)).toBe(-150);
    expect(Math.round(b2.y - b1.y)).toBe(-80);
    await expect(view.getByTestId('pm-up')).toHaveCount(0); // still the top level: the drag opened nothing
    await shot(page, 'project-maps-zoomed');
    // ⤢ fits it again
    await view.getByTestId('pm-fit').click();
    await expect.poll(scale).toBeCloseTo(s0, 2);
    expect(c.width).toBeGreaterThan(0);

    // into the shop, then back: the ← button, Backspace, a double click on the empty canvas
    await shop.click();
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await expect(view.getByTestId('pm-up')).toContainText('Tutto il progetto');
    await shot(page, 'project-maps-inside');
    await view.getByTestId('pm-up').click();
    await expect(view.getByTestId('pm-node-rimborsi')).toHaveCount(0);
    await shop.click();
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await page.keyboard.press('Backspace');
    await expect(view.getByTestId('pm-node-rimborsi')).toHaveCount(0);
    await shop.click();
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await canvas.dblclick({ position: { x: 30, y: c.height - 120 } });
    await expect(view.getByTestId('pm-node-rimborsi')).toHaveCount(0);
  } finally { await app.close(); }
});
