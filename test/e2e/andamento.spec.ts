// E2E of «Andamento» (ADR 0202) on the frozen demo: one rail entry instead of Costi, Qualità and Classificatori; the
// sticky head with the title and the four tabs; G Q / G K and the old links landing on their tab (Classificatori on Qualità, ADR 0210); one toolbar per tab;
// and the «Uso» tab of the local usage counter (KPIs, uses per day, the ranking, the places never opened). Screenshots
// dark and light in test-results/shots/andamento-*.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

/** the brain-ui fixture brain (as qualita.spec.ts): costs and quality data for the tabs */
const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-andamento-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

test('Andamento: one page with five tabs, old ids as aliases, and the usage counter', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ height: 1100, env: { SB_BRAIN: fixtureBrain() } });
  try {
    // the rail: one entry in ANDAMENTO, Classificatori out of BRAIN
    await expect(page.getByTestId('nav-andamento')).toBeVisible();
    for (const gone of ['costi', 'qualita', 'classificatori']) await expect(page.getByTestId(`nav-${gone}`)).toHaveCount(0);
    await page.getByTestId('nav-andamento').click();
    const an = page.getByTestId('andamento-page');
    await expect(an.locator('h1')).toHaveText('Andamento');
    await expect(page.getByTestId('an-tab-costi')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('an-panel-costi').getByTestId('bx-tab-head')).toBeVisible();
    await expect(page.getByTestId('an-panel-costi').getByTestId('bx-lead')).toHaveCount(0);
    await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30_000 });
    await shot(page, 'andamento-costi-dark');
    // the title stays on screen while a tab scrolls
    await page.locator('.an-scroll').evaluate(el => el.scrollTo({ top: 700 }));
    await expect.poll(() => page.locator('.an-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    await expect(an.locator('h1')).toBeInViewport();
    await shot(page, 'andamento-costi-scrolled-dark');
    // old keys and links land on their tab
    await goPage(page, 'qualita');
    await expect(page.getByTestId('an-tab-qualita')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('an-panel-qualita').getByTestId('bx-q-trovati')).toBeVisible({ timeout: 30_000 });
    // Classificatori folded into Qualità (ADR 0210): no tab of its own, its old id opens Qualità with the section
    await expect(page.getByTestId('an-tab-classificatori')).toHaveCount(0);
    await goPage(page, 'classificatori');
    await expect(page.getByTestId('an-tab-qualita')).toHaveAttribute('aria-selected', 'true');
    const cls = page.getByTestId('an-panel-qualita').getByTestId('bx-q-classifiers');
    await cls.scrollIntoViewIfNeeded({ timeout: 30_000 });
    await expect(cls.getByTestId('cls-grid')).toBeVisible();
    await shot(page, 'andamento-classificatori-dark');
    await page.keyboard.press('Control+K');
    await page.getByTestId('palette-input').fill('sb://memoria/apprendimento');
    await page.getByTestId('palette-item-link').click();
    await expect(page.getByTestId('an-panel-apprendimento').getByTestId('learning-page')).toBeVisible();
    // the arrow keys move between tabs
    await page.getByTestId('an-tab-apprendimento').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('an-tab-uso')).toHaveAttribute('aria-selected', 'true');
    // Uso: the demo's two weeks of counts
    await page.getByTestId('an-tab-uso').click();
    const uso = page.getByTestId('use-tab');
    await expect(uso.getByTestId('bx-tab-head')).toContainText('decidere cosa tenere');
    await expect(uso.getByTestId('use-kpi-total')).not.toContainText(/^0$/);
    await expect(uso.getByTestId('use-list').locator('li').first()).toContainText('Grindhouse');
    await expect(uso.getByTestId('use-never')).toBeVisible();
    await shot(page, 'andamento-uso-dark');
    await theme(page, 'light');
    await shot(page, 'andamento-uso-light');
    await page.getByTestId('an-tab-costi').click();
    await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30_000 });
    await shot(page, 'andamento-costi-light');
    // a page in the ranking opens on click
    await page.getByTestId('an-tab-uso').click();
    await uso.getByRole('button', { name: /^Apri Task/ }).click();
    await expect(page.getByTestId('page-task')).toBeVisible();
  } finally { await app.close(); }
});
