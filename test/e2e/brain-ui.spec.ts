// End-to-end: the brain area of the UI (src/renderer/brain) in the real app, pointed (SB_BRAIN) at a temporary
// synthetic brain whose data server is test/fixtures/brain-ui/brain-site.mjs (the real API shapes, fictional data).
// Every section is rendered through the test route (#brain-test/<page>), its key content asserted, and one screenshot
// saved per section in test-results/shots/brain-*.png (Qualità: its demo shot is in qualita.spec.ts); then the 3D map (WebGL), its 2D fallback and a flow, the
// error state, the virtualized table, the side peek with the keyboard, and the light theme.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, shot } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');

function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-brain-ui-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}

let app: ElectronApplication, page: Page, brain: string;

async function open(target: string, reload = false): Promise<void> {
  await page.evaluate(([t, r]) => { location.hash = `#brain-test/${t}`; if (r) location.reload(); }, [target, reload] as const);
  if (reload) await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('brain-test')).toBeVisible();
}
/** wait until no skeleton is left on the page (every read answered) */
async function settled(): Promise<void> {
  await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30000 });
  await page.waitForTimeout(250);
}


test.beforeAll(async () => {
  brain = fixtureBrain();
  ({ app, page } = await launch({ SB_BRAIN: brain }));
  await page.emulateMedia({ colorScheme: "dark" }); // the app default; one light shot at the end
  await expect(page.getByTestId('app')).toBeVisible();
  await open('fatto', true);
});
test.afterAll(async () => { await app?.close(); });

test('Oggi and Adesso are gone: their old links open DevOps', async () => {
  await open('home');
  await expect(page.getByTestId('brain-page-devops')).toBeVisible();
  await open('adesso');
  await expect(page.getByTestId('brain-page-devops')).toBeVisible();
});

test('Fatto e standup: done by topic with DevOps links, diary table, another day', async () => {
  await open('fatto');
  const p = page.getByTestId('brain-page-fatto');
  await settled();
  await expect(p.getByRole('heading', { name: 'Fatto oggi' })).toBeVisible();
  await expect(p.getByRole('link', { name: 'apply the discount once' })).toHaveAttribute('href', /pullrequest\/51001$/);
  await expect(p.getByTestId('bx-standup')).toBeVisible();
  // only the work Regia's work: the app's own chats, diary lines, threads and commits are left out (lib/appwork.ts)
  await expect(p.getByTestId('bx-standup')).toContainText('Export fatture');
  await expect(p).not.toContainText('Pagina Procedure');
  await expect(p).not.toContainText("Regia dell'app");
  await p.locator('summary', { hasText: 'Dettaglio tecnico' }).click();
  await expect(p).toContainText('2 commit');
  await expect(p).toContainText('QA ordini');
  await shot(page, 'brain-fatto');
  await p.getByRole('button', { name: 'Giorno prima' }).click();
  await expect(p.getByRole('heading', { name: 'Fatto ieri' })).toBeVisible();
  await settled();
  await expect(p.getByTestId('bx-diary')).toContainText('Login scaduto sul nodo di test');
});

test('Idee: table with filters (state, area, who), side peek by keyboard, Esc closes it', async () => {
  await open('idee');
  const p = page.getByTestId('brain-page-idee');
  await settled();
  await expect(p.getByTestId('bx-table-idee')).toContainText('9 righe');
  await p.getByLabel('Filtra per Chi').selectOption('IA');
  await expect(p.getByTestId('bx-table-idee')).toContainText('4 di 9 righe');
  await p.getByLabel('Filtra per Chi').selectOption('');
  const grid = p.getByRole('grid', { name: 'Idee' });
  await grid.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(p.getByTestId('bx-peek')).toBeVisible();
  await page.waitForTimeout(300); // the peek slides in
  await shot(page, 'brain-idee');
  await page.keyboard.press('Escape');
  await expect(p.getByTestId('bx-peek')).toHaveCount(0);
});

test("Idee · Dall'IA: the AI's ideas with their reasoning in the peek, filter by audience, reflections below; old spunti links land here", async () => {
  await open('spunti/riflessioni');
  const p = page.getByTestId('brain-page-idee');
  await settled();
  await expect(p.getByTestId('bx-tab-ia')).toHaveAttribute('aria-selected', 'true');
  await expect(p.getByTestId('bx-table-idee')).toContainText('4 righe');
  await expect(p.getByLabel('Filtra per Per')).toBeVisible();
  await expect(p.getByTestId('bx-riflessione')).toHaveCount(2);
  await p.getByRole('row').filter({ hasText: 'Rileggere i propri errori' }).click();
  await expect(p.getByTestId('bx-peek').getByTestId('bx-reason')).toContainText('Ho notato');
  await page.waitForTimeout(300);
  await shot(page, 'brain-idee-ia');
  await page.keyboard.press('Escape');
  await p.getByTestId('bx-tab-mie').click();
  await expect(p.getByTestId('bx-tab-mie')).toHaveAttribute('aria-selected', 'true');
  await expect(p.getByTestId('bx-table-idee')).toContainText('5 righe');
  await expect(p.getByTestId('bx-riflessione')).toHaveCount(0);
  await p.getByTestId('bx-tab-tutte').click();
  await expect(p.getByTestId('bx-table-idee')).toContainText('9 righe');
});

