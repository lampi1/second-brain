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

// ADR 0276 + ADR 0307: «Mappe» opened by the user (top bar, the Orchestrator's head (ADR 0301), Ctrl+Shift+S) takes the
// whole screen at once; Esc leaves the map as a page beside the Orchestrator's column, where the user talks to the
// Orchestrator while he looks at it. Opened by the Orchestrator (app_project_map open) it stays beside the column.
test('the project maps open full screen, Esc puts them beside the Orchestrator, and they step into a system', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('maps-btn').click();
    const view = page.getByTestId('pm-view');
    await expect(view.getByTestId('pm-node-negozio')).toBeVisible();
    await expect(view.getByTestId('pm-fullscreen')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(view.getByTestId('pm-fullscreen')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('orchestrator-input')).toBeVisible();
    await expect.poll(async () => (await view.boundingBox())!.x).toBeGreaterThan(100); // beside the column, not over it
    await shot(page, 'project-maps-page');
    await view.getByTestId('pm-node-negozio').click();
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    // it comes back where the user left it (Ctrl+Shift+S from another page)
    await goPage(page, 'task');
    await expect(view).toHaveCount(0);
    await page.keyboard.press('Control+Shift+KeyS');
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await expect(view.getByTestId('pm-fullscreen')).toHaveAttribute('aria-pressed', 'true'); // the user opened it: full screen
    await page.keyboard.press('Escape');
    await view.locator('.pm-trail').getByRole('button', { name: 'Tutto il progetto' }).click();
    await expect(view.getByTestId('pm-node-carrello')).toHaveCount(0);
    // the Orchestrator opens it at a system (app_project_map open → ui:command 'maps')
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('file:')) w.webContents.send('ui:command', { action: 'maps', value: 'alfa-shop/negozio' }); });
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await expect(view.getByTestId('pm-fullscreen')).toHaveAttribute('aria-pressed', 'false'); // the Orchestrator opened it: beside him
  } finally { await app.close(); }
});

// ADR 0276: a Strategist's plan drawn on the map: its steps inside the box they work on, the piece that is not there
// yet, the plan in the side column with «Approva e parti» while it waits for the user
test('a plan is drawn on the map: steps in their box, a planned piece, approval from the map', async () => {
  const { app, page } = await launchDemo();
  try {
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { tree(): void } }).__sbDemo.tree());
    await page.getByTestId('maps-btn').click();
    const view = page.getByTestId('pm-view');
    await expect(view.getByTestId('pm-plan')).toContainText('Sconti in percentuale');
    await expect(view.getByTestId('pm-plan')).toContainText('1 di 4 passi fatti');
    await expect(view.getByTestId('pm-node-note-di-rilascio')).toBeVisible();
    await view.getByTestId('pm-node-negozio').click();
    await expect(view.getByTestId('pm-works-ordini')).toContainText('Applico lo sconto % sul prezzo pieno'); // the step under way first (ADR 0302)
    await expect(view.getByTestId('pm-works-ordini')).toContainText('1/3 fatti');
    await shot(page, 'project-map-plan');
    // a plan that waits for the user: the pieces dashed, the approval on the map
    await app.evaluate(() => { const d = (globalThis as unknown as { __sbDemo: { plan(id: string, p: unknown): void } }).__sbDemo; d.plan('tree-plan', { phase: 'proposed', at: 5, map: 'alfa-shop', clarified: [], steps: [{ title: 'Scrivo i resi parziali', role: 'artisan', state: 'todo', on: 'rimborsi' }] }); });
    await expect(view.getByTestId('pm-plan-approve')).toBeVisible();
    await shot(page, 'project-map-plan-proposed');
    await view.getByTestId('pm-plan-approve').click();
    await expect(view.getByTestId('pm-plan-approve')).toHaveCount(0);
  } finally { await app.close(); }
});

