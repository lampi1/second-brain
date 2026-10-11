// End-to-end: the brain area of the UI (src/renderer/brain) in the real app, pointed (SB_BRAIN) at a temporary
// synthetic brain whose data server is test/fixtures/brain-ui/brain-site.mjs (the real API shapes, fictional data).
// Every section is rendered through the test route (#brain-test/<page>), its key content asserted, and one screenshot
// saved per section in test-results/shots/brain-*.png; then the 3D map (WebGL), its 2D fallback and a flow, the
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
  await open('home', true);
});
test.afterAll(async () => { await app?.close(); });

test('Oggi: tiles (waiting, working, spend, AI ideas), done today, stand-up, map entry', async () => {
  await open('home');
  const p = page.getByTestId('brain-page-home');
  await settled();
  await expect(p.getByTestId('bx-lead')).toContainText('chat ti aspettano');
  await expect(p.getByTestId('bx-tile-wait')).toContainText('QA ordini');
  await expect(p.getByTestId('bx-tile-live')).toContainText('Prodotto · Fix calcolo sconto');
  await expect(p.getByTestId('bx-tile-cost')).toContainText('38 $');
  await expect(p.getByTestId('bx-tile-ai')).toContainText('Rileggere i propri errori');
  await expect(p.getByTestId('bx-home-done')).toContainText('PR unita');
  await expect(p.getByTestId('bx-standup')).toContainText('Oggi:');
  await expect(p.getByTestId('bx-standup')).not.toContainText('Alex decide');
  await shot(page, 'brain-home');
});

test('Adesso: chats waiting first, working, finished folded; next step and last message; message box needs the Regia', async () => {
  await open('adesso');
  const p = page.getByTestId('brain-page-adesso');
  await settled();
  await expect(p.getByTestId('bx-group-wait')).toContainText('QA ordini');
  await expect(p.getByTestId('bx-group-wait')).toContainText('Tu: «riprendi dal test case 7»');
  await expect(p.getByTestId('bx-group-live')).toContainText('Ho trovato la causa');
  // a DevOps number in a now.md line became a named link
  await expect(p.getByTestId('bx-group-live').getByRole('link', { name: /Sconto applicato due volte/ }).first()).toHaveAttribute('target', '_blank');
  await expect(p.getByTestId('bx-group-rest')).toContainText('Finite o ferme');
  await expect(p.getByTestId('bx-composer-off')).toBeVisible();
  await shot(page, 'brain-adesso');
});

test('Fatto e standup: done by topic with DevOps links, diary table, another day', async () => {
  await open('fatto');
  const p = page.getByTestId('brain-page-fatto');
  await settled();
  await expect(p.getByRole('heading', { name: 'Fatto oggi' })).toBeVisible();
  await expect(p.getByRole('link', { name: 'apply the discount once' })).toHaveAttribute('href', /pullrequest\/51001$/);
  await expect(p.getByTestId('bx-standup')).toBeVisible();
  await shot(page, 'brain-fatto');
  await p.getByRole('button', { name: 'Giorno prima' }).click();
  await expect(p.getByRole('heading', { name: 'Fatto ieri' })).toBeVisible();
  await settled();
  await expect(p.getByTestId('bx-diary')).toContainText('Login scaduto sul nodo di test');
});