test('Costi: KPIs, savings, charts by day / kind / model / area, chats table; period switch', async () => {
  await open('costi');
  const p = page.getByTestId('brain-page-costi');
  await settled();
  await expect(p.getByTestId('bx-lead')).toContainText('in 7 giorni');
  await expect(p.getByTestId('bx-advice')).toContainText('Chat lunghe');
  for (const c of ['spesa-giorni-7', 'spesa-tipo-7', 'spesa-modello-7', 'spesa-area-7']) await expect(p.getByTestId(`bx-chart-${c}`).locator('svg[role=img]')).toBeVisible();
  await expect(p.getByTestId('bx-cost-chats')).toContainText('Regia');
  await expect(p.getByTestId('bx-cost-live')).toContainText('Adesso'); // today's chats by cost, live, above the history
  await shot(page, 'brain-costi');
  await p.getByTestId('bx-chart-spesa-chat-7').scrollIntoViewIfNeeded();
  await shot(page, 'brain-costi-chat');
  await p.getByRole('button', { name: '30 giorni' }).click();
  await expect(p.getByTestId('bx-lead')).toContainText('in 30 giorni');
});

test('Qualità: four metrics with their source (errors caught, rules, PRs, reopened bugs) and proposals in one row', async () => {
  await open('qualita');
  const p = page.getByTestId('brain-page-qualita');
  await settled();
  for (const id of ['trovati', 'tornati', 'pr', 'riaperti']) await expect(p.getByTestId(`bx-q-${id}`)).toContainText('Fonte:');
  await expect(p.getByTestId('bx-q-tornati')).toContainText('2 su 4');
  await expect(p.getByTestId('bx-q-fuori')).toContainText('7 righe su 49 fuori dal conteggio: 3 illeggibili');
  // no DevOps in this run: the PRs card says so, the reopened bugs one says the read is off
  await expect(p.getByTestId('bx-q-riaperti')).toContainText('lettura DevOps spenta');
  await expect(p.getByTestId('bx-q-proposte')).toContainText('Proposte di miglioramento: 34');
  for (const gone of ['lodi', 'taccuini', 'misure', 'bug']) await expect(p.getByTestId(`bx-tab-${gone}`)).toHaveCount(0);
  await shot(page, 'brain-qualita');
});

test('Confronto: the comparison report rendered, files to open and download', async () => {
  await open('confronto');
  const p = page.getByTestId('brain-page-confronto');
  await settled();
  await expect(p.getByTestId('bx-compare-report')).toContainText('Claude · reviewer');
  await expect(p.getByRole('button', { name: 'Tabella in CSV' })).toBeVisible();
  await expect(p.getByTestId('bx-table-file-confronto')).toContainText('pr-51002.md');
  await shot(page, 'brain-confronto');
});

