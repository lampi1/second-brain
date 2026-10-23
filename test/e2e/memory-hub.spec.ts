// E2E of the Memoria hub (ADR 0122) on the frozen demo brain: the live top (the day's sentence, the counters, the latest
// changes, the one «Manutenzione»), the tab bar in order with counts and arrow keys, a deep link memoria/<tab>, the old
// pages' G-keys (G S, G L, G T, G I, G J, G D) landing on their tab with the rail free of them, and the trash in
// «Approvate» with «Annulla» that puts the rule back. Screenshots of every tab dark and light: test-results/shots/hub-*.png.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goPage, launchDemo, shot } from './helpers';

// the synthetic brain of test/fixtures/brain-ui answers the brain pages (Idee, Script) as in discuss.spec.ts
const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'brain-ui');
function fixtureBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-e2e-hub-'));
  fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'brain-site.mjs'), path.join(d, 'ops', 'tools', 'brain-site.mjs'));
  fs.copyFileSync(path.join(FIX, 'data.mjs'), path.join(d, 'ops', 'tools', 'brain-ui-data.mjs'));
  return d;
}

const TABS = ['proposte', 'approvate', 'skill', 'regole', 'script', 'idee', 'app', 'file', 'apprendimento', 'statistiche'] as const;

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

async function visit(page: Page, link: string) {
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill(link);
  await page.keyboard.press('Enter');
}

async function openTab(page: Page, id: (typeof TABS)[number]) {
  await page.getByTestId(`mh-tab-${id}`).click();
  const panel = page.getByTestId(`mh-panel-${id}`);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('bx-loading')).toHaveCount(0, { timeout: 30000 });
  // the tab bar on top, its panel right under it (only the hub's frame scrolls)
  await panel.evaluate(el => { const f = el.closest('.bx-scroll'); const bar = el.previousElementSibling; if (f && bar) f.scrollTop += el.getBoundingClientRect().top - f.getBoundingClientRect().top - bar.getBoundingClientRect().height; });
  await page.mouse.move(700, 995); // no hover tooltip in the shot
  await page.waitForTimeout(450); // the panel's entry and the ink settle
}

