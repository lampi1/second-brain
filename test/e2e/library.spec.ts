// E2E of Memoria → Artifact (ADR 0317) on the frozen demo: the tab right after «Diario e note» with its count, the demo's
// artifacts grouped by day (a report with two versions, an HTML report with its picture, a PDF, screenshots from two
// chats, one file gone and shown as missing, a csv, an SVG and a Word file), the search and the type filter, the list view, a card opening the viewer
// with the artifact bar (source chat, versions, related), and a missing file still listed. Screenshots dark and light:
// test-results/shots/library-*.png.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function visit(page: Page, link: string) {
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill(link);
  await page.keyboard.press('Enter');
}

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

test('Memoria → Artifact: gallery by day, filters, versions, missing file, viewer with the artifact bar', async () => {
  test.setTimeout(180_000);
  const { app, page } = await launchDemo({ height: 1000, width: 1500 });
  try {
    await visit(page, 'sb://memoria/artifact');
    // the tab comes right after «Diario e note»
    const tabs = page.getByTestId('mh-tabs').getByRole('tab');
    const ids = await tabs.evaluateAll(els => els.map(e => e.getAttribute('data-tab')));
    expect(ids.slice(-2)).toEqual(['file', 'artifact']);
    await expect(page.getByTestId('mh-panel-artifact')).toBeVisible();
    // the demo's artifacts: two versions of the cost analysis are one card, the deleted draft is still there, missing
    await expect(page.getByTestId('lib-count')).toHaveText(/^\d+ artifact$/, { timeout: 30_000 });
    const costs = page.locator('[data-testid="lib-card"]', { hasText: 'Analisi dei costi degli agenti' });
    await expect(costs).toHaveCount(1);
    await expect(costs).toContainText('2 versioni');
    const gone = page.locator('[data-testid="lib-card"]', { hasText: 'Bozza del confronto prezzi' });
    await expect(gone).toContainText('File mancante', { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Oggi/ })).toBeVisible();
    // the HTML report's picture is the report drawn small; the screenshot's is the image
    const qa = page.locator('[data-testid="lib-card"]', { hasText: 'QA rimborsi' });
    await expect(qa.locator('.lib-mini')).toBeVisible({ timeout: 20_000 });
    await expect(qa).toContainText('QA · Rimborsi');
    await expect(page.locator('.lib-thumb img').first()).toBeVisible({ timeout: 20_000 });
    // every kind of file: a table shows its first lines, an SVG itself, a Word file its tile; their kinds join the row
    await expect(page.locator('[data-testid="lib-card"]', { hasText: 'Export rimborsi' }).locator('.lib-lines')).toContainText('Rimborso parziale', { timeout: 20_000 });
    await expect(page.locator('[data-testid="lib-card"]', { hasText: 'Flusso rimborsi' }).locator('.lib-thumb img')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="lib-card"]', { hasText: 'Verbale riunione rilascio' }).locator('.lib-tile')).toContainText('DOCX', { timeout: 20_000 });
    await expect(page.getByTestId('lib-kind-data')).toBeVisible();
    await expect(page.getByTestId('lib-kind-document')).toBeVisible();
    await expect(page.getByTestId('lib-kind-media')).toHaveCount(0);
    // the tab bar on top, the gallery under it (only the hub's frame scrolls)
    await page.getByTestId('mh-panel-artifact').evaluate(el => { const f = el.closest('.bx-scroll'); const bar = el.previousElementSibling; if (f && bar) f.scrollTop += el.getBoundingClientRect().top - f.getBoundingClientRect().top - bar.getBoundingClientRect().height; });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    await shot(page, 'library-gallery-dark');
    await theme(page, 'light');
    await shot(page, 'library-gallery-light');
    await theme(page, 'dark');

    // the search and the type filter
    await page.getByTestId('lib-search').fill('motori');
    await expect(page.getByTestId('lib-count')).toHaveText(/^1 di \d+ artifact$/);
    await page.getByTestId('lib-search').fill('');
    await page.getByTestId('lib-kind-pdf').click();
    await expect(page.locator('[data-testid="lib-card"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="lib-card"]')).toContainText('Audit sicurezza');
    await page.getByTestId('lib-reset').click();
    // the list view
    await page.getByTestId('lib-view-list').click();
    await expect(page.locator('.lib-rows').first()).toBeVisible();
    await shot(page, 'library-list-dark');
    await page.getByTestId('lib-view-grid').click();

    // a card opens the viewer, formatted, with the artifact bar
    await costs.getByTestId('lib-card-open').click();
    await expect(page.getByTestId('viewer-markdown')).toContainText('Cosa cambia');
    const bar = page.getByTestId('lib-vbar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('lib-vbar-chat')).toContainText('Mappa 3D');
    await expect(bar.getByTestId('lib-vbar-versions').locator('option')).toHaveCount(2);
    await shot(page, 'library-viewer-dark');
    // the older version opens its own text
    await bar.getByTestId('lib-vbar-versions').selectOption('1');
    await expect(page.getByTestId('viewer-markdown')).toContainText('31 $');
    await page.keyboard.press('Escape');

    // the HTML report opens rendered
    await qa.getByTestId('lib-card-open').click();
    await expect(page.getByTestId('viewer-report')).toBeVisible();
    await expect(page.getByTestId('lib-vbar-related').first()).toBeVisible();
    await shot(page, 'library-viewer-html-dark');
    await page.keyboard.press('Escape');

    // a csv opens as a table; a Word file, which the viewer does not render, puts «Apri con l'app» first
    await page.locator('[data-testid="lib-card"]', { hasText: 'Export rimborsi' }).getByTestId('lib-card-open').click();
    await expect(page.getByTestId('viewer-csv')).toContainText('Carta scaduta');
    await expect(page.getByTestId('lib-vbar-app')).not.toHaveClass(/primary/);
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="lib-card"]', { hasText: 'Verbale riunione rilascio' }).getByTestId('lib-card-open').click();
    const app2 = page.getByTestId('lib-vbar-app');
    await expect(app2).toHaveClass(/primary/);
    await app2.click();
    await expect(app2).toHaveAttribute('data-opened', 'true');
    await expect(page.locator('.lib-vbar-err')).toHaveCount(0);
    await shot(page, 'library-viewer-docx-dark');
  } finally { await app.close(); }
});