test('Esplora: tree, file preview with links to other files, word search', async () => {
  await open('esplora/AGENTS.md');
  const p = page.getByTestId('brain-page-esplora');
  await settled();
  await expect(p.getByTestId('bx-file-md')).toContainText('Produzione');
  await p.getByTestId('bx-file-md').getByRole('link', { name: 'map.md' }).click();
  await expect(p.getByTestId('bx-viewer')).toContainText('Mappa della memoria');
  await p.getByLabel('Cerca nei file').fill('reviewer');
  await p.getByRole('button', { name: 'Cerca', exact: true }).click();
  await expect(p.getByTestId('bx-hits')).toContainText('risultati per «reviewer»');
  await shot(page, 'brain-esplora');
  await p.getByTestId('bx-hits').getByRole('button', { name: /ops\/tools\/cost\.mjs|playbooks\/reviewer\.md/ }).first().click();
  await expect(p.getByTestId('bx-viewer')).toBeVisible();

  // a hostile markdown file: no script runs, no element keeps a link that could navigate the app window
  await open('esplora/notes/trappola.md');
  await expect(p.getByTestId('bx-file-md')).toContainText('relativo');
  const leaks = await page.evaluate(() => {
    const md = document.querySelector('[data-testid="bx-file-md"]')!;
    const links = [...md.querySelectorAll('*')].flatMap(el => el.getAttributeNames().filter(n => /href|action|usemap/i.test(n)).map(n => `${el.tagName}:${n}=${el.getAttribute(n)}`));
    return { links, tags: md.querySelectorAll('area, map, base, script, form, button').length, pwned: (window as unknown as { __pwned?: number }).__pwned ?? null, url: location.href };
  });
  expect(leaks.links).toEqual(['A:href=https://example.com']);
  expect(leaks.tags).toBe(0);
  expect(leaks.pwned).toBeNull();
  expect(leaks.url).toMatch(/^file:.*index\.html#brain-test\/esplora/);
  await expect(p.getByRole('link', { name: 'esterno' })).toHaveAttribute('target', '_blank');
});

test('Mappa: direct exploration, optional filters, keyboard and accessible fallback without a player', async () => {
  await open('mappa');const m=page.getByTestId('brain-map');await expect(m).toBeVisible();
  await expect(m.locator('.bx-map-msg')).toHaveCount(0,{timeout:30000});
  await expect(m.getByTestId('bx-map-menu')).toHaveCount(0);await expect(m.getByTestId('bx-map-player')).toHaveCount(0);
  const canvas=m.getByTestId('bx-map-canvas');
  if(await canvas.count()){
    await expect.poll(async()=>Number(await canvas.getAttribute('data-map-visible-names'))).toBeGreaterThan(0);
    const gl=canvas.locator('canvas');await expect(gl).toHaveCount(1);await page.emulateMedia({reducedMotion:'reduce'});await canvas.focus();
    let previous:Buffer=Buffer.alloc(0),stable=0;
    await expect.poll(async()=>{const current=await gl.screenshot();stable=current.equals(previous)?stable+1:0;previous=current;return stable;},{timeout:20000,intervals:[150]}).toBeGreaterThanOrEqual(3);
    const original=await gl.screenshot();await page.keyboard.press('ArrowRight');
    await expect.poll(async()=>(await gl.screenshot()).equals(original)).toBe(false);
    await page.keyboard.press('Home');await expect.poll(async()=>(await gl.screenshot()).equals(original)).toBe(true);
    await page.keyboard.press('+');await expect.poll(async()=>(await gl.screenshot()).equals(original)).toBe(false);
    await page.keyboard.press('Home');await expect.poll(async()=>(await gl.screenshot()).equals(original)).toBe(true);
  }else await expect(m.getByTestId('bx-map-flat')).toBeVisible();
  await shot(page,'brain-map-direct');
  await expect(m.getByRole('button',{name:'Filtri',exact:true})).toHaveCount(0);
  await expect(m.locator('.bx-map-panel')).toHaveCount(0);
  await m.getByTestId('bx-map-view').click();await expect(m.getByTestId('bx-map-view')).toHaveText('Vista essenziale');
  await m.getByTestId('bx-map-close').click();await expect(m).toHaveCount(0);
  await open('mappa?flat');const flat=page.getByTestId('bx-map-flat');await expect(flat).toContainText('mem.mjs');
  const chosen=flat.getByRole('button',{name:/reviewer/});await chosen.focus();await page.keyboard.press('Enter');await expect(page.getByTestId('bx-map-piece')).toContainText('Verso');
  await expect(page.getByRole('button',{name:'Chiudi la scheda'})).toBeFocused();await page.getByRole('button',{name:'Chiudi la scheda'}).click();await expect(chosen).toBeFocused();
  await chosen.click();await expect(page.getByTestId('bx-map-piece')).toHaveClass('bx-map-context');await expect(page.locator('.bx-map-panel')).toHaveCount(0);
  await shot(page,'brain-map-flat');await page.getByTestId('bx-map-close').click();
});

test('States: a failing data source shows its cause and Riprova; light theme follows the app', async () => {
  fs.writeFileSync(path.join(brain, 'FAIL_tables'), '');
  await open('idee', true);
  const p = page.getByTestId('brain-page-idee');
  await expect(p.getByTestId('bx-error')).toContainText('errore simulato');
  await shot(page, 'brain-error');
  fs.rmSync(path.join(brain, 'FAIL_tables'));
  await p.getByRole('button', { name: 'Riprova' }).click();
  await expect(p.getByTestId('bx-table-idee')).toBeVisible({ timeout: 15000 });

  await page.emulateMedia({ colorScheme: 'light' });
  await open('fatto');
  await settled();
  await shot(page, 'brain-fatto-light');
  await page.emulateMedia({ colorScheme: 'dark' });
});