// The owner 2026-11-13: «le voglio poter mettere a tutto schermo, tutto schermo davvero» · «ogni riquadro devo poterlo
// discutere con l'orchestrator in un click»
test('the maps go real full screen, Esc leaves it, and a box is discussed with the Orchestrator in one click', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('orchestrator-maps').click();
    const view = page.getByTestId('pm-view');
    await view.getByTestId('pm-node-negozio').click();
    await expect(view.getByTestId('pm-node-rimborsi')).toBeVisible();
    await expect(view.getByTestId('pm-fullscreen')).toHaveAttribute('aria-pressed', 'true'); // full screen from the first moment (ADR 0307)
    // the whole window (the OS full screen is asked too; a headless window may not get it)
    const vp = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const b = (await view.boundingBox())!;
    expect([b.x, b.y, Math.round(b.width), Math.round(b.height)]).toEqual([0, 0, vp.width, vp.height]);
    await shot(page, 'project-maps-fullscreen');
    await page.keyboard.press('Escape');
    await expect(view.getByTestId('pm-fullscreen')).toHaveAttribute('aria-pressed', 'false');
    await expect(view).toBeVisible(); // Esc left the full screen, not the page
    await expect.poll(async () => (await view.boundingBox())!.x).toBeGreaterThan(100);

    // one click on a box's corner: the Orchestrator, beside the map, has a draft that quotes the box
    await view.getByTestId('pm-talk-rimborsi').click();
    await expect(view).toBeVisible();
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
    const view = page.getByTestId('pm-view'), canvas = view.getByTestId('pm-canvas');
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

// ADR 0302 (the owner 2026-11-13): the part being worked on moves, quietly; the plan's steps read in order, the ones of
// one turn together; entering a system and coming back are a passage, not a cut; the projects are a list at the side
test('the map shows what moves, the order of the steps, the passage into a system and the projects at the side', async () => {
  const { app, page } = await launchDemo();
  try {
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { tree(): void } }).__sbDemo.tree());
    await page.getByTestId('maps-btn').click();
    const view = page.getByTestId('pm-view');
    // the plan's steps in order: three turns, the third holds two steps that go together
    const flow = view.getByTestId('pm-flow');
    await expect(flow.getByTestId('pm-step-2')).toHaveAttribute('data-s', 'now');
    await expect(flow.getByTestId('pm-turn-3')).toHaveAttribute('data-par', '');
    await expect(flow.getByTestId('pm-turn-3')).toContainText('insieme');
    await expect(flow.getByTestId('pm-turn-4')).toHaveCount(0);
    // somebody works on the shop and on the notes right now; nobody on the payments
    await expect(view.getByTestId('pm-node-negozio')).toHaveAttribute('data-running', '');
    await expect(view.getByTestId('pm-node-note-di-rilascio')).toHaveAttribute('data-running', '');
    await expect(view.getByTestId('pm-node-pagamenti')).not.toHaveAttribute('data-running', '');
    await expect(view.getByTestId('pm-legend-run')).toBeVisible();
    await shot(page, 'project-map-moving');
    // into the shop: the level inside comes in; back up: the box left is marked
    await view.getByTestId('pm-node-negozio').click();
    await expect(view.getByTestId('pm-node-ordini')).toBeVisible();
    await expect(view.getByTestId('pm-level')).toHaveAttribute('data-enter', 'in');
    await expect(view.getByTestId('pm-works-ordini')).toContainText('2∥');
    await shot(page, 'project-map-inside');
    await view.getByTestId('pm-up').click();
    await expect(view.getByTestId('pm-level')).toHaveAttribute('data-enter', 'out');
    await expect(view.getByTestId('pm-node-negozio')).toHaveClass(/came/);
    // a step of the plan shows the box it works on
    await flow.getByTestId('pm-step-4').click();
    await expect(view.getByTestId('pm-detail')).toContainText('Note di rilascio');
    // the projects are a list beside the drawing, not a menu
    const nav = view.getByTestId('pm-nav');
    await expect(nav.getByRole('button')).toHaveCount(2);
    await expect(nav.getByTestId('pm-nav-alfa-shop')).toHaveAttribute('aria-pressed', 'true');
    await nav.getByTestId('pm-nav-beta-crm').click();
    await expect(view.getByTestId('pm-node-crm')).toBeVisible();
    await expect(view.getByTestId('pm-flow')).toHaveCount(0);
    await shot(page, 'project-map-projects');
    // full screen: the list at the side, the drawing, the agents
    await nav.getByTestId('pm-nav-alfa-shop').click();
    await expect(view).toHaveClass(/pm-full/);
    await expect(view.getByTestId('pm-node-negozio')).toBeInViewport();
    await shot(page, 'project-map-moving-full');
  } finally { await app.close(); }
});

