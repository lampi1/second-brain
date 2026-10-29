// End-to-end: the Qualità page in the frozen demo (SB_DEMO=1 SB_DEMO_FREEZE=1) pointed at the synthetic brain of
// test/fixtures/brain-ui (SB_BRAIN), with the demo's /api/quality (demo.ts demoQuality: turns, held PRs, reopened bugs).
// Four metrics, each with its source and dates; rows out of the count said on screen; the details open; proposals in
// one row that opens the Proposte deck in Memoria. Screenshots: test-results/shots/qualita-*.png.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, setSize, shot, goPage, setQuestionsAside } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-qualita-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}

let app: ElectronApplication, page: Page;
test.beforeAll(async () => {
  ({ app, page } = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_BRAIN: fixtureBrain() }));
  await setSize(app, 1600, 1000);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.getByTestId('app')).toBeVisible();
  await setQuestionsAside({ app, page }); // the demo's requests: «Rispondi dopo» (the window is always on)
});
test.afterAll(async () => { await app?.close(); });

test('Qualità: four true metrics with source and dates, out-of-count rows visible, proposals in one row', async () => {
  await goPage(page, 'qualita');
  const p = page.getByTestId('page-qualita');
  await expect(p.getByTestId('bx-q-trovati')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30000 });

  // 1) his corrections per 100 turns (ADR 0197): the logs' days, both sides, with the breakdown and «Come lo conto»
  const caught = p.getByTestId('bx-q-trovati');
  await expect(caught).toContainText('ogni 100 turni');
  await expect(caught).toContainText(/Fonte: le tue correzioni.*ai-errors\.md.*dal .* al /);
  await expect(caught).toContainText(/correzioni tue su .* turni: .*«Correggi il pensiero»/);
  await expect(caught.getByTestId('bx-q-trovati-how')).toContainText('Come lo conto');
  // 2) rules: judged ones only, young ones "troppo presto", rows out of the count said
  const rules = p.getByTestId('bx-q-tornati');
  await expect(rules).toContainText('2 su 4');
  await expect(rules).toContainText('2 regole troppo recenti');
  await expect(rules.getByTestId('bx-q-fuori')).toContainText('3 illeggibili');
  await expect(rules.getByTestId('bx-q-regole').locator('li').first()).toContainText('tornato');
  // 3) PRs held, with why; 4) reopened bugs with who and when
  await expect(p.getByTestId('bx-q-pr')).toContainText('2');
  await expect(p.getByTestId('bx-q-pr-list')).toContainText('test case fallito: Sconto in fattura saldo');
  await expect(p.getByTestId('bx-q-riaperti')).toContainText('su 38 risolti da te (8%)');
  await expect(p.getByTestId('bx-q-riaperti-list')).toContainText('riaperto');
  await expect(p.getByTestId('bx-lead')).toContainText('correzioni ogni 100 turni');
  // gone until they have data
  for (const gone of ['lodi', 'taccuini', 'misure']) await expect(p.getByTestId(`bx-tab-${gone}`)).toHaveCount(0);
  await shot(page, 'qualita');

  await caught.getByText('Giorno per giorno').click();
  await expect(caught.getByTestId('bx-q-trovati-days').locator('li').first()).toBeVisible();
  await rules.getByText('Quali righe').click();
  await expect(rules).toContainText('«bug-introdotto»');
  await shot(page, 'qualita-dettagli');

  await p.getByTestId('bx-q-proposte').getByRole('button', { name: 'Decidi in Memoria' }).click();
  await expect(page.getByTestId('page-memoria')).toBeVisible();
});
