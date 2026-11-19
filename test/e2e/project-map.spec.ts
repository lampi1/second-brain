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
    // the plan is told in the side panel, with its percentage; the header carries it too (ADR 0326)
    await expect(view.getByTestId('pm-side').getByTestId('pm-plan')).toContainText('25%');
    await expect(view.getByTestId('pm-progress-chip')).toContainText('25%');
    await expect(view.getByTestId('pm-plan-ask')).toHaveCount(0);
    await expect(view.getByTestId('pm-node-note-di-rilascio')).toBeVisible();
    await view.getByTestId('pm-node-negozio').click();
    await expect(view.getByTestId('pm-works-ordini')).toContainText('Applico lo sconto % sul prezzo pieno'); // the step under way first (ADR 0302)
    await expect(view.getByTestId('pm-works-ordini')).toContainText('1/3 fatti');
    await shot(page, 'project-map-plan');
    // a plan that waits for the user: the pieces dashed, the approval on the map
    await app.evaluate(() => { const d = (globalThis as unknown as { __sbDemo: { plan(id: string, p: unknown): void } }).__sbDemo; d.plan('tree-plan', { phase: 'proposed', at: 5, map: 'alfa-shop', clarified: [], steps: [{ title: 'Scrivo i resi parziali', role: 'artisan', state: 'todo', on: 'rimborsi' }] }); });
    // one line over the drawing holds the approval; every step is open in the side panel
    await expect(view.getByTestId('pm-plan-ask').getByTestId('pm-plan-approve')).toBeVisible();
    await expect(view.getByTestId('pm-stepcard-1')).toContainText('su Rimborsi');
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
    // the plan's steps in order, one row each in the side panel (ADR 0326): the third and the fourth go together
    const flow = view.getByTestId('pm-flow');
    await expect(flow.getByTestId('pm-step-2')).toHaveAttribute('data-s', 'now');
    await expect(flow.locator('.pm-planstep')).toHaveCount(4);
    await flow.getByTestId('pm-step-head-3').click();
    await expect(flow.getByTestId('pm-stepcard-3')).toContainText('Va insieme al passo 4.');
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
    await flow.getByTestId('pm-step-head-4').click();
    await flow.getByTestId('pm-stepcard-on-4').click();
    await expect(view.getByTestId('pm-detail')).toContainText('Note di rilascio');
    // the projects are a list beside the drawing, not a menu
    const nav = view.getByTestId('pm-nav');
    await expect(nav.getByRole('button')).toHaveCount(3);
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
    await expect(view.getByTestId('pm-step-2')).toContainText('in corso');
    await expect(now).toContainText('lo fa Artisan');
    await expect(now).toContainText('su Ordini e sconti');
    await expect(view.getByTestId('pm-stepcard-1')).toHaveCount(0);
    // any other on a click on its row: the two that go together say so
    for (const n of [1, 3, 4]) await view.getByTestId(`pm-step-head-${n}`).click();
    for (const n of [1, 2, 3, 4]) await expect(view.getByTestId(`pm-stepcard-${n}`)).toBeVisible();
    await expect(view.getByTestId('pm-stepcard-1')).toContainText('Parte per primo.');
    await expect(view.getByTestId('pm-stepcard-3')).toContainText('Va insieme al passo 4.');
    await shot(page, 'project-map-steps');
    await view.getByTestId('pm-step-head-1').click();
    await expect(view.getByTestId('pm-stepcard-1')).toHaveCount(0);

    // into the shop: with nothing picked, the side tells the system on screen
    await view.getByTestId('pm-node-negozio').click();
    await expect(view.getByTestId('pm-here')).toContainText('Come funziona');
    await expect(view.getByTestId('pm-here')).toContainText('Dentro ci sono cinque parti');
    // a part with pieces of its own (ADR 0316): entered like a system; the side tells how it works, its rules, what it
    // keeps, why, its key files, what goes in and out (each passage with what it carries), the plan's steps on it
    await view.getByTestId('pm-node-ordini').click();
    for (const id of ['totale', 'sconti', 'conferma']) await expect(view.getByTestId(`pm-node-${id}`)).toBeVisible();
    const detail = view.getByTestId('pm-here');
    await expect(detail).toContainText('arrotonda una volta sola alla fine');
    await expect(detail.getByTestId('pm-rules')).toContainText('Si arrotonda una volta sola');
    await expect(detail.getByTestId('pm-keeps')).toContainText('OrderLines');
    await expect(detail.getByTestId('pm-why')).toContainText('una modifica ne crea uno nuovo');
    await expect(detail.getByTestId('pm-keyfile-src/Orders/Checkout.cs')).toBeVisible();
    await expect(detail.getByTestId('pm-pass-carrello--ordini')).toContainText('Quando il cliente preme «Paga»');
    await expect(detail.getByTestId('pm-pass-ordini--pagamenti')).toContainText('addebita il totale');
    await expect(detail.getByTestId('pm-worklist')).toContainText('Applico lo sconto %');
    await expect(detail.getByTestId('pm-paths-here')).toContainText('Cosa succede quando un cliente paga?');
    await shot(page, 'project-map-details');
    // a path: its stops one by one, the view follows each to its level, the boxes of the path lit
    await detail.getByTestId('pm-paths-here').getByRole('button', { name: 'Cosa succede quando un cliente paga?' }).click();
    await expect(view.getByTestId('pm-stop-now')).toContainText('Somma le righe');
    await expect(view.getByTestId('pm-node-totale')).toHaveClass(/stop-now/);
    await expect(view.getByTestId('pm-node-sconti')).toHaveClass(/on-path/);
    await shot(page, 'project-map-path');
    await view.getByTestId('pm-walk-next').click();
    await view.getByTestId('pm-walk-next').click();
    await view.getByTestId('pm-walk-next').click();
    await expect(view.getByTestId('pm-stop-now')).toContainText('Il gateway risponde');
    await expect(view.getByTestId('pm-node-pagamenti')).toHaveClass(/stop-now/);
    await expect(view.getByTestId('pm-node-carrello')).toHaveCount(0); // back at the top
    await view.getByTestId('pm-walk-close').click();
    await expect(view.getByTestId('pm-walk')).toHaveCount(0);
    await view.getByTestId('pm-node-negozio').click();
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