// ADR 0307 (the owner 2026-11-14): «voglio che si capisca bene ogni passaggio e vorrei anche poterle aggiornare da un
// tasto… il contenuto testuale non è molto dettagliato». Every step of a plan told in full, every box with how it works
// and what goes in and out, every arrow with what passes on it, and «Aggiorna» that asks the Orchestrator for a redraw.
test('the map tells every step, every box and every arrow in full, and «Aggiorna» asks the Orchestrator to redraw it', async () => {
  const { app, page } = await launchDemo();
  try {
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { tree(): void } }).__sbDemo.tree());
    await page.getByTestId('maps-btn').click();
    const view = page.getByTestId('pm-view');
    // a plan under way: the step being done, told in full (when it starts, how far it is, who does it, on which box)
    const now = view.getByTestId('pm-stepcard-2');
    await expect(now).toContainText('Parte quando è finito il passo 1.');
    await expect(now).toContainText('in corso');
    await expect(now).toContainText('lo fa Artisan');
    await expect(now).toContainText('su Ordini e sconti');
    await expect(view.getByTestId('pm-stepcard-1')).toHaveCount(0);
    // all of them on a click: the two that go together say so
    await view.getByTestId('pm-flow-all').click();
    for (const n of [1, 2, 3, 4]) await expect(view.getByTestId(`pm-stepcard-${n}`)).toBeVisible();
    await expect(view.getByTestId('pm-stepcard-1')).toContainText('Parte per primo.');
    await expect(view.getByTestId('pm-stepcard-3')).toContainText('Va insieme al passo 4.');
    await shot(page, 'project-map-steps');
    await view.getByTestId('pm-flow-all').click();
    await expect(view.getByTestId('pm-stepcard-1')).toHaveCount(0);

    // into the shop: with nothing picked, the side tells the system on screen
    await view.getByTestId('pm-node-negozio').click();
    await expect(view.getByTestId('pm-here')).toContainText('Come funziona');
    await expect(view.getByTestId('pm-here')).toContainText('Dentro ci sono cinque parti');
    // a part: how it works, what goes in and out (each passage with what it carries), the plan's steps on it
    await view.getByTestId('pm-node-ordini').click();
    const detail = view.getByTestId('pm-detail');
    await expect(detail).toContainText('arrotonda una volta sola alla fine');
    await expect(detail.getByTestId('pm-pass-carrello--ordini')).toContainText('Quando il cliente preme «Paga»');
    await expect(detail.getByTestId('pm-pass-ordini--pagamenti')).toContainText('addebita il totale');
    await expect(detail.getByTestId('pm-worklist')).toContainText('Applico lo sconto %');
    await shot(page, 'project-map-details');
    // a piece nobody described yet says how to get its text
    await view.getByTestId('pm-node-db').click();
    await expect(view.getByTestId('pm-no-details')).toBeVisible();
    // an arrow: what passes on it
    await view.getByTestId('pm-label-ordini--pagamenti').click();
    await expect(view.getByTestId('pm-link-detail')).toContainText('senza risposta entro 30 secondi');
    await shot(page, 'project-map-arrow');

    // «Aggiorna»: the request goes to the Orchestrator as the user's message; the button waits for the new version
    await view.getByTestId('pm-refresh').click();
    await expect(view.getByTestId('pm-refresh')).toBeDisabled();
    await expect(view.getByTestId('pm-refresh')).toContainText('Aggiornamento chiesto');
    await expect(view.getByTestId('pm-refresh-note')).toContainText('Chiesto all’Orchestrator'); // said inside the full screen
    await page.keyboard.press('Escape');
    await expect(page.getByText(/Aggiorna la mappa del progetto «Alfa · negozio online» \(alfa-shop\)/).first()).toBeVisible();
  } finally { await app.close(); }
});
