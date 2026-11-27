// E2E of Memoria → Artifact (ADR 0328) on the frozen demo: the tab right after «Diario e note» with its count, ONE list
// of what the demo's chats were asked to prepare, grouped by day (a report with two versions, an HTML report with its
// picture, a PDF, a csv, a Word file, one file gone and shown as missing), no type chips and no filters, the search,
// the list view, a card opening the viewer with the artifact bar (source chat, versions, related), a Word file read
// in the app, and ✕ taking a card off the list. Screenshots dark and light: test-results/shots/library-*.png.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function visit(page: Page, link: string) {
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill(link);
  await page.keyboard.press('Enter');
}

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

test('Memoria → Artifact: one list by day, versions, missing file, every artifact opens in the viewer, remove', async () => {
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
    // a table shows its first lines, a Word file its tile; nothing divides the list by type
    await expect(page.locator('[data-testid="lib-card"]', { hasText: 'Scenari di rimborso provati' }).locator('.lib-lines')).toContainText('Rimborso parziale', { timeout: 20_000 });
    await expect(page.locator('[data-testid="lib-card"]', { hasText: 'Verbale della riunione di rilascio' }).locator('.lib-tile')).toContainText('DOCX', { timeout: 20_000 });
    await expect(page.locator('[data-testid^="lib-kind-"]')).toHaveCount(0);
    await expect(page.locator('.lib-bar select')).toHaveCount(0);
    // the tab bar on top, the gallery under it (only the hub's frame scrolls)
    await page.getByTestId('mh-panel-artifact').evaluate(el => { const f = el.closest('.bx-scroll'); const bar = el.previousElementSibling; if (f && bar) f.scrollTop += el.getBoundingClientRect().top - f.getBoundingClientRect().top - bar.getBoundingClientRect().height; });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    await shot(page, 'library-gallery-dark');
    await theme(page, 'light');
    await shot(page, 'library-gallery-light');
    await theme(page, 'dark');

    // the search
    await page.getByTestId('lib-search').fill('motori');
    await expect(page.getByTestId('lib-count')).toHaveText(/^1 di \d+ artifact$/);
    await expect(page.locator('[data-testid="lib-card"]')).toContainText('Confronto motori');
    await page.getByTestId('lib-search').fill('');
    // under twenty artifacts there is no next page
    await expect(page.getByTestId('lib-more')).toHaveCount(0);
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

    // a csv opens as a table; a Word file opens as its text and its table, «Apri con l'app» stays beside it
    await page.getByRole('button', { name: 'Apri Scenari di rimborso provati', exact: true }).click();
    await expect(page.getByTestId('viewer-csv')).toContainText('Carta scaduta');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Apri Verbale della riunione di rilascio', exact: true }).click();
    await expect(page.getByTestId('viewer-office')).toContainText('Prossima riunione il primo lunedì dopo il rilascio.');
    await expect(page.getByTestId('viewer-office').locator('table')).toContainText('Firmare l’installer');
    const app2 = page.getByTestId('lib-vbar-app');
    await expect(app2).not.toHaveClass(/primary/);
    await app2.click();
    await expect(app2).toHaveAttribute('data-opened', 'true');
    await expect(page.locator('.lib-vbar-err')).toHaveCount(0);
    await shot(page, 'library-viewer-docx-dark');
    await page.keyboard.press('Escape');

    // ✕ asks once more, then the card leaves the list (the file stays on disk)
    const before = await page.locator('[data-testid="lib-card"]').count();
    await gone.hover();
    await gone.getByTestId('lib-card-remove').click();
    await gone.getByTestId('lib-card-remove-yes').click();
    await expect(page.locator('[data-testid="lib-card"]')).toHaveCount(before - 1);
    await expect(gone).toHaveCount(0);
  } finally { await app.close(); }
});