// Issue #443, ADR 0322: a project told as a sequence. The phases are a line in the saved order, numbered, with the
// plain arrow to the next; inside a phase the steps are a line too, two of them together; a step's panel tells its
// status, proofs and links, a phase's lists its steps, each opened by a click; the panel is dragged wider by its left
// edge and the width is remembered, the drawing keeping its room.
test('a map of phases is a line, the steps inside too; the panel tells proofs and steps and is resized', async () => {
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'collegamenti');
    await page.getByTestId('bm-map-page').getByRole('button', { name: 'Progetti', exact: true }).click();
    const view = page.getByTestId('pm-view');
    await view.getByTestId('pm-nav-gamma-migrazione').click();
    await expect(view.getByTestId('pm-level')).toHaveAttribute('data-layout', 'linear');
    const ids = ['analisi', 'preparazione', 'migrazione', 'verifica'];
    const boxes = await Promise.all(ids.map(async id => (await view.getByTestId(`pm-node-${id}`).boundingBox())!));
    for (let i = 1; i < boxes.length; i++) { expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x + boxes[i - 1]!.width - 1); expect(Math.abs(boxes[i]!.y - boxes[0]!.y)).toBeLessThan(2); }
    for (const [i, id] of ids.entries()) await expect(view.getByTestId(`pm-ord-${id}`)).toHaveText(String(i + 1));
    await expect(view.getByTestId('pm-next-analisi-preparazione')).toHaveCount(1);
    // the arrows to the next phase say nothing, least of all «da capire»; the only label is on the way back
    await expect(view.locator('.pm-label')).toHaveCount(1);
    await expect(view.getByTestId('pm-label-verifica--preparazione')).toHaveText('se un controllo fallisce');
    await shot(page, 'project-map-phases');

    // into a phase: its steps in a line, two together; the panel lists them, each with its status
    await view.getByTestId('pm-node-preparazione').click();
    await expect(view.getByTestId('pm-level')).toHaveAttribute('data-layout', 'linear');
    for (const [id, n] of [['script', '1'], ['ripristino', '2'], ['avviso', '2'], ['via-libera', '3']] as const) await expect(view.getByTestId(`pm-ord-${id}`)).toHaveText(n);
    await expect(view.getByTestId('pm-par-avviso')).toBeVisible();
    await expect(view.getByTestId('pm-par-script')).toHaveCount(0);
    const [a, b] = [(await view.getByTestId('pm-node-ripristino').boundingBox())!, (await view.getByTestId('pm-node-avviso').boundingBox())!];
    expect(Math.abs(a.x - b.x)).toBeLessThan(2); expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    await expect(view.getByTestId('pm-label-ripristino--via-libera')).toHaveText('solo se riesce');
    await expect(view.getByTestId('pm-here')).toContainText('I suoi passi');
    await expect(view.getByTestId('pm-here').getByTestId('pm-no-details')).toHaveCount(0);
    // a sub-step opens its own detail: status, proofs, the address of a proof; no empty section
    await view.getByTestId('pm-here').getByTestId('pm-part-script').getByRole('button').click();
    const detail = view.getByTestId('pm-detail');
    await expect(detail).toContainText('Script di copia');
    await expect(detail.getByTestId('pm-proofs')).toContainText('36 script, tutti passati');
    await expect(detail.getByTestId('pm-proof-link-0')).toBeVisible();
    await expect(detail.getByText('Come funziona')).toHaveCount(0);
    await expect(detail.getByTestId('pm-refs')).toHaveCount(0);
    await shot(page, 'project-map-step-detail');

    // the panel (full screen: beside the drawing): wider from its left edge, remembered, and the drawing keeps its room
    await view.getByTestId('pm-fullscreen').click();
    await expect(view).toHaveClass(/pm-full/);
    await shot(page, 'project-map-steps-full');
    const wrap = view.getByTestId('pm-sidewrap'), handle = view.getByTestId('pm-resize');
    const w0 = (await wrap.boundingBox())!.width;
    await handle.focus();
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await wrap.boundingBox())!.width).toBeGreaterThan(w0 + 20);
    const w1 = (await wrap.boundingBox())!.width;
    expect(await page.evaluate(() => Number(localStorage.getItem('sb.projectMap.sideWidth')))).toBeGreaterThan(w0);
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
    expect((await view.getByTestId('pm-canvas').boundingBox())!.width).toBeGreaterThanOrEqual(319);
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await wrap.boundingBox())!.width).toBeLessThan(w1);
    expect((await wrap.boundingBox())!.width).toBeGreaterThanOrEqual(279);
    await handle.dblclick();
    await expect.poll(async () => Math.round((await wrap.boundingBox())!.width)).toBe(Math.round(w0));
    // dragged by its left edge: 120 px to the left make it 120 px wider, and that width is kept; a click alone keeps it
    const edge = (await handle.boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
    await page.mouse.down(); await page.mouse.move(edge.x + edge.width / 2 - 120, edge.y + 200, { steps: 4 }); await page.mouse.up();
    await expect.poll(async () => Math.round((await wrap.boundingBox())!.width)).toBe(Math.round(w0) + 120);
    expect(await page.evaluate(() => Number(localStorage.getItem('sb.projectMap.sideWidth')))).toBe(Math.round(w0) + 120);
    await handle.click();
    expect(await page.evaluate(() => Number(localStorage.getItem('sb.projectMap.sideWidth')))).toBe(Math.round(w0) + 120);
    // back to the phases, the whole line on screen: the way back from «Verifica» runs under the boxes, behind none
    await view.getByTestId('pm-up').click();
    await expect(view.getByTestId('pm-node-verifica')).toBeVisible();
    await expect(view.getByTestId('pm-label-verifica--preparazione')).toBeVisible();
    await shot(page, 'project-map-phases-full');
  } finally { await app.close(); }
});

