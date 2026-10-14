// E2E of the DevOps page's "Test e QA" section with the demo data (SB_DEMO: qa-status.mjs --mine --json faked by
// devops/demo.ts, no network): after "Aggiorna ora" each PR with a test plan shows done/missing, who ran how many, the
// failed and blocked test cases first with who and when, a QA bug under its test case, the ones still to do with who they
// are assigned to; names and titles only (no ids in the text); "Copia per lo stand-up" copies the same as plain text.
// Screenshots dark and light.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';
// the demo DevOps data's pull request URL (src/main/devops/demo.ts)
const prUrl = (id: number) => `https://dev.azure.com/o/Shop/_git/shop-web/pullrequest/${id}`;

test('DevOps page: Test e QA shows done/missing, who ran them, QA bugs, and copies the stand-up', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.getByTestId('nav-devops').click();
    const dv = page.getByTestId('brain-page-devops');
    await dv.getByTestId('devops-refresh').click();
    const qa = dv.getByTestId('devops-qa');
    await expect(qa).toBeVisible({ timeout: 30_000 });
    await expect(qa).toContainText('mancano 4 test case');
    await expect(qa).toContainText('eseguiti da Giulia Bianchi 2, Sara Neri 2');

    const card = qa.getByTestId('qa-report-812');
    await expect(card.getByTestId('qa-headline')).toHaveText('4 su 6 fatti · mancano 2 · 1 fallito · 1 bloccato · 1 bug aperto');
    await expect(card.getByRole('link', { name: /Rimborso: lo sconto in origine entra nel totale/ })).toHaveAttribute('href', prUrl(812));
    await card.getByTestId('qa-plan-7000').locator('summary').click();
    const failed = card.getByTestId('qa-point-1');
    await expect(failed).toContainText('fallito');
    await expect(failed).toContainText('Giulia Bianchi');
    await expect(failed.getByRole('link', { name: 'Rimborso parziale: lo sconto di riga si perde con due righe uguali' })).toHaveAttribute('href', 'https://dev.azure.com/o/Shop/_workitems/edit/5201');
    await expect(card.getByTestId('qa-point-5')).toContainText('assegnato a Sara Neri');
    // failed first, then blocked, then the ones to do
    await expect(card.locator('.qa-points li').first()).toHaveAttribute('data-testid', 'qa-point-1');
    await expect(card.locator('.qa-points li').nth(1)).toHaveAttribute('data-testid', 'qa-point-4');
    await expect(card).toContainText('Il messaggio di conferma del reso è in inglese'); // a bug not on a test case
    await expect(qa.getByTestId('qa-report-809').getByTestId('qa-headline')).toHaveText('0 su 2 fatti · mancano 2');
    // names and titles: the visible text carries no ids (they stay inside links)
    const text = await qa.innerText();
    expect(text).not.toMatch(/\b(812|809|5201|5101|7000)\b/);

    await qa.getByTestId('qa-copy').click();
    await expect(page.getByTestId('toasts')).toContainText('Stand-up copiato');
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toContain('PR «Rimborso: lo sconto in origine entra nel totale»: 4 su 6 fatti');
    expect(copied).toContain('- fallito: Reso parziale con sconto di riga (Giulia Bianchi)');

    await qa.scrollIntoViewIfNeeded();
    await shot(page, 'devops-qa-dark');
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(300);
    await shot(page, 'devops-qa-light');
  } finally {
    await app.close();
  }
});
