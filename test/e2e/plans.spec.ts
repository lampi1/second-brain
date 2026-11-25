// The plans on screen (ADR 0343), over the demo's twenty and more jobs and ideas (__sbDemo.plans(),
// main/demo-plans.ts): the list by status, search, project filter and the finished apart; a plan approved, kept for
// later, started and changed on its map; an idea written down; a finished map that moves to the archive once opened.
// Frozen demo, hidden window (SB_HIDDEN). Screenshots: test-results/shots/plans-*.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { choose, goPage, launchDemo, shot } from './helpers';

interface Seeded { id: string; title: string; state: string }
/** The demo's jobs, on the page that lists their maps. */
async function works(app: ElectronApplication, page: Page): Promise<(title: string) => string> {
  const all = await app.evaluate(() => (globalThis as unknown as { __sbDemo: { plans(): Promise<Seeded[]> } }).__sbDemo.plans());
  expect(all.length).toBeGreaterThanOrEqual(20);
  await goPage(page, 'collegamenti');
  // the Mappa page opens on the jobs
  await expect(page.getByTestId('pl-group-wait')).toBeVisible();
  return title => all.find(m => m.title === title)!.id;
}
const open = async (page: Page, id: string) => {
  await page.getByTestId(`pl-open-${id}`).click();
  await expect(page.getByTestId('pl-map')).toBeVisible();
};
const back = async (page: Page) => {
  await page.getByTestId('pl-back').click();
  await expect(page.getByTestId('pl-list')).toBeVisible();
};

test('the list is by status, what waits on top; search, project and the finished apart', async () => {
  const { app, page } = await launchDemo();
  try {
    const id = await works(app, page);
    const list = page.getByTestId('pl-list');
    expect(await list.locator('.pl-group').evaluateAll(l => l.map(e => e.getAttribute('data-group')))).toEqual(['wait', 'running', 'stopped', 'planned', 'idea']);
    await expect(page.getByTestId(`pl-row-${id('Codici sconto alla cassa')}`)).toContainText('Aspetta il tuo ok');
    await shot(page, 'plans-list');

    // words are found in titles, ideas and steps, in both tabs
    await page.getByTestId('pl-search').fill('iva sui resi');
    await expect(list.locator('.pl-row')).toHaveCount(1);
    await expect(list.locator('.pl-row')).toContainText('Correzione IVA sui resi');
    await shot(page, 'plans-search');
    await page.getByTestId('pl-search').fill('niente che si chiami così');
    await expect(page.getByTestId('pl-empty')).toBeVisible();
    await page.getByTestId('pl-empty').getByRole('button').click();

    // a project is a label and a filter; it is still there after a look at a map
    await choose(page.getByTestId('pl-project'), 'app-mobile');
    await expect(page.getByTestId(`pl-row-${id('Notifiche di consegna')}`)).toBeVisible();
    await expect(page.getByTestId(`pl-row-${id('Codici sconto alla cassa')}`)).toHaveCount(0);
    await shot(page, 'plans-filter');
    await open(page, id('Notifiche di consegna'));
    await back(page);
    await expect(page.getByTestId(`pl-row-${id('Codici sconto alla cassa')}`)).toHaveCount(0);
    await choose(page.getByTestId('pl-project'), '');

    // the finished are apart
    await list.getByRole('button', { name: /^Finite/ }).click();
    await expect(page.getByTestId('pl-group-finished')).toContainText('Lista dei desideri');
    await expect(page.getByTestId('pl-group-wait')).toHaveCount(0);
    await shot(page, 'plans-archive');
  } finally { await app.close(); }
});

test('a plan is approved and kept, started, or changed on its map', async () => {
  const { app, page } = await launchDemo();
  try {
    const id = await works(app, page), map = page.getByTestId('pl-map');
    // role, model and preset on the boxes, the steps of one turn together
    await open(page, id('Codici sconto alla cassa'));
    await expect(map).toHaveAttribute('data-state', 'toApprove');
    await expect(map.locator('.pl-box')).toHaveCount(5);
    await expect(map.getByTestId('pl-box-1')).toContainText('Scout');
    await map.getByTestId('pl-box-pick-3').click();
    await shot(page, 'plans-to-approve');
    // approved and kept: nothing starts until «Parti»
    await map.getByTestId('pl-do-keep').click();
    await expect(map).toHaveAttribute('data-state', 'planned');
    await expect(map.getByTestId('pl-note')).toContainText('parte quando premi «Parti»');
    await shot(page, 'plans-planned');
    await map.getByTestId('pl-do-start').click();
    await expect(map).toHaveAttribute('data-state', 'running');
    await back(page);

    // a change in the user's words: the new plan is asked for, what runs goes on
    await open(page, id('Ricerca prodotti che perdona gli errori'));
    await map.getByTestId('pl-do-replan').click();
    await map.getByTestId('pl-replan-text').fill('Aggiungi una prova con i nomi scritti male');
    await shot(page, 'plans-replan');
    await map.getByTestId('pl-replan-send').click();
    await expect(map.getByTestId('pl-replan')).toHaveCount(0);
  } finally { await app.close(); }
});

test('an idea alone is a map; a finished map opened once is in the archive', async () => {
  const { app, page } = await launchDemo();
  try {
    const id = await works(app, page), map = page.getByTestId('pl-map');
    await page.getByTestId('pl-idea-new').click();
    await page.getByTestId('pl-idea-title').fill('Abbonamento mensile');
    await page.getByTestId('pl-idea-text').fill('Una scatola al mese, scelta dal cliente.');
    await page.getByTestId('pl-idea-save').click();
    await expect(map).toHaveAttribute('data-state', 'idea');
    await expect(page.getByTestId('pl-title')).toHaveText('Abbonamento mensile');
    await shot(page, 'plans-idea');
    await back(page);

    const tab = page.getByTestId('pl-list').getByRole('button', { name: /^Finite/ });
    await expect(tab).toContainText('nuov');
    await tab.click();
    await open(page, id('Correzione IVA sui resi'));
    await expect(map).toHaveAttribute('data-state', 'archived');
    await shot(page, 'plans-finished');
    await back(page);
    await expect(page.getByTestId(`pl-row-${id('Correzione IVA sui resi')}`)).not.toContainText('nuova');
  } finally { await app.close(); }
});