// ADR 0326 (the owner 2026-11-19): «le mappe servono per tracciare l'andamento di un piano, sarebbe bello ci fosse anche
// un progressivo, una percentuale, e più dettagli nella parte dx». The percentage in the header, the progress card in
// the side panel (where the project is, what is under way, what comes next, every phase with its bar), each phase's
// own count on its box and in its panel; nothing over the drawing.
test('the map tells how far the project is: the percentage, the phase under way, each phase with its bar', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('maps-btn').click();
    const view = page.getByTestId('pm-view');
    await view.getByTestId('pm-nav-gamma-migrazione').click();
    const card = view.getByTestId('pm-progress');
    await expect(view.getByTestId('pm-progress-chip')).toContainText('40%');
    await expect(card.getByTestId('pm-progress-pct')).toHaveText('40%');
    await expect(card).toContainText('4 di 10 passi fatti · 1 di 4 fasi chiuse');
    await expect(card.getByTestId('pm-progress-at')).toContainText('Preparazione');
    await expect(card.getByTestId('pm-progress-now')).toContainText('Prova di ripristino');
    await expect(card.getByTestId('pm-progress-now')).toContainText('Ripristino a metà: mancano gli allegati');
    await expect(card.getByTestId('pm-progress-next')).toContainText('Via libera');
    await expect(card.getByTestId('pm-progress-groups').locator('li')).toHaveCount(4);
    await expect(card.getByTestId('pm-progress-group-analisi')).toContainText('2/2');
    // each phase wears its own count on its box
    await expect(view.getByTestId('pm-count-preparazione')).toHaveText('2/4');
    await expect(view.getByTestId('pm-count-verifica')).toHaveCount(0); // nothing inside it
    await expect(view.locator('.pm-plancard, .pm-planask')).toHaveCount(0); // no plan here, and nothing over the drawing
    await shot(page, 'project-map-progress');
    // into a phase from its row: the card folds to its first lines, the phase tells its own count
    await card.getByTestId('pm-progress-group-preparazione').click();
    await expect(view.getByTestId('pm-node-ripristino')).toBeVisible();
    await expect(card.getByTestId('pm-progress-groups')).toHaveCount(0);
    await expect(card.getByTestId('pm-progress-pct')).toHaveText('40%');
    await expect(view.getByTestId('pm-here-progress')).toContainText('50%');
    await expect(view.getByTestId('pm-here-progress')).toContainText('2 di 4 passi fatti');
    await card.getByTestId('pm-progress-more').click();
    await expect(card.getByTestId('pm-progress-groups')).toBeVisible();
    await shot(page, 'project-map-progress-phase');
    // a map that is a picture of a system, with no plan on it, has no progress
    await view.getByTestId('pm-nav-beta-crm').click();
    await expect(view.getByTestId('pm-node-crm')).toBeVisible();
    await expect(view.getByTestId('pm-progress')).toHaveCount(0);
    await expect(view.getByTestId('pm-progress-chip')).toHaveCount(0);
  } finally { await app.close(); }
});
