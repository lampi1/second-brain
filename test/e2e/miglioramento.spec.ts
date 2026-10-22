// End-to-end: the "Regole imparate" section of the Regole page (ADR 0030, folded into Regole by ADR 0082; the old
// page id and its G R shortcut open Regole) in the frozen demo (SB_DEMO=1 SB_DEMO_FREEZE=1) with the demo's
// /api/improve and 'learn:act' (demo.ts demoLearn): the model choice with its typical error, coverage and n, results
// out of the count, a proposal with its gain (decided in Memoria → Proposte, ADR 0123), the after-check, [Ripristina]; notifications "senza
// dati"; the brain's retired cost/time estimator is not shown (ADR 0053, 0101). The
// clicks go through main and change the page. Screenshots: test-results/shots/miglioramento-*.png.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goPage, launch, setSize, shot, setQuestionsAside } from './helpers';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-learn-'));
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

test('Regole imparate: one card per policy with its numbers and n; its proposal points to Proposte, Ripristina changes it', async () => {
  await expect(page.getByTestId('nav-miglioramento')).toHaveCount(0); // no page of its own any more
  await goPage(page, 'regole');
  const p = page.getByTestId('page-miglioramento');
  await expect(p.getByTestId('bx-learn-estimates')).toHaveCount(0);
  const est = p.getByTestId('bx-learn-routing');
  await expect(est).toBeVisible({ timeout: 30000 });
  await expect(p.getByTestId('bx-learned-lead')).toContainText('1 proposta da decidere');

  await expect(est).toContainText('Scelta del modello');
  await expect(est).toContainText('v2');
  await expect(est.getByTestId('bx-learn-error')).toContainText('×1,7');
  await expect(est.getByTestId('bx-learn-error')).toContainText('sulle ultime 30');
  await expect(est.getByTestId('bx-learn-cover')).toContainText('84% delle volte (su 30)');
  await expect(est.getByTestId('bx-learn-out')).toContainText('5 con esito sconosciuto');
  await expect(est.getByTestId('bx-learn-proposal')).toContainText('stessa area e tipo');
  await expect(est.getByTestId('bx-learn-proposal')).toContainText('su 42 casi in comune');
  await expect(est.getByTestId('bx-learn-check')).toContainText('migliorata');
  await expect(est.getByTestId('bx-learn-rollback')).toHaveText('Ripristina v1');
  const notify = p.getByTestId('bx-learn-notifications');
  await expect(notify.getByTestId('bx-learn-error')).toContainText('senza dati: 12 misurati, ne servono 20');
  await shot(page, 'miglioramento');
  // the intro and a "?" beside the terms that are not obvious: its explanation on focus
  await expect(p.getByText('Niente cambia finché non la approvi in Memoria → Proposte')).toBeVisible();
  await est.getByTestId('bx-help-h-prop-routing').focus();
  await expect(est.getByRole('tooltip').filter({ hasText: 'almeno 30' })).toBeVisible();
  await shot(page, 'miglioramento-aiuto');
  await est.getByTestId('bx-help-h-prop-routing').blur();

  // the proposal is decided in Memoria → Proposte (ADR 0123): here a line points there, no button decides it
  await expect(est.getByTestId('bx-learn-proposal').getByTestId('proposals-pointer')).toBeVisible();
  await expect(est.getByTestId('bx-learn-apply')).toHaveCount(0);

  // [Ripristina v1]: back to v1, nothing more to go back to
  await est.getByTestId('bx-learn-rollback').click();
  await expect(est.getByTestId('bx-learn-rollback')).toHaveCount(0);
  await expect(est).toContainText('v1');
});

test('the old page id and its G R shortcut land on Regole, with the learned rules in it', async () => {
  await page.getByTestId('nav-home').click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press('r');
  await expect(page.getByTestId('nav-memoria')).toHaveAttribute('aria-current', 'page'); // Memoria → Regole (ADR 0122)
  await expect(page.getByTestId('page-miglioramento')).toBeVisible();
});
