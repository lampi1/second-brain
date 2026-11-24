// The work maps on screen (ADR 0343), over the demo's twenty and more jobs and ideas (__sbDemo.workMaps(),
// main/demo-work-maps.ts): the list by status, search, project filter and the finished apart; a plan approved, kept for
// later, started and changed on its map; an idea written down; a finished map that moves to the archive once opened.
// Frozen demo, hidden window (SB_HIDDEN). Screenshots: test-results/shots/work-maps-*.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { choose, goPage, launchDemo, shot } from './helpers';

interface Seeded { id: string; title: string; state: string }
/** The demo's jobs, on the page that lists their maps. */
async function works(app: ElectronApplication, page: Page): Promise<(title: string) => string> {
  const all = await app.evaluate(() => (globalThis as unknown as { __sbDemo: { workMaps(): Promise<Seeded[]> } }).__sbDemo.workMaps());
  expect(all.length).toBeGreaterThanOrEqual(20);
  await goPage(page, 'collegamenti');
  // the Mappa page opens on the jobs
  await expect(page.getByTestId('wm-group-wait')).toBeVisible();
  return title => all.find(m => m.title === title)!.id;
}
const open = async (page: Page, id: string) => {
  await page.getByTestId(`wm-open-${id}`).click();
  await expect(page.getByTestId('wm-map')).toBeVisible();
};
const back = async (page: Page) => {
  await page.getByTestId('wm-back').click();
  await expect(page.getByTestId('wm-list')).toBeVisible();
};

test('the list is by status, what waits on top; search, project and the finished apart', async () => {
  const { app, page } = await launchDemo();
  try {
    const id = await works(app, page);
    const list = page.getByTestId('wm-list');
    expect(await list.locator('.wm-group').evaluateAll(l => l.map(e => e.getAttribute('data-group')))).toEqual(['wait', 'running', 'stopped', 'planned', 'idea']);
    await expect(page.getByTestId(`wm-row-${id('Codici sconto alla cassa')}`)).toContainText('Aspetta il tuo ok');
    await shot(page, 'work-maps-list');

    // words are found in titles, ideas and steps, in both tabs
    await page.getByTestId('wm-search').fill('iva sui resi');
    await expect(list.locator('.wm-row')).toHaveCount(1);
    await expect(list.locator('.wm-row')).toContainText('Correzione IVA sui resi');
    await shot(page, 'work-maps-search');
    await page.getByTestId('wm-search').fill('niente che si chiami così');
    await expect(page.getByTestId('wm-empty')).toBeVisible();
    await page.getByTestId('wm-empty').getByRole('button').click();

    // a project is a label and a filter; it is still there after a look at a map
    await choose(page.getByTestId('wm-project'), 'app-mobile');
    await expect(page.getByTestId(`wm-row-${id('Notifiche di consegna')}`)).toBeVisible();
    await expect(page.getByTestId(`wm-row-${id('Codici sconto alla cassa')}`)).toHaveCount(0);
    await shot(page, 'work-maps-filter');
    await open(page, id('Notifiche di consegna'));
    await back(page);
    await expect(page.getByTestId(`wm-row-${id('Codici sconto alla cassa')}`)).toHaveCount(0);
    await choose(page.getByTestId('wm-project'), '');

    // the finished are apart
    await list.getByRole('button', { name: /^Finite/ }).click();
    await expect(page.getByTestId('wm-group-finished')).toContainText('Lista dei desideri');
    await expect(page.getByTestId('wm-group-wait')).toHaveCount(0);
    await shot(page, 'work-maps-archive');
  } finally { await app.close(); }
});

test('a plan is approved and kept, started, or changed on its map', async () => {
  const { app, page } = await launchDemo();
  try {
    const id = await works(app, page), map = page.getByTestId('wm-map');
    // role, model and preset on the boxes, the steps of one turn together
    await open(page, id('Codici sconto alla cassa'));
    await expect(map).toHaveAttribute('data-state', 'toApprove');
    await expect(map.locator('.wm-box')).toHaveCount(5);
    await expect(map.getByTestId('wm-box-1')).toContainText('Scout');
    await map.getByTestId('wm-box-pick-3').click();
    await shot(page, 'work-maps-to-approve');
    // approved and kept: nothing starts until «Parti»
    await map.getByTestId('wm-do-keep').click();
    await expect(map).toHaveAttribute('data-state', 'planned');
    await expect(map.getByTestId('wm-note')).toContainText('parte quando premi «Parti»');
    await shot(page, 'work-maps-planned');
    await map.getByTestId('wm-do-start').click();
    await expect(map).toHaveAttribute('data-state', 'running');
    await back(page);

    // a change in the user's words: the new plan is asked for, what runs goes on
    await open(page, id('Ricerca prodotti che perdona gli errori'));
    await map.getByTestId('wm-do-replan').click();
    await map.getByTestId('wm-replan-text').fill('Aggiungi una prova con i nomi scritti male');
    await shot(page, 'work-maps-replan');
    await map.getByTestId('wm-replan-send').click();
    await expect(map.getByTestId('wm-replan')).toHaveCount(0);
  } finally { await app.close(); }
});

test('an idea alone is a map; a finished map opened once is in the archive', async () => {
  const { app, page } = await launchDemo();
  try {
    const id = await works(app, page), map = page.getByTestId('wm-map');
    await page.getByTestId('wm-idea-new').click();
    await page.getByTestId('wm-idea-title').fill('Abbonamento mensile');
    await page.getByTestId('wm-idea-text').fill('Una scatola al mese, scelta dal cliente.');
    await page.getByTestId('wm-idea-save').click();
    await expect(map).toHaveAttribute('data-state', 'idea');
    await expect(page.getByTestId('wm-title')).toHaveText('Abbonamento mensile');
    await shot(page, 'work-maps-idea');
    await back(page);

    const tab = page.getByTestId('wm-list').getByRole('button', { name: /^Finite/ });
    await expect(tab).toContainText('nuov');
    await tab.click();
    await open(page, id('Correzione IVA sui resi'));
    await expect(map).toHaveAttribute('data-state', 'archived');
    await shot(page, 'work-maps-finished');
    await back(page);
    await expect(page.getByTestId(`wm-row-${id('Correzione IVA sui resi')}`)).not.toContainText('nuova');
  } finally { await app.close(); }
});