test('Memoria hub: live top, tabs with keys and deep links, old G-keys, trash with undo, every tab dark and light', async () => {
  test.setTimeout(240_000);
  const { app, page } = await launchDemo({ height: 1000, width: 1440, env: { SB_BRAIN: fixtureBrain() } });
  try {
    // the rail: Memoria only, with no Dashboard nor the pages that became tabs
    for (const id of ['dashboard', 'skill', 'regole', 'script', 'idee', 'apprendimento']) await expect(page.getByTestId(`nav-${id}`)).toHaveCount(0);
    await page.getByTestId('nav-memoria').click();
    const mem = page.getByTestId('bm-memory-page');
    await expect(mem).toHaveAttribute('data-tab', 'proposte');

    // the live top
    const hero = mem.getByTestId('mh-hero');
    await expect(hero.getByTestId('dash-headline')).not.toBeEmpty();
    for (const p of ['proposals', 'working', 'waiting', 'changes', 'lines']) await expect(hero.getByTestId(`mh-pulse-${p}`)).toBeVisible();
    await expect(page.getByTestId('bm-maint-now-run')).toHaveCount(1); // «Manutenzione» once, in the head

    // the tabs, in order, with arrow keys
    const tabs = mem.getByTestId('mh-tabs').getByRole('tab');
    await expect(tabs).toHaveCount(TABS.length);
    for (const [i, id] of TABS.entries()) await expect(tabs.nth(i)).toHaveAttribute('data-testid', `mh-tab-${id}`);
    await expect(page.getByRole('tab', { name: /Script/ })).toHaveCount(1);
    await page.getByTestId('mh-tab-proposte').focus();
    await page.keyboard.press('ArrowRight');
    await expect(mem).toHaveAttribute('data-tab', 'approvate');
    await expect(page.getByTestId('mh-tab-approvate')).toBeFocused();
    await page.keyboard.press('End');
    await expect(mem).toHaveAttribute('data-tab', 'statistiche');
    await expect(page.getByTestId('mh-tab-statistiche')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(mem).toHaveAttribute('data-tab', 'proposte');
    await expect(page.getByTestId('mh-tab-proposte')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(mem).toHaveAttribute('data-tab', 'statistiche');

    // the old G-keys land on their tab
    const keys: [Parameters<typeof goPage>[1], string][] = [['skill', 'skill'], ['regole', 'regole'], ['script', 'script'], ['idee', 'idee'], ['dashboard', 'proposte']];
    for (const [key, tab] of keys) {
      await goPage(page, key);
      await expect(page.getByTestId('page-memoria')).toBeVisible();
      await expect(mem).toHaveAttribute('data-tab', tab);
      await expect(page.getByTestId(`mh-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
    }
    await expect(page.getByTestId('nav-memoria')).toHaveAttribute('aria-current', 'page');

    // a deep link memoria/<tab>
    await visit(page, 'sb://memoria/file');
    await expect(mem).toHaveAttribute('data-tab', 'file');
    await expect(mem.getByTestId('bm-maint-memory')).toBeVisible();

    // «Approvate»: the bin takes a rule out, «Annulla» puts it back
    await openTab(page, 'approvate');
    const ap = mem.getByTestId('mh-approved');
    for (const g of ['skill', 'rule', 'script']) await expect(ap.getByTestId(`mh-ap-group-${g}`)).toBeVisible();
    const rule = ap.getByTestId('mh-ap-group-rule').locator('[data-testid^="mh-ap-rule-"]:not([data-locked="true"])').first();
    const rowId = await rule.getAttribute('data-testid');
    const delId = rowId!.replace('mh-ap-', 'mh-del-');
    await ap.getByTestId(delId).click();
    await expect(ap.getByTestId(rowId!)).toHaveCount(0);
    const undo = page.getByTestId('toast').filter({ hasText: 'eliminat' }).getByTestId('toast-action');
    await expect(undo).toHaveText('Annulla');
    await undo.click();
    await expect(ap.getByTestId(rowId!)).toBeVisible();
    await expect(page.getByTestId('toast').filter({ hasText: 'rimess' })).toBeVisible();
    for (const x of await page.getByTestId('toast-close').all()) await x.click().catch(() => undefined);

    // every tab, dark then light
    await visit(page, 'sb://memoria/proposte');
    await page.waitForTimeout(800); // the counters finish counting
    await shot(page, 'hub-top-dark');
    for (const id of TABS) { await openTab(page, id); await shot(page, `hub-${id}-dark`); }
    await theme(page, 'light');
    await openTab(page, 'proposte');
    await shot(page, 'hub-top-light');
    for (const id of TABS) { await openTab(page, id); await shot(page, `hub-${id}-light`); }
    // Idee: yours and the AI's, «Rispolvera» brings an old one back
    await openTab(page, 'idee');
    await expect(page.getByTestId('bx-tab-mie')).toBeVisible();
    await expect(page.getByTestId('bx-tab-ia')).toBeVisible();
    await page.getByTestId('mh-dust').click();
    await expect(page.getByTestId('mh-dusted')).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, 'hub-idee-dust-light');
    await page.getByTestId('bx-tab-ia').click();
    await expect(page.getByTestId('bx-tab-ia')).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(300);
    await shot(page, 'hub-idee-ia-light');
  } finally { await app.close(); }
});

// Regression: a narrow center pane must expose every tab and complete approved-memory text.
// Authored for the normal E2E run on main; do not run as part of this branch fix.
test('Memoria keeps all tabs and long approved entries readable in a narrow pane', async () => {
  const { app, page } = await launchDemo({ height: 900, width: 1200, env: { SB_BRAIN: fixtureBrain() } });
  try {
    await page.getByTestId('nav-memoria').click();
    const mem = page.getByTestId('bm-memory-page');
    await mem.evaluate(el => { el.style.width = '580px'; el.style.maxWidth = '100%'; });
    await page.getByTestId('mh-tab-approvate').click();
    const bar = page.getByTestId('mh-tabs');
    await expect.poll(() => bar.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    for (const id of TABS) {
      await expect(page.getByTestId(`mh-tab-${id}`)).toBeVisible();
      expect(await page.getByTestId(`mh-tab-${id}`).evaluate(el => {
        const box = el.getBoundingClientRect(), parent = el.parentElement!.getBoundingClientRect();
        return box.left >= parent.left && box.right <= parent.right && box.bottom <= parent.bottom;
      })).toBe(true);
    }
    const row = mem.locator('.mh-row-name').first();
    await expect(row).toBeVisible();
    await row.evaluate(el => { (el.querySelector('code') ?? el).textContent = 'Una regola con un nome molto lungo che deve restare leggibile '.repeat(3); });
    await expect.poll(() => row.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await shot(page, 'hub-narrow-approved-unclipped');
    await page.getByTestId('mh-tab-statistiche').click();
    await expect(mem).toHaveAttribute('data-tab', 'statistiche');
    await shot(page, 'hub-narrow-unclipped');
  } finally { await app.close(); }
});