test('Da fare: decisions first, open work by topic (PR named after its bug), AI-found bugs apart, due ideas, threads', async () => {
  await open('dafare');
  const p = page.getByTestId('brain-page-dafare');
  await settled();
  await expect(p.getByTestId('bx-decisions')).toContainText('Clienti · Export fatture');
  await expect(p.getByTestId('bx-todo')).toContainText('Sconto applicato due volte sul totale');
  await expect(p.getByTestId('bx-todo')).toContainText("Bug trovati dall'IA");
  await expect(p).toContainText('Idee da riprendere');
  await shot(page, 'brain-dafare');
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

test("Spunti dell'IA: reasoning cards by audience, reflections tab", async () => {
  await open('spunti');
  const p = page.getByTestId('brain-page-spunti');
  await settled();
  await expect(p.getByTestId('bx-spunto').first()).toContainText('Ho notato');
  await expect(p).toContainText('Per te');
  await shot(page, 'brain-spunti');
  await p.getByTestId('bx-tab-riflessioni').click();
  await expect(p.getByTestId('bx-riflessione')).toHaveCount(2);
});

test('Costi: KPIs, savings, charts by day / kind / model / area, chats table, estimates; period switch', async () => {
  await open('costi');
  const p = page.getByTestId('brain-page-costi');
  await settled();
  await expect(p.getByTestId('bx-lead')).toContainText('in 7 giorni');
  await expect(p.getByTestId('bx-advice')).toContainText('Chat lunghe');
  for (const c of ['spesa-giorni-7', 'spesa-tipo-7', 'spesa-modello-7', 'spesa-area-7']) await expect(p.getByTestId(`bx-chart-${c}`).locator('svg[role=img]')).toBeVisible();
  await expect(p.getByTestId('bx-cost-chats')).toContainText('Regia');
  await expect(p.getByTestId('bx-estimates')).toContainText('Ancora nessuna stima');
  await shot(page, 'brain-costi');
  await p.getByTestId('bx-chart-spesa-chat-7').scrollIntoViewIfNeeded();
  await shot(page, 'brain-costi-chat');
  await p.getByTestId('bx-calc').getByLabel('Il lavoro da stimare').fill('Fix the login bug');
  await p.getByTestId('bx-calc').getByRole('button', { name: 'Stima' }).click();
  await expect(p.getByTestId('bx-calc-result')).toContainText('Stima senza dati');
  await p.getByRole('button', { name: '30 giorni' }).click();
  await expect(p.getByTestId('bx-lead')).toContainText('in 30 giorni');
});

test('Qualità: errors (charts + table), rules, praise, notebooks, proposals, measures, bugs', async () => {
  await open('qualita');
  const p = page.getByTestId('brain-page-qualita');
  await settled();
  await expect(p.getByTestId('bx-chart-errori-per-tipo')).toBeVisible();
  await expect(p.getByTestId('bx-table-errori-ia')).toContainText('46 righe');
  await shot(page, 'brain-qualita');
  for (const [tab, text] of [['regole', 'hanno funzionato'], ['lodi', 'perfetto'], ['taccuini', 'qa-runner'], ['proposte', 'applicate ma solo'], ['misure', 'Interventi forzati per giorno'], ['bug', 'totale ricalcolato']] as const) {
    await p.getByTestId(`bx-tab-${tab}`).click();
    await expect(p.getByTestId(`bx-quality-${tab}`)).toContainText(text);
  }
  await shot(page, 'brain-qualita-bug');
  await p.getByTestId('bx-tab-misure').click();
  await shot(page, 'brain-qualita-misure');
});

test('Collaborazione: mailboxes (stuck mail), who writes to whom, environments, a 1000+ row log virtualized', async () => {
  await open('collabora');
  const p = page.getByTestId('brain-page-collabora');
  await settled();
  await expect(p.getByTestId('bx-boxes')).toContainText('2 chat hanno posta non letta');
  await expect(p.getByTestId('bx-chart-posta-coppie')).toBeVisible();
  await expect(p.getByTestId('bx-chart-ambienti-minuti')).toBeVisible();
  const log = p.getByTestId('bx-table-posta-registro');
  await expect(log).toContainText(/1\.?1\d\d righe/);
  expect(await log.locator('tbody tr.r').count()).toBeLessThan(80);
  await shot(page, 'brain-collabora');
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

test('Mappa 3D: full screen, essential view, menu, weak points, a flow played; 2D list without WebGL', async () => {
  await open('mappa');
  const m = page.getByTestId('brain-map');
  await expect(m).toBeVisible();
  await expect(m.getByTestId('bx-map-menu')).toContainText('Parli con la Regia');
  await expect(m).toContainText(/\d+ pezzi \(dei \d+ veri\)/);
  const canvas = m.getByTestId('bx-map-canvas').locator('canvas');
  const has3d = await canvas.count().then(n => n > 0, () => false) || await canvas.first().waitFor({ timeout: 8000 }).then(() => true, () => false);
  if (has3d) await page.waitForTimeout(3500); // the layout settles and the camera fits
  await shot(page, 'brain-map');
  await m.getByRole('button', { name: /Parli con la Regia/ }).click();
  await expect(m.getByTestId('bx-map-player')).toContainText('1/3');
  await page.waitForTimeout(1500);
  await shot(page, 'brain-map-flow');
  await m.getByRole('tab', { name: /Punti deboli/ }).click();
  await expect(m.getByTestId('bx-map-menu')).toContainText('contesto fisso');
  await page.keyboard.press('Escape'); // the flow
  await m.getByTestId('bx-map-view').click(); // every file and arrow
  await expect(m).toContainText(/^Mappa del cervello \d+ pezzi · \d+ percorsi/);
  await expect(m.getByTestId('bx-map-view')).toHaveText('Vista essenziale');
  await page.keyboard.press('Escape'); // the map
  await expect(m).toHaveCount(0);

  await open('mappa?flat');
  await expect(page.getByTestId('bx-map-flat')).toContainText('mem.mjs');
  await page.getByTestId('bx-map-flat').getByRole('button', { name: /reviewer/ }).click();
  await expect(page.getByTestId('bx-map-piece')).toContainText('Verso');
  await shot(page, 'brain-map-flat');
  await page.getByTestId('bx-map-close').click();
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
  await open('home');
  await settled();
  await shot(page, 'brain-home-light');
  await page.emulateMedia({ colorScheme: 'dark' });
});
